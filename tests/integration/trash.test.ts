import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { orderedChapters, withChapters } from "../../src/domain/chapters";
import { openWorkspaceDatabase, WORKSPACE_TRASH_STORE_NAME, WORKSPACES_STORE_NAME, type OpenWorkspaceDatabase } from "../../src/persistence/indexeddb";
import { WorkspaceRepository } from "../../src/persistence/workspace-repository";
import { TrashRepository, TrashVersionConflictError, createTrashEntry, parseTrashEntry } from "../../src/persistence/trash-repository";
import { createHistoryEntry, WritingHistoryRepository } from "../../src/persistence/writing-history";
import { LibraryBackupRepository, parseLibraryBackup } from "../../src/persistence/library-backup";

let database: OpenWorkspaceDatabase;
beforeEach(async () => { vi.stubGlobal("indexedDB", new IDBFactory()); database = await openWorkspaceDatabase(); });
afterEach(() => database.close());
function reference(workspace: ReturnType<typeof createWorkspaceFixture>) { return { projectId: workspace.project.id, storageVersion: workspace.storageVersion }; }
describe("recoverable deletion", () => {
  it("restores a copy when the original identity already exists and rejects duplicate history IDs", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database); const current = await repo.save(createWorkspaceFixture());
    const history = createHistoryEntry(current, "保存", "manual"); const entry = createTrashEntry(current, null, [history]);
    expect(() => parseTrashEntry({ ...entry, history: [history, history] })).toThrow();
    await database.add(WORKSPACE_TRASH_STORE_NAME, entry, entry.id);
    const restored = await trash.restoreWorkspace(reference(current), entry.id);
    expect(restored.project.id).not.toBe(current.project.id); expect(restored.chapter.id).not.toBe(current.chapter.id); expect(restored.chapter.body).toEqual(current.chapter.body);
    expect(await repo.load()).toEqual(current); expect(await new WritingHistoryRepository(database).list(restored.project.id)).toHaveLength(1);
  });
  it("keeps a work, its latest PM snapshot and history, then restores without overwriting another work", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database); const history = new WritingHistoryRepository(database);
    const first = createWorkspaceFixture(); first.project.storyMemory.characterNotes = "主人公";
    first.project.aiConsent = { providerId: "chatgpt", policyVersion: 1, grantedAt: new Date().toISOString() };
    const saved = await repo.save(first); await history.add(createHistoryEntry(first, "初稿", "manual"));
    const latest = { ...saved, chapter: { ...saved.chapter, contentRevision: 8, body: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "保存に失敗していた最新本文😀" }] }] } } };
    await repo.delete(reference(saved), latest); expect(await repo.load()).toBeNull(); expect(await history.list(first.project.id)).toHaveLength(0);
    const entry = (await trash.list())[0]; expect(entry.snapshot.chapter.body).toEqual(latest.chapter.body); expect(entry.history).toHaveLength(1);
    const second = await repo.save(createWorkspaceFixture({ identity: "replacement" }));
    const restored = await trash.restoreWorkspace(reference(second), entry.id);
    expect(restored.chapter.body).toEqual(latest.chapter.body); expect(restored.project.storyMemory.characterNotes).toBe("主人公"); expect(restored.project.aiConsent).toBeNull();
    expect(await repo.load()).toEqual(second); expect(await trash.list()).toHaveLength(0); expect(await repo.listFiles()).toHaveLength(2);
    expect(await history.list(restored.project.id)).toHaveLength(1);
  });
  it("restores a deleted chapter with a fresh ID, exact body and original position", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database);
    const first = createWorkspaceFixture(); const second = { ...first.chapter, id: crypto.randomUUID(), title: "後半", outlineNotes: "戻ってくる" };
    const current = await repo.save(withChapters(first, [first.chapter, second]));
    const next = withChapters(current, [second], second.id); const removed = await trash.removeChapter(next, first.chapter.id);
    const entry = (await trash.list())[0]; expect(entry.kind).toBe("chapter"); expect(removed.document.chapterIds).toHaveLength(1);
    const restored = await trash.restoreChapter(reference(removed), entry.id); const chapters = orderedChapters(restored);
    expect(chapters[0].body).toEqual(first.chapter.body); expect(chapters[0].id).not.toBe(first.chapter.id); expect(chapters[0].title).toBe(first.chapter.title);
    expect(restored.chapter.id).toBe(second.id); expect(restored.chapter.body).toEqual(second.body); expect(await trash.list()).toHaveLength(0);
  });
  it("rolls back deletion and retains the original data if the trash write fails", async () => {
    const repo = new WorkspaceRepository(database); const current = await repo.save(createWorkspaceFixture());
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(repo.delete(reference(current))).rejects.toThrow(); expect(await repo.load()).toEqual(current);
    expect(await database.count(WORKSPACE_TRASH_STORE_NAME)).toBe(0);
  });
  it("rolls back restoration if saving the recovered manuscript fails", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database); const current = await repo.save(createWorkspaceFixture());
    await repo.delete(reference(current)); const entry = (await trash.list())[0];
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(trash.restoreWorkspace(null, entry.id)).rejects.toThrow(); expect(await trash.list()).toEqual([entry]); expect(await repo.load()).toBeNull();
  });
  it("rejects stale references, wrong-work chapter recovery and invalid data", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database); const first = await repo.save(createWorkspaceFixture());
    await repo.delete(reference(first)); const entry = (await trash.list())[0];
    const second = await repo.save(createWorkspaceFixture({ identity: "replacement" }));
    await expect(trash.restoreWorkspace(null, entry.id)).rejects.toBeInstanceOf(TrashVersionConflictError);
    await expect(trash.purge({ ...reference(second), storageVersion: 99 }, entry.id)).rejects.toBeInstanceOf(TrashVersionConflictError);
    expect(() => parseTrashEntry({ ...entry, chapterId: first.chapter.id })).toThrow(); expect(() => parseTrashEntry({ ...entry, schemaVersion: 2 })).toThrow();
    const chapter = createTrashEntry(first, first.chapter.id); await database.add(WORKSPACE_TRASH_STORE_NAME, chapter, chapter.id);
    await expect(trash.restoreChapter(reference(second), chapter.id)).rejects.toThrow(); expect(await trash.list()).toHaveLength(2);
  });
  it("exports trash, migrates old backups and imports matching work/chapter IDs consistently", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database); const current = createWorkspaceFixture();
    await repo.save(current); const entry = createTrashEntry(current, current.chapter.id); await database.add(WORKSPACE_TRASH_STORE_NAME, entry, entry.id);
    const library = new LibraryBackupRepository(database); const bundle = await library.export(); expect(bundle.version).toBe(2); expect(bundle.trash).toHaveLength(1);
    expect(parseLibraryBackup({ kind: bundle.kind, version: 1, exportedAt: bundle.exportedAt, workspaces: bundle.workspaces, history: [] }).trash).toEqual([]);
    await library.importCopies(bundle, reference(current)); const all = await library.export(); const copy = all.workspaces.find((item) => item.project.id !== current.project.id);
    if (!copy) throw new Error("Missing copy"); const copiedTrash = all.trash.find((item) => item.projectId === copy.project.id);
    expect(copiedTrash?.chapterId).toBe(copy.chapter.id); expect(copiedTrash?.snapshot.chapter.body).toEqual(current.chapter.body);
    await trash.purge(reference(current), entry.id); expect((await trash.list()).some((item) => item.id === entry.id)).toBe(false);
  });
  it("can export a deleted-only library and purges only the chosen entry", async () => {
    const repo = new WorkspaceRepository(database); const trash = new TrashRepository(database); const first = await repo.save(createWorkspaceFixture()); await repo.delete(reference(first));
    const library = await new LibraryBackupRepository(database).export(); expect(library.workspaces).toHaveLength(0); expect(library.trash).toHaveLength(1);
    await trash.purge(null, library.trash[0].id); expect(await trash.list()).toHaveLength(0); expect(await database.count(WORKSPACES_STORE_NAME)).toBe(0);
  });
});
