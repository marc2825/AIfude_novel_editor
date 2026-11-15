// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/sw.js", "utf8");
function worker(fail = false, assets = ["/offline", "/_next/static/chunks/app.js"]) {
  const handlers = new Map<string, (event: unknown) => void>();
  const addAll = vi.fn<(requests: Request[]) => Promise<void>>(async () => { if (fail) throw new Error("quota"); });
  const match = vi.fn(async () => new Response("static shell"));
  const caches = { has: vi.fn(async () => false), open: vi.fn(async () => ({ addAll, match })), delete: vi.fn(async () => true), keys: vi.fn(async () => ["novel-offline-v1-old", "unrelated"]) };
  const fetch = vi.fn(async () => new Response("uncached"));
  const skipWaiting = vi.fn();
  runInNewContext(source, { importScripts: vi.fn(), Request, Response, URL, caches, fetch,
    self: { NOVEL_OFFLINE: { version: "a".repeat(20), assets }, location: { origin: "https://example.test" }, clients: { claim: vi.fn() }, skipWaiting,
      addEventListener: (kind: string, callback: (event: unknown) => void) => handlers.set(kind, callback) } });
  async function lifecycle(kind: string) {
    let pending: Promise<void> | undefined;
    handlers.get(kind)?.({ waitUntil: (promise: Promise<void>) => { pending = promise; } }); await pending;
  }
  function request(path: string, method = "GET", mode = "cors") {
    let result: Promise<Response> | undefined;
    handlers.get("fetch")?.({ request: { url: new URL(path, "https://example.test").href, method, mode }, respondWith: (value: Promise<Response>) => { result = value; } }); return result;
  }
  return { caches, addAll, fetch, match, skipWaiting, lifecycle, request };
}
describe("public-shell service worker", () => {
  it("installs only explicit public assets without cookies and never replaces a live editor", async () => {
    const sw = worker(); await sw.lifecycle("install");
    const requests: Request[] = sw.addAll.mock.calls[0]?.[0] ?? [];
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/offline", "/_next/static/chunks/app.js"]);
    expect(requests.every((r) => r.credentials === "omit" && r.redirect === "error")).toBe(true);
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });
  it("never intercepts AI, auth, dynamic responses, queries, other origins or writes", () => {
    const sw = worker();
    for (const [path, method] of [["/api/ai/edits", "POST"], ["/api/ai/connections", "GET"], ["/api/ai/feedback", "POST"], ["/api/sync", "POST"], ["/api/sync?project=private", "GET"], ["/auth", "GET"], ["/offline?secret=private", "GET"], ["https://other.test/offline", "GET"], ["/offline", "POST"]]) expect(sw.request(path!, method!)).toBeUndefined();
    expect(sw.caches.open).not.toHaveBeenCalled(); expect(sw.fetch).not.toHaveBeenCalled();
  });
  it("rejects a manifest containing a secret or dynamic route", () => {
    for (const path of ["/", "/api/ai/edits", "/_next/static/../secret.js"]) expect(() => worker(false, ["/offline", path])).toThrow();
  });
  it("keeps the old cache after failed install and cleans only own old versions on activation", async () => {
    const sw = worker(true); await expect(sw.lifecycle("install")).rejects.toThrow("quota");
    expect(sw.caches.delete).toHaveBeenCalledExactlyOnceWith(`novel-offline-v1-${"a".repeat(20)}`);
    sw.caches.delete.mockClear(); await sw.lifecycle("activate");
    expect(sw.caches.delete).toHaveBeenCalledExactlyOnceWith("novel-offline-v1-old");
  });
  it("falls back to the offline route without storing a dynamic navigation", async () => {
    const sw = worker(); sw.fetch.mockRejectedValue(new Error("offline"));
    expect(await (await sw.request("/", "GET", "navigate"))?.text()).toBe("static shell");
    expect(await (await sw.request("/offline", "GET", "navigate"))?.text()).toBe("static shell");
    expect(sw.addAll).not.toHaveBeenCalled();
  });
});
