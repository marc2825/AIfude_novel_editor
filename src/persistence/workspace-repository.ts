import {
  parseWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../domain/workspace";
import {
  WORKSPACES_STORE_NAME,
  WORKSPACE_FILES_STORE_NAME,
  WORKSPACE_HISTORY_STORE_NAME,
  WORKSPACE_TRASH_STORE_NAME,
  type OpenWorkspaceDatabase,
} from "./indexeddb";

import { createTrashEntry, MAX_TRASH_ENTRIES } from "./trash-repository";
import { createHistoryEntry, MAX_HISTORY_ENTRIES, parseHistoryEntry } from "./writing-history";

export type StoredWorkspaceReference = Readonly<{
  projectId: string;
  storageVersion: number;
}>;

export type WorkspaceFileInfo = Readonly<{ projectId: string; title: string }>;

export class WorkspaceVersionConflictError extends Error {
  readonly expectedStorageVersion: number | null;
  readonly actualStorageVersion: number | null;

  constructor(
    expectedStorageVersion: number | null,
    actualStorageVersion: number | null,
  ) {
    super("保存データのstorage versionが一致しません。");
    this.name = "WorkspaceVersionConflictError";
    this.expectedStorageVersion = expectedStorageVersion;
    this.actualStorageVersion = actualStorageVersion;
  }
}

export class InvalidWorkspaceStoreError extends Error {
  constructor() {
    super("workspaces storeがV0.1の単一workspace構成に適合しません。");
    this.name = "InvalidWorkspaceStoreError";
  }
}

export class WorkspaceStorageVersionOverflowError extends Error {
  constructor() {
    super("storage versionをこれ以上更新できません。");
    this.name = "WorkspaceStorageVersionOverflowError";
  }
}

function nextStorageVersion(storageVersion: number): number {
  if (storageVersion === Number.MAX_SAFE_INTEGER) {
    throw new WorkspaceStorageVersionOverflowError();
  }

  return storageVersion + 1;
}

function assertExpectedVersion(
  current: WorkspaceSnapshot | null,
  expectedStorageVersion: number | null,
): void {
  const actualStorageVersion = current?.storageVersion ?? null;

  if (actualStorageVersion !== expectedStorageVersion) {
    throw new WorkspaceVersionConflictError(
      expectedStorageVersion,
      actualStorageVersion,
    );
  }
}

export class WorkspaceRepository {
  readonly #database: OpenWorkspaceDatabase;

  constructor(database: OpenWorkspaceDatabase) {
    this.#database = database;
  }

  async listFiles(): Promise<readonly WorkspaceFileInfo[]> {
    const transaction = this.#database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME], "readonly");
    const activeStore = transaction.objectStore(WORKSPACES_STORE_NAME);
    const filesStore = transaction.objectStore(WORKSPACE_FILES_STORE_NAME);
    const [activeKeys, active, fileKeys, files] = await Promise.all([
      activeStore.getAllKeys(), activeStore.getAll(), filesStore.getAllKeys(), filesStore.getAll(),
    ]);
    await transaction.done;
    if (activeKeys.length > 1) throw new InvalidWorkspaceStoreError();
    const seen = new Set<string>();
    return [...active, ...files].map((value, index) => {
      const snapshot = parseWorkspaceSnapshot(value);
      const key = [...activeKeys, ...fileKeys][index];
      if (key !== snapshot.project.id || seen.has(key)) throw new InvalidWorkspaceStoreError();
      seen.add(key);
      return { projectId: key, title: snapshot.project.title };
    });
  }

  /** Atomically archive the saved active file and activate an existing or new file. */
  async activateFile(
    reference: StoredWorkspaceReference | null,
    target: string | WorkspaceSnapshot,
  ): Promise<WorkspaceSnapshot> {
    const newFile = typeof target === "string" ? null : parseWorkspaceSnapshot(target);
    const targetId = typeof target === "string" ? target : target.project.id;
    const transaction = this.#database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME], "readwrite", { durability: "strict" });
    const activeStore = transaction.objectStore(WORKSPACES_STORE_NAME);
    const filesStore = transaction.objectStore(WORKSPACE_FILES_STORE_NAME);
    const keys = await activeStore.getAllKeys();
    if (keys.length > 1) throw new InvalidWorkspaceStoreError();
    const stored = keys.length === 0 ? undefined : await activeStore.get(keys[0]);
    const current = stored === undefined ? null : parseWorkspaceSnapshot(stored);
    if (current !== null && current.project.id !== keys[0]) throw new InvalidWorkspaceStoreError();
    if ((current?.project.id ?? null) !== (reference?.projectId ?? null)) {
      throw new WorkspaceVersionConflictError(reference?.storageVersion ?? null, current?.storageVersion ?? null);
    }
    assertExpectedVersion(current, reference?.storageVersion ?? null);
    if (targetId === current?.project.id) {
      if (newFile !== null) throw new InvalidWorkspaceStoreError();
      await transaction.done;
      return current;
    }
    const archived = await filesStore.get(targetId);
    if (newFile !== null && (archived !== undefined || newFile.storageVersion !== 0)) throw new InvalidWorkspaceStoreError();
    if (newFile === null && archived === undefined) throw new InvalidWorkspaceStoreError();
    const next = newFile ?? parseWorkspaceSnapshot(archived);
    if (next.project.id !== targetId) throw new InvalidWorkspaceStoreError();
    const writes: Promise<unknown>[] = [];
    if (current !== null) {
      // Never overwrite a duplicate archive left by an invalid store.
      if (await filesStore.get(current.project.id) !== undefined) throw new InvalidWorkspaceStoreError();
      writes.push(filesStore.add(current, current.project.id), activeStore.delete(current.project.id));
    }
    if (archived !== undefined) writes.push(filesStore.delete(targetId));
    writes.push(activeStore.add(next, targetId));
    await Promise.all([...writes, transaction.done]);
    return next;
  }

  async load(projectId?: string): Promise<WorkspaceSnapshot | null> {
    if (projectId === undefined) {
      const transaction = this.#database.transaction(
        WORKSPACES_STORE_NAME,
        "readonly",
      );
      const keys = await transaction.store.getAllKeys();

      if (keys.length > 1) {
        throw new InvalidWorkspaceStoreError();
      }

      if (keys.length === 0) {
        await transaction.done;
        return null;
      }

      const stored = await transaction.store.get(keys[0]);
      await transaction.done;

      if (stored === undefined) {
        throw new InvalidWorkspaceStoreError();
      }

      const snapshot = parseWorkspaceSnapshot(stored);

      if (snapshot.project.id !== keys[0]) {
        throw new InvalidWorkspaceStoreError();
      }

      return snapshot;
    }

    const stored = await this.#database.get(WORKSPACES_STORE_NAME, projectId);

    if (stored === undefined) {
      return null;
    }

    const snapshot = parseWorkspaceSnapshot(stored);

    if (snapshot.project.id !== projectId) {
      throw new InvalidWorkspaceStoreError();
    }

    return snapshot;
  }

  async save(snapshotValue: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    const snapshot = parseWorkspaceSnapshot(snapshotValue);
    const transaction = this.#database.transaction(
      [WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME],
      "readwrite", { durability: "strict" },
    );
    const store = transaction.objectStore(WORKSPACES_STORE_NAME);
    const keys = await store.getAllKeys();
    if (await transaction.objectStore(WORKSPACE_FILES_STORE_NAME).get(snapshot.project.id) !== undefined) throw new InvalidWorkspaceStoreError();

    if (
      keys.length > 1 ||
      (keys.length === 1 && keys[0] !== snapshot.project.id)
    ) {
      throw new InvalidWorkspaceStoreError();
    }

    const stored =
      keys.length === 0
        ? undefined
        : await store.get(snapshot.project.id);
    const current =
      stored === undefined ? null : parseWorkspaceSnapshot(stored);

    if (current === null) {
      if (snapshot.storageVersion !== 0) {
        throw new WorkspaceVersionConflictError(
          snapshot.storageVersion,
          null,
        );
      }

      await Promise.all([
        store.add(snapshot, snapshot.project.id),
        transaction.done,
      ]);
      return snapshot;
    }

    assertExpectedVersion(current, snapshot.storageVersion);

    const savedSnapshot = parseWorkspaceSnapshot({
      ...snapshot,
      storageVersion: nextStorageVersion(current.storageVersion),
    });

    await Promise.all([
      store.put(savedSnapshot, snapshot.project.id),
      transaction.done,
    ]);
    return savedSnapshot;
  }

  async replace(
    currentReference: StoredWorkspaceReference | null,
    replacementValue: WorkspaceSnapshot,
  ): Promise<WorkspaceSnapshot> {
    const replacement = parseWorkspaceSnapshot(replacementValue);
    const transaction = this.#database.transaction(
      [WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME],
      "readwrite", { durability: "strict" },
    );
    try {
      const store = transaction.objectStore(WORKSPACES_STORE_NAME);
      const keys = await store.getAllKeys();
      if (await transaction.objectStore(WORKSPACE_FILES_STORE_NAME).get(replacement.project.id) !== undefined) throw new InvalidWorkspaceStoreError();

      if (keys.length > 1) {
        throw new InvalidWorkspaceStoreError();
      }

      if (currentReference === null) {
        if (keys.length !== 0) {
          const stored = await store.get(keys[0]);
          const current = parseWorkspaceSnapshot(stored);
          throw new WorkspaceVersionConflictError(
            null,
            current.storageVersion,
          );
        }

        const initialReplacement = parseWorkspaceSnapshot({
          ...replacement,
          storageVersion: 0,
        });

        await Promise.all([
          store.add(
            initialReplacement,
            initialReplacement.project.id,
          ),
          transaction.done,
        ]);
        return initialReplacement;
      }

      if (keys.length !== 1 || keys[0] !== currentReference.projectId) {
        throw new WorkspaceVersionConflictError(
          currentReference.storageVersion,
          null,
        );
      }

      const stored = await store.get(currentReference.projectId);
      const current = parseWorkspaceSnapshot(stored);
      assertExpectedVersion(current, currentReference.storageVersion);

      const replacedSnapshot = parseWorkspaceSnapshot({
        ...replacement,
        storageVersion: nextStorageVersion(current.storageVersion),
      });

      if (currentReference.projectId !== replacedSnapshot.project.id) {
        const history = transaction.objectStore(WORKSPACE_HISTORY_STORE_NAME);
        const historyKeys = await history.index("projectId").getAllKeys(currentReference.projectId);
        for (const key of historyKeys) await history.delete(key);
        await store.delete(currentReference.projectId);
      }
      await store.put(replacedSnapshot, replacedSnapshot.project.id);
      await transaction.done;
      return replacedSnapshot;
    } catch (error: unknown) {
      try { transaction.abort(); } catch { /* Already completed or aborted. */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }

  /** The checkpoint and restored workspace commit together, before any editor is replaced. */
  async restoreHistory(reference: StoredWorkspaceReference, replacement: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    const next = parseWorkspaceSnapshot(replacement);
    const tx = this.#database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const store = tx.objectStore(WORKSPACES_STORE_NAME);
      const keys = await store.getAllKeys();
      if (keys.length !== 1 || keys[0] !== reference.projectId || next.project.id !== reference.projectId) throw new InvalidWorkspaceStoreError();
      const current = parseWorkspaceSnapshot(await store.get(reference.projectId));
      assertExpectedVersion(current, reference.storageVersion);
      const saved = parseWorkspaceSnapshot({ ...next, storageVersion: nextStorageVersion(current.storageVersion) });
      const history = tx.objectStore(WORKSPACE_HISTORY_STORE_NAME);
      const entries = (await history.index("projectId").getAll(reference.projectId)).map(parseHistoryEntry).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const checkpoint = createHistoryEntry(current, "復元前の状態", "before-restore");
      await history.add(checkpoint, checkpoint.id);
      await store.put(saved, saved.project.id);
      for (const entry of entries.slice(MAX_HISTORY_ENTRIES - 1)) await history.delete(entry.id);
      await tx.done;
      return saved;
    } catch (error: unknown) {
      try { tx.abort(); } catch { /* Already completed or aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }

  async delete(reference: StoredWorkspaceReference, recoveryValue?: WorkspaceSnapshot): Promise<void> {
    const transaction = this.#database.transaction(
      [WORKSPACES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME],
      "readwrite", { durability: "strict" },
    );
    try {
      const keys = await transaction.objectStore(WORKSPACES_STORE_NAME).getAllKeys();

      if (keys.length > 1) {
        throw new InvalidWorkspaceStoreError();
      }

      if (keys.length !== 1 || keys[0] !== reference.projectId) {
        throw new WorkspaceVersionConflictError(
          reference.storageVersion,
          null,
        );
      }

      const stored = await transaction.objectStore(WORKSPACES_STORE_NAME).get(reference.projectId);
      const current = parseWorkspaceSnapshot(stored);

      assertExpectedVersion(current, reference.storageVersion);
      const history = transaction.objectStore(WORKSPACE_HISTORY_STORE_NAME);
      const historyKeys = await history.index("projectId").getAllKeys(reference.projectId);
      const entries = (await history.index("projectId").getAll(reference.projectId)).map(parseHistoryEntry);
      const recovery = recoveryValue === undefined ? current : parseWorkspaceSnapshot(recoveryValue);
      if (recovery.project.id !== current.project.id || recovery.document.id !== current.document.id || recovery.storageVersion !== current.storageVersion) throw new InvalidWorkspaceStoreError();
      const trash = transaction.objectStore(WORKSPACE_TRASH_STORE_NAME);
      if (await trash.count() >= MAX_TRASH_ENTRIES) throw new Error("ごみ箱が満杯です。");
      const entry = createTrashEntry(recovery, null, entries);
      await trash.add(entry, entry.id);
      for (const key of historyKeys) await history.delete(key);
      await transaction.objectStore(WORKSPACES_STORE_NAME).delete(reference.projectId);
      await transaction.done;
    } catch (error: unknown) {
      try { transaction.abort(); } catch { /* Already completed or aborted. */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }
}
