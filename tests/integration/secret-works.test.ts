import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { orderedChapters, withChapters } from "../../src/domain/chapters";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "../../src/domain/workspace";
import { openWorkspaceDatabase, WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME, type OpenWorkspaceDatabase } from "../../src/persistence/indexeddb";
import { createSecretVault, openWorkspace, sealWorkspace, unlockSecretVault } from "../../src/persistence/secret-vault";
import { LibraryBackupRepository, parseLibraryBackup } from "../../src/persistence/library-backup";
import { SecretKeyring, SecretLockedError, SecretStateError, SecretVaultRepository, SecretWorkspaceRepository } from "../../src/persistence/secret-workspace";
import { createHistoryEntry } from "../../src/persistence/writing-history";

const SECRET_TEXT = "誰にも見せない本文";
let database: OpenWorkspaceDatabase;
beforeEach(async () => { vi.stubGlobal("indexedDB", new IDBFactory()); database = await openWorkspaceDatabase(); });
afterEach(() => database.close());

function withText(workspace: WorkspaceSnapshot, text: string, title = "秘密の物語"): WorkspaceSnapshot {
  return parseWorkspaceSnapshot({ ...workspace, project: { ...workspace.project, title },
    chapter: { ...workspace.chapter, title: "告白", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } } });
}
const ref = (workspace: WorkspaceSnapshot) => ({ projectId: workspace.project.id, storageVersion: workspace.storageVersion });
async function rawDump(): Promise<string> {
  return JSON.stringify(await Promise.all(([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_TRASH_STORE_NAME] as const).map((name) => database.getAll(name))));
}
async function secretSetup() {
  const keyring = new SecretKeyring(); const { record, key } = await createSecretVault("secret password", { iterations: 100_000 });
  await new SecretVaultRepository(database).create(record); keyring.set(key);
  const repository = new SecretWorkspaceRepository(database, keyring);
  let current = await repository.save(withText(createWorkspaceFixture(), SECRET_TEXT));
  await repository.history().add(createHistoryEntry(current, "初稿", "manual"));
  await database.put("workspace-sync", { projectId: current.project.id, plain: SECRET_TEXT }, current.project.id);
  current = await repository.setSecret(ref(current), current, true);
  return { keyring, repository, current, record, key };
}

describe("secret works in storage", () => {
  it("passes plain works through unchanged", async () => {
    const repository = new SecretWorkspaceRepository(database, new SecretKeyring());
    const saved = await repository.save(withText(createWorkspaceFixture(), "普通の本文"));
    expect(await repository.load()).toEqual(saved); expect(await rawDump()).toContain("普通の本文");
    expect(await repository.listFiles()).toEqual([{ projectId: saved.project.id, title: "秘密の物語" }]);
  });

  it("seals the work, its history and later saves, and needs the key to read them", async () => {
    const { keyring, repository, current } = await secretSetup();
    expect(await database.get("workspace-sync", current.project.id)).toBeUndefined();
    expect(await rawDump()).not.toContain(SECRET_TEXT); expect(await rawDump()).not.toContain("秘密の物語");
    const edited = await repository.save(withText(current, `${SECRET_TEXT}・追記`));
    expect(edited.storageVersion).toBe(current.storageVersion + 1); expect(await rawDump()).not.toContain("追記");
    expect((await repository.load())?.chapter.body).toEqual(edited.chapter.body);
    expect((await repository.history().list(current.project.id))[0].snapshot.chapter.body).toEqual(withText(current, SECRET_TEXT).chapter.body);
    expect(await repository.listFiles()).toEqual([{ projectId: current.project.id, title: "秘密の物語", secret: true, locked: false }]);
    keyring.clear();
    await expect(repository.load()).rejects.toBeInstanceOf(SecretLockedError);
    await expect(repository.save(edited)).rejects.toBeInstanceOf(SecretLockedError);
    expect(await repository.listFiles()).toEqual([{ projectId: current.project.id, title: "シークレット作品", secret: true, locked: true }]);
    await expect(repository.base.save({ ...edited, storageVersion: edited.storageVersion })).rejects.toBeInstanceOf(SecretStateError);
  });

  it("refuses to switch to a locked secret work before moving anything, and opens it once unlocked", async () => {
    const { keyring, repository, current, key } = await secretSetup();
    const plain = await repository.activateFile(ref(current), createWorkspaceFixture({ identity: "replacement" }));
    keyring.clear();
    await expect(repository.activateFile(ref(plain), current.project.id)).rejects.toBeInstanceOf(SecretLockedError);
    expect((await repository.load())?.project.id).toBe(plain.project.id);
    keyring.set(key);
    const reopened = await repository.activateFile(ref(plain), current.project.id);
    expect(reopened.chapter.body).toEqual(current.chapter.body); expect(reopened.project.title).toBe("秘密の物語");
  });

  it("keeps chapters sealed through removal and restore, and restores a deleted secret work as secret", async () => {
    const { keyring, repository, current, key } = await secretSetup();
    const second = { ...current.chapter, id: crypto.randomUUID(), title: "第二章", orderIndex: 1, body: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "第二章の秘密" }] }] } };
    let work = await repository.save(withChapters(current, [...orderedChapters(current), second]));
    work = await repository.trash().removeChapter(withChapters(work, orderedChapters(work).filter((chapter) => chapter.id !== second.id)), second.id);
    expect(await rawDump()).not.toContain("第二章の秘密");
    const entry = (await repository.trash().list()).find((item) => item.kind === "chapter");
    if (!entry) throw new Error("chapter entry");
    work = await repository.trash().restoreChapter(ref(work), entry.id, work);
    expect(orderedChapters(work).map((chapter) => chapter.title)).toEqual(["告白", "第二章"]);
    expect(orderedChapters((await repository.load()) as WorkspaceSnapshot)[1].body).toEqual(second.body);
    await repository.delete(ref(work), work);
    keyring.clear();
    const deleted = (await repository.trash().list()).find((item) => item.kind === "workspace");
    if (!deleted) throw new Error("workspace entry");
    expect(deleted.snapshot.project.title).toBe("シークレット作品"); expect(await rawDump()).not.toContain(SECRET_TEXT);
    keyring.set(key);
    const restored = await repository.trash().restoreWorkspace(null, deleted.id);
    expect(restored.secret).toBeDefined();
    const opened = await repository.activateFile(null, restored.project.id);
    expect(opened.chapter.body).toEqual(work.chapter.body);
  });

  it("backs up secret works sealed with the wrapped key and imports copies sealed with another device's key", async () => {
    const { current, record } = await secretSetup();
    const bundle = await new LibraryBackupRepository(database).export();
    expect(bundle.secretVault).toEqual(record); expect(JSON.stringify(bundle)).not.toContain(SECRET_TEXT);
    const parsed = parseLibraryBackup(JSON.parse(JSON.stringify(bundle)));
    vi.stubGlobal("indexedDB", new IDBFactory()); const other = await openWorkspaceDatabase();
    try {
      const device = await createSecretVault("other device password", { iterations: 100_000 });
      await expect(new LibraryBackupRepository(other).importCopies(parsed, null)).rejects.toBeInstanceOf(SecretLockedError);
      expect(await unlockSecretVault(parsed.secretVault!, "wrong password")).toBeNull();
      const source = await unlockSecretVault(parsed.secretVault!, "secret password");
      if (!source) throw new Error("unlock");
      expect(await new LibraryBackupRepository(other).importCopies(parsed, null, { open: (shell) => openWorkspace(source, shell), seal: (copy) => sealWorkspace(device.key, copy) })).toBe(1);
      expect(JSON.stringify(await other.getAll(WORKSPACE_FILES_STORE_NAME))).not.toContain(SECRET_TEXT);
      const keyring = new SecretKeyring(); keyring.set(device.key);
      const repository = new SecretWorkspaceRepository(other, keyring);
      const files = await repository.listFiles(); expect(files[0]).toMatchObject({ title: "秘密の物語", secret: true, locked: false });
      const opened = await repository.activateFile(null, files[0].projectId);
      expect(opened.chapter.body).toEqual(current.chapter.body); expect(opened.project.id).not.toBe(current.project.id);
      expect(await repository.history().list(opened.project.id)).toHaveLength(1);
    } finally { other.close(); }
  });
  it("moves a locked secret work to the trash without the key and turns secret storage off again", async () => {
    const { keyring, repository, current, key } = await secretSetup();
    const plain = await repository.activateFile(ref(current), createWorkspaceFixture({ identity: "replacement" }));
    keyring.clear();
    await repository.trash().removeSavedWorkspace(ref(plain), current.project.id);
    expect((await repository.listFiles()).map((file) => file.projectId)).toEqual([plain.project.id]);
    keyring.set(key);
    const second = await secretSetup2(repository, plain);
    const off = await repository.setSecret(ref(second), second, false);
    expect(await rawDump()).toContain("あとで解除する本文"); expect((await repository.load())?.secret).toBeUndefined();
    expect(repository.isSecret(off.project.id)).toBe(false);
  });
});

async function secretSetup2(repository: SecretWorkspaceRepository, plain: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const saved = await repository.save(withText(plain, "あとで解除する本文", "解除する作品"));
  return repository.setSecret(ref(saved), saved, true);
}
