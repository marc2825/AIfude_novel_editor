import { z } from "zod";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "../domain/workspace";
import { WORKSPACE_HISTORY_STORE_NAME, type OpenWorkspaceDatabase } from "./indexeddb";

export const MAX_HISTORY_ENTRIES = 50;
const entrySchema = z.object({
  schemaVersion: z.literal(1), id: z.uuid(), projectId: z.uuid(), createdAt: z.iso.datetime(),
  label: z.string().min(1).max(120), reason: z.enum(["manual", "autosave", "before-restore"]), snapshot: z.unknown(),
}).strict();
export type WritingHistoryEntry = Omit<z.infer<typeof entrySchema>, "snapshot"> & { snapshot: WorkspaceSnapshot };
export function parseHistoryEntry(value: unknown): WritingHistoryEntry {
  const entry = entrySchema.parse(value);
  const snapshot = parseWorkspaceSnapshot(entry.snapshot);
  if (snapshot.project.id !== entry.projectId) throw new Error("履歴の作品IDが一致しません。");
  return { ...entry, snapshot };
}
export function createHistoryEntry(snapshot: WorkspaceSnapshot, label: string, reason: WritingHistoryEntry["reason"]): WritingHistoryEntry {
  return parseHistoryEntry({ schemaVersion: 1, id: crypto.randomUUID(), projectId: snapshot.project.id, createdAt: new Date().toISOString(), label, reason, snapshot });
}
export class WritingHistoryRepository {
  constructor(private readonly database: OpenWorkspaceDatabase) {}
  async list(projectId: string): Promise<WritingHistoryEntry[]> {
    const entries = await this.database.getAllFromIndex(WORKSPACE_HISTORY_STORE_NAME, "projectId", projectId);
    return entries.map(parseHistoryEntry).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async add(entryValue: WritingHistoryEntry): Promise<void> {
    const entry = parseHistoryEntry(entryValue);
    const tx = this.database.transaction(WORKSPACE_HISTORY_STORE_NAME, "readwrite", { durability: "strict" });
    try {
      const entries = (await tx.store.index("projectId").getAll(entry.projectId)).map(parseHistoryEntry);
      const oldest = entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(MAX_HISTORY_ENTRIES - 1);
      await tx.store.add(entry, entry.id);
      for (const old of oldest) await tx.store.delete(old.id);
      await tx.done;
    } catch (error: unknown) {
      try { tx.abort(); } catch { /* Already completed or aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
  async clear(projectId: string): Promise<void> {
    const tx = this.database.transaction(WORKSPACE_HISTORY_STORE_NAME, "readwrite", { durability: "strict" });
    try {
      const keys = await tx.store.index("projectId").getAllKeys(projectId);
      for (const key of keys) await tx.store.delete(key);
      await tx.done;
    } catch (error: unknown) {
      try { tx.abort(); } catch { /* Already completed or aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
}
