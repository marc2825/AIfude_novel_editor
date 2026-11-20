import { z } from "zod";
import { cloneWorkspace } from "../domain/chapters";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "../domain/workspace";
import { WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME, WORKSPACE_VAULT_STORE_NAME, type OpenWorkspaceDatabase } from "./indexeddb";
import { parseTrashEntry, MAX_TRASH_ENTRIES, type TrashEntry } from "./trash-repository";
import { parseHistoryEntry, type WritingHistoryEntry } from "./writing-history";
import { InvalidWorkspaceStoreError, WorkspaceVersionConflictError, type StoredWorkspaceReference } from "./workspace-repository";
import { secretVaultRecordSchema, type SecretVaultRecord } from "./secret-vault";
import { SecretLockedError } from "./secret-errors";

export const MAX_LIBRARY_BACKUP_BYTES = 100 * 1024 * 1024;
const legacyBundleSchema = z.object({ kind: z.literal("novel-editor-library"), version: z.literal(1), exportedAt: z.iso.datetime(),
  workspaces: z.array(z.unknown()).min(1).max(1_000), history: z.array(z.unknown()).max(50_000),
}).strict();
const bundleSchema = legacyBundleSchema.extend({ version: z.literal(2), workspaces: z.array(z.unknown()).max(1_000), trash: z.array(z.unknown()).max(MAX_TRASH_ENTRIES),
  // The wrapped data key of secret works. It is useless without the password.
  secretVault: secretVaultRecordSchema.optional() }).strict();
export type LibraryBackup = { kind: "novel-editor-library"; version: 2; exportedAt: string; workspaces: WorkspaceSnapshot[]; history: WritingHistoryEntry[]; trash: TrashEntry[]; secretVault?: SecretVaultRecord };
/** Opens shells with the backup's key and seals copies with this device's key. */
export type SecretImportCodec = Readonly<{ open: (shell: WorkspaceSnapshot) => Promise<WorkspaceSnapshot>; seal: (snapshot: WorkspaceSnapshot) => Promise<WorkspaceSnapshot> }>;
export function libraryBackupHasSecrets(bundle: LibraryBackup): boolean {
  return bundle.workspaces.some((workspace) => workspace.secret) || bundle.history.some((entry) => entry.snapshot.secret) ||
    bundle.trash.some((entry) => entry.snapshot.secret || entry.history.some((item) => item.snapshot.secret));
}
export function parseLibraryBackup(value: unknown): LibraryBackup {
  const legacy = legacyBundleSchema.safeParse(value);
  const bundle = bundleSchema.parse(legacy.success ? { ...legacy.data, version: 2, trash: [] } : value);
  const trash = bundle.trash.map(parseTrashEntry);
  if (bundle.workspaces.length + trash.length === 0 || new Set(trash.map((entry) => entry.id)).size !== trash.length) throw new Error("ごみ箱の参照が不正です。");
  const workspaces = bundle.workspaces.map(parseWorkspaceSnapshot);
  const ids = new Set(workspaces.map((workspace) => workspace.project.id));
  const history = bundle.history.map(parseHistoryEntry);
  if (ids.size !== workspaces.length || new Set(history.map((entry) => entry.id)).size !== history.length || history.some((entry) => !ids.has(entry.projectId))) throw new Error("バックアップの参照が不正です。");
  const counts = new Map<string, number>();
  for (const entry of history) {
    const count = (counts.get(entry.projectId) ?? 0) + 1;
    if (count > 50) throw new Error("作品ごとの履歴は50件までです。");
    counts.set(entry.projectId, count);
  }
  if (libraryBackupHasSecrets({ ...bundle, workspaces, history, trash }) && !bundle.secretVault) throw new Error("シークレット作品の鍵がバックアップにありません。");
  return { ...bundle, workspaces, history, trash };
}
export async function readLibraryBackup(file: File): Promise<LibraryBackup> {
  if (file.size > MAX_LIBRARY_BACKUP_BYTES) throw new Error("一括バックアップは100MiB以下にしてください。");
  return parseLibraryBackup(JSON.parse(await file.text()));
}
export class LibraryBackupRepository {
  constructor(private readonly database: OpenWorkspaceDatabase) {}
  async export(): Promise<LibraryBackup> {
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME, WORKSPACE_VAULT_STORE_NAME], "readonly");
    const [active, files, history, activeKeys, fileKeys, historyKeys, trash, trashKeys, vault] = await Promise.all([
      tx.objectStore(WORKSPACES_STORE_NAME).getAll(), tx.objectStore(WORKSPACE_FILES_STORE_NAME).getAll(), tx.objectStore(WORKSPACE_HISTORY_STORE_NAME).getAll(),
      tx.objectStore(WORKSPACES_STORE_NAME).getAllKeys(), tx.objectStore(WORKSPACE_FILES_STORE_NAME).getAllKeys(), tx.objectStore(WORKSPACE_HISTORY_STORE_NAME).getAllKeys(),
      tx.objectStore(WORKSPACE_TRASH_STORE_NAME).getAll(), tx.objectStore(WORKSPACE_TRASH_STORE_NAME).getAllKeys(), tx.objectStore(WORKSPACE_VAULT_STORE_NAME).get("vault"),
    ]);
    await tx.done;
    if (active.length > 1) throw new InvalidWorkspaceStoreError();
    const bundle = parseLibraryBackup({ kind: "novel-editor-library", version: 2, exportedAt: new Date().toISOString(), workspaces: [...active, ...files], history, trash, ...(vault === undefined ? {} : { secretVault: vault }) });
    if (bundle.workspaces.some((workspace, index) => workspace.project.id !== [...activeKeys, ...fileKeys][index]) ||
        bundle.history.some((entry, index) => entry.id !== historyKeys[index]) || bundle.trash.some((entry, index) => entry.id !== trashKeys[index])) throw new InvalidWorkspaceStoreError();
    return bundle;
  }
  async importCopies(value: LibraryBackup, reference: StoredWorkspaceReference | null, codec?: SecretImportCodec): Promise<number> {
    const parsed = parseLibraryBackup(value);
    if (libraryBackupHasSecrets(parsed) && !codec) throw new SecretLockedError();
    // Copies get new IDs, and sealed writing is bound to IDs: open first, clone, then seal again (all before the transaction).
    const open = async (snapshot: WorkspaceSnapshot) => snapshot.secret && codec ? codec.open(snapshot) : snapshot;
    const secretProjects = new Set<string>();
    for (const snapshot of [...parsed.workspaces, ...parsed.history.map((entry) => entry.snapshot), ...parsed.trash.flatMap((entry) => [entry.snapshot, ...entry.history.map((item) => item.snapshot)])]) {
      if (snapshot.secret) secretProjects.add(snapshot.project.id);
    }
    const bundle = { ...parsed,
      workspaces: await Promise.all(parsed.workspaces.map(open)),
      history: await Promise.all(parsed.history.map(async (entry) => ({ ...entry, snapshot: await open(entry.snapshot) }))),
      trash: await Promise.all(parsed.trash.map(async (entry) => ({ ...entry, snapshot: await open(entry.snapshot), history: await Promise.all(entry.history.map(async (item) => ({ ...item, snapshot: await open(item.snapshot) }))) }))),
    };
    const identities = new Map<string, string>();
    const seal = async (source: WorkspaceSnapshot, copy: WorkspaceSnapshot) => secretProjects.has(source.project.id) && codec ? codec.seal(copy) : copy;
    const workspaces = await Promise.all(bundle.workspaces.map((workspace) => seal(workspace, cloneWorkspace(workspace, identities))));
    const history = await Promise.all(bundle.history.map(async (entry) => {
      const snapshot = await seal(entry.snapshot, cloneWorkspace(entry.snapshot, identities));
      return parseHistoryEntry({ ...entry, id: crypto.randomUUID(), projectId: snapshot.project.id, snapshot });
    }));
    const trashEntries = await Promise.all(bundle.trash.map(async (entry) => {
      const snapshot = await seal(entry.snapshot, cloneWorkspace(entry.snapshot, identities));
      return parseTrashEntry({ ...entry, id: crypto.randomUUID(), projectId: snapshot.project.id, snapshot,
        chapterId: entry.chapterId === null ? null : identities.get(entry.chapterId),
        history: await Promise.all(entry.history.map(async (item) => ({ ...item, id: crypto.randomUUID(), projectId: snapshot.project.id, snapshot: await seal(item.snapshot, cloneWorkspace(item.snapshot, identities)) }))),
      });
    }));
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const active = tx.objectStore(WORKSPACES_STORE_NAME);
      const keys = await active.getAllKeys();
      if (keys.length > 1) throw new InvalidWorkspaceStoreError();
      const current = keys.length === 0 ? null : parseWorkspaceSnapshot(await active.get(keys[0]));
      if (current?.project.id !== (reference?.projectId ?? undefined) || (current?.storageVersion ?? null) !== (reference?.storageVersion ?? null)) throw new WorkspaceVersionConflictError(reference?.storageVersion ?? null, current?.storageVersion ?? null);
      const files = tx.objectStore(WORKSPACE_FILES_STORE_NAME);
      for (const workspace of workspaces) {
        if (await active.get(workspace.project.id) !== undefined || await files.get(workspace.project.id) !== undefined) throw new InvalidWorkspaceStoreError();
      }
      const trashStore = tx.objectStore(WORKSPACE_TRASH_STORE_NAME);
      if (await trashStore.count() + trashEntries.length > MAX_TRASH_ENTRIES) throw new Error("ごみ箱が満杯です。");
      for (const workspace of workspaces) await files.add(workspace, workspace.project.id);
      for (const entry of history) await tx.objectStore(WORKSPACE_HISTORY_STORE_NAME).add(entry, entry.id);
      for (const entry of trashEntries) await trashStore.add(entry, entry.id);
      await tx.done;
      return workspaces.length;
    } catch (error: unknown) {
      try { tx.abort(); } catch { /* Already completed or aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
}
