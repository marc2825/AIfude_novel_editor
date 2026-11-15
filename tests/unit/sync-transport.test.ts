// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createSyncPayload, type SyncRequest } from "../../src/domain/sync";
import { sameOriginSyncTransport } from "../../src/features/sync/transport";
import { createWorkspaceFixture } from "../fixtures/workspace";
afterEach(() => vi.unstubAllGlobals());
function request(): SyncRequest { const payload = createSyncPayload(createWorkspaceFixture(), []); return { version: 1, projectId: payload.workspace.project.id, operationId: crypto.randomUUID(), deviceId: crypto.randomUUID(), baseRevision: 0, payload }; }
it("requires HTTPS and same-origin; only explicit loopback fixtures allow HTTP", () => {
  expect(() => sameOriginSyncTransport("http://example.test")).toThrow(); expect(() => sameOriginSyncTransport("http://192.168.0.1", true)).toThrow();
  expect(() => sameOriginSyncTransport("https://user:secret@example.test")).toThrow(); expect(() => sameOriginSyncTransport("https://example.test/path")).toThrow();
  expect(sameOriginSyncTransport("http://127.0.0.1:3108", true).destination).toBe("http://127.0.0.1:3108");
});
it("uses no-store and rejects mismatched response identities without automatically retrying", async () => {
  const value = request(); const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ version: 1, status: "applied", projectId: value.projectId, operationId: crypto.randomUUID(), revision: 1 })); vi.stubGlobal("fetch", fetch);
  await expect(sameOriginSyncTransport("https://example.test").exchange(value, new AbortController().signal)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "same-origin", redirect: "error" });
});
it("does not send while offline and does not replay when connection returns", async () => {
  vi.stubGlobal("navigator", { onLine: false }); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(sameOriginSyncTransport("https://example.test").exchange(request(), new AbortController().signal)).rejects.toMatchObject({ code: "offline" });
  vi.stubGlobal("navigator", { onLine: true }); expect(fetch).not.toHaveBeenCalled();
});
it("rejects an abort-ignoring late response and cancels its body", async () => {
  let release: (value: Response) => void = () => {}; const late = new Promise<Response>((resolve) => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn(() => late)); const value = request(), abort = new AbortController();
  const pending = sameOriginSyncTransport("https://example.test").exchange(value, abort.signal); abort.abort();
  await expect(pending).rejects.toMatchObject({ code: "network" });
  const response = Response.json({ version: 1, status: "applied", projectId: value.projectId, operationId: value.operationId, revision: 1 }); const cancel = vi.spyOn(response.body!, "cancel");
  release(response); await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
});
it("distinguishes authentication failure and refuses an oversized response", async () => {
  const value = request(); const transport = sameOriginSyncTransport("https://example.test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  await expect(transport.exchange(value, new AbortController().signal)).rejects.toMatchObject({ code: "auth" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(10 * 1024 * 1024 + 1))));
  await expect(transport.exchange(value, new AbortController().signal)).rejects.toMatchObject({ code: "invalid" });
});
