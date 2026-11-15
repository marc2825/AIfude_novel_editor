import { mkdtemp, readFile, rm, stat, writeFile, chmod, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createChatGptStore } from "../../src/server/ai/chatgpt/store";
import { createChatGptAuthService, verifyChatGptIdentity, type ChatGptAuthService, type StartChatGptCallback } from "../../src/server/ai/chatgpt/auth";
import { chatGptRecord, CHATGPT_CONNECTION_ID } from "../fixtures/chatgpt";
import { createDeferred } from "../helpers/deferred";

let directory: string;
const services: ChatGptAuthService[] = [];
beforeEach(async () => { directory = await mkdtemp("/tmp/novel-editor-chatgpt-test-"); });
afterEach(async () => {
  for (const service of services.splice(0)) await service.disconnect();
  await rm(directory, { recursive: true, force: true });
});

function harness(options: Readonly<{ verify?: (token: string, clientId: string, nonce: string) => Promise<{ email: string | null; subject: string }>; fetch?: typeof fetch }> = {}) {
  const callbacks: Array<(url: URL) => Promise<boolean>> = [];
  const close = vi.fn();
  const startCallback: StartChatGptCallback = async (callback) => {
    callbacks.push(callback);
    return { redirectUri: "http://127.0.0.1:1455/auth/callback", close };
  };
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes("openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" });
    if (String(url).endsWith("/revoke")) return new Response(null, { status: 200 });
    return Response.json({
      token_type: "Bearer", access_token: "new-access", refresh_token: "new-refresh", id_token: "signed-id-token",
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", expires_in: 3600,
    });
  });
  const store = createChatGptStore(directory);
  const verify = vi.fn(options.verify ?? (async () => ({ email: "writer@example.test", subject: "subject-test" })));
  const service = createChatGptAuthService({ store, fetch: options.fetch ?? transport, verifyIdentity: verify, startCallback });
  services.push(service);
  async function finish(authorizationUrl: string, additions: Record<string, string> = {}) {
    const authorization = new URL(authorizationUrl);
    const callback = callbacks.at(-1);
    if (!callback) throw new Error("Missing callback");
    const url = new URL(authorization.searchParams.get("redirect_uri") ?? "");
    url.search = new URLSearchParams({ code: "one-time-code", state: authorization.searchParams.get("state") ?? "", client_id: "oaiapp_test", ...additions }).toString();
    return callback(url);
  }
  return { store, service, transport, verify, close, finish };
}

describe("ChatGPT OAuth lifecycle and protected storage", () => {
  it("creates a stable host, verifies identity and scopes, and saves owner-only credentials without exposing tokens", async () => {
    const h = harness();
    const authorizationUrl = await h.service.signIn();
    const parameters = new URL(authorizationUrl).searchParams;
    expect(parameters.get("client_id")).toBe("dynamic_agent_client");
    expect(parameters.get("agent_name_hint")).toBe("AIFUDE");
    expect(parameters.get("resource")).toBe("https://api.openai.com/v1");
    expect(parameters.get("code_challenge_method")).toBe("S256");
    expect(await h.finish(authorizationUrl)).toBe(true);
    const exchange = h.transport.mock.calls[0]?.[1]?.body;
    if (!(exchange instanceof URLSearchParams)) throw new Error("Expected form body");
    expect(exchange.get("client_id")).toBe("oaiapp_test");
    expect(exchange.get("redirect_uri")).toBe(parameters.get("redirect_uri"));
    expect(createHash("sha256").update(exchange.get("code_verifier") ?? "").digest("base64url")).toBe(parameters.get("code_challenge"));
    expect(h.verify).toHaveBeenCalledWith("signed-id-token", "oaiapp_test", parameters.get("nonce"));
    const record = await h.store.read();
    expect(record?.session?.accessToken).toBe("new-access");
    expect((await stat(join(directory, "connection.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(await h.service.status())).not.toMatch(/new-access|new-refresh|signed-id-token/u);
    expect((await h.service.status()).welcomePending).toBe(true);
    await h.service.acknowledgeWelcome();
    expect((await h.service.status()).welcomePending).toBe(false);
    const returning = new URL(await h.service.signIn());
    expect(returning.searchParams.get("client_id")).toBe("oaiapp_test");
    expect(returning.searchParams.get("ext_agent_host_id")).toBe(parameters.get("ext_agent_host_id"));
    expect(returning.searchParams.has("id_token_hint")).toBe(false);
  });

  it("does not exchange an invalid state or replay a used callback", async () => {
    const h = harness();
    const url = await h.service.signIn();
    expect(await h.finish(url, { state: "wrong-state" })).toBe(false);
    expect(h.transport).not.toHaveBeenCalled();
    expect(await h.finish(url)).toBe(true);
    expect(await h.finish(url)).toBe(false);
    expect(h.transport).toHaveBeenCalledOnce();
  });

  it.each(["access_denied", "invalid_scope"])("treats OAuth %s as a failure without exchanging a code", async (error) => {
    const h = harness();
    expect(await h.finish(await h.service.signIn(), { error })).toBe(false);
    expect(h.transport).not.toHaveBeenCalled();
    expect((await h.service.status()).signInFailed).toBe(true);
  });

  it("rejects missing plan scope and bad identity without replacing the saved connection", async () => {
    const h = harness({ verify: async () => { throw new Error("Untrusted JWT"); } });
    expect(await h.finish(await h.service.signIn())).toBe(false);
    expect((await h.store.read())?.session).toBeNull();
    const noScope = harness({ fetch: async () => Response.json({ token_type: "Bearer", access_token: "access", refresh_token: "refresh", id_token: "id", scope: "openid", expires_in: 3600 }) });
    expect(await noScope.finish(await noScope.service.signIn())).toBe(false);
    expect((await noScope.store.read())?.session).toBeNull();
  });

  it("rejects a changed returning client or verified subject", async () => {
    const h = harness({ verify: async () => ({ email: "other@example.test", subject: "other-subject" }) });
    await h.store.update(async () => ({ record: chatGptRecord(), value: undefined }));
    const url = await h.service.signIn();
    expect(await h.finish(url, { client_id: "oaiapp_other" })).toBe(false);
    expect(h.transport).not.toHaveBeenCalled();
    expect(await h.finish(await h.service.signIn())).toBe(false);
    expect((await h.store.read())?.session?.connectionId).toBe(CHATGPT_CONNECTION_ID);
  });

  it("serializes rotating refresh tokens across separate store instances", async () => {
    const h = harness();
    await h.store.update(async () => ({ record: chatGptRecord(Date.now() - 1), value: undefined }));
    const second = createChatGptAuthService({ store: createChatGptStore(directory), fetch: h.transport });
    const tokens = await Promise.all([h.service.access(CHATGPT_CONNECTION_ID, new AbortController().signal), second.access(CHATGPT_CONNECTION_ID, new AbortController().signal)]);
    expect(tokens).toEqual(["new-access", "new-access"]);
    expect(h.transport).toHaveBeenCalledOnce();
    const body = h.transport.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(String(body)).toContain("grant_type=refresh_token");
    expect((await h.store.read())?.session?.refreshToken).toBe("new-refresh");
  });

  it("discards a delayed sign-in completion after disconnect", async () => {
    const verification = createDeferred<{ email: string | null; subject: string }>();
    const h = harness({ verify: () => verification.promise });
    const completion = h.finish(await h.service.signIn());
    await vi.waitFor(() => expect(h.verify).toHaveBeenCalledOnce());
    await h.service.disconnect();
    verification.resolve({ email: "writer@example.test", subject: "subject-test" });
    expect(await completion).toBe(false);
    expect((await h.service.status()).connected).toBe(false);
  });

  it("clears local tokens even when remote revocation cannot be confirmed", async () => {
    const h = harness({ fetch: async () => { throw new Error("network detail"); } });
    await h.store.update(async () => ({ record: chatGptRecord(), value: undefined }));
    expect(await h.service.disconnect()).toBe(false);
    const record = await h.store.read();
    expect(record?.session).toBeNull();
    expect(record?.registration?.clientId).toBe("oaiapp_test");
    await expect(h.service.access(CHATGPT_CONNECTION_ID, new AbortController().signal)).rejects.toThrow();
    expect(await readFile(join(directory, "connection.json"), "utf8")).not.toMatch(/test-access-token|test-refresh-token|test-id-token/u);
  });

  it("fails closed on corrupted, world-readable, or symlinked credentials", async () => {
    const store = createChatGptStore(directory);
    expect(await store.read()).toBeNull();
    const filename = join(directory, "connection.json");
    await writeFile(filename, "invalid-json", { mode: 0o600 });
    await expect(store.update(async () => ({ record: chatGptRecord(), value: undefined }))).rejects.toThrow();
    expect(await readFile(filename, "utf8")).toBe("invalid-json");
    await writeFile(filename, JSON.stringify(chatGptRecord()));
    await chmod(filename, 0o644);
    await expect(store.read()).rejects.toThrow();
    await rm(filename);
    const target = join(directory, "target.json");
    await writeFile(target, JSON.stringify(chatGptRecord()), { mode: 0o600 });
    await symlink(target, filename);
    await expect(store.read()).rejects.toThrow();
  });
});

describe("OpenAI ID token verification", () => {
  it("checks signature, issuer, audience, nonce, expiry and required subject", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key", alg: "RS256" }] });
    async function jwt(overrides: Record<string, unknown> = {}) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ nonce: "expected-nonce", email: "writer@example.test", iss: "https://auth.openai.com",
        aud: "oaiapp_test", sub: "test-subject", iat: now, exp: now + 120, ...overrides })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey);
    }
    await expect(verifyChatGptIdentity(await jwt(), "oaiapp_test", "expected-nonce", keys)).resolves.toEqual({ email: "writer@example.test", subject: "test-subject" });
    await expect(verifyChatGptIdentity(await jwt(), "wrong-audience", "expected-nonce", keys)).rejects.toThrow();
    await expect(verifyChatGptIdentity(await jwt(), "oaiapp_test", "wrong-nonce", keys)).rejects.toThrow();
    for (const claims of [{ iss: "https://other.example" }, { sub: undefined }, { iat: Math.floor(Date.now() / 1000) + 60 }, { azp: "other-client" }]) {
      await expect(verifyChatGptIdentity(await jwt(claims), "oaiapp_test", "expected-nonce", keys)).rejects.toThrow();
    }
    const wrong = await generateKeyPair("RS256");
    const wrongKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(wrong.publicKey), kid: "test-key" }] });
    await expect(verifyChatGptIdentity(await jwt(), "oaiapp_test", "expected-nonce", wrongKeys)).rejects.toThrow();
    const expired = await new SignJWT({ nonce: "expected-nonce" }).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://auth.openai.com").setAudience("oaiapp_test").setSubject("subject").setIssuedAt().setExpirationTime(1).sign(privateKey);
    await expect(verifyChatGptIdentity(expired, "oaiapp_test", "expected-nonce", keys)).rejects.toThrow();
  });
});
