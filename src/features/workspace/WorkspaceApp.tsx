"use client";
import { DEFAULT_WRITING_TOOL_MEMORY, type WritingToolMemory } from "../ai-edit/writing-tools";
import { TypographyPanel } from "./TypographyPanel";
import { useOnline } from "../offline/use-online";
import { PwaControls } from "../offline/PwaControls";
import { SyncPanel } from "../sync/SyncPanel";
import type { SyncTransport } from "../sync/transport";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { countDocumentCharacters } from "../../domain/chapters";
import { EditorUiStateStore } from "../../persistence/editor-ui-state";
import { EditorSessions } from "../editor/editor-sessions";
import { AiFeedbackPanel } from "../feedback/AiFeedbackPanel";
import { DiagnosticsPanel } from "../feedback/DiagnosticsPanel";
import { SearchPanel } from "../editor/SearchPanel";
import { TrashPanel } from "./TrashPanel";
import { SavedWorksPanel } from "./SavedWorksPanel";
import { confirmSecretExport, SecretLockScreen, SecretSettings, UnlockForm } from "./SecretControls";

const SECRET_IDLE_LOCK_MS = 10 * 60 * 1000;
const IDLE_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
import { ChapterPanel, type ChapterPanelHandle } from "./ChapterPanel";
import { WritingProgress } from "./WritingProgress";
import { WritingHistoryPanel } from "./WritingHistoryPanel";
import { LibraryBackupPanel } from "./LibraryBackupPanel";
import { AI_MODEL_PREFERENCE_AUTOMATIC } from "../../domain/ai-models";
import type { AiModelPreference, WorkspaceSnapshot } from "../../domain/workspace";
import {
  AiEditBoundary,
  type AiEditBoundaryHandle,
} from "../ai-edit/AiEditBoundary";
import { AiEditErrorBoundary } from "../ai-edit/AiEditErrorBoundary";
import {
  resolveRuntimeModel,
  type PublicAiRuntime,
} from "../ai-edit/consent";
import { NovelEditor } from "../editor/NovelEditor";
import styles from "./Workspace.module.css";
import { AiConnectionSettingsPanel, type AiConnectionSettingsHandle } from "../ai-edit/AiConnectionSettingsPanel";
import { useChatGptConnection } from "../ai-edit/use-chatgpt-connection";
import { WorkspaceSettings, type WorkspaceSettingsHandle } from "./WorkspaceSettings";
import { AuthoringPanel, type AuthoringPanelHandle } from "./AuthoringPanel";
import { StoryMemoryPanel, type StoryMemoryPanelHandle } from "./StoryMemoryPanel";
import { WorkspaceLayout, type WorkspacePanelId } from "./WorkspaceLayout";
import { WorkspaceFiles } from "./WorkspaceFiles";
import { createWritingWorkspace, readWritingFile, WritingFileError } from "./workspace-files";
import { workspaceBackupErrorMessage } from "./backup";
import type { WorkspaceActionResult } from "./use-workspace";
import {
  type WorkspaceAccess,
  useWorkspace,
} from "./use-workspace";

export type AiRuntimeInfo = PublicAiRuntime;

const DISABLED_AI_RUNTIME: AiRuntimeInfo = {
  available: false,
  defaultModelId: null,
  externalDataTransfer: false,
  models: [],
  providerId: null,
};

function runtimeSignature(runtime: AiRuntimeInfo): string {
  return JSON.stringify([runtime.settingsRevision ?? "environment", runtime.available, runtime.providerId, runtime.defaultModelId,
    runtime.externalDataTransfer, runtime.models.map((model) => [model.id, model.displayName]),
    (runtime.comparisonProviders ?? []).map(runtimeSignature)]);
}

function aiRuntimeLabel(
  runtime: AiRuntimeInfo,
  modelPreference: AiModelPreference,
): string {
  if (!runtime.available) {
    return "AI：無効";
  }

  const model = resolveRuntimeModel(runtime, modelPreference);

  if (model === null) {
    return `AI：選択モデル利用不可（${modelPreference}）`;
  }

  const destination = runtime.externalDataTransfer
    ? "外部送信あり"
    : "外部送信なし";
  const kind = runtime.providerId === "mock" ? "デモ候補・" : "";
  return `AI：${model.displayName}（${kind}${destination}）`;
}

/** The brand mark: a brush tip split into the writer's green and the AI's gold. */
function BrandMark() {
  return <svg className={styles.brandMark} viewBox="0 0 160 160" aria-hidden="true" focusable="false">
    <g transform="translate(83 76) rotate(40)">
      <rect x="-10" y="-84" width="20" height="80" rx="10" fill="var(--ink)" />
      <rect x="-15" y="-16" width="30" height="21" rx="6" fill="var(--accent)" />
      <path d="M-15 4 C-24 24 -20 54 0 94 C3 64 3 32 -1.5 4 Z" fill="var(--accent)" />
      <path d="M2.5 4 C7 32 4 64 0 94 C20 54 24 24 15 4 Z" fill="var(--ai)" />
    </g>
  </svg>;
}

function Header({
  aiRuntime,
  modelPreference = AI_MODEL_PREFERENCE_AUTOMATIC,
  status,
}: Readonly<{
  aiRuntime: AiRuntimeInfo;
  modelPreference?: AiModelPreference;
  status: string;
}>) {
  return (
    <header className="workspace-header">
      <div>
        <BrandMark />
        <h1 id="product-title">AIFUDE</h1>
        <p aria-label="AI実行環境" className={styles.aiRuntime}>
          {aiRuntimeLabel(aiRuntime, modelPreference)}
        </p>
      </div>
      <p className="status" role="status" aria-live="polite" data-state={status}>
        {status}
      </p>
    </header>
  );
}

function accessStatus(access: WorkspaceAccess): string | null {
  switch (access) {
    case "locked":
      return "他のタブが編集中のため読み取り専用";
    case "unsupported":
      return "Web Locksを利用できないため読み取り専用";
    case "conflict":
      return "保存先が更新されたため読み取り専用";
    case "editable":
      return null;
  }
}

export function WorkspaceApp({
  aiRuntime: initialRuntime = DISABLED_AI_RUNTIME,
  offlineShell = false,
  syncTransport,
}: Readonly<{ aiRuntime?: AiRuntimeInfo; offlineShell?: boolean; syncTransport?: SyncTransport }>) {
  const online = useOnline();
  const connectionAllowed = online && !offlineShell;
  const [activePanel, setActivePanel] = useState<WorkspacePanelId | null>(null);
  const [feedbackOpened, setFeedbackOpened] = useState(false);
  const changePanel = useCallback((panel: WorkspacePanelId | null) => {
    if (panel === "feedback") setFeedbackOpened(true);
    setActivePanel(panel);
  }, []);
  // The last tool of each kind; the selection decides which kind a new AI session uses.
  const [toolMemory, setToolMemory] = useState<WritingToolMemory>(DEFAULT_WRITING_TOOL_MEMORY);
  const [configuredRuntime, setConfiguredRuntime] = useState(initialRuntime);
  const baseRuntimeRef = useRef(initialRuntime);
  const connectionPanelRef = useRef<AiConnectionSettingsHandle>(null);
  const connectionDirtyRef = useRef(false);
  const {
    syncActions,
    deleteChapter, listTrash, restoreTrash, purgeTrash, trashSavedWork,
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
    secret, unlockSecret, lockSecret, setupSecret, setWorkSecret, changeSecretPassword, trashLockedWork,
  } = useWorkspace();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [uiWarning, setUiWarning] = useState(false);
  const [editorSessions] = useState(() => new EditorSessions(new EditorUiStateStore(() => queueMicrotask(() => setUiWarning(true)))));
  useEffect(() => { editorSessions.retain(); return () => editorSessions.disposeLater(); }, [editorSessions]);
  // Locked secret works must not stay in memory as live editor documents.
  const knownFiles = state.phase === "ready" || state.phase === "deleted" || state.phase === "locked" ? state.files : null;
  const lockedProjectId = state.phase === "locked" ? state.projectId : null;
  useEffect(() => {
    if (secret.unlocked) return;
    for (const file of knownFiles ?? []) if (file.secret) editorSessions.disposeProject(file.projectId);
    if (lockedProjectId) editorSessions.disposeProject(lockedProjectId);
  }, [secret.unlocked, knownFiles, lockedProjectId, editorSessions]);

  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const chapterPanelRef = useRef<ChapterPanelHandle>(null);
  const chapterDirtyRef = useRef(false);
  const aiEditBoundaryRef = useRef<AiEditBoundaryHandle>(null);
  const editorRef = useRef<Editor | null>(null);
  const settingsPanelRef = useRef<WorkspaceSettingsHandle>(null);
  const settingsDirtyRef = useRef(false);
  const memoryPanelRef = useRef<StoryMemoryPanelHandle>(null);
  const memoryDirtyRef = useRef(false);
  const authoringPanelRef = useRef<AuthoringPanelHandle>(null);
  const authoringDirtyRef = useRef(false);
  const [hasDrafts, setHasDrafts] = useState(false);
  const refreshDraftNotice = useCallback(() => setHasDrafts(
    authoringDirtyRef.current || memoryDirtyRef.current || chapterDirtyRef.current || settingsDirtyRef.current || connectionDirtyRef.current,
  ), []);
  const [paidApiEnabled, setPaidApiEnabled] = useState(false);
  const invalidateConnection = useCallback(() => { aiEditBoundaryRef.current?.invalidateContext(); }, []);
  const onConnectionRuntimeChange = useCallback((runtime: AiRuntimeInfo) => {
    if (runtimeSignature(baseRuntimeRef.current) !== runtimeSignature(runtime)) {
      invalidateConnection(); baseRuntimeRef.current = runtime; setConfiguredRuntime(runtime); setPaidApiEnabled(false);
    }
  }, [invalidateConnection]);
  const onConnectionDirtyChange = useCallback((dirty: boolean) => { connectionDirtyRef.current = dirty; refreshDraftNotice(); }, [refreshDraftNotice]);
  const onPaidApiChange = useCallback((enabled: boolean) => { invalidateConnection(); setPaidApiEnabled(enabled); }, [invalidateConnection]);
  const connection = useChatGptConnection(connectionAllowed && (configuredRuntime.providerId === "chatgpt" || configuredRuntime.comparisonProviders?.some((provider) => provider.providerId === "chatgpt") === true), invalidateConnection);
  const connectionId = connection.status?.connected && !connection.connecting && !connection.busy ? connection.status.connectionId ?? undefined : undefined;
  const aiRuntime: AiRuntimeInfo = {
    ...configuredRuntime,
    available: connectionAllowed && configuredRuntime.available,
    paidApiEnabled,
    ...(configuredRuntime.providerId === "chatgpt" ? { connectionId } : {}),
    comparisonProviders: configuredRuntime.comparisonProviders?.map((provider) => ({ ...provider, available: connectionAllowed && provider.available, paidApiEnabled, ...(provider.providerId === "chatgpt" ? { connectionId } : {}) })),
  };
  useEffect(() => { if (!connectionAllowed) invalidateConnection(); }, [connectionAllowed, invalidateConnection]);

  const onAiCommand = useCallback((editor: Editor) => {
    return aiEditBoundaryRef.current?.invoke(editor) ?? false;
  }, []);
  const onDictionaryCommand = useCallback((editor: Editor) => {
    return aiEditBoundaryRef.current?.invoke(editor, undefined, "dictionary") ?? false;
  }, []);

  const onEditorReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setActiveEditor(editor);
      setActiveCount(Array.from(editor.state.doc.textContent).length);
      handleEditorReady(editor);
      aiEditBoundaryRef.current?.revalidate(editor);
    },
    [handleEditorReady],
  );

  const onEditorDestroy = useCallback((editor: Editor) => {
    if (editorRef.current === editor) {
      editorRef.current = null;
      setActiveEditor(null);
    }

    aiEditBoundaryRef.current?.revalidate(editor);
  }, []);

  const onEditorTransaction = useCallback((editor: Editor) => {
    if (editorRef.current === editor) aiEditBoundaryRef.current?.revalidate(editor);
  }, []);

  const onDocumentChange = useCallback((editor: Editor) => {
    if (editorRef.current === editor) setActiveCount(Array.from(editor.state.doc.textContent).length);
    handleDocumentChange(editor);
  }, [handleDocumentChange]);
  const onChapterDirtyChange = useCallback((dirty: boolean) => { chapterDirtyRef.current = dirty; refreshDraftNotice(); }, [refreshDraftNotice]);

  const requestEditorFocus = useCallback((editor: Editor) => {
    if (editorRef.current === editor && !editor.isDestroyed) {
      editor.view.focus();
    }
  }, []);

  const onSettingsDirtyChange = useCallback((dirty: boolean) => { settingsDirtyRef.current = dirty; refreshDraftNotice(); }, [refreshDraftNotice]);
  const onAuthoringDirtyChange = useCallback((dirty: boolean) => { authoringDirtyRef.current = dirty; refreshDraftNotice(); }, [refreshDraftNotice]);
  const onMemoryDirtyChange = useCallback((dirty: boolean) => { memoryDirtyRef.current = dirty; refreshDraftNotice(); }, [refreshDraftNotice]);
  const confirmDiscardMemory = useCallback(() => (!authoringDirtyRef.current && !memoryDirtyRef.current && !chapterDirtyRef.current && !settingsDirtyRef.current) || window.confirm(
    "保存していない作品メモリ・人物・文体・章の設定・作品設定があります。入力中の変更を破棄して続行しますか？ 残す場合はキャンセルして保存してください。",
  ), []);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (authoringDirtyRef.current || memoryDirtyRef.current || chapterDirtyRef.current || settingsDirtyRef.current || connectionDirtyRef.current || (state.phase === "ready" && state.saveStatus !== "saved")) {
        event.preventDefault(); event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state]);

  const saveCurrent = useCallback(async (): Promise<WorkspaceActionResult> => {
    if (editorRef.current?.view.composing) return { ok: false, message: "日本語の変換を確定してから保存してください。" };
    if (settingsDirtyRef.current) {
      const saved = await settingsPanelRef.current?.save();
      if (saved?.ok !== true) return saved ?? { ok: false, message: "作品設定を保存できませんでした。" };
    }
    if (authoringDirtyRef.current) {
      const saved = await authoringPanelRef.current?.save();
      if (saved?.ok !== true) return saved ?? { ok: false, message: "執筆設定を保存できませんでした。" };
    }
    if (memoryDirtyRef.current) {
      const saved = await memoryPanelRef.current?.save();
      if (saved?.ok !== true) return saved ?? { ok: false, message: "メモリを保存できませんでした。" };
    }
    if (chapterDirtyRef.current) {
      const saved = await chapterPanelRef.current?.save();
      if (saved?.ok !== true) return saved ?? { ok: false, message: "章の設定を保存できませんでした。" };
    }
    const manuscript = await saveWorkspace();
    if (!manuscript.ok) return manuscript;
    if (connectionDirtyRef.current) {
      const saved = await connectionPanelRef.current?.save();
      if (saved?.ok !== true) return { ok: false, message: "本文・作品設定・メモは保存しましたが、AI接続設定を保存できませんでした。接続設定の入力は保持しています。" };
    }
    return manuscript;
  }, [saveWorkspace]);

  /** Save every draft and the body before a secret work is locked, so locking never loses input. */
  const lockNow = useCallback(async (): Promise<WorkspaceActionResult> => {
    if (state.phase === "ready" && state.secret) {
      const saved = await saveCurrent();
      if (!saved.ok) return { ok: false, message: saved.message ?? "保存できないためロックしませんでした。" };
    }
    return lockSecret();
  }, [state, saveCurrent, lockSecret]);
  // The idle timer must not restart on every state change, so it reads the latest lockNow through a ref.
  const lockNowRef = useRef(lockNow);
  useEffect(() => { lockNowRef.current = lockNow; }, [lockNow]);
  // Auto-lock after 10 minutes without input while unlocked; retry a minute later if a save or input is in progress.
  useEffect(() => {
    if (!secret.unlocked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay = SECRET_IDLE_LOCK_MS) => {
      clearTimeout(timer);
      timer = setTimeout(() => { void lockNowRef.current().then((result) => { if (!result.ok) schedule(60_000); }); }, delay);
    };
    const activity = () => schedule();
    for (const name of IDLE_EVENTS) window.addEventListener(name, activity, { capture: true, passive: true });
    schedule();
    return () => { clearTimeout(timer); for (const name of IDLE_EVENTS) window.removeEventListener(name, activity, { capture: true }); };
  }, [secret.unlocked]);
  const secretAction = secret.vaultExists && state.phase !== "locked" ? (secret.unlocked
    ? <button type="button" aria-label="シークレット作品をロック" onClick={() => void lockNow()}><span>ロック</span></button>
    : <button type="button" aria-label="シークレット作品を解錠" aria-expanded={unlockOpen} onClick={() => setUnlockOpen(!unlockOpen)}><span>解錠</span></button>) : null;
  const unlockUi = unlockOpen && !secret.unlocked ? <section aria-label="シークレット作品の解錠" className={styles.feedback}>
    <UnlockForm onUnlock={async (password) => { const result = await unlockSecret(password); if (result.ok) setUnlockOpen(false); return result; }} />
  </section> : null;
  const switchWorkspace = useCallback(async (target: string | WorkspaceSnapshot): Promise<WorkspaceActionResult> => {
    if (typeof target === "string" && currentSnapshot()?.project.id === target) return { ok: true };
    if (!confirmDiscardMemory()) return { ok: false, message: "作品の切替を取り消しました。" };
    invalidateConnection();
    const result = await activateWorkspace(target);
    if (result.ok) { authoringDirtyRef.current = false; memoryDirtyRef.current = false; chapterDirtyRef.current = false; settingsDirtyRef.current = false; refreshDraftNotice(); }
    return result;
  }, [activateWorkspace, confirmDiscardMemory, currentSnapshot, invalidateConnection, refreshDraftNotice]);
  const openWritingFile = useCallback(async (file: File): Promise<WorkspaceActionResult> => {
    try { return await switchWorkspace(await readWritingFile(file)); }
    catch (error: unknown) { return { ok: false, message: error instanceof WritingFileError ? error.message : workspaceBackupErrorMessage(error) }; }
  }, [switchWorkspace]);
  const guardedImport = useCallback(async (snapshot: WorkspaceSnapshot): Promise<WorkspaceActionResult> => {
    if (!confirmDiscardMemory()) return { ok: false, message: "バックアップの取り込みを取り消しました。" };
    invalidateConnection();
    const result = await importWorkspace(snapshot);
    if (result.ok) { authoringDirtyRef.current = false; memoryDirtyRef.current = false; chapterDirtyRef.current = false; settingsDirtyRef.current = false; refreshDraftNotice(); }
    return result;
  }, [confirmDiscardMemory, importWorkspace, invalidateConnection, refreshDraftNotice]);
  const guardedDelete = useCallback(async (): Promise<WorkspaceActionResult> => {
    if (!confirmDiscardMemory()) return { ok: false, message: "削除を取り消しました。" };
    invalidateConnection();
    const result = await deleteWorkspace();
    if (result.ok) { setActivePanel("backup"); authoringDirtyRef.current = false; memoryDirtyRef.current = false; chapterDirtyRef.current = false; settingsDirtyRef.current = false; refreshDraftNotice(); }
    return result;
  }, [confirmDiscardMemory, deleteWorkspace, invalidateConnection, refreshDraftNotice]);
  const filesUi = <WorkspaceFiles
    activeProjectId={state.phase === "ready" ? state.workspace.project.id : null}
    disabled={state.phase === "ready" ? state.access !== "editable" || state.operation !== "idle" : state.phase !== "deleted"}
    files={state.phase === "ready" || state.phase === "deleted" || state.phase === "locked" ? state.files : []}
    getCurrentSnapshot={currentSnapshot} onNew={() => switchWorkspace(createWritingWorkspace())}
    onOpen={openWritingFile} onSave={saveCurrent} onSwitch={switchWorkspace} onManage={() => setActivePanel("backup")}
    confirmExport={() => confirmSecretExport(state.phase === "ready" && state.secret === true)}
  />;

  const savedWorksUi = <SavedWorksPanel activeProjectId={state.phase === "ready" ? state.workspace.project.id : state.phase === "locked" ? state.projectId : null}
    disabled={state.phase === "ready" ? state.access !== "editable" || state.operation !== "idle" : state.phase !== "deleted"}
    files={state.phase === "ready" || state.phase === "deleted" || state.phase === "locked" ? state.files : []}
    onOpen={switchWorkspace} onTrash={trashSavedWork} onTrashActive={state.phase === "locked" ? trashLockedWork : guardedDelete} />;
  const trashUi = <TrashPanel disabled={state.phase === "ready" ? state.access !== "editable" || state.operation !== "idle" : state.phase !== "deleted"}
    refreshKey={`${state.phase === "ready" ? `${state.workspace.project.id}:${state.workspace.document.chapterIds.join(",")}` : state.phase}|${state.phase === "ready" || state.phase === "deleted" ? state.files.map((file) => file.projectId).join(",") : ""}`}
    projectId={state.phase === "ready" ? state.workspace.project.id : null} onList={listTrash} onPurge={purgeTrash}
    onRestore={async (entry) => {
      if (entry.kind === "chapter") invalidateConnection();
      return restoreTrash(entry);
    }} />;

  const connectionUi = <AiEditErrorBoundary key="ai-connections"><AiConnectionSettingsPanel active={connectionAllowed && activePanel === "connections"} embedded={state.phase === "ready" || state.phase === "deleted"} ref={connectionPanelRef}
    disabled={!connectionAllowed || (state.phase === "ready" ? state.access !== "editable" || state.operation !== "idle" : state.phase !== "deleted")}
    paidApiEnabled={paidApiEnabled} onPaidApiEnabledChange={onPaidApiChange} onInvalidate={invalidateConnection}
    onRuntimeChange={onConnectionRuntimeChange} onDirtyChange={onConnectionDirtyChange} /></AiEditErrorBoundary>;

  if (state.phase === "hydrating") {
    return (
      <main className="home" aria-busy="true">
        <Header aiRuntime={aiRuntime} status="読み込み中" />
        <p className={styles.feedback}>原稿を読み込んでいます。</p>
      </main>
    );
  }

  if (state.phase === "load-error") {
    return (
      <main className="home">
        <Header aiRuntime={aiRuntime} status="読み込み失敗" />
        <p className={styles.error} role="alert">
          保存データを読み込めませんでした。既存データは変更されていません。
        </p>
      </main>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <main className="home">
        <Header
          aiRuntime={aiRuntime}
          status={accessStatus(state.access) ?? "読み取り専用"}
        />
        <p className={styles.feedback}>
          編集中のworkspaceが利用可能になってから、ページを再読み込みしてください。
        </p>
      </main>
    );
  }

  if (state.phase === "deleted") {
    return (
      <WorkspaceLayout active={activePanel} onActiveChange={changePanel}
        header={<Header aiRuntime={aiRuntime} status="削除済み" />} files={filesUi} alerts={unlockUi} secretAction={secretAction}
        panels={{
        typography: null, feedback: null, settings: null, memory: null, chapters: null, history: null, connections: connectionUi,
          backup: <>{savedWorksUi}{trashUi}<LibraryBackupPanel disabled={false} onExport={exportLibrary} onImport={importLibrary} /></> }}
        editor={<div id="workspace-editor" role="tabpanel" aria-label="作品を選択">
          <p className={styles.feedback} role="status">
            ローカルデータを削除しました。ごみ箱から復元できます。新しい空の作品を始めるには「新規作品」を選んでください。
          </p>
          <button onClick={() => void switchWorkspace(createWritingWorkspace())} type="button">新しい作品を始める</button>
        </div>}
      >{null}</WorkspaceLayout>
    );
  }

  if (state.phase === "locked") {
    return (
      <WorkspaceLayout active={activePanel} onActiveChange={changePanel}
        header={<Header aiRuntime={aiRuntime} status="ロック中" />} files={filesUi} alerts={null}
        panels={{
          typography: null, feedback: null, settings: null, memory: null, chapters: null, history: null, connections: connectionUi,
          backup: <>{savedWorksUi}{trashUi}<LibraryBackupPanel disabled={false} onExport={exportLibrary} onImport={importLibrary} /></> }}
        editor={<div id="workspace-editor" role="tabpanel" aria-label="シークレット作品">
          <SecretLockScreen onUnlock={unlockSecret} onTrash={trashLockedWork} canTrash={state.access === "editable"} />
        </div>}
      >{null}</WorkspaceLayout>
    );
  }

  const accessMessage = accessStatus(state.access);
  const saveStatus =
    state.operation === "processing" ? "履歴・バックアップ処理中" : state.operation === "switching" ? "作品切替中" : state.operation === "importing"
      ? "バックアップ取込中"
      : state.operation === "deleting"
        ? "削除中"
        : accessMessage ??
          {
            dirty: "未保存",
            error: "保存失敗",
            saved: "保存済み",
            saving: "保存中",
          }[state.saveStatus];
  const initialText = state.workspace.chapter.body;
  const editable =
    state.access === "editable" && state.operation === "idle";
  const captureContext = {
    chapterId: state.workspace.chapter.id,
    commonPrompt: state.workspace.project.commonPrompt,
    storyMemory: state.workspace.project.storyMemory,
    authoringProfile: state.workspace.project.authoringProfile,
    contextRevision: state.workspace.project.contextRevision,
    documentId: state.workspace.document.id,
    editable,
    manualStyle: state.workspace.styleProfile.manualInstructions,
    projectId: state.workspace.project.id,
  };

  return (
    <WorkspaceLayout active={activePanel} onActiveChange={changePanel}
      secretAction={secretAction}
      header={<Header aiRuntime={aiRuntime} modelPreference={state.workspace.project.aiModelPreference}
        status={saveStatus} />}
      files={filesUi}
      alerts={<>
        {!connectionAllowed ? <p className={styles.feedback} role="status">{online ? "オフライン用画面です。AIを使うには設定から保存してオンライン画面へ戻ってください。" : "オフラインです。本文の編集と端末への保存は続けられます。AIは停止し、接続が戻っても自動送信しません。"}</p> : null}
        {hasDrafts ? <p className={styles.draftNotice} role="status">メモ・設定に未保存の入力があります。「保存」で保存できます。</p> : null}
        {state.saveStatus === "error" && state.access === "editable" ? (
          <p className={styles.error} role="alert">保存できませんでした。本文はこの画面に保持されています。</p>
        ) : null}
        {historyWarning ? <p role="alert" className={styles.error}>{historyWarning}</p> : null}
        {uiWarning ? <p role="status">タブ・カーソル位置の保存を利用できません。本文の保存は別に行います。</p> : null}
        {unlockUi}
      </>}
      panels={{
        typography: <TypographyPanel key={`typography:${state.workspace.chapter.id}:${state.editorSession}`} editor={activeEditor} context={captureContext} active={activePanel === "typography"} getCurrentSnapshot={currentSnapshot}
          confirmExport={() => confirmSecretExport(state.secret)} />,
        feedback: <>{feedbackOpened ? <DiagnosticsPanel key={`diagnostics:${state.workspace.chapter.id}:${state.editorSession}`} editor={activeEditor} context={captureContext}
          onAi={(editor, instruction) => {
            setActivePanel(null);
            requestAnimationFrame(() => aiEditBoundaryRef.current?.invoke(editor, instruction, "custom"));
          }}><AiFeedbackPanel editor={activeEditor} contextRevision={state.workspace.project.contextRevision} runtime={aiRuntime}
            consent={state.workspace.project.aiConsent} modelPreference={state.workspace.project.aiModelPreference} onConsentChange={updateAiConsent} /></DiagnosticsPanel> : null}</>,
        settings: <><WorkspaceSettings embedded ref={settingsPanelRef} onDirtyChange={onSettingsDirtyChange}
          onPaidApiEnabledChange={onPaidApiChange} chatGptConnection={connection} aiRuntime={aiRuntime}
          busy={state.operation !== "idle"} editable={state.access === "editable"} getCurrentSnapshot={currentSnapshot}
          key={`${state.workspace.project.id}:${state.editorSession}`} onDelete={guardedDelete}
          onConsentChange={updateAiConsent} onImport={guardedImport} onModelPreferenceChange={updateAiModelPreference}
          onSave={updateSettings} workspace={state.workspace} confirmExport={() => confirmSecretExport(state.secret)} />
          <SecretSettings vaultExists={secret.vaultExists} unlocked={secret.unlocked} secret={state.secret === true} disabled={!editable || state.operation !== "idle"}
            onSetup={setupSecret} onUnlock={unlockSecret} onToggle={setWorkSecret} onChangePassword={changeSecretPassword} onLock={lockNow} />
          <PwaControls online={online} offlineShell={offlineShell} onSave={saveCurrent} /></>,
        connections: connectionUi,
        memory: <><StoryMemoryPanel embedded ref={memoryPanelRef} onDirtyChange={onMemoryDirtyChange}
          key={`memory:${state.workspace.project.id}:${state.editorSession}`} memory={state.workspace.project.storyMemory}
          disabled={!editable} onSave={updateStoryMemory} />
          <AuthoringPanel key={`authoring:${state.workspace.project.id}:${state.editorSession}`} ref={authoringPanelRef}
            profile={state.workspace.project.authoringProfile} workspace={state.workspace} editor={activeEditor}
            disabled={!editable} onSave={updateAuthoringProfile} onDirtyChange={onAuthoringDirtyChange} /></>,
        chapters: <ChapterPanel embedded ref={chapterPanelRef} key={`chapter:${state.workspace.chapter.id}:${state.editorSession}`}
          workspace={state.workspace} disabled={!editable} onDirtyChange={onChapterDirtyChange}
          onChange={(change) => { invalidateConnection(); return changeChapters(change); }}
          onDelete={() => { invalidateConnection(); return deleteChapter(); }} />,
        history: <WritingHistoryPanel embedded active={activePanel === "history"} key={`history:${state.workspace.project.id}`}
          workspace={state.workspace} disabled={!editable} warning={null}
          getCurrentSnapshot={currentSnapshot} onList={listHistory} onClear={clearHistory}
          onAutoChange={(enabled) => updateWritingOptions(state.workspace.project.writingGoal, enabled)}
          onCreate={async (label) => { const saved = await saveCurrent(); return saved.ok ? createCheckpoint(label) : saved; }}
          onRestore={async (entry) => {
            const saved = await saveCurrent(); if (!saved.ok) return saved;
            invalidateConnection(); return restoreCheckpoint(entry);
          }} />,
        backup: <>{savedWorksUi}{trashUi}<LibraryBackupPanel disabled={!editable} onExport={async () => {
          const saved = await saveCurrent(); if (!saved.ok) throw new Error("保存できません。"); return exportLibrary();
        }} onImport={async (bundle, password) => { const saved = await saveCurrent(); return saved.ok ? importLibrary(bundle, password) : saved; }} />
          <SyncPanel key={`sync:${state.workspace.project.id}`} actions={syncActions} disabled={!editable} onSave={saveCurrent} onImport={importLibrary} transport={offlineShell ? undefined : syncTransport} /></>,
      }}
      editor={<div className={styles.editorPanel} id="workspace-editor" role="tabpanel" aria-label={state.workspace.project.title}>
        <NovelEditor
          onDictionaryCommand={onDictionaryCommand}
          toolbarStart={<button type="button" className={styles.chapterButton} aria-label={`${state.workspace.chapter.title}（章とアウトラインを開く）`}
            aria-expanded={activePanel === "chapters"} onClick={() => changePanel(activePanel === "chapters" ? null : "chapters")}>
            <span>{state.workspace.chapter.title}</span></button>}
          toolbarEnd={<SearchPanel key={`search:${state.workspace.chapter.id}:${state.editorSession}`} editor={activeEditor} disabled={!editable} />}
          sessions={editorSessions}
          sessionKey={`${state.workspace.project.id}:${state.workspace.chapter.id}:${state.editorSession}`}
          positionKey={`${state.workspace.project.id}:${state.workspace.chapter.id}`}
          editable={editable} initialContentRevision={state.workspace.chapter.contentRevision} initialText={initialText}
          key={`${state.workspace.chapter.id}:${state.editorSession}`}
          onAiCommand={onAiCommand} onDocumentChange={onDocumentChange} onEditorDestroy={onEditorDestroy}
          onEditorReady={onEditorReady} onEditorTransaction={onEditorTransaction}
        />
        <footer className={styles.manuscriptFooter}>
          <WritingProgress workspace={state.workspace}
            activeCount={activeEditor ? activeCount : countDocumentCharacters(state.workspace.chapter.body)}
            disabled={!editable} onSave={updateWritingOptions} />
        </footer>
      </div>}
    >
      <AiEditErrorBoundary>
        <AiEditBoundary
          toolMemory={toolMemory} onToolMemoryChange={setToolMemory}
          key={`${state.workspace.project.id}:${state.workspace.chapter.id}:${state.editorSession}`}
          captureContext={captureContext} consent={state.workspace.project.aiConsent}
          modelPreference={state.workspace.project.aiModelPreference} onAccepted={requestImmediateSave}
          onConsentChange={updateAiConsent} onRequestEditorFocus={requestEditorFocus}
          ref={aiEditBoundaryRef} runtime={aiRuntime}
        />
      </AiEditErrorBoundary>
    </WorkspaceLayout>
  );
}
