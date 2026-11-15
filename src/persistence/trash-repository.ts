import { z } from "zod";
import { cloneWorkspace, orderedChapters, withChapters } from "../domain/chapters";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "../domain/workspace";
import { WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME, WORKSPACE_SYNC_STORE_NAME, type OpenWorkspaceDatabase } from "./indexeddb";
import { parseHistoryEntry, type WritingHistoryEntry } from "./writing-history";
import type { StoredWorkspaceReference } from "./workspace-repository";

export const MAX_TRASH_ENTRIES = 200;
const entrySchema = z.object({ schemaVersion: z.literal(1), id: z.uuid(), kind: z.enum(["workspace", "chapter"]),
  projectId: z.uuid(), chapterId: z.uuid().nullable(), deletedAt: z.iso.datetime(), snapshot: z.unknown(), history: z.array(z.unknown()).max(50),
}).strict();
export type TrashEntry = Omit<z.infer<typeof entrySchema>, "snapshot" | "history"> & { snapshot: WorkspaceSnapshot; history: WritingHistoryEntry[] };
export class TrashVersionConflictError extends Error {}
export function parseTrashEntry(value: unknown): TrashEntry {
  const entry = entrySchema.parse(value); const snapshot = parseWorkspaceSnapshot(entry.snapshot); const history = entry.history.map(parseHistoryEntry);
  if (entry.projectId !== snapshot.project.id || new Set(history.map((item) => item.id)).size !== history.length || history.some((item) => item.projectId !== entry.projectId) ||
      (entry.kind === "workspace" ? entry.chapterId !== null : !orderedChapters(snapshot).some((chapter) => chapter.id === entry.chapterId) || history.length > 0)) throw new Error("ごみ箱の参照が不正です。");
  return { ...entry, snapshot, history };
}
export function createTrashEntry(snapshot: WorkspaceSnapshot, chapterId: string | null, history: WritingHistoryEntry[] = []): TrashEntry {
  return parseTrashEntry({ schemaVersion: 1, id: crypto.randomUUID(), kind: chapterId === null ? "workspace" : "chapter", projectId: snapshot.project.id, chapterId, deletedAt: new Date().toISOString(), snapshot, history });
}
function verifyReference(current: WorkspaceSnapshot | null, reference: StoredWorkspaceReference | null): void {
  if ((current?.project.id ?? null) !== (reference?.projectId ?? null) || (current?.storageVersion ?? null) !== (reference?.storageVersion ?? null)) throw new TrashVersionConflictError("保存先が更新されています。");
}
function nextVersion(value: number): number { if (value === Number.MAX_SAFE_INTEGER) throw new Error("保存versionの上限です。"); return value + 1; }

export class TrashRepository {
  constructor(private readonly database: OpenWorkspaceDatabase) {}
  async list(): Promise<TrashEntry[]> {
    const tx = this.database.transaction(WORKSPACE_TRASH_STORE_NAME, "readonly");
    const [entries, keys] = await Promise.all([tx.store.getAll(), tx.store.getAllKeys()]); await tx.done;
    const parsed = entries.map(parseTrashEntry);
    if (parsed.some((entry, index) => entry.id !== keys[index])) throw new Error("ごみ箱のキーが不正です。");
    return parsed.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  async removeChapter(nextValue: WorkspaceSnapshot, removedId: string): Promise<WorkspaceSnapshot> {
    const next = parseWorkspaceSnapshot(nextValue);
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_TRASH_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const active = tx.objectStore(WORKSPACES_STORE_NAME); const keys = await active.getAllKeys();
      const current = keys.length === 1 ? parseWorkspaceSnapshot(await active.get(keys[0])) : null;
      verifyReference(current, { projectId: next.project.id, storageVersion: next.storageVersion });
      if (!current || keys[0] !== current.project.id || current.document.id !== next.document.id ||
          current.document.chapterIds.length !== next.document.chapterIds.length + 1 || !current.document.chapterIds.includes(removedId) ||
          next.document.chapterIds.includes(removedId) || next.document.chapterIds.some((id) => !current.document.chapterIds.includes(id))) throw new Error("章の削除範囲が不正です。");
      const trash = tx.objectStore(WORKSPACE_TRASH_STORE_NAME);
      if (await trash.count() >= MAX_TRASH_ENTRIES) throw new Error("ごみ箱が満杯です。不要な項目を完全削除してください。");
      const entry = createTrashEntry(current, removedId);
      const saved = parseWorkspaceSnapshot({ ...next, storageVersion: nextVersion(current.storageVersion) });
      await trash.add(entry, entry.id); await active.put(saved, saved.project.id); await tx.done;
      return saved;
    } catch (error: unknown) { try { tx.abort(); } catch { /* Finished. */ } await tx.done.catch(() => undefined); throw error; }
  }
  async restoreChapter(reference: StoredWorkspaceReference, entryId: string): Promise<WorkspaceSnapshot> {
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_TRASH_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const active = tx.objectStore(WORKSPACES_STORE_NAME); const keys = await active.getAllKeys();
      const current = keys.length === 1 ? parseWorkspaceSnapshot(await active.get(keys[0])) : null; verifyReference(current, reference);
      const trash = tx.objectStore(WORKSPACE_TRASH_STORE_NAME); const entry = parseTrashEntry(await trash.get(entryId));
      if (!current || keys[0] !== current.project.id || entry.kind !== "chapter" || entry.projectId !== current.project.id || entry.snapshot.document.id !== current.document.id || current.document.chapterIds.length >= 200) throw new Error("復元先の作品を開いてください。");
      const original = orderedChapters(entry.snapshot).find((chapter) => chapter.id === entry.chapterId);
      if (!original) throw new Error("復元する章がありません。");
      const chapters = orderedChapters(current);
      chapters.splice(Math.min(original.orderIndex, chapters.length), 0, { ...original, id: crypto.randomUUID(), contentRevision: 0, updatedAt: new Date().toISOString() });
      const saved = withChapters({ ...current, storageVersion: nextVersion(current.storageVersion) }, chapters);
      await active.put(saved, saved.project.id); await trash.delete(entryId); await tx.done; return saved;
    } catch (error: unknown) { try { tx.abort(); } catch { /* Finished. */ } await tx.done.catch(() => undefined); throw error; }
  }
  async restoreWorkspace(reference: StoredWorkspaceReference | null, entryId: string): Promise<WorkspaceSnapshot> {
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const active = tx.objectStore(WORKSPACES_STORE_NAME); const keys = await active.getAllKeys();
      if (keys.length > 1) throw new TrashVersionConflictError("保存先が不正です。");
      const current = keys.length === 1 ? parseWorkspaceSnapshot(await active.get(keys[0])) : null; verifyReference(current, reference);
      const trash = tx.objectStore(WORKSPACE_TRASH_STORE_NAME); const entry = parseTrashEntry(await trash.get(entryId));
      const files = tx.objectStore(WORKSPACE_FILES_STORE_NAME);
      if (entry.kind !== "workspace") throw new Error("作品の復元対象が不正です。");
      const collision = current?.project.id === entry.projectId || await files.get(entry.projectId) !== undefined;
      const identities = new Map<string, string>();
      const source = collision ? cloneWorkspace(entry.snapshot, identities) : entry.snapshot;
      const snapshot = parseWorkspaceSnapshot({ ...source, storageVersion: 0, project: { ...source.project, aiConsent: null, contextRevision: nextVersion(source.project.contextRevision), updatedAt: new Date().toISOString() } });
      await files.add(snapshot, snapshot.project.id);
      for (const item of entry.history) {
        const historySnapshot = collision ? cloneWorkspace(item.snapshot, identities) : { ...item.snapshot, project: { ...item.snapshot.project, aiConsent: null } };
        const recovered = { ...item, id: crypto.randomUUID(), projectId: snapshot.project.id, snapshot: historySnapshot };
        await tx.objectStore(WORKSPACE_HISTORY_STORE_NAME).add(recovered, recovered.id);
      }
      await trash.delete(entryId); await tx.done; return snapshot;
    } catch (error: unknown) { try { tx.abort(); } catch { /* Finished. */ } await tx.done.catch(() => undefined); throw error; }
  }
  async purge(reference: StoredWorkspaceReference | null, entryId: string): Promise<void> {
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_TRASH_STORE_NAME, WORKSPACE_SYNC_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const active = tx.objectStore(WORKSPACES_STORE_NAME); const keys = await active.getAllKeys();
      if (keys.length > 1) throw new TrashVersionConflictError("保存先が不正です。");
      verifyReference(keys.length === 1 ? parseWorkspaceSnapshot(await active.get(keys[0])) : null, reference);
      const trash = tx.objectStore(WORKSPACE_TRASH_STORE_NAME); const entry = parseTrashEntry(await trash.get(entryId));
      await trash.delete(entryId);
      // Permanent local deletion must not leave an orphaned manuscript in the sync outbox.
      if (entry.kind === "workspace" && !keys.includes(entry.projectId) && await tx.objectStore(WORKSPACE_FILES_STORE_NAME).get(entry.projectId) === undefined &&
        !(await trash.getAll()).map(parseTrashEntry).some((remaining) => remaining.projectId === entry.projectId)) {
        await tx.objectStore(WORKSPACE_SYNC_STORE_NAME).delete(entry.projectId);
      }
      await tx.done;
    } catch (error: unknown) { try { tx.abort(); } catch { /* Finished. */ } await tx.done.catch(() => undefined); throw error; }
  }
}
