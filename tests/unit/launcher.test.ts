// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCommand, EDITOR_URL, healthMatches, isSupportedNodeVersion, probeReady, waitForReady } from "../../scripts/launch";
import { GET } from "../../src/app/api/health/route";
import { createDeferred } from "../helpers/deferred";

afterEach(() => vi.unstubAllEnvs());
describe("supported Node versions", () => {
  it.each(["24.21.0", "24.21.1", "24.22.0"])("accepts %s", (version) => {
    expect(isSupportedNodeVersion(version, "24.21.0")).toBe(true);
  });
  it.each(["24.20.9", "24.21.0-rc.1", "25.0.0", "22.21.0", "invalid"])("rejects %s", (version) => {
    expect(isSupportedNodeVersion(version, "24.21.0")).toBe(false);
  });
});
describe("local launcher readiness", () => {
  it("confirms the app and this launch instance rather than trusting any HTTP success", async () => {
    const id = crypto.randomUUID();
    expect(healthMatches({ app: "novel-ai-editor", launchId: id }, id)).toBe(true);
    for (const value of [null, {}, { app: "other", launchId: id }, { app: "novel-ai-editor", launchId: crypto.randomUUID() }]) expect(healthMatches(value, id)).toBe(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ app: "novel-ai-editor", launchId: id })).mockResolvedValueOnce(new Response("x".repeat(1_025)));
    expect(await probeReady(EDITOR_URL, id, new AbortController().signal)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${EDITOR_URL}/api/health`, expect.objectContaining({ cache: "no-store", redirect: "error" }));
    expect(await probeReady(EDITOR_URL, id, new AbortController().signal)).toBe(false);
  });
  it("returns on cancellation even if fetch ignores abort and discards its late success", async () => {
    const pending = createDeferred<Response>(); const controller = new AbortController(); const id = crypto.randomUUID();
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    const ready = probeReady(EDITOR_URL, id, controller.signal); controller.abort(); expect(await ready).toBe(false);
    pending.resolve(Response.json({ app: "novel-ai-editor", launchId: id })); await Promise.resolve(); expect(await ready).toBe(false);
  });
  it("caps readiness waiting and refuses another launch ID", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ app: "novel-ai-editor", launchId: crypto.randomUUID() }));
    await expect(waitForReady(EDITOR_URL, crypto.randomUUID(), new AbortController().signal, 20)).rejects.toThrow("起動を確認できません");
  });
  it("opens the fixed URL through the host browser without a shell", () => {
    expect(browserCommand("linux", true)).toEqual(["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${EDITOR_URL}'`]]);
    expect(browserCommand("darwin", false)).toEqual(["open", [EDITOR_URL]]);
    expect(browserCommand("linux", false)).toEqual(["xdg-open", [EDITOR_URL]]);
  });
  it("exposes only a bounded public launch ID and no server configuration", async () => {
    const id = crypto.randomUUID(); vi.stubEnv("NOVEL_EDITOR_LAUNCH_ID", id); vi.stubEnv("OPENAI_API_KEY", "private-test-key");
    const response = GET(); expect(await response.json()).toEqual({ app: "novel-ai-editor", launchId: id }); expect(response.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("NOVEL_EDITOR_LAUNCH_ID", "private-test-key"); expect(await GET().json()).toEqual({ app: "novel-ai-editor", launchId: null });
  });
});
