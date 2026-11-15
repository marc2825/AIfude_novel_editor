import "server-only";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { parseSyncPayload, parseSyncRequest, parseSyncResponse, type RemoteSync, type SyncResponse } from "../../domain/sync";

export class SyncServiceError extends Error {
  constructor(readonly code: "auth" | "invalid" | "missing" | "limit") { super(`Sync ${code}`); }
}
export type SyncPrincipal = Readonly<{ accountId: string }>;
const storedRow = z.object({ revision: z.int().positive(), payload: z.string() });
/** No HTTP endpoint is exposed by the product. An authenticated adapter must supply principal. */
export class SqliteSyncService {
  readonly #database: DatabaseSync;
  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
    const version = this.#database.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1) { this.#database.close(); throw new SyncServiceError("invalid"); }
    this.#database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sync_projects (owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,id)) STRICT;
      CREATE TABLE IF NOT EXISTS sync_receipts (owner TEXT NOT NULL, operation TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(owner,operation)) STRICT;
      CREATE TABLE IF NOT EXISTS sync_revisions (owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,id,revision)) STRICT;
      PRAGMA user_version=1;`);
  }
  close() { this.#database.close(); }
  private owner(principal: SyncPrincipal | null): string {
    if (!principal || !z.uuid().safeParse(principal.accountId).success) throw new SyncServiceError("auth");
    return principal.accountId;
  }
  read(principal: SyncPrincipal | null, projectId: string, revision?: number): RemoteSync {
    const owner = this.owner(principal);
    if (!z.uuid().safeParse(projectId).success || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))) throw new SyncServiceError("invalid");
    const row = revision === undefined
      ? this.#database.prepare("SELECT revision,payload FROM sync_projects WHERE owner=? AND id=?").get(owner, projectId)
      : this.#database.prepare("SELECT revision,payload FROM sync_revisions WHERE owner=? AND id=? AND revision=?").get(owner, projectId, revision);
    if (!row) throw new SyncServiceError("missing");
    const parsed = storedRow.parse(row); return { version: 1, revision: parsed.revision, payload: parseSyncPayload(JSON.parse(parsed.payload)) };
  }
  exchange(principal: SyncPrincipal | null, value: unknown): SyncResponse {
    const owner = this.owner(principal);
    let request;
    try { request = parseSyncRequest(value); } catch { throw new SyncServiceError("invalid"); }
    const digest = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const db = this.#database;
    db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = db.prepare("SELECT digest,response FROM sync_receipts WHERE owner=? AND operation=?").get(owner, request.operationId);
      if (receipt) {
        if (receipt.digest !== digest || typeof receipt.response !== "string") throw new SyncServiceError("invalid");
        const response = parseSyncResponse(JSON.parse(receipt.response)); db.exec("COMMIT"); return response;
      }
      const row = db.prepare("SELECT revision,payload FROM sync_projects WHERE owner=? AND id=?").get(owner, request.projectId);
      const current = row ? storedRow.parse(row) : null;
      if (request.baseRevision > (current?.revision ?? 0)) throw new SyncServiceError("invalid");
      let response: SyncResponse;
      if (current && current.revision !== request.baseRevision) {
        response = { version: 1, status: "conflict", operationId: request.operationId, projectId: request.projectId, revision: current.revision, payload: parseSyncPayload(JSON.parse(current.payload)) };
      } else {
        response = { version: 1, status: "applied", operationId: request.operationId, projectId: request.projectId, revision: (current?.revision ?? 0) + 1 };
      }
      response = parseSyncResponse(response);
      const payload = JSON.stringify(request.payload), result = JSON.stringify(response);
      const usage = db.prepare(`SELECT
        (SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM sync_projects WHERE owner=?) +
        (SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM sync_revisions WHERE owner=?) +
        (SELECT coalesce(sum(length(CAST(response AS BLOB))),0) FROM sync_receipts WHERE owner=?) AS bytes,
        (SELECT count(*) FROM sync_receipts WHERE owner=?) AS receipts,
        (SELECT count(*) FROM sync_projects WHERE owner=?) AS projects`).get(owner, owner, owner, owner, owner);
      const quota = z.object({ bytes: z.number(), receipts: z.number(), projects: z.number() }).parse(usage);
      if (quota.receipts >= 1_000 || (!current && quota.projects >= 100) || quota.bytes + Buffer.byteLength(payload) * 2 + Buffer.byteLength(result) > 100 * 1024 * 1024) throw new SyncServiceError("limit");
      if (response.status === "applied") {
        db.prepare("INSERT INTO sync_revisions(owner,id,revision,payload) VALUES(?,?,?,?)").run(owner, request.projectId, response.revision, payload);
        db.prepare("INSERT INTO sync_projects(owner,id,revision,payload) VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload").run(owner, request.projectId, response.revision, payload);
      }
      db.prepare("INSERT INTO sync_receipts(owner,operation,digest,response) VALUES(?,?,?,?)").run(owner, request.operationId, digest, result);
      db.exec("COMMIT"); return response;
    } catch (error: unknown) { db.exec("ROLLBACK"); throw error; }
  }
}
