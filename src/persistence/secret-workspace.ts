import { orderedChapters, withChapters } from "../domain/chapters";
import { secretPayloadSchema } from "../domain/secret";
import type { WorkspaceSnapshot } from "../domain/workspace";
import { WORKSPACE_VAULT_STORE_NAME, type OpenWorkspaceDatabase } from "./indexeddb";
import { SecretLockedError, SecretStateError } from "./secret-errors";
import { openJson, openWorkspace, sealWorkspace, secretVaultRecordSchema, type SecretVaultRecord } from "./secret-vault";
import { TrashRepository, type TrashEntry } from "./trash-repository";
import { WritingHistoryRepository, type WritingHistoryEntry } from "./writing-history";
import { WorkspaceRepository, type StoredWorkspaceReference, type WorkspaceFileInfo } from "./workspace-repository";

export { SecretLockedError, SecretStateError };

/** Holds the data key in memory only while unlocked. Locking or reloading drops it. */
export class SecretKeyring {
  #key: CryptoKey | null = null;
  readonly #listeners = new Set<() => void>();
  get unlocked(): boolean { return this.#key !== null; }
  require(projectId: string | null = null): CryptoKey { if (this.#key === null) throw new SecretLockedError(projectId); return this.#key; }
  set(key: CryptoKey): void { this.#key = key; this.#notify(); }
  clear(): void { if (this.#key === null) return; this.#key = null; this.#notify(); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #notify(): void { for (const listener of this.#listeners) listener(); }
}

const VAULT_KEY = "vault";
export class SecretVaultRepository {
  constructor(private readonly database: OpenWorkspaceDatabase) {}
  async get(): Promise<SecretVaultRecord | null> {
    const stored: unknown = await this.database.get(WORKSPACE_VAULT_STORE_NAME, VAULT_KEY);
    return stored === undefined ? null : secretVaultRecordSchema.parse(stored);
  }
  /** Adds the vault only when none exists, so a second tab or a restore cannot replace another password. */
  async create(record: SecretVaultRecord): Promise<void> {
    const tx = this.database.transaction(WORKSPACE_VAULT_STORE_NAME, "readwrite", { durability: "strict" });
    try {
      if (await tx.store.get(VAULT_KEY) !== undefined) throw new Error("パスワードは既に設定されています。");
      await tx.store.add(secretVaultRecordSchema.parse(record), VAULT_KEY); await tx.done;
    } catch (error: unknown) { try { tx.abort(); } catch { /* Finished. */ } await tx.done.catch(() => undefined); throw error; }
  }
  /** Replace the wrapped key after a password change; refuses if the stored vault changed meanwhile. */
  async replace(previous: SecretVaultRecord, next: SecretVaultRecord): Promise<void> {
    const tx = this.database.transaction(WORKSPACE_VAULT_STORE_NAME, "readwrite", { durability: "strict" });
    try {
      const stored: unknown = await tx.store.get(VAULT_KEY);
      if (stored === undefined || JSON.stringify(secretVaultRecordSchema.parse(stored)) !== JSON.stringify(previous)) throw new Error("パスワードの設定が更新されています。");
      await tx.store.put(secretVaultRecordSchema.parse(next), VAULT_KEY); await tx.done;
    } catch (error: unknown) { try { tx.abort(); } catch { /* Finished. */ } await tx.done.catch(() => undefined); throw error; }
  }
}

/**
 * The workspace repository as the app uses it: secret works go to storage as sealed shells and
 * come back decrypted. Plain works pass through unchanged. Locked works throw SecretLockedError
 * before anything is moved.
 */
export class SecretWorkspaceRepository {
  readonly #secret = new Set<string>();
  readonly base: WorkspaceRepository;
  constructor(readonly database: OpenWorkspaceDatabase, readonly keyring: SecretKeyring) { this.base = new WorkspaceRepository(database); }
  history(): SecretHistoryRepository { return new SecretHistoryRepository(new WritingHistoryRepository(this.database), this.keyring, (id) => this.isSecret(id)); }
  trash(): SecretTrashRepository { return new SecretTrashRepository(new TrashRepository(this.database), this.keyring, (id) => this.isSecret(id)); }
  isSecret(projectId: string): boolean { return this.#secret.has(projectId); }
  #track(snapshot: WorkspaceSnapshot): void { if (snapshot.secret) this.#secret.add(snapshot.project.id); else this.#secret.delete(snapshot.project.id); }
  async #open(snapshot: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    this.#track(snapshot);
    return snapshot.secret ? openWorkspace(this.keyring.require(snapshot.project.id), snapshot) : snapshot;
  }
  async load(projectId?: string): Promise<WorkspaceSnapshot | null> {
    const stored = await this.base.load(projectId);
    return stored === null ? null : this.#open(stored);
  }
  /** The stored shell of a locked active work, for deleting it without the password. */
  async loadShell(): Promise<WorkspaceSnapshot | null> { return this.base.load(); }
  async save(snapshot: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    if (!this.isSecret(snapshot.project.id)) return this.base.save(snapshot);
    const saved = await this.base.save(await sealWorkspace(this.keyring.require(snapshot.project.id), snapshot));
    return { ...snapshot, storageVersion: saved.storageVersion };
  }
  async replace(reference: StoredWorkspaceReference | null, replacement: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    const replaced = await this.base.replace(reference, replacement);
    this.#track(replaced); return replaced;
  }
  async restoreHistory(reference: StoredWorkspaceReference, replacement: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    if (!this.isSecret(reference.projectId)) return this.base.restoreHistory(reference, replacement);
    const saved = await this.base.restoreHistory(reference, await sealWorkspace(this.keyring.require(reference.projectId), replacement));
    return { ...replacement, storageVersion: saved.storageVersion };
  }
  async delete(reference: StoredWorkspaceReference, recovery?: WorkspaceSnapshot): Promise<void> {
    const sealed = recovery && this.isSecret(reference.projectId) && !recovery.secret ? await sealWorkspace(this.keyring.require(reference.projectId), recovery) : recovery;
    await this.base.delete(reference, sealed);
    this.#secret.delete(reference.projectId);
  }
  async activateFile(reference: StoredWorkspaceReference | null, target: string | WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    if (typeof target === "string" && !this.keyring.unlocked && await this.base.isSecretFile(target)) throw new SecretLockedError(target);
    return this.#open(await this.base.activateFile(reference, target));
  }
  /** Titles of secret works are shown only while unlocked. */
  async listFiles(): Promise<readonly WorkspaceFileInfo[]> {
    const files = await this.base.listFiles();
    return Promise.all(files.map(async (file): Promise<WorkspaceFileInfo> => {
      if (!file.secret || !file.sealed) { this.#secret.delete(file.projectId); return { projectId: file.projectId, title: file.title }; }
      this.#secret.add(file.projectId);
      if (!this.keyring.unlocked) return { projectId: file.projectId, title: file.title, secret: true, locked: true };
      try { return { projectId: file.projectId, title: secretPayloadSchema.parse(await openJson(this.keyring.require(file.projectId), file.sealed)).projectTitle, secret: true, locked: false }; }
      catch { return { projectId: file.projectId, title: file.title, secret: true, locked: true }; }
    }));
  }
  /** Turn secret storage on or off for the open work, its history and its trash entries. */
  async setSecret(reference: StoredWorkspaceReference, current: WorkspaceSnapshot, on: boolean): Promise<WorkspaceSnapshot> {
    if (current.secret || current.project.id !== reference.projectId || current.storageVersion !== reference.storageVersion || this.isSecret(reference.projectId) === on) throw new SecretStateError();
    const key = this.keyring.require(reference.projectId);
    const database = this.database;
    const convert = (snapshot: WorkspaceSnapshot) => on ? sealWorkspace(key, snapshot) : openWorkspace(key, snapshot);
    const history = await Promise.all((await new WritingHistoryRepository(database).list(reference.projectId)).map(async (entry) => ({ ...entry, snapshot: await convert(entry.snapshot) })));
    const trash = await Promise.all((await new TrashRepository(database).list()).filter((entry) => entry.projectId === reference.projectId).map(async (entry) => ({
      ...entry, snapshot: await convert(entry.snapshot), history: await Promise.all(entry.history.map(async (item) => ({ ...item, snapshot: await convert(item.snapshot) }))),
    })));
    const saved = await this.base.convertSecrecy(reference, on ? await sealWorkspace(key, current) : current, history, trash);
    this.#track(saved);
    return { ...current, storageVersion: saved.storageVersion };
  }
}

/** Saved history with secret works sealed. */
export class SecretHistoryRepository {
  constructor(private readonly base: WritingHistoryRepository, private readonly keyring: SecretKeyring, private readonly isSecret: (projectId: string) => boolean) {}
  async list(projectId: string): Promise<WritingHistoryEntry[]> {
    const entries = await this.base.list(projectId);
    return Promise.all(entries.map(async (entry) => entry.snapshot.secret ? { ...entry, snapshot: await openWorkspace(this.keyring.require(projectId), entry.snapshot) } : entry));
  }
  async add(entry: WritingHistoryEntry): Promise<void> {
    await this.base.add(this.isSecret(entry.projectId) && !entry.snapshot.secret ? { ...entry, snapshot: await sealWorkspace(this.keyring.require(entry.projectId), entry.snapshot) } : entry);
  }
  clear(projectId: string): Promise<void> { return this.base.clear(projectId); }
}

/** Trash operations; chapter removal and restore of secret works are sealed before storage. */
export class SecretTrashRepository {
  constructor(private readonly base: TrashRepository, private readonly keyring: SecretKeyring, private readonly isSecret: (projectId: string) => boolean) {}
  list(): Promise<TrashEntry[]> { return this.base.list(); }
  async removeChapter(next: WorkspaceSnapshot, removedId: string): Promise<WorkspaceSnapshot> {
    if (!this.isSecret(next.project.id)) return this.base.removeChapter(next, removedId);
    const saved = await this.base.removeChapter(await sealWorkspace(this.keyring.require(next.project.id), next), removedId);
    return { ...next, storageVersion: saved.storageVersion };
  }
  async restoreChapter(reference: StoredWorkspaceReference, entryId: string, current: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    if (!this.isSecret(reference.projectId)) return this.base.restoreChapter(reference, entryId);
    const key = this.keyring.require(reference.projectId);
    const entry = (await this.base.list()).find((item) => item.id === entryId);
    if (!entry || entry.kind !== "chapter" || entry.projectId !== current.project.id || current.document.chapterIds.length >= 200) throw new Error("復元する章がありません。");
    const original = orderedChapters(await openWorkspace(key, entry.snapshot)).find((chapter) => chapter.id === entry.chapterId);
    if (!original) throw new Error("復元する章がありません。");
    const chapters = orderedChapters(current);
    chapters.splice(Math.min(original.orderIndex, chapters.length), 0, { ...original, id: crypto.randomUUID(), contentRevision: 0, updatedAt: new Date().toISOString() });
    const next = withChapters(current, chapters);
    const saved = await this.base.restoreChapterPrepared(reference, entryId, await sealWorkspace(key, next));
    return { ...next, storageVersion: saved.storageVersion };
  }
  restoreWorkspace(reference: StoredWorkspaceReference | null, entryId: string): Promise<WorkspaceSnapshot> { return this.base.restoreWorkspace(reference, entryId); }
  purge(reference: StoredWorkspaceReference | null, entryId: string): Promise<void> { return this.base.purge(reference, entryId); }
  removeSavedWorkspace(reference: StoredWorkspaceReference | null, projectId: string): Promise<void> { return this.base.removeSavedWorkspace(reference, projectId); }
}
