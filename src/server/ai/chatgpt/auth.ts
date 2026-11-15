import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

import type { ChatGptConnectionStatus } from "../../../domain/chatgpt-connection";
import { readBoundedJson, type ChatGptFetch } from "./http";
import type { ChatGptStore } from "./store";

const issuer = "https://auth.openai.com";
const authorizationEndpoint = `${issuer}/api/accounts/authorize`;
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const grantedScopes = ["chatgpt.tokens.use.direct", "resource.invoke"];
const tokenSchema = z.object({
  access_token: z.string().min(1).max(32_768),
  expires_in: z.number().int().positive().max(31_536_000),
  id_token: z.string().min(1).max(32_768).optional(),
  refresh_token: z.string().min(1).max(32_768).optional(),
  scope: z.string().max(4096).optional(),
  token_type: z.literal("Bearer"),
});
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export class ChatGptAuthError extends Error {
  constructor() { super("ChatGPT connection unavailable"); }
}

type VerifiedIdentity = Readonly<{ email: string | null; subject: string }>;
export type VerifyChatGptIdentity = (idToken: string, clientId: string, nonce: string) => Promise<VerifiedIdentity>;
export type ChatGptCallbackListener = Readonly<{ redirectUri: string; close: () => void }>;
export type StartChatGptCallback = (callback: (url: URL) => Promise<boolean>) => Promise<ChatGptCallbackListener>;

async function verifyIdentity(idToken: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = jwks): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(idToken, keys, {
    algorithms: ["RS256"], audience: clientId, issuer,
    requiredClaims: ["sub", "exp", "iat", "nonce"], clockTolerance: 5,
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub ||
    typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5) throw new ChatGptAuthError();
  if ((payload.azp !== undefined && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new ChatGptAuthError();
  return { email: typeof payload.email === "string" ? payload.email : null, subject: payload.sub };
}

// A dedicated loopback listener keeps authorization codes out of Next request logs.
export const startChatGptCallback: StartChatGptCallback = async (callback) => {
  const server = createServer((request, response) => {
    const address = server.address();
    if (address === null || typeof address === "string") { response.writeHead(400).end(); return; }
    const origin = `http://127.0.0.1:${address.port}`;
    if ((request.url?.length ?? 0) > 8192) { response.writeHead(400).end(); return; }
    let url: URL;
    try { url = new URL(request.url ?? "/", origin); }
    catch { response.writeHead(400).end(); return; }
    if (request.method !== "GET" || request.headers.host !== `127.0.0.1:${address.port}` || url.origin !== origin || url.pathname !== "/auth/callback") {
      response.writeHead(400).end(); return;
    }
    void callback(url).then((success) => {
      response.writeHead(success ? 200 : 400, {
        "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      }).end(success
        ? "<!doctype html><html lang=ja><meta charset=utf-8><title>ChatGPT接続</title><p>ChatGPTへの接続が完了しました。このタブを閉じてエディタへ戻ってください。</p></html>"
        : "<!doctype html><html lang=ja><meta charset=utf-8><title>ChatGPT接続</title><p>接続を完了できませんでした。エディタへ戻り、もう一度接続してください。</p></html>");
    }).catch(() => { response.writeHead(400).end(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  const address = server.address();
  if (address === null || typeof address === "string") { server.close(); throw new ChatGptAuthError(); }
  return { redirectUri: `http://127.0.0.1:${address.port}/auth/callback`, close: () => { server.close(); } };
};

export type ChatGptAuthService = Readonly<{
  status: () => Promise<ChatGptConnectionStatus>;
  signIn: () => Promise<string>;
  disconnect: () => Promise<boolean>;
  acknowledgeWelcome: () => Promise<void>;
  access: (connectionId: string, signal: AbortSignal) => Promise<string>;
  isCurrent: (connectionId: string) => Promise<boolean>;
}>;

export function createChatGptAuthService(dependencies: Readonly<{
  store: ChatGptStore;
  fetch?: ChatGptFetch;
  verifyIdentity?: VerifyChatGptIdentity;
  startCallback?: StartChatGptCallback;
}>): ChatGptAuthService {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const verify = dependencies.verifyIdentity ?? verifyIdentity;
  const listen = dependencies.startCallback ?? startChatGptCallback;
  let generation = 0;
  let closePending: (() => void) | null = null;
  let signInFailed = false;

  async function tokenRequest(body: URLSearchParams, signal: AbortSignal) {
    const response = await fetch(tokenEndpoint, {
      method: "POST", body, signal, redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!response.ok) { await response.body?.cancel(); throw new ChatGptAuthError(); }
    return tokenSchema.parse(await readBoundedJson(response));
  }

  return {
    async status() {
      const record = await dependencies.store.read();
      const session = record?.session;
      const connected = session !== undefined && session !== null && grantedScopes.every((scope) => session.scopes.includes(scope));
      return {
        connected, connectionId: connected ? session.connectionId : null,
        email: connected ? record?.registration?.email ?? null : null, welcomePending: connected && session.welcomePending, signInFailed,
      };
    },
    async signIn() {
      const ownGeneration = ++generation;
      signInFailed = false;
      closePending?.();
      const record = await dependencies.store.update(async (current) => ({ record: current, value: current }));
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const expiresAt = Date.now() + 300_000;
      let consumed = false;
      const listener = await listen(async (url) => {
        if (consumed || ownGeneration !== generation || Date.now() >= expiresAt || url.searchParams.get("state") !== state || url.pathname !== "/auth/callback") return false;
        consumed = true;
        try {
          const code = url.searchParams.get("code");
          const clientId = url.searchParams.get("client_id") ?? record.registration?.clientId;
          if (url.searchParams.has("error") || !code || code.length > 4096 || !clientId || clientId === "dynamic_agent_client" || clientId.length > 256 ||
            (record.registration !== null && clientId !== record.registration.clientId)) throw new ChatGptAuthError();
          const result = await tokenRequest(new URLSearchParams({
            client_id: clientId, code, code_verifier: verifier, grant_type: "authorization_code",
            redirect_uri: listener.redirectUri, resource,
          }), AbortSignal.timeout(10_000));
          if (!result.id_token || !result.refresh_token) throw new ChatGptAuthError();
          const identity = await verify(result.id_token, clientId, nonce);
          if (record.registration !== null && identity.subject !== record.registration.subject) throw new ChatGptAuthError();
          const actualScopes = (result.scope ?? "").split(/\s+/u);
          if (!grantedScopes.every((scope) => actualScopes.includes(scope))) throw new ChatGptAuthError();
          const session = {
            accessToken: result.access_token, connectionId: randomUUID(), expiresAt: Date.now() + result.expires_in * 1000,
            idToken: result.id_token, refreshToken: result.refresh_token, scopes: actualScopes,
            welcomePending: record.registration === null,
          };
          await dependencies.store.update(async (current) => {
            if (ownGeneration !== generation || Date.now() >= expiresAt || current.hostId !== record.hostId || current.session?.connectionId !== record.session?.connectionId) throw new ChatGptAuthError();
            return { record: { ...current, registration: { clientId, ...identity }, session }, value: undefined };
          });
          return true;
        } catch {
          if (ownGeneration === generation) signInFailed = true;
          return false;
        } finally {
          clearTimeout(expiry);
          listener.close();
          if (ownGeneration === generation) closePending = null;
        }
      });
      if (ownGeneration !== generation) { listener.close(); throw new ChatGptAuthError(); }
      const expiry = setTimeout(() => { consumed = true; signInFailed = true; listener.close(); }, 300_000);
      expiry.unref?.();
      closePending = () => { consumed = true; clearTimeout(expiry); listener.close(); };
      const parameters = new URLSearchParams({
        client_id: record.registration?.clientId ?? "dynamic_agent_client", ext_agent_host_id: record.hostId,
        response_type: "code", redirect_uri: listener.redirectUri, scope: scopes, resource, state, nonce,
        code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      });
      if (record.registration === null) parameters.set("agent_name_hint", "AIFUDE");
      return `${authorizationEndpoint}?${parameters}`;
    },
    async access(connectionId, signal) {
      const result = await dependencies.store.update(async (record) => {
        const session = record.session;
        const registration = record.registration;
        if (!session || !registration || session.connectionId !== connectionId || !grantedScopes.every((scope) => session.scopes.includes(scope))) throw new ChatGptAuthError();
        if (session.expiresAt > Date.now() + 60_000) return { record, value: session.accessToken };
        const renewed = await tokenRequest(new URLSearchParams({
          client_id: registration.clientId, grant_type: "refresh_token", refresh_token: session.refreshToken, resource,
        }), signal);
        const nextScopes = renewed.scope?.split(/\s+/u) ?? session.scopes;
        if (!grantedScopes.every((scope) => nextScopes.includes(scope))) throw new ChatGptAuthError();
        // Retain the validated identity; no new sign-in identity is accepted during refresh.
        return { record: { ...record, session: {
          ...session, accessToken: renewed.access_token, expiresAt: Date.now() + renewed.expires_in * 1000,
          refreshToken: renewed.refresh_token ?? session.refreshToken, scopes: nextScopes,
        } }, value: renewed.access_token };
      }, signal);
      signal.throwIfAborted();
      return result;
    },
    async isCurrent(connectionId) { return (await dependencies.store.read())?.session?.connectionId === connectionId; },
    async acknowledgeWelcome() {
      await dependencies.store.update(async (record) => ({ record: {
        ...record, session: record.session === null ? null : { ...record.session, welcomePending: false },
      }, value: undefined }));
    },
    async disconnect() {
      ++generation;
      closePending?.(); closePending = null;
      const previous = await dependencies.store.update(async (record) => ({ record: { ...record, session: null }, value: record }));
      if (!previous.session || !previous.registration) return true;
      // Stop local access immediately. Retain the refresh token in memory only for revocation.
      try {
        const signal = AbortSignal.timeout(10_000);
        const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { signal, redirect: "error", cache: "no-store" });
        if (!discovery.ok) { await discovery.body?.cancel(); return false; }
        const metadata = z.object({ issuer: z.literal(issuer), revocation_endpoint: z.url() }).parse(await readBoundedJson(discovery));
        const endpoint = new URL(metadata.revocation_endpoint);
        if (endpoint.origin !== issuer || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) return false;
        const response = await fetch(endpoint, {
          method: "POST", signal, redirect: "error", cache: "no-store",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: previous.session.refreshToken, token_type_hint: "refresh_token", client_id: previous.registration.clientId }),
        });
        await response.body?.cancel();
        return response.status === 200;
      } catch { return false; }
    },
  };
}

export { verifyIdentity as verifyChatGptIdentity };
