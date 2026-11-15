// @vitest-environment node
import "fake-indexeddb/auto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deleteDB, openDB } from "idb";
import { afterEach, expect, it } from "vitest";
import { createSyncPayload, parseSyncPayload, workspaceFromSync, historyFromSync, type SyncRequest } from "../../src/domain/sync";
import { orderedChapters } from "../../src/domain/chapters";
import { openWorkspaceDatabase, WORKSPACE_DATABASE_NAME, type OpenWorkspaceDatabase, type WorkspaceDatabase } from "../../src/persistence/indexeddb";
import { SyncRepository } from "../../src/persistence/sync-repository";
import { WorkspaceRepository } from "../../src/persistence/workspace-repository";
import { createHistoryEntry } from "../../src/persistence/writing-history";
import { TrashRepository } from "../../src/persistence/trash-repository";
import { SqliteSyncService } from "../../src/server/sync/sqlite-service";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { authoringFixture } from "../fixtures/authoring";

const account = { accountId: "90000000-0000-4000-8000-000000000001" };
const other = { accountId: "90000000-0000-4000-8000-000000000002" };
const databases: OpenWorkspaceDatabase[] = [], services: SqliteSyncService[] = [], directories: string[] = [];
afterEach(async () => { for (const db of databases.splice(0)) db.close(); for (const service of services.splice(0)) service.close(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function device() {
  const db = await openDB<WorkspaceDatabase>(crypto.randomUUID(), 5, { upgrade(db) {
    db.createObjectStore("workspaces"); db.createObjectStore("workspace-files"); db.createObjectStore("workspace-trash"); db.createObjectStore("workspace-sync");
    db.createObjectStore("workspace-history").createIndex("projectId", "projectId");
  } }); databases.push(db); return { db, sync: new SyncRepository(db), workspaces: new WorkspaceRepository(db) };
}
function request(baseRevision = 0): SyncRequest { const payload = createSyncPayload(createWorkspaceFixture(), []); return { version: 1, operationId: crypto.randomUUID(), deviceId: crypto.randomUUID(), projectId: payload.workspace.project.id, baseRevision, payload }; }
function server(path = ":memory:") { const service = new SqliteSyncService(path); services.push(service); return service; }

it("projects all chapters, memory, authoring and history while rejecting secret fields and malformed references", () => {
  const snapshot = createWorkspaceFixture(); snapshot.project.authoringProfile = authoringFixture();
  snapshot.chapter.body = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "葵", marks: [{ type: "ruby", attrs: { reading: "あおい", base: "葵" } }] },
    { type: "text", text: "が来た", marks: [{ type: "emphasis" }] },
  ] }] };
  const second = { ...snapshot.chapter, id: crypto.randomUUID(), orderIndex: 1, title: "第二章" };
  snapshot.additionalChapters = [second]; snapshot.document.chapterIds.push(second.id);
  snapshot.project.aiConsent = { providerId: "secret-provider-marker", policyVersion: 1, grantedAt: new Date().toISOString() };
  snapshot.project.aiModelPreference = "secret-model-marker";
  const payload = createSyncPayload(snapshot, [createHistoryEntry(snapshot, "履歴", "manual")]);
  expect(payload.workspace.project.authoringProfile).toEqual(snapshot.project.authoringProfile);
  expect(orderedChapters(workspaceFromSync(payload.workspace))).toEqual(orderedChapters(snapshot));
  expect(orderedChapters(historyFromSync(payload)[0]!.snapshot)).toEqual(orderedChapters(snapshot));
  expect(payload.history).toHaveLength(1); expect(JSON.stringify(payload)).not.toContain("secret-provider-marker"); expect(JSON.stringify(payload)).not.toContain("secret-model-marker");
  expect(JSON.stringify(payload)).not.toContain("aiConsent"); expect(JSON.stringify(payload)).not.toContain("storageVersion");
  expect(() => parseSyncPayload({ ...payload, apiKey: "private" })).toThrow();
  expect(() => parseSyncPayload({ ...payload, workspace: { ...payload.workspace, project: { ...payload.workspace.project, credential: "private" } } })).toThrow();
  expect(() => parseSyncPayload({ ...payload, version: 99 })).toThrow();
  expect(() => parseSyncPayload({ ...payload, history: [...payload.history, ...payload.history] })).toThrow();
  expect(() => parseSyncPayload({ ...payload, workspace: { ...payload.workspace, chapters: [] } })).toThrow();
});

it("migrates database v4 without rewriting a single stored workspace byte", async () => {
  await deleteDB(WORKSPACE_DATABASE_NAME);
  const old = await openDB<WorkspaceDatabase>(WORKSPACE_DATABASE_NAME, 4, { upgrade(db) {
    db.createObjectStore("workspaces"); db.createObjectStore("workspace-files"); db.createObjectStore("workspace-trash"); db.createObjectStore("workspace-history").createIndex("projectId", "projectId");
  } });
  const snapshot = createWorkspaceFixture(); await old.put("workspaces", snapshot, snapshot.project.id); old.close();
  const upgraded = await openWorkspaceDatabase(); databases.push(upgraded);
  expect(upgraded.version).toBe(5); expect(await upgraded.get("workspaces", snapshot.project.id)).toEqual(snapshot); expect(await upgraded.count("workspace-sync")).toBe(0);
});

it("keeps a pending request immutable through later edits and late/duplicate acknowledgements", async () => {
  const { db, sync, workspaces } = await device(); const saved = await workspaces.save(createWorkspaceFixture()); const id = saved.project.id;
  expect((await sync.load(id)).enabled).toBe(false); await expect(sync.stage(id)).rejects.toThrow();
  await sync.setEnabled(id, true); const first = await sync.stage(id); const pending = first.pending!;
  await workspaces.save({ ...saved, project: { ...saved.project, title: "後から書いた作品名" } });
  expect((await sync.stage(id)).pending).toEqual(pending);
  const service = server(); const ack = service.exchange(account, pending); await sync.complete(id, ack);
  const next = await sync.stage(id); expect(next.pending?.payload.workspace.project.title).toBe("後から書いた作品名");
  expect(next.pending?.baseRevision).toBe(1); expect(next.pending?.operationId).not.toBe(pending.operationId);
  await sync.complete(id, ack); expect((await sync.load(id)).pending).toEqual(next.pending);
  expect((await db.get("workspaces", id))).toEqual(await workspaces.load());
});

it("serializes two local stage writers without Web Locks and atomically preserves both conflicting copies", async () => {
  const deviceA = await device(), deviceB = await device();
  const a = await deviceA.workspaces.save(createWorkspaceFixture()); const b = await deviceB.workspaces.save(createWorkspaceFixture()); const id = a.project.id;
  await deviceA.sync.setEnabled(id, true); await deviceB.sync.setEnabled(id, true);
  const twin = await openDB<WorkspaceDatabase>(deviceA.db.name, 5); databases.push(twin);
  const staged = await Promise.all([deviceA.sync.stage(id), new SyncRepository(twin).stage(id)]);
  expect(staged[0]!.pending).toEqual(staged[1]!.pending);
  const service = server(); await deviceA.sync.complete(id, service.exchange(account, staged[0]!.pending));
  await deviceB.workspaces.save({ ...b, project: { ...b.project, title: "端末Bの変更" } });
  const local = await deviceB.sync.stage(id); const conflict = service.exchange(account, local.pending);
  const held = await deviceB.sync.complete(id, conflict); expect(held.conflict).toBe(true); expect(held.copies).toHaveLength(2);
  expect(held.copies.map((copy) => copy.payload.workspace.project.title)).toEqual(["端末Bの変更", a.project.title]);
  expect((await deviceB.workspaces.load())?.project.title).toBe("端末Bの変更");
  await expect(deviceB.sync.resolveWithLocal(id, held.sequence - 1)).rejects.toThrow();
  await deviceB.sync.resolveWithLocal(id, held.sequence); const resolved = await deviceB.sync.stage(id);
  expect(resolved.pending?.baseRevision).toBe(1); await deviceB.sync.complete(id, service.exchange(account, resolved.pending));
  expect(service.read(account, id).revision).toBe(2); expect(service.read(account, id, 1).payload.workspace.project.title).toBe(a.project.title);
});

it("uses transactional server CAS across connections, durable receipts, authorization and request identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "novel-sync-sqlite-")); directories.push(directory); const path = join(directory, "sync.sqlite");
  const one = server(path), two = server(path); const first = request(); const competing = request();
  const ack = one.exchange(account, first); expect(ack.status).toBe("applied");
  expect(two.exchange(account, competing).status).toBe("conflict"); expect(two.exchange(account, first)).toEqual(ack);
  expect(() => two.exchange(account, { ...first, baseRevision: 1 })).toThrow();
  expect(() => one.exchange(null, request())).toThrow(); expect(() => two.read(other, first.projectId)).toThrow();
  expect(() => two.exchange(account, request(99))).toThrow(); expect(() => two.exchange(account, { ...request(), owner: other.accountId })).toThrow();
  const reopened = server(path); expect(reopened.exchange(account, first)).toEqual(ack); expect(reopened.read(account, first.projectId).revision).toBe(1);
});

it("rolls back the manuscript and revision if receipt storage fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "novel-sync-rollback-")); directories.push(directory); const path = join(directory, "sync.sqlite");
  const service = server(path), requestValue = request(); const raw = new DatabaseSync(path);
  try {
    raw.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON sync_receipts BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;");
    expect(() => service.exchange(account, requestValue)).toThrow(); expect(() => service.read(account, requestValue.projectId)).toThrow();
    raw.exec("DROP TRIGGER fail_receipt;"); expect(service.exchange(account, requestValue).revision).toBe(1);
  } finally { raw.close(); }
});

it("does not apply an ack after opt-out or accept an impossible revision", async () => {
  const { sync, workspaces } = await device(); const saved = await workspaces.save(createWorkspaceFixture()); const id = saved.project.id;
  await sync.setEnabled(id, true); const state = await sync.stage(id); const response = server().exchange(account, state.pending);
  await sync.setEnabled(id, false); await sync.complete(id, response); expect((await sync.load(id)).pending).toEqual(state.pending);
  await sync.setEnabled(id, true); await expect(sync.complete(id, { ...response, revision: 99 })).rejects.toThrow();
  expect((await sync.load(id)).pending).toEqual(state.pending);
});

it("preserves an outbox in trash but removes it on permanent local deletion without touching the server", async () => {
  const { db, sync, workspaces } = await device(); const saved = await workspaces.save(createWorkspaceFixture()); const id = saved.project.id;
  await sync.setEnabled(id, true); const state = await sync.stage(id); const service = server(); service.exchange(account, state.pending);
  await workspaces.delete({ projectId: id, storageVersion: saved.storageVersion });
  expect((await sync.load(id)).pending).toEqual(state.pending);
  const trash = new TrashRepository(db); const entries = await trash.list();
  await trash.purge(null, entries[0]!.id);
  expect(await db.count("workspace-sync")).toBe(0); expect(service.read(account, id).revision).toBe(1);
});

it("retains conflicts when a local transaction cannot hold more copies and validates explicit copy deletion", async () => {
  const { db, sync, workspaces } = await device(); const saved = await workspaces.save(createWorkspaceFixture()); const id = saved.project.id;
  await sync.setEnabled(id, true); const state = await sync.stage(id); const service = server(); service.exchange(account, request());
  const conflict = service.exchange(account, state.pending); const held = await sync.complete(id, conflict);
  await expect(sync.removeCopy(id, held.copies[0]!.id, held.sequence)).rejects.toThrow();
  const resolved = await sync.resolveWithLocal(id, held.sequence); await expect(sync.removeCopy(id, held.copies[0]!.id, held.sequence)).rejects.toThrow();
  const removed = await sync.removeCopy(id, held.copies[0]!.id, resolved.sequence); expect(removed.copies).toHaveLength(1);
  const staged = await sync.stage(id); const newer = request(1); service.exchange(account, newer);
  const full = { ...staged, copies: Array.from({ length: 20 }, () => ({ ...held.copies[0]!, id: crypto.randomUUID() })) };
  await db.put("workspace-sync", full, id);
  await expect(sync.complete(id, service.exchange(account, staged.pending))).rejects.toThrow();
  expect(await db.get("workspace-sync", id)).toEqual(full); expect(await workspaces.load()).toEqual(saved);
});
