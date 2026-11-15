import { describe, expect, it, vi, afterEach } from "vitest";
import { readAiServerConfig } from "../../src/server/ai/config";
import { diagnoseConnection } from "../../src/server/ai/connection-diagnostics";
import type { ChatGptAuthService } from "../../src/server/ai/chatgpt/auth";
import { createDeferred } from "../helpers/deferred";

const signal = () => new AbortController().signal;
const origin = { APP_ORIGIN: "http://127.0.0.1:3000" };
afterEach(() => vi.useRealTimers());
describe("diagnostics without manuscript or inference", () => {
  it("uses only the local models GET and checks an exact configured model", async () => {
    const config = readAiServerConfig({ ...origin, AI_PROVIDER: "local", LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434/v1", LOCAL_LLM_MODEL: "novel:tag", LOCAL_LLM_API_KEY: "private-test-token" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [{ id: "novel:tag" }] }));
    expect(await diagnoseConnection(config, signal(), false, { fetch })).toBe("ok");
    expect(fetch).toHaveBeenCalledOnce(); const [url, init] = fetch.mock.calls[0]; expect(url).toBe("http://127.0.0.1:11434/v1/models");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer private-test-token" } }); expect(init?.body).toBeUndefined();
  });
  it("reads the ChatGPT account catalog with server-only authentication and never invokes responses", async () => {
    const id = crypto.randomUUID(); const auth: ChatGptAuthService = { status: vi.fn().mockResolvedValue({ connected: true, connectionId: id, email: null, welcomePending: false }), access: vi.fn().mockResolvedValue("private-test-token"), isCurrent: vi.fn().mockResolvedValue(true), signIn: vi.fn(), disconnect: vi.fn(), acknowledgeWelcome: vi.fn() };
    const config = readAiServerConfig({ ...origin, AI_PROVIDER: "chatgpt", CHATGPT_MODEL: "configured-model" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ models: [{ slug: "configured-model", visibility: "list" }] }));
    expect(await diagnoseConnection(config, signal(), false, { fetch, getAuth: () => auth })).toBe("ok");
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/models"); expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it("refuses API diagnosis while either API permission is OFF without any network request", async () => {
    const env = { ...origin, AI_PROVIDER: "openai", OPENAI_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "fixture-key" };
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await diagnoseConnection(readAiServerConfig(env), signal(), true, { fetch })).toBe("api-disabled");
    expect(await diagnoseConnection(readAiServerConfig({ ...env, AI_ENABLE_PAID_API: "true" }), signal(), false, { fetch })).toBe("api-disabled"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["openai", "OPENAI", "gpt-5.6-luna", "https://api.openai.com/v1/models", { data: [{ id: "gpt-5.6-luna" }] }],
    ["anthropic", "ANTHROPIC", "claude-test", "https://api.anthropic.com/v1/models", { data: [{ id: "claude-test" }] }],
    ["gemini", "GEMINI", "gemini-test", "https://generativelanguage.googleapis.com/v1beta/models", { models: [{ name: "models/gemini-test" }] }],
    ["xai", "XAI", "grok-test", "https://api.x.ai/v1/models", { data: [{ id: "grok-test" }] }],
    ["deepseek", "DEEPSEEK", "deepseek-test", "https://api.deepseek.com/models", { data: [{ id: "deepseek-test" }] }],
  ] as const)("checks the %s API catalog using no prompt or URL credential", async (mode, prefix, model, url, result) => {
    const config = readAiServerConfig({ ...origin, AI_PROVIDER: mode, AI_ENABLE_PAID_API: "true", [`${prefix}_MODEL`]: model, [`${prefix}_API_KEY`]: "fixture-key" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(result));
    expect(await diagnoseConnection(config, signal(), true, { fetch })).toBe("ok");
    expect(fetch.mock.calls[0]?.[0]).toBe(url); expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined(); expect(url).not.toContain("fixture-key");
  });
  it("uses Claude auth status only and distinguishes subscription, billed and missing authentication", async () => {
    const config = readAiServerConfig({ ...origin, AI_PROVIDER: "claude", CLAUDE_MODEL: "claude-test" });
    const paid = readAiServerConfig({ ...origin, AI_PROVIDER: "claude", CLAUDE_MODEL: "claude-test", AI_ENABLE_PAID_API: "true" });
    const status = (authMethod: string) => vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ authMethod }) });
    const runCli = status("claude.ai");
    expect(await diagnoseConnection(config, signal(), false, { runCli })).toBe("auth-only");
    expect(runCli.mock.calls[0]?.[0]).toMatchObject({ args: ["auth", "status"], stdin: "" });
    expect(await diagnoseConnection(config, signal(), false, { runCli: status("api_key") })).toBe("billed-auth-disabled");
    expect(await diagnoseConnection(paid, signal(), false, { runCli: status("api_key") })).toBe("auth-only-billed");
    expect(await diagnoseConnection(paid, signal(), false, { runCli: status("none") })).toBe("auth-required");
  });
  it("reports incomplete model discovery and rejects oversized or malformed responses", async () => {
    const config = readAiServerConfig({ ...origin, AI_PROVIDER: "local", LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1", LOCAL_LLM_MODEL: "expected" });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: "other" }] })).mockResolvedValueOnce(new Response("x".repeat(262_145))).mockResolvedValueOnce(Response.json({ models: [] }));
    expect(await diagnoseConnection(config, signal(), false, { fetch })).toBe("model-not-listed");
    expect(await diagnoseConnection(config, signal(), false, { fetch })).toBe("unreachable"); expect(await diagnoseConnection(config, signal(), false, { fetch })).toBe("unreachable");
  });
  it("returns on deadline even when fetch ignores abort, and ignores its late result", async () => {
    vi.useFakeTimers(); const pending = createDeferred<Response>(); const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(pending.promise);
    const config = readAiServerConfig({ ...origin, AI_PROVIDER: "local", LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1", LOCAL_LLM_MODEL: "expected" });
    const result = diagnoseConnection(config, signal(), false, { fetch, deadlineMs: 100 });
    await vi.advanceTimersByTimeAsync(100); expect(await result).toBe("timeout"); expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    pending.resolve(Response.json({ data: [{ id: "expected" }] })); await Promise.resolve(); expect(fetch).toHaveBeenCalledOnce();
  });
});
