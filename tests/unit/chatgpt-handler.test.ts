import { describe, expect, it, vi } from "vitest";
import { readAiServerConfig } from "../../src/server/ai/config";
import { handleChatGptConnection } from "../../src/server/http/chatgpt-handler";
import { chatGptAuthStub } from "../fixtures/chatgpt";

const origin = "http://127.0.0.1:3000";
const config = readAiServerConfig({ AI_PROVIDER: "chatgpt", APP_ORIGIN: origin, CHATGPT_MODEL: "gpt-6.1-sol", CHATGPT_AUTH_DIR: "/tmp/novel-editor-test" });
function request(action?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/ai/chatgpt`, { method: action === undefined ? "GET" : "POST",
    headers: { host: "127.0.0.1:3000", origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    ...(action === undefined ? {} : { body: JSON.stringify({ action }) }) });
}
describe("ChatGPT connection HTTP boundary", () => {
  it("returns only safe status metadata with no-store", async () => {
    const response = await handleChatGptConnection(request(), config, chatGptAuthStub());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toMatch(/test-access-token|test-refresh-token|test-id-token/u);
  });
  it.each([["origin", "https://evil.example"], ["host", "evil.example"], ["sec-fetch-site", "cross-site"]])("rejects cross-origin calls before auth actions", async (header, value) => {
    const signIn = vi.fn();
    const response = await handleChatGptConnection(request("sign-in", { [header]: value }), config, { ...chatGptAuthStub(), signIn });
    expect(response.status).toBe(403);
    expect(signIn).not.toHaveBeenCalled();
  });
  it("requires Origin for connection mutation and rejects unknown actions", async () => {
    const signIn = vi.fn();
    const missing = request("sign-in"); missing.headers.delete("origin");
    expect((await handleChatGptConnection(missing, config, { ...chatGptAuthStub(), signIn })).status).toBe(403);
    expect((await handleChatGptConnection(request("unknown"), config, chatGptAuthStub())).status).toBe(400);
    expect(signIn).not.toHaveBeenCalled();
  });
  it("dispatches explicit sign-in, acknowledgement, and disconnect actions", async () => {
    const auth = chatGptAuthStub();
    const signIn = vi.fn(auth.signIn), disconnect = vi.fn(auth.disconnect), acknowledgeWelcome = vi.fn(auth.acknowledgeWelcome);
    for (const action of ["sign-in", "acknowledge", "disconnect"]) {
      expect((await handleChatGptConnection(request(action), config, { ...auth, signIn, disconnect, acknowledgeWelcome })).status).toBe(200);
    }
    expect(signIn).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce(); expect(acknowledgeWelcome).toHaveBeenCalledOnce();
  });
  it("does not expose a raw authentication error", async () => {
    const response = await handleChatGptConnection(request("sign-in"), config, { ...chatGptAuthStub(), async signIn() { throw new Error("private-token"); } });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-token");
  });
});
