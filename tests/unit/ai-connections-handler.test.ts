import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAiConnections } from "../../src/server/http/ai-connections-handler";
import { publicConnectionStateSchema } from "../../src/domain/ai-connections";
import { settingsFromEnvironment, type AiSettingsStore, type ConnectionRecord } from "../../src/server/ai/connection-settings";
import { matchesAiSettingsRevision } from "../../src/server/http/ai-settings-revision";
import { createDeferred } from "../helpers/deferred";

const environment = { APP_ORIGIN: "http://127.0.0.1:3000", AI_PROVIDER: "mock", OPENAI_API_KEY: "private-test-key", LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1", LOCAL_LLM_MODEL: "fixture" };
beforeEach(() => vi.stubGlobal("novelEditorAiRateLimiters", new Map()));
function request(value?: unknown, origin = environment.APP_ORIGIN) {
  return new Request(`${environment.APP_ORIGIN}/api/ai/connections`, { method: value === undefined ? "GET" : "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json", "sec-fetch-site": "same-origin" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
function setup() {
  let record: ConnectionRecord | null = null;
  const store: AiSettingsStore = { read: vi.fn(async () => record), update: vi.fn(async (_revision, settings) => {
    record = settings ? { version: 1, revision: crypto.randomUUID(), settings } : null; return record;
  }) };
  return { store, change(value: ConnectionRecord) { record = value; } };
}
describe("AI settings HTTP boundary", () => {
  it("returns only public configuration and saves a new selection without provider calls", async () => {
    const { store } = setup(); const fetch = vi.fn<typeof globalThis.fetch>();
    const get = await handleAiConnections(request(), { environment, store, diagnostic: { fetch } });
    const data = publicConnectionStateSchema.parse(await get.json()); expect(data.settings.primary).toBe("mock"); expect(JSON.stringify(data)).not.toContain("private-test-key");
    const saved = await handleAiConnections(request({ action: "save", expectedRevision: null, settings: { ...data.settings, primary: "local" } }), { environment, store, diagnostic: { fetch } });
    const result = publicConnectionStateSchema.parse(await saved.json()); expect(result.revision).not.toBeNull(); expect(result.settings.primary).toBe("local"); expect(fetch).not.toHaveBeenCalled();
    expect(get.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-origin mutations, unexpected manuscript fields, and stale settings", async () => {
    const { store, change } = setup(); const fetch = vi.fn<typeof globalThis.fetch>();
    const body = { action: "diagnose", requestId: crypto.randomUUID(), expectedRevision: null, mode: "local", allowPaidApi: false };
    expect((await handleAiConnections(request(body, "https://other.test"), { environment, store, diagnostic: { fetch } })).status).toBe(403);
    expect((await handleAiConnections(request({ ...body, manuscript: "送らない本文" }), { environment, store, diagnostic: { fetch } })).status).toBe(400);
    change({ version: 1, revision: crypto.randomUUID(), settings: settingsFromEnvironment(environment) });
    expect((await handleAiConnections(request(body), { environment, store, diagnostic: { fetch } })).status).toBe(409); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects old diagnostics after configuration changes while fetch ignores abort", async () => {
    const { store, change } = setup(); const pending = createDeferred<Response>(); const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(pending.promise);
    const promise = handleAiConnections(request({ action: "diagnose", requestId: crypto.randomUUID(), expectedRevision: null, mode: "local", allowPaidApi: false }), { environment, store, diagnostic: { fetch } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    change({ version: 1, revision: crypto.randomUUID(), settings: settingsFromEnvironment(environment) });
    pending.resolve(Response.json({ data: [{ id: "fixture" }] })); expect((await promise).status).toBe(409);
  });
  it("does not contact APIs before both permissions are enabled or reveal internal errors", async () => {
    const { store } = setup(); const fetch = vi.fn<typeof globalThis.fetch>();
    const response = await handleAiConnections(request({ action: "diagnose", requestId: crypto.randomUUID(), expectedRevision: null, mode: "openai", allowPaidApi: true }), { environment, store, diagnostic: { fetch } });
    expect(await response.json()).toMatchObject({ status: "api-disabled" }); expect(fetch).not.toHaveBeenCalled();
    vi.mocked(store.read).mockRejectedValueOnce(new Error("private-test-key"));
    const failure = await handleAiConnections(request(), { environment, store }); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("private-test-key");
  });
  it("binds inference requests to their setting revision, including legacy environment requests", () => {
    expect(matchesAiSettingsRevision(request(), "environment")).toBe(true);
    const revision = crypto.randomUUID(); expect(matchesAiSettingsRevision(request(), revision)).toBe(false);
    const current = new Request(environment.APP_ORIGIN, { headers: { "x-novel-ai-settings-revision": revision } });
    expect(matchesAiSettingsRevision(current, revision)).toBe(true); expect(matchesAiSettingsRevision(current, crypto.randomUUID())).toBe(false); expect(matchesAiSettingsRevision(current, "invalid")).toBe(false);
  });
});
