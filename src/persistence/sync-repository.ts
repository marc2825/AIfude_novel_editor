import { createSyncPayload, emptySyncState, parseSyncResponse, remoteSyncSchema, syncStateSchema, type RemoteSync, type SyncPayload, type SyncResponse, type SyncState } from "../domain/sync";
import { parseWorkspaceSnapshot } from "../domain/workspace";
import { WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_SYNC_STORE_NAME, type OpenWorkspaceDatabase } from "./indexeddb";
import { parseHistoryEntry } from "./writing-history";

/** Sync CAS uses IndexedDB transactions only; it never acquires a Web Lock or edits an editor. */
export class SyncRepository {
  constructor(private readonly database: OpenWorkspaceDatabase) {}
  async load(projectId: string): Promise<SyncState> {
    const value = await this.database.get(WORKSPACE_SYNC_STORE_NAME, projectId);
    const state = value === undefined ? emptySyncState(projectId) : syncStateSchema.parse(value);
    if (state.projectId !== projectId) throw new Error("同期状態の作品IDが一致しません。");
    return state;
  }
  private async mutate(projectId: string, change: (state: SyncState) => SyncState): Promise<SyncState> {
    const tx = this.database.transaction(WORKSPACE_SYNC_STORE_NAME, "readwrite", { durability: "strict" });
    try {
      const value = await tx.store.get(projectId);
      const state = value === undefined ? emptySyncState(projectId) : syncStateSchema.parse(value);
      if (state.projectId !== projectId) throw new Error("同期ID不一致");
      const next = syncStateSchema.parse(change(state));
      await tx.store.put(next, projectId); await tx.done; return next;
    } catch (error: unknown) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
  }
  setEnabled(projectId: string, enabled: boolean): Promise<SyncState> {
    return this.mutate(projectId, (state) => ({ ...state, enabled, sequence: state.sequence + 1, lastError: null }));
  }
  async stage(projectId: string): Promise<SyncState> {
    const tx = this.database.transaction([WORKSPACES_STORE_NAME, WORKSPACE_FILES_STORE_NAME, WORKSPACE_HISTORY_STORE_NAME, WORKSPACE_SYNC_STORE_NAME], "readwrite", { durability: "strict" });
    try {
      const store = tx.objectStore(WORKSPACE_SYNC_STORE_NAME); const raw = await store.get(projectId);
      const state = raw === undefined ? emptySyncState(projectId) : syncStateSchema.parse(raw);
      if (state.projectId !== projectId || !state.enabled) throw new Error("先に同期準備を有効にしてください。");
      if (state.pending || state.conflict) { await tx.done; return state; }
      const active = await tx.objectStore(WORKSPACES_STORE_NAME).get(projectId);
      const archived = await tx.objectStore(WORKSPACE_FILES_STORE_NAME).get(projectId);
      if (active !== undefined && archived !== undefined) throw new Error("作品保存先が重複しています。");
      const snapshot = parseWorkspaceSnapshot(active ?? archived);
      if (snapshot.project.id !== projectId) throw new Error("同期作品の参照が不正です。");
      const history = (await tx.objectStore(WORKSPACE_HISTORY_STORE_NAME).index("projectId").getAll(projectId)).map(parseHistoryEntry);
      const payload = createSyncPayload(snapshot, history);
      if (JSON.stringify(payload) === JSON.stringify(state.lastUploaded)) { await tx.done; return state; }
      const next = syncStateSchema.parse({ ...state, sequence: state.sequence + 1, lastError: null,
        pending: { version: 1, operationId: crypto.randomUUID(), deviceId: state.deviceId, projectId, baseRevision: state.remoteRevision, payload } });
      await store.put(next, projectId); await tx.done; return next;
    } catch (error: unknown) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
  }
  complete(projectId: string, value: SyncResponse): Promise<SyncState> {
    const result = parseSyncResponse(value);
    return this.mutate(projectId, (state) => {
      const request = state.pending;
      if (!state.enabled || !request || request.operationId !== result.operationId) return state;
      if (result.projectId !== projectId || result.revision <= request.baseRevision ||
        (result.status === "applied" && result.revision !== request.baseRevision + 1) ||
        (result.status === "conflict" && result.payload.workspace.project.id !== projectId)) throw new Error("同期応答のrevisionまたは作品IDが不正です。");
      if (result.status === "applied") return { ...state, sequence: state.sequence + 1, pending: null, remoteRevision: result.revision, lastUploaded: request.payload, lastError: null };
      return { ...state, sequence: state.sequence + 1, remoteRevision: result.revision, pending: null, conflict: true, lastError: null,
        copies: [...state.copies, this.copy(request.payload, request.baseRevision, "local-conflict"), this.copy(result.payload, result.revision, "remote-conflict")] };
    });
  }
  fail(projectId: string, operationId: string, error: NonNullable<SyncState["lastError"]>): Promise<SyncState> {
    return this.mutate(projectId, (state) => state.pending?.operationId !== operationId || !state.enabled ? state : { ...state, lastError: error });
  }
  receive(projectId: string, value: RemoteSync, expectedSequence: number): Promise<SyncState> {
    const remote = remoteSyncSchema.parse(value);
    return this.mutate(projectId, (state) => {
      if (!state.enabled || state.sequence !== expectedSequence) return state;
      if (remote.payload.workspace.project.id !== projectId || remote.revision < state.remoteRevision) throw new Error("古い、または別作品の同期データです。");
      if (state.copies.some((copy) => copy.revision === remote.revision && JSON.stringify(copy.payload) === JSON.stringify(remote.payload))) return state;
      // Receiving is a preview/copy operation, never an acknowledgement of local edits.
      return { ...state, sequence: state.sequence + 1, copies: [...state.copies, this.copy(remote.payload, remote.revision, "remote")] };
    });
  }
  resolveWithLocal(projectId: string, expectedSequence: number): Promise<SyncState> {
    return this.mutate(projectId, (state) => {
      if (!state.enabled || !state.conflict || state.sequence !== expectedSequence) throw new Error("同期状態が変わりました。再確認してください。");
      return { ...state, sequence: state.sequence + 1, conflict: false, lastUploaded: null, lastError: null };
    });
  }
  removeCopy(projectId: string, copyId: string, expectedSequence: number): Promise<SyncState> {
    return this.mutate(projectId, (state) => {
      if (state.conflict || state.sequence !== expectedSequence || !state.copies.some((copy) => copy.id === copyId)) throw new Error("コピー削除前に同期状態を確認してください。");
      return { ...state, sequence: state.sequence + 1, copies: state.copies.filter((copy) => copy.id !== copyId) };
    });
  }
  private copy(payload: SyncPayload, revision: number, source: SyncState["copies"][number]["source"]): SyncState["copies"][number] {
    return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), revision, source, payload };
  }
}
