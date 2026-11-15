import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceDatabase, WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, type OpenWorkspaceDatabase } from "../../src/persistence/indexeddb";
import { WorkspaceRepository, WorkspaceVersionConflictError } from "../../src/persistence/workspace-repository";
import { WritingHistoryRepository, createHistoryEntry } from "../../src/persistence/writing-history";
import { LibraryBackupRepository, parseLibraryBackup, readLibraryBackup, MAX_LIBRARY_BACKUP_BYTES } from "../../src/persistence/library-backup";
import { withChapters, orderedChapters } from "../../src/domain/chapters";
import { createWorkspaceFixture } from "../fixtures/workspace";

let database: OpenWorkspaceDatabase;
beforeEach(async () => { vi.stubGlobal("indexedDB", new IDBFactory()); database = await openWorkspaceDatabase(); });
afterEach(() => database.close());
function reference(workspace: ReturnType<typeof createWorkspaceFixture>) { return { projectId: workspace.project.id, storageVersion: workspace.storageVersion }; }
describe("writing library and history", () => {
  it("round trips every work, chapter, note and history as independent copies with reset consent", async () => {
    const repo = new WorkspaceRepository(database); const history = new WritingHistoryRepository(database); const library = new LibraryBackupRepository(database);
    let first = createWorkspaceFixture();
    first.project.storyMemory.characterNotes = "主人公";
    first.project.aiConsent = { policyVersion: 1, providerId: "openai", grantedAt: new Date().toISOString() };
    const secondChapter = { ...first.chapter, id: crypto.randomUUID(), title: "第二章", outlineNotes: "帰還" };
    first = await repo.save(withChapters(first, [first.chapter, secondChapter], secondChapter.id));
    const checkpoint = createHistoryEntry(first, "初稿", "manual"); await history.add(checkpoint);
    const second = await repo.activateFile(reference(first), createWorkspaceFixture({ identity: "replacement" }));
    const bundle = parseLibraryBackup(JSON.parse(JSON.stringify(await library.export())));
    expect(bundle.workspaces).toHaveLength(2); expect(bundle.history).toHaveLength(1);
    expect(await library.importCopies(bundle, reference(second))).toBe(2);
    expect(await repo.load()).toEqual(second); expect(await repo.listFiles()).toHaveLength(4);
    const archives = (await database.getAll(WORKSPACE_FILES_STORE_NAME));
    const exportedAgain = await library.export();
    const copiedFirst = exportedAgain.workspaces.find((workspace) => workspace.project.id !== first.project.id && workspace.project.storyMemory.characterNotes === "主人公");
    if (!copiedFirst) throw new Error("Missing copied work");
    expect(orderedChapters(copiedFirst).map((chapter) => [chapter.title, chapter.outlineNotes, chapter.body])).toEqual(orderedChapters(first).map((chapter) => [chapter.title, chapter.outlineNotes, chapter.body]));
    expect(copiedFirst.project.aiConsent).toBeNull(); expect(copiedFirst.document.id).not.toBe(first.document.id);
    const copiedHistory = await history.list(copiedFirst.project.id); expect(copiedHistory).toHaveLength(1);
    expect(copiedHistory[0].snapshot.document.chapterIds).toEqual(copiedFirst.document.chapterIds);
    expect(archives).toHaveLength(3);
  });
  it("rejects malformed and future backups, duplicate IDs, orphan history and oversized files", async () => {
    const repo = new WorkspaceRepository(database); const first = await repo.save(createWorkspaceFixture());
    const library = new LibraryBackupRepository(database); const bundle = await library.export();
    for (const invalid of [{ ...bundle, version: 3 }, { ...bundle, workspaces: [first, first] }, { ...bundle, history: [createHistoryEntry(createWorkspaceFixture({ identity: "replacement" }), "他作品", "manual")] }, { ...bundle, workspaces: [{ ...first, schemaVersion: 99 }] }]) expect(() => parseLibraryBackup(invalid)).toThrow();
    const file = new File(["{}"], "huge.json"); Object.defineProperty(file, "size", { value: MAX_LIBRARY_BACKUP_BYTES + 1 });
    await expect(readLibraryBackup(file)).rejects.toThrow(); expect(await repo.load()).toEqual(first); expect(await repo.listFiles()).toHaveLength(1);
  });
  it("refuses a stale backup import and leaves all stores unchanged", async () => {
    const repo = new WorkspaceRepository(database); const first = await repo.save(createWorkspaceFixture()); const library = new LibraryBackupRepository(database);
    const bundle = await library.export(); await repo.save(first);
    await expect(library.importCopies(bundle, reference(first))).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
    expect(await database.count(WORKSPACE_FILES_STORE_NAME)).toBe(0); expect(await database.count(WORKSPACE_HISTORY_STORE_NAME)).toBe(0);
  });
  it("rolls back all imported copies after a synchronous storage error", async () => {
    const repo = new WorkspaceRepository(database); const first = await repo.save(createWorkspaceFixture()); const library = new LibraryBackupRepository(database);
    const second = createWorkspaceFixture({ identity: "replacement" }); const bundle = { ...await library.export(), workspaces: [first, second] };
    const original = IDBObjectStore.prototype.add; let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      if (this.name === WORKSPACE_FILES_STORE_NAME && ++calls === 2) throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    });
    await expect(library.importCopies(bundle, reference(first))).rejects.toThrow();
    expect(await database.count(WORKSPACE_FILES_STORE_NAME)).toBe(0); expect(await repo.load()).toEqual(first);
  });
  it("atomically records the current state before restoring and enforces CAS", async () => {
    const repo = new WorkspaceRepository(database); const history = new WritingHistoryRepository(database);
    const first = await repo.save(createWorkspaceFixture()); const past = createHistoryEntry(first, "以前", "manual"); await history.add(past);
    const current = await repo.save({ ...first, project: { ...first.project, storyMemory: { ...first.project.storyMemory, settingNotes: "新設定" } } });
    await expect(repo.restoreHistory(reference(first), past.snapshot)).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
    expect(await history.list(first.project.id)).toHaveLength(1);
    const restored = await repo.restoreHistory(reference(current), past.snapshot);
    expect(restored.storageVersion).toBe(current.storageVersion + 1); expect(restored.project.storyMemory.settingNotes).toBe("");
    expect((await history.list(first.project.id)).find((entry) => entry.reason === "before-restore")?.snapshot).toEqual(current);
  });
  it("keeps the current manuscript when the checkpoint write fails during restoration", async () => {
    const repo = new WorkspaceRepository(database); const first = await repo.save(createWorkspaceFixture());
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(repo.restoreHistory(reference(first), { ...first, project: { ...first.project, title: "戻したい作品" } })).rejects.toThrow();
    expect(await repo.load()).toEqual(first); expect(await database.count(WORKSPACE_HISTORY_STORE_NAME)).toBe(0);
  });
  it("retains at most 50 entries and deletes a work's history together with that work", async () => {
    const repo = new WorkspaceRepository(database); const first = await repo.save(createWorkspaceFixture()); const history = new WritingHistoryRepository(database);
    for (let index = 0; index < 52; index++) await history.add({ ...createHistoryEntry(first, `履歴${index}`, "manual"), createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() });
    const entries = await history.list(first.project.id); expect(entries).toHaveLength(50); expect(entries.at(-1)?.label).toBe("履歴2");
    await repo.delete(reference(first)); expect(await database.count(WORKSPACE_HISTORY_STORE_NAME)).toBe(0); expect(await database.count(WORKSPACES_STORE_NAME)).toBe(0);
  });
  it("rolls back history deletions when replacing a work fails synchronously", async () => {
    const repo = new WorkspaceRepository(database); const current = await repo.save(createWorkspaceFixture());
    const history = new WritingHistoryRepository(database); const checkpoint = createHistoryEntry(current, "保護する稿", "manual"); await history.add(checkpoint);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(repo.replace(reference(current), createWorkspaceFixture({ identity: "replacement" }))).rejects.toThrow();
    expect(await repo.load()).toEqual(current); expect(await history.list(current.project.id)).toEqual([checkpoint]);
  });

});
