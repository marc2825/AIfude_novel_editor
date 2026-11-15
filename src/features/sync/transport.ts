import { MAX_SYNC_BYTES, parseSyncRequest, parseSyncResponse, remoteSyncSchema, assertSyncSize, type RemoteSync, type SyncRequest, type SyncResponse } from "../../domain/sync";
import { browserIsOffline } from "../offline/connection-state";
export class SyncTransportError extends Error {
  constructor(readonly code: "offline" | "auth" | "network" | "invalid" | "limit") { super(`Sync ${code}`); }
}
export interface SyncTransport {
  readonly destination: string;
  exchange(request: SyncRequest, signal: AbortSignal): Promise<SyncResponse>;
  read(projectId: string, signal: AbortSignal): Promise<RemoteSync>;
}
/** Cookie-based, same-origin adapter. Production has no configured endpoint. */
export function sameOriginSyncTransport(origin: string, allowLoopbackFixture = false): SyncTransport {
  const base = new URL(origin);
  if (base.origin !== origin || (base.protocol !== "https:" && !(allowLoopbackFixture && base.protocol === "http:" && base.hostname === "127.0.0.1"))) throw new SyncTransportError("invalid");
  async function receive(path: string, request: RequestInit, signal: AbortSignal): Promise<unknown> {
    if (browserIsOffline()) throw new SyncTransportError("offline");
    if (typeof location !== "undefined" && location.origin !== origin) throw new SyncTransportError("invalid");
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    let remove = () => {};
    const abort = new Promise<never>((_resolve, reject) => {
      const cancelled = () => reject(new SyncTransportError("network"));
      deadline.addEventListener("abort", cancelled, { once: true }); remove = () => deadline.removeEventListener("abort", cancelled);
      if (deadline.aborted) cancelled();
    });
    const read = (async () => {
      if (deadline.aborted) throw new SyncTransportError("network");
      const response = await fetch(new URL(path, base), { ...request, credentials: "same-origin", cache: "no-store", redirect: "error", signal: deadline,
        headers: { "Content-Type": "application/json", "X-Novel-Sync": "1" } });
      if (deadline.aborted) { await response.body?.cancel(); throw new SyncTransportError("network"); }
      if (response.status === 401 || response.status === 403) throw new SyncTransportError("auth");
      if (response.status === 413) throw new SyncTransportError("limit");
      if (response.status === 400) throw new SyncTransportError("invalid");
      if (!response.ok || !response.body) throw new SyncTransportError("network");
      const reader = response.body.getReader(); let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
      const cancel = () => { void reader.cancel().catch(() => {}); }; deadline.addEventListener("abort", cancel, { once: true });
      try {
        while (true) {
          const part = await reader.read(); if (deadline.aborted) throw new SyncTransportError("network"); if (part.done) break;
          bytes += part.value.byteLength; if (bytes > MAX_SYNC_BYTES) { await reader.cancel(); throw new SyncTransportError("invalid"); }
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode(); const value: unknown = JSON.parse(text); return value;
      } finally { deadline.removeEventListener("abort", cancel); reader.releaseLock(); }
    })();
    try { return await Promise.race([read, abort]); }
    catch (error: unknown) { throw error instanceof SyncTransportError ? error : new SyncTransportError("network"); }
    finally { remove(); }
  }
  return {
    destination: base.origin,
    exchange: async (value, signal) => {
      const request = parseSyncRequest(value); const response = parseSyncResponse(await receive("/api/sync", { method: "POST", body: JSON.stringify(request) }, signal));
      if (response.operationId !== request.operationId || response.projectId !== request.projectId) throw new SyncTransportError("invalid");
      return response;
    },
    read: async (id, signal) => {
      if (!/^[a-f0-9-]{36}$/u.test(id)) throw new SyncTransportError("invalid");
      const value = await receive(`/api/sync?project=${encodeURIComponent(id)}`, { method: "GET" }, signal); assertSyncSize(value);
      const response = remoteSyncSchema.parse(value); if (response.payload.workspace.project.id !== id) throw new SyncTransportError("invalid"); return response;
    },
  };
}
