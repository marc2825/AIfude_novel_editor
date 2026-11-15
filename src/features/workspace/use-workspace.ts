"use client";

import { authoringProfilesEqual, type AuthoringProfile } from "../../domain/authoring-profile";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSyncPayload } from "../../domain/sync";
import { SyncRepository } from "../../persistence/sync-repository";
import { receiveRemote, sendPending, type WorkspaceSyncActions } from "../sync/operations";

import {
  aiConsentSchema,
  aiModelPreferenceSchema,
  parseWorkspaceSnapshot,
  persistedDocumentSchema,
  workspaceSettingsInputSchema,
  type AiConsent,
  type AiModelPreference,
  type WorkspaceSettingsInput,
  type WorkspaceSnapshot,
} from "../../domain/workspace";
import { TrashRepository, TrashVersionConflictError, type TrashEntry } from "../../persistence/trash-repository";
import { orderedChapters, withChapters } from "../../domain/chapters";
import { WritingHistoryRepository, createHistoryEntry, type WritingHistoryEntry } from "../../persistence/writing-history";
import { LibraryBackupRepository, type LibraryBackup } from "../../persistence/library-backup";
import { AI_EXTERNAL_CONSENT_POLICY_VERSION } from "../../domain/limits";
import { storyMemoriesEqual, type StoryMemory } from "../../domain/story-memory";
import { openWorkspaceDatabase } from "../../persistence/indexeddb";
import {
  SaveCoordinator,
  type SaveCoordinatorStatus,
} from "../../persistence/save-coordinator";
import {
  type StoredWorkspaceReference,
  type WorkspaceFileInfo,
  WorkspaceRepository,
  WorkspaceVersionConflictError,
} from "../../persistence/workspace-repository";
import {
  acquireWorkspaceLock,
  type WorkspaceLockLease,
  type WorkspaceLockStatus,
} from "../../persistence/workspace-lock";
import { prepareWorkspaceImport } from "./backup";
import { createWritingWorkspace } from "./workspace-files";

export type WorkspaceAccess =
  | "editable"
  | "locked"
  | "unsupported"
  | "conflict";

type WorkspaceOperation = "idle" | "importing" | "deleting" | "switching" | "processing";

export type WorkspaceSessionState =
  | Readonly<{ phase: "hydrating" }>
  | Readonly<{ phase: "load-error" }>
  | Readonly<{ phase: "deleted"; files: readonly WorkspaceFileInfo[] }>
  | Readonly<{
      access: Exclude<WorkspaceAccess, "editable" | "conflict">;
      phase: "unavailable";
    }>
  | Readonly<{
      access: WorkspaceAccess;
      editorSession: number;
      operation: WorkspaceOperation;
      phase: "ready";
      saveStatus: SaveCoordinatorStatus;
      workspace: WorkspaceSnapshot;
      files: readonly WorkspaceFileInfo[];
    }>;

export type WorkspaceActionResult = Readonly<{
  message?: string;
  ok: boolean;
}>;

const initialState: WorkspaceSessionState = { phase: "hydrating" };


function accessForLock(
  status: WorkspaceLockStatus,
): Exclude<WorkspaceAccess, "conflict"> {
  if (status === "acquired") {
    return "editable";
  }

  return status === "unavailable" ? "locked" : "unsupported";
}

function actionFailureMessage(error: unknown, action: "import" | "delete") {
  if (error instanceof WorkspaceVersionConflictError) {
    return action === "import"
      ? "保存先が更新されたため、バックアップを取り込めませんでした。"
      : "保存先が更新されたため、ローカルデータを削除できませんでした。";
  }

  return action === "import"
    ? "バックアップを保存できませんでした。現在の作品は変更されていません。"
    : "ローカルデータを削除できませんでした。";
}

export function useWorkspace() {
  const editorEpochsRef = useRef(new Map<string, number>());
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const accessRef = useRef<WorkspaceAccess>("unsupported");
  const contentRevisionRef = useRef(0);
  const coordinatorRef = useRef<SaveCoordinator | null>(null);
  const consentMutationRef = useRef(false);
  const databaseRef = useRef<Awaited<
    ReturnType<typeof openWorkspaceDatabase>
  > | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const leaseRef = useRef<WorkspaceLockLease | null>(null);
  const mountedRef = useRef(false);
  const modelPreferenceMutationRef = useRef(false);
  const operationRef = useRef<WorkspaceOperation>("idle");
  const persistedReferenceRef = useRef<StoredWorkspaceReference | null>(null);
  const repositoryRef = useRef<WorkspaceRepository | null>(null);
  const snapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const settingsSaveRef = useRef(false);
  const [state, setState] = useState<WorkspaceSessionState>(initialState);

  const currentSnapshot = useCallback((): WorkspaceSnapshot | null => {
    const current = snapshotRef.current;

    if (current === null) {
      return null;
    }

    const editor = editorRef.current;
    const body =
      editor === null
        ? current.chapter.body
        : persistedDocumentSchema.parse(editor.state.doc.toJSON());

    return parseWorkspaceSnapshot({
      ...current,
      chapter: {
        ...current.chapter,
        body,
        contentRevision: contentRevisionRef.current,
      },
    });
  }, []);

  const installCoordinator = useCallback((): SaveCoordinator => {
    const coordinator = new SaveCoordinator({
      onStateChange(nextState) {
        if (!mountedRef.current) {
          return;
        }

        const conflict =
          nextState.error instanceof WorkspaceVersionConflictError;

        if (conflict) {
          accessRef.current = "conflict";
        }

        setState((current) => {
          if (current.phase !== "ready") {
            return current;
          }

          return {
            ...current,
            access: conflict ? "conflict" : current.access,
            saveStatus: nextState.status,
          };
        });
      },
      async save(savingSequence) {
        const repository = repositoryRef.current;
        const current = currentSnapshot();

        if (repository === null || current === null) {
          throw new Error("保存対象のworkspace sessionがありません。");
        }

        const previous = current.project.autoHistoryEnabled ? await repository.load() : null;
        const timestamp = new Date().toISOString();
        const savedSnapshot = await repository.save(
          parseWorkspaceSnapshot({
            ...current,
            project: { ...current.project, updatedAt: timestamp },
            document: { ...current.document, updatedAt: timestamp },
            chapter: { ...current.chapter, updatedAt: timestamp },
          }),
        );

        if (previous !== null && databaseRef.current !== null &&
            (JSON.stringify(previous.chapter.body) !== JSON.stringify(savedSnapshot.chapter.body) ||
             JSON.stringify(previous.project.storyMemory) !== JSON.stringify(savedSnapshot.project.storyMemory))) {
          try {
            await new WritingHistoryRepository(databaseRef.current).add(createHistoryEntry(previous, "自動保存前の状態", "autosave"));
            if (mountedRef.current) setHistoryWarning(null);
          } catch {
            if (mountedRef.current) setHistoryWarning("本文は保存されましたが、保存履歴を記録できませんでした。");
          }
        }

        if (coordinatorRef.current === coordinator) {
          const hasNewerChanges =
            coordinator.state.dirtySequence > savingSequence;
          const latest = hasNewerChanges ? currentSnapshot() : null;
          snapshotRef.current =
            latest === null
              ? savedSnapshot
              : parseWorkspaceSnapshot({
                  ...latest,
                  storageVersion: savedSnapshot.storageVersion,
                });
          persistedReferenceRef.current = {
            projectId: savedSnapshot.project.id,
            storageVersion: savedSnapshot.storageVersion,
          };

          if (mountedRef.current) {
            setState((currentState) =>
              currentState.phase === "ready"
                ? {
                    ...currentState,
                    workspace: hasNewerChanges
                      ? parseWorkspaceSnapshot({
                          ...currentState.workspace,
                          storageVersion: savedSnapshot.storageVersion,
                        })
                      : savedSnapshot,
                    files: currentState.files.map((file) => file.projectId === savedSnapshot.project.id
                      ? { projectId: file.projectId, title: savedSnapshot.project.title } : file),
                  }
                : currentState,
            );
          }
        }
      },
    });
    coordinatorRef.current = coordinator;
    return coordinator;
  }, [currentSnapshot]);

  useEffect(() => {
    let active = true;
    let openedDatabase: Awaited<
      ReturnType<typeof openWorkspaceDatabase>
    > | null = null;
    let acquiredLease: WorkspaceLockLease | null = null;
    mountedRef.current = true;

    async function hydrate(): Promise<void> {
      try {
        openedDatabase = await openWorkspaceDatabase();

        if (!active) {
          openedDatabase.close();
          return;
        }

        acquiredLease = await acquireWorkspaceLock();

        if (!active) {
          acquiredLease.release();
          await acquiredLease.released.catch(() => undefined);
          openedDatabase.close();
          return;
        }

        const repository = new WorkspaceRepository(openedDatabase);
        let workspace = await repository.load();
        const storedFiles = await repository.listFiles();
        const access = accessForLock(acquiredLease.status);
        if (workspace === null && storedFiles.length > 0 && access === "editable") {
          workspace = await repository.activateFile(null, storedFiles[0].projectId);
        }
        let persistedReference: StoredWorkspaceReference | null =
          workspace === null
            ? null
            : {
                projectId: workspace.project.id,
                storageVersion: workspace.storageVersion,
              };

        if (!active) {
          acquiredLease.release();
          await acquiredLease.released.catch(() => undefined);
          openedDatabase.close();
          return;
        }

        if (workspace === null && access !== "editable") {
          databaseRef.current = openedDatabase;
          leaseRef.current = acquiredLease;
          repositoryRef.current = repository;
          accessRef.current = access;
          setState({ access, phase: "unavailable" });
          return;
        }

        let initialSaveStatus: SaveCoordinatorStatus = "saved";

        if (workspace === null) {
          workspace = createWritingWorkspace();

          try {
            workspace = await repository.save(workspace);
            persistedReference = {
              projectId: workspace.project.id,
              storageVersion: workspace.storageVersion,
            };
          } catch (error: unknown) {
            if (error instanceof WorkspaceVersionConflictError) {
              throw error;
            }
            initialSaveStatus = "error";
          }
        }

        if (!active) {
          acquiredLease.release();
          await acquiredLease.released.catch(() => undefined);
          openedDatabase.close();
          return;
        }

        databaseRef.current = openedDatabase;
        leaseRef.current = acquiredLease;
        persistedReferenceRef.current = persistedReference;
        repositoryRef.current = repository;
        accessRef.current = access;
        contentRevisionRef.current = workspace.chapter.contentRevision;
        snapshotRef.current = workspace;

        if (access === "editable") {
          installCoordinator();
        }

        setState({
          access,
          editorSession: 0,
          operation: "idle",
          phase: "ready",
          saveStatus: initialSaveStatus,
          workspace,
          files: [
            { projectId: workspace.project.id, title: workspace.project.title },
            ...storedFiles.filter((file) => file.projectId !== workspace.project.id),
          ],
        });
      } catch {
        if (active) {
          setState({ phase: "load-error" });
        }
        acquiredLease?.release();
        await acquiredLease?.released.catch(() => undefined);
        openedDatabase?.close();
      }
    }

    void hydrate();

    return () => {
      active = false;
      mountedRef.current = false;
      editorRef.current = null;
      snapshotRef.current = null;
      operationRef.current = "idle";
      persistedReferenceRef.current = null;

      const coordinator = coordinatorRef.current;
      const database = databaseRef.current;
      const lease = leaseRef.current;

      coordinatorRef.current = null;
      databaseRef.current = null;
      leaseRef.current = null;
      repositoryRef.current = null;

      void (async () => {
        await coordinator?.dispose();
        lease?.release();
        await lease?.released.catch(() => undefined);
        database?.close();
      })();
    };
  }, [installCoordinator]);

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  const handleDocumentChange = useCallback((editor: Editor) => {
    if (
      editorRef.current === editor &&
      accessRef.current === "editable" &&
      operationRef.current === "idle"
    ) {
      contentRevisionRef.current += 1;
      coordinatorRef.current?.markDirty();
    }
  }, []);

  const requestImmediateSave = useCallback(() => {
    if (
      accessRef.current === "editable" &&
      operationRef.current === "idle"
    ) {
      void coordinatorRef.current?.flush();
    }
  }, []);

  useEffect(() => {
    // Background suspension may interrupt this best-effort flush. Only the
    // coordinator's completed write can change the UI to "saved".
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") requestImmediateSave();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", requestImmediateSave);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", requestImmediateSave);
    };
  }, [requestImmediateSave]);

  const updateSettings = useCallback(
    async (
      inputValue: WorkspaceSettingsInput,
    ): Promise<WorkspaceActionResult> => {
      const result = workspaceSettingsInputSchema.safeParse(inputValue);
      const current = currentSnapshot();
      const coordinator = coordinatorRef.current;

      if (!result.success) {
        return {
          message: "設定の文字数または入力内容を確認してください。",
          ok: false,
        };
      }

      if (
        current === null ||
        coordinator === null ||
        consentMutationRef.current ||
        modelPreferenceMutationRef.current ||
        settingsSaveRef.current ||
        accessRef.current !== "editable" ||
        operationRef.current !== "idle"
      ) {
        return { message: "現在は設定を変更できません。", ok: false };
      }

      const nextAuthoring = result.data.authoringProfile ?? current.project.authoringProfile;
      const authoringChanged = !authoringProfilesEqual(nextAuthoring, current.project.authoringProfile);
      const nextMemory = result.data.storyMemory ?? current.project.storyMemory;
      const memoryChanged = !storyMemoriesEqual(nextMemory, current.project.storyMemory);
      const unchanged = !memoryChanged && !authoringChanged &&
        current.project.title === result.data.title &&
        current.project.commonPrompt === result.data.commonPrompt &&
        current.styleProfile.manualInstructions ===
          result.data.manualInstructions;

      if (unchanged && coordinator.state.status === "saved") {
        return { ok: true };
      }

      if (!unchanged) {
        const contextChanged = memoryChanged || authoringChanged ||
          current.project.commonPrompt !== result.data.commonPrompt ||
          current.styleProfile.manualInstructions !==
            result.data.manualInstructions;
        const styleChanged =
          current.styleProfile.manualInstructions !==
          result.data.manualInstructions;
        const timestamp = new Date().toISOString();
        let updated: WorkspaceSnapshot;

        try {
          updated = parseWorkspaceSnapshot({
            ...current,
            project: {
              ...current.project,
              commonPrompt: result.data.commonPrompt,
              storyMemory: nextMemory,
              authoringProfile: nextAuthoring,
              contextRevision:
                current.project.contextRevision + (contextChanged ? 1 : 0),
              title: result.data.title,
              updatedAt: timestamp,
            },
            styleProfile: {
              ...current.styleProfile,
              manualInstructions: result.data.manualInstructions,
              revision:
                current.styleProfile.revision + (styleChanged ? 1 : 0),
              updatedAt: styleChanged
                ? timestamp
                : current.styleProfile.updatedAt,
            },
          });
        } catch {
          return {
            message: "設定のversionをこれ以上更新できません。",
            ok: false,
          };
        }

        snapshotRef.current = updated;
        setState((currentState) =>
          currentState.phase === "ready"
            ? { ...currentState, workspace: updated }
            : currentState,
        );
        coordinator.markDirty();
      }
      settingsSaveRef.current = true;

      try {
        await coordinator.flush();
      } finally {
        settingsSaveRef.current = false;
      }

      return coordinator.state.status === "saved"
        ? { ok: true }
        : {
            message:
              coordinator.state.error instanceof WorkspaceVersionConflictError
                ? "保存先が更新されたため、設定を保存できませんでした。"
                : "設定を保存できませんでした。入力内容はこの画面に保持されています。",
            ok: false,
          };
    },
    [currentSnapshot],
  );

  const updateAuthoringProfile = useCallback(async (authoringProfile: AuthoringProfile): Promise<WorkspaceActionResult> => {
    const current = currentSnapshot();
    if (!current) return { ok: false, message: "作品がありません。" };
    return updateSettings({ title: current.project.title, commonPrompt: current.project.commonPrompt,
      manualInstructions: current.styleProfile.manualInstructions, authoringProfile });
  }, [currentSnapshot, updateSettings]);

  const updateStoryMemory = useCallback(async (memory: StoryMemory): Promise<WorkspaceActionResult> => {
    const current = currentSnapshot();
    if (current === null) return { ok: false, message: "現在はメモリを保存できません。" };
    return updateSettings({
      title: current.project.title,
      commonPrompt: current.project.commonPrompt,
      manualInstructions: current.styleProfile.manualInstructions,
      storyMemory: memory,
    });
  }, [currentSnapshot, updateSettings]);

  const updateAiConsent = useCallback(
    async (providerId: string | null): Promise<WorkspaceActionResult> => {
      const current = currentSnapshot();
      const coordinator = coordinatorRef.current;

      if (
        current === null ||
        coordinator === null ||
        consentMutationRef.current ||
        modelPreferenceMutationRef.current ||
        settingsSaveRef.current ||
        accessRef.current !== "editable" ||
        operationRef.current !== "idle"
      ) {
        return { message: "現在はAI送信同意を変更できません。", ok: false };
      }

      const consentValidation = aiConsentSchema.safeParse({
        grantedAt: new Date().toISOString(),
        policyVersion: AI_EXTERNAL_CONSENT_POLICY_VERSION,
        providerId,
      });
      const nextConsent: AiConsent | null =
        providerId === null
          ? null
          : consentValidation.success
            ? consentValidation.data
            : null;

      if (providerId !== null && nextConsent === null) {
        return { message: "AI送信先を確認できません。", ok: false };
      }

      const previousConsent = current.project.aiConsent;
      const unchanged =
        (previousConsent === null && nextConsent === null) ||
        (previousConsent !== null &&
          nextConsent !== null &&
          previousConsent.providerId === nextConsent.providerId &&
          previousConsent.policyVersion === nextConsent.policyVersion);

      if (unchanged) {
        return { ok: true };
      }

      let updated: WorkspaceSnapshot;

      try {
        updated = parseWorkspaceSnapshot({
          ...current,
          project: {
            ...current.project,
            aiConsent: nextConsent,
            contextRevision: current.project.contextRevision + 1,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch {
        return {
          message: "同意情報のversionをこれ以上更新できません。",
          ok: false,
        };
      }

      consentMutationRef.current = true;
      snapshotRef.current = updated;

      if (nextConsent === null) {
        setState((currentState) =>
          currentState.phase === "ready"
            ? { ...currentState, workspace: updated }
            : currentState,
        );
      }

      const consentSequence = coordinator.markDirty();

      try {
        await coordinator.flush();

        if (coordinator.state.savedSequence >= consentSequence) {
          return { ok: true };
        }

        if (nextConsent !== null) {
          const latest = currentSnapshot();

          if (latest !== null) {
            snapshotRef.current = parseWorkspaceSnapshot({
              ...latest,
              project: {
                ...latest.project,
                aiConsent: previousConsent,
                contextRevision: current.project.contextRevision,
                updatedAt: current.project.updatedAt,
              },
            });
          }
        }

        return {
          message:
            nextConsent === null
              ? "同意撤回を保存できませんでした。現在の画面では外部送信を停止しています。"
              : "同意を保存できなかったため、外部送信は有効になっていません。",
          ok: false,
        };
      } finally {
        consentMutationRef.current = false;
      }
    },
    [currentSnapshot],
  );

  const updateAiModelPreference = useCallback(
    async (
      preferenceValue: AiModelPreference,
    ): Promise<WorkspaceActionResult> => {
      const preference = aiModelPreferenceSchema.safeParse(preferenceValue);
      const current = currentSnapshot();
      const coordinator = coordinatorRef.current;

      if (!preference.success) {
        return { message: "AIモデル設定が正しくありません。", ok: false };
      }

      if (
        current === null ||
        coordinator === null ||
        consentMutationRef.current ||
        modelPreferenceMutationRef.current ||
        settingsSaveRef.current ||
        accessRef.current !== "editable" ||
        operationRef.current !== "idle"
      ) {
        return { message: "現在はAIモデルを変更できません。", ok: false };
      }

      if (current.project.aiModelPreference === preference.data) {
        return { ok: true };
      }

      let updated: WorkspaceSnapshot;

      try {
        updated = parseWorkspaceSnapshot({
          ...current,
          project: {
            ...current.project,
            aiModelPreference: preference.data,
            contextRevision: current.project.contextRevision + 1,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch {
        return {
          message: "AIモデル設定のversionをこれ以上更新できません。",
          ok: false,
        };
      }

      modelPreferenceMutationRef.current = true;
      snapshotRef.current = updated;
      setState((currentState) =>
        currentState.phase === "ready"
          ? { ...currentState, workspace: updated }
          : currentState,
      );
      coordinator.markDirty();

      try {
        await coordinator.flush();
      } finally {
        modelPreferenceMutationRef.current = false;
      }

      return coordinator.state.status === "saved"
        ? { ok: true }
        : {
            message:
              coordinator.state.error instanceof WorkspaceVersionConflictError
                ? "保存先が更新されたため、AIモデル設定を保存できませんでした。"
                : "AIモデル設定を保存できませんでした。選択内容はこの画面に保持されています。",
            ok: false,
          };
    },
    [currentSnapshot],
  );

  const stopCoordinator = useCallback(async () => {
    const coordinator = coordinatorRef.current;

    if (coordinator === null) {
      return false;
    }

    await coordinator.dispose();

    if (coordinatorRef.current === coordinator) {
      coordinatorRef.current = null;
    }

    return coordinator.state.status !== "saved";
  }, []);

  const resumeAfterFailure = useCallback(
    (wasDirty: boolean) => {
      if (
        mountedRef.current &&
        accessRef.current === "editable" &&
        snapshotRef.current !== null
      ) {
        const coordinator = installCoordinator();

        if (wasDirty) {
          coordinator.markDirty();
        }
      }
    },
    [installCoordinator],
  );

  const importWorkspace = useCallback(
    async (
      importedValue: WorkspaceSnapshot,
    ): Promise<WorkspaceActionResult> => {
      const repository = repositoryRef.current;
      const current = snapshotRef.current;

      if (
        repository === null ||
        current === null ||
        accessRef.current !== "editable" ||
        operationRef.current !== "idle"
      ) {
        return {
          message: "編集権限がないため、バックアップを取り込めません。",
          ok: false,
        };
      }

      let imported: WorkspaceSnapshot;

      try {
        imported = prepareWorkspaceImport(importedValue);
      } catch {
        return {
          message: "バックアップを安全に取り込めません。",
          ok: false,
        };
      }

      operationRef.current = "importing";
      setState((currentState) =>
        currentState.phase === "ready"
          ? { ...currentState, operation: "importing" }
          : currentState,
      );
      const wasDirty = await stopCoordinator();

      try {
        const latest = snapshotRef.current;

        if (latest === null) {
          throw new Error("現在のworkspaceがありません。");
        }

        const replaced = await repository.replace(
          persistedReferenceRef.current,
          imported,
        );

        if (!mountedRef.current) {
          return { ok: false };
        }

        editorRef.current = null;
        snapshotRef.current = replaced;
        persistedReferenceRef.current = {
          projectId: replaced.project.id,
          storageVersion: replaced.storageVersion,
        };
        contentRevisionRef.current = replaced.chapter.contentRevision;
        operationRef.current = "idle";
        installCoordinator();
        const epoch = (editorEpochsRef.current.get(replaced.project.id) ?? 0) + 1;
        editorEpochsRef.current.set(replaced.project.id, epoch);
        setState((currentState) => ({
          access: "editable",
          editorSession: epoch,
          operation: "idle",
          phase: "ready",
          saveStatus: "saved",
          workspace: replaced,
          files: [
            { projectId: replaced.project.id, title: replaced.project.title },
            ...(currentState.phase === "ready" ? currentState.files.filter((file) => file.projectId !== current.project.id) : []),
          ],
        }));
        return { ok: true };
      } catch (error: unknown) {
        operationRef.current = "idle";

        if (error instanceof WorkspaceVersionConflictError) {
          accessRef.current = "conflict";
        } else {
          resumeAfterFailure(wasDirty);
        }

        setState((currentState) =>
          currentState.phase === "ready"
            ? {
                ...currentState,
                access:
                  error instanceof WorkspaceVersionConflictError
                    ? "conflict"
                    : currentState.access,
                operation: "idle",
              }
            : currentState,
        );
        return {
          message: actionFailureMessage(error, "import"),
          ok: false,
        };
      }
    },
    [installCoordinator, resumeAfterFailure, stopCoordinator],
  );

  const deleteWorkspace = useCallback(async (): Promise<WorkspaceActionResult> => {
    const repository = repositoryRef.current;
    const current = snapshotRef.current;

    if (
      repository === null ||
      current === null ||
      accessRef.current !== "editable" ||
      operationRef.current !== "idle" || settingsSaveRef.current || consentMutationRef.current || modelPreferenceMutationRef.current || editorRef.current?.view.composing
    ) {
      return {
        message: "現在はローカルデータを削除できません。入力・保存を完了し、編集権限を確認してください。",
        ok: false,
      };
    }

    operationRef.current = "deleting";
    const deletingEditor = editorRef.current; deletingEditor?.setEditable(false);
    setState((currentState) =>
      currentState.phase === "ready"
        ? { ...currentState, operation: "deleting" }
        : currentState,
    );
    const wasDirty = await stopCoordinator();

    try {
      const latest = currentSnapshot();

      if (latest === null) {
        throw new Error("現在のworkspaceがありません。");
      }

      let reference = persistedReferenceRef.current;
      if (reference === null) {
        const saved = await repository.save(latest);
        reference = { projectId: saved.project.id, storageVersion: saved.storageVersion };
        persistedReferenceRef.current = reference;
        snapshotRef.current = { ...latest, storageVersion: saved.storageVersion };
      }
      await repository.delete(reference, currentSnapshot() ?? latest);

      editorRef.current = null;
      snapshotRef.current = null;
      persistedReferenceRef.current = null;
      operationRef.current = "idle";

      if (mountedRef.current) {
        setState((currentState) => ({ phase: "deleted", files: currentState.phase === "ready"
          ? currentState.files.filter((file) => file.projectId !== current.project.id) : [] }));
      }

      return { ok: true };
    } catch (error: unknown) {
      operationRef.current = "idle";

      if (error instanceof WorkspaceVersionConflictError) {
        accessRef.current = "conflict";
      } else {
        resumeAfterFailure(wasDirty);
      }

      if (deletingEditor && !deletingEditor.isDestroyed && accessRef.current === "editable") deletingEditor.setEditable(true);
      setState((currentState) =>
        currentState.phase === "ready"
          ? {
              ...currentState,
              access:
                error instanceof WorkspaceVersionConflictError
                  ? "conflict"
                  : currentState.access,
              operation: "idle",
            }
          : currentState,
      );
      return {
        message: actionFailureMessage(error, "delete"),
        ok: false,
      };
    }
  }, [currentSnapshot, resumeAfterFailure, stopCoordinator]);

  const saveWorkspace = useCallback(async (): Promise<WorkspaceActionResult> => {
    const coordinator = coordinatorRef.current;
    if (coordinator === null || accessRef.current !== "editable" || operationRef.current !== "idle" || settingsSaveRef.current) {
      return { ok: false, message: "現在は保存できません。" };
    }
    if (persistedReferenceRef.current === null && snapshotRef.current !== null && coordinator.state.dirtySequence === 0) coordinator.markDirty();
    await coordinator.flush();
    return coordinator.state.status === "saved" ? { ok: true } : { ok: false, message: "保存できませんでした。現在の作品はこの画面に保持されています。" };
  }, []);

  const activateWorkspace = useCallback(async (target: string | WorkspaceSnapshot): Promise<WorkspaceActionResult> => {
    const repository = repositoryRef.current;
    const current = snapshotRef.current;
    const editor = editorRef.current;
    if (repository === null || accessRef.current !== "editable" || operationRef.current !== "idle" || settingsSaveRef.current || consentMutationRef.current || modelPreferenceMutationRef.current || editor?.view.composing) {
      return { ok: false, message: "現在は作品を切り替えられません。入力・保存の完了後に再試行してください。" };
    }
    if (typeof target === "string" && target === current?.project.id) return { ok: true };
    operationRef.current = "switching";
    editor?.setEditable(false);
    setState((value) => value.phase === "ready" ? { ...value, operation: "switching" } : value);
    let stopped = false;
    try {
      const coordinator = coordinatorRef.current;
      if (coordinator !== null) {
        if (persistedReferenceRef.current === null && current !== null && coordinator.state.dirtySequence === 0) coordinator.markDirty();
        await coordinator.flush();
        if (coordinator.state.status !== "saved") throw coordinator.state.error ?? new Error("Unsaved workspace");
        await stopCoordinator();
        stopped = true;
      }
      const next = await repository.activateFile(persistedReferenceRef.current, target);
      if (!mountedRef.current) return { ok: false };
      editorRef.current = null;
      snapshotRef.current = next;
      persistedReferenceRef.current = { projectId: next.project.id, storageVersion: next.storageVersion };
      contentRevisionRef.current = next.chapter.contentRevision;
      operationRef.current = "idle";
      installCoordinator();
      setState((value) => {
        const files = value.phase === "ready" || value.phase === "deleted" ? value.files : [];
        return {
          phase: "ready", access: "editable", editorSession: editorEpochsRef.current.get(next.project.id) ?? 0,
          operation: "idle", saveStatus: "saved", workspace: next,
          files: files.some((file) => file.projectId === next.project.id)
            ? files.map((file) => file.projectId === next.project.id ? { projectId: file.projectId, title: next.project.title } : file)
            : [...files, { projectId: next.project.id, title: next.project.title }],
        };
      });
      return { ok: true };
    } catch (error: unknown) {
      operationRef.current = "idle";
      if (error instanceof WorkspaceVersionConflictError) accessRef.current = "conflict";
      else if (stopped) resumeAfterFailure(false);
      if (editor !== null && !editor.isDestroyed && accessRef.current === "editable") editor.setEditable(true);
      setState((value) => value.phase === "ready" ? { ...value, operation: "idle", access: accessRef.current } : value);
      return { ok: false, message: "保存または読み込みに失敗したため、作品を切り替えませんでした。現在の本文はこの画面に保持されています。" };
    }
  }, [installCoordinator, resumeAfterFailure, stopCoordinator]);

  const changeWritingWorkspace = useCallback(async (
    change: (current: WorkspaceSnapshot) => WorkspaceSnapshot,
    restore = false,
    trashAction?: "delete-chapter" | string,
  ): Promise<WorkspaceActionResult> => {
    const repository = repositoryRef.current;
    const editor = editorRef.current;
    if (!repository || accessRef.current !== "editable" || operationRef.current !== "idle" || settingsSaveRef.current || consentMutationRef.current || modelPreferenceMutationRef.current || editor?.view.composing) {
      return { ok: false, message: "入力・保存が完了してから再試行してください。" };
    }
    operationRef.current = "switching";
    editor?.setEditable(false);
    setState((value) => value.phase === "ready" ? { ...value, operation: "switching" } : value);
    let stopped = false;
    try {
      const coordinator = coordinatorRef.current;
      if (!coordinator) throw new Error("保存できません。");
      if (persistedReferenceRef.current === null && coordinator.state.dirtySequence === 0) coordinator.markDirty();
      await coordinator.flush();
      if (coordinator.state.status !== "saved") throw coordinator.state.error ?? new Error("保存できません。");
      const current = currentSnapshot();
      if (!current) throw new Error("作品がありません。");
      const changed = parseWorkspaceSnapshot(change(current));
      await stopCoordinator(); stopped = true;
      const reference = persistedReferenceRef.current;
      const database = databaseRef.current;
      const next = trashAction === "delete-chapter" && database ? await new TrashRepository(database).removeChapter(changed, current.chapter.id)
        : trashAction && database && reference ? await new TrashRepository(database).restoreChapter(reference, trashAction)
        : restore && reference ? await repository.restoreHistory(reference, changed) : await repository.save(changed);
      if (!mountedRef.current) return { ok: false };
      const remount = restore || next.chapter.id !== current.chapter.id;
      if (remount) editorRef.current = null;
      if (restore) editorEpochsRef.current.set(next.project.id, (editorEpochsRef.current.get(next.project.id) ?? 0) + 1);
      snapshotRef.current = next;
      persistedReferenceRef.current = { projectId: next.project.id, storageVersion: next.storageVersion };
      contentRevisionRef.current = next.chapter.contentRevision;
      operationRef.current = "idle";
      installCoordinator();
      if (!remount) editor?.setEditable(true);
      setState((value) => value.phase === "ready" ? { ...value, operation: "idle", saveStatus: "saved", workspace: next,
        editorSession: editorEpochsRef.current.get(next.project.id) ?? 0,
        files: value.files.map((file) => file.projectId === next.project.id ? { ...file, title: next.project.title } : file),
      } : value);
      return { ok: true };
    } catch (error: unknown) {
      operationRef.current = "idle";
      if (error instanceof WorkspaceVersionConflictError || error instanceof TrashVersionConflictError) accessRef.current = "conflict";
      else if (stopped) resumeAfterFailure(false);
      if (editor && !editor.isDestroyed && accessRef.current === "editable") editor.setEditable(true);
      setState((value) => value.phase === "ready" ? { ...value, operation: "idle", access: accessRef.current } : value);
      return { ok: false, message: "保存に失敗したため変更しませんでした。現在の本文は保持されています。" };
    }
  }, [currentSnapshot, installCoordinator, resumeAfterFailure, stopCoordinator]);

  const changeChapters = useCallback((change: (current: WorkspaceSnapshot) => WorkspaceSnapshot) => changeWritingWorkspace(change), [changeWritingWorkspace]);
  const updateWritingOptions = useCallback((writingGoal: number, autoHistoryEnabled: boolean) => changeWritingWorkspace((current) => ({
    ...current, project: { ...current.project, writingGoal, autoHistoryEnabled },
  })), [changeWritingWorkspace]);
  const listHistory = useCallback(async (): Promise<WritingHistoryEntry[]> => {
    const database = databaseRef.current; const current = snapshotRef.current;
    if (!database || !current) return [];
    return new WritingHistoryRepository(database).list(current.project.id);
  }, []);
  const withSavedWorkspace = useCallback(async <Result,>(
    action: (database: NonNullable<typeof databaseRef.current>, snapshot: WorkspaceSnapshot, reference: StoredWorkspaceReference) => Promise<Result>,
  ): Promise<Result> => {
    const editor = editorRef.current;
    const coordinator = coordinatorRef.current;
    const database = databaseRef.current;
    if (!database || !coordinator || accessRef.current !== "editable" || operationRef.current !== "idle" || settingsSaveRef.current || consentMutationRef.current || modelPreferenceMutationRef.current || editor?.view.composing) throw new Error("現在は操作できません。");
    operationRef.current = "processing";
    editor?.setEditable(false);
    setState((value) => value.phase === "ready" ? { ...value, operation: "processing" } : value);
    try {
      if (persistedReferenceRef.current === null && coordinator.state.dirtySequence === 0) coordinator.markDirty();
      await coordinator.flush();
      if (coordinator.state.status !== "saved") throw new Error("保存できません。");
      const current = currentSnapshot(); const reference = persistedReferenceRef.current;
      if (!current || !reference) throw new Error("保存対象がありません。");
      return await action(database, current, reference);
    } catch (error: unknown) {
      if (error instanceof WorkspaceVersionConflictError || error instanceof TrashVersionConflictError) accessRef.current = "conflict";
      throw error;
    } finally {
      operationRef.current = "idle";
      if (accessRef.current === "editable" && editor && !editor.isDestroyed) editor.setEditable(true);
      if (mountedRef.current) setState((value) => value.phase === "ready" ? { ...value, operation: "idle", access: accessRef.current } : value);
    }
  }, [currentSnapshot]);
  const withTrashStorage = useCallback(async <Result,>(action: (database: NonNullable<typeof databaseRef.current>, reference: StoredWorkspaceReference | null) => Promise<Result>): Promise<Result> => {
    if (snapshotRef.current !== null) return withSavedWorkspace((database, _snapshot, reference) => action(database, reference));
    const database = databaseRef.current;
    if (!database || accessRef.current !== "editable" || operationRef.current !== "idle") throw new Error("現在はごみ箱を変更できません。");
    operationRef.current = "processing";
    try { return await action(database, null); }
    finally { operationRef.current = "idle"; }
  }, [withSavedWorkspace]);
  const listTrash = useCallback(async (): Promise<TrashEntry[]> => databaseRef.current ? new TrashRepository(databaseRef.current).list() : [], []);
  const deleteChapter = useCallback(() => changeWritingWorkspace((current) => {
    const remaining = orderedChapters(current).filter((chapter) => chapter.id !== current.chapter.id);
    if (remaining.length === 0) throw new Error("最後の章は削除できません。");
    return withChapters(current, remaining, remaining[0].id);
  }, false, "delete-chapter"), [changeWritingWorkspace]);
  const restoreTrash = useCallback(async (entry: TrashEntry): Promise<WorkspaceActionResult> => {
    if (entry.kind === "chapter") return changeWritingWorkspace((current) => current, false, entry.id);
    try {
      const restored = await withTrashStorage((database, reference) => new TrashRepository(database).restoreWorkspace(reference, entry.id));
      editorEpochsRef.current.set(restored.project.id, (editorEpochsRef.current.get(restored.project.id) ?? 0) + 1);
      const files = await repositoryRef.current?.listFiles();
      if (files && mountedRef.current) setState((value) => value.phase === "ready" || value.phase === "deleted" ? { ...value, files } : value);
      if (snapshotRef.current === null) return activateWorkspace(restored.project.id);
      return { ok: true, message: "作品を復元しました。保存済み作品から開けます。" };
    } catch { return { ok: false, message: "復元できませんでした。ごみ箱と現在の作品を確認してください。" }; }
  }, [activateWorkspace, changeWritingWorkspace, withTrashStorage]);
  const purgeTrash = useCallback(async (id: string): Promise<WorkspaceActionResult> => {
    try { await withTrashStorage((database, reference) => new TrashRepository(database).purge(reference, id)); return { ok: true }; }
    catch { return { ok: false, message: "完全削除できませんでした。" }; }
  }, [withTrashStorage]);
  const createCheckpoint = useCallback(async (label: string): Promise<WorkspaceActionResult> => {
    try {
      await withSavedWorkspace((database, current) => new WritingHistoryRepository(database).add(createHistoryEntry(current, label, "manual")));
      return { ok: true };
    } catch { return { ok: false, message: "履歴を保存できませんでした。本文は保持されています。" }; }
  }, [withSavedWorkspace]);
  const restoreCheckpoint = useCallback((entry: WritingHistoryEntry) => changeWritingWorkspace((current) => {
    if (entry.projectId !== current.project.id) throw new Error("別作品の履歴です。");
    const timestamp = new Date().toISOString();
    const chapters = orderedChapters(entry.snapshot).map((chapter) => ({ ...chapter, updatedAt: timestamp,
      contentRevision: Math.max(chapter.contentRevision, orderedChapters(current).find((item) => item.id === chapter.id)?.contentRevision ?? 0) + 1,
    }));
    return withChapters({ ...entry.snapshot, storageVersion: current.storageVersion,
      styleProfile: { ...entry.snapshot.styleProfile, revision: Math.max(current.styleProfile.revision, entry.snapshot.styleProfile.revision) + 1, updatedAt: timestamp },
      project: {
      ...entry.snapshot.project, updatedAt: timestamp, aiConsent: current.project.aiConsent, autoHistoryEnabled: current.project.autoHistoryEnabled,
      contextRevision: Math.max(current.project.contextRevision, entry.snapshot.project.contextRevision) + 1,
    } }, chapters, entry.snapshot.chapter.id);
  }, true), [changeWritingWorkspace]);
  const clearHistory = useCallback(async (): Promise<WorkspaceActionResult> => {
    try {
      await withSavedWorkspace((database, current) => new WritingHistoryRepository(database).clear(current.project.id));
      return { ok: true };
    } catch { return { ok: false, message: "履歴を削除できませんでした。" }; }
  }, [withSavedWorkspace]);
  const exportLibrary = useCallback((): Promise<LibraryBackup> => withTrashStorage((database) => new LibraryBackupRepository(database).export()), [withTrashStorage]);
  const importLibrary = useCallback(async (bundle: LibraryBackup): Promise<WorkspaceActionResult> => {
    try {
      return await withTrashStorage(async (database, reference) => {
        const count = await new LibraryBackupRepository(database).importCopies(bundle, reference);
        try {
          const files = await repositoryRef.current?.listFiles();
          if (files && mountedRef.current) setState((value) => value.phase === "ready" || value.phase === "deleted" ? { ...value, files } : value);
          return { ok: true, message: `${count}作品${bundle.trash.length > 0 ? `とごみ箱${bundle.trash.length}件` : ""}をコピーとして復元しました。` };
        } catch { return { ok: true, message: "復元は完了しました。一覧を再読み込みできないため、ページを再読み込みしてください。" }; }
      });
    } catch { return { ok: false, message: "一括復元に失敗しました。既存作品は変更されていません。" }; }
  }, [withTrashStorage]);

  const syncActions = useMemo<WorkspaceSyncActions>(() => {
    function current() {
      const database = databaseRef.current; const snapshot = snapshotRef.current;
      if (!database || !snapshot) throw new Error("作品を開いてください。");
      return { repository: new SyncRepository(database), projectId: snapshot.project.id };
    }
    return {
      load: () => { const { repository, projectId } = current(); return repository.load(projectId); },
      enable: (enabled) => withSavedWorkspace((database, snapshot) => new SyncRepository(database).setEnabled(snapshot.project.id, enabled)),
      prepare: () => withSavedWorkspace((database, snapshot) => new SyncRepository(database).stage(snapshot.project.id)),
      send: (transport, signal) => { const { repository, projectId } = current(); return sendPending(repository, projectId, transport, signal); },
      receive: (transport, signal) => { const { repository, projectId } = current(); return receiveRemote(repository, projectId, transport, signal); },
      resolve: (sequence) => withSavedWorkspace((database, snapshot) => new SyncRepository(database).resolveWithLocal(snapshot.project.id, sequence)),
      removeCopy: (copyId, sequence) => withSavedWorkspace((database, snapshot) => new SyncRepository(database).removeCopy(snapshot.project.id, copyId, sequence)),
      export: () => withSavedWorkspace(async (database, snapshot) => createSyncPayload(snapshot, await new WritingHistoryRepository(database).list(snapshot.project.id))),
    };
  }, [withSavedWorkspace]);

  return {
    syncActions,
    deleteChapter, listTrash, restoreTrash, purgeTrash,
    changeChapters, updateWritingOptions, listHistory, createCheckpoint, restoreCheckpoint, clearHistory, exportLibrary, importLibrary, historyWarning,
    activateWorkspace,
    currentSnapshot,
    deleteWorkspace,
    handleDocumentChange,
    handleEditorReady,
    importWorkspace,
    requestImmediateSave,
    saveWorkspace,
    state,
    updateAiConsent,
    updateAiModelPreference,
    updateSettings,
    updateStoryMemory,
    updateAuthoringProfile,
  };
}
