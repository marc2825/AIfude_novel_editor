import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";

const origin = "http://127.0.0.1:3108";
const fixtureDirectory = await mkdtemp(join(tmpdir(), "novel-sync-e2e-"));
const vite = await createViteServer({ configFile: false, root: resolve("tests/sync-fixture"), plugins: [react()],
  resolve: { alias: { "server-only": resolve("tests/stubs/server-only.ts") } },
  server: { middlewareMode: true, fs: { allow: [process.cwd()] } } });
const { SqliteSyncService, SyncServiceError } = await vite.ssrLoadModule(resolve("src/server/sync/sqlite-service.ts"));
const service = new SqliteSyncService(join(fixtureDirectory, "sync.sqlite"));
let dropResponse = false;
async function json(request, maximum) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > maximum) throw new Error("limit"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function reply(response, status, value) { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); }
const server = createServer((request, response) => {
  void (async () => {
    if (request.headers.host !== "127.0.0.1:3108") { reply(response, 403, { error: "origin" }); return; }
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/__test/session" && request.method === "POST") {
      const value = await json(request, 100); if (!["owner", "other", "expired"].includes(value.account)) throw new Error("invalid");
      response.setHeader("Set-Cookie", `novel_sync_fixture=${value.account}; Path=/; HttpOnly; SameSite=Strict`); reply(response, 200, { ok: true }); return;
    }
    if (url.pathname === "/__test/drop-response" && request.method === "POST") { dropResponse = true; reply(response, 200, { ok: true }); return; }
    if (url.pathname === "/api/sync") {
      if ((request.headers.origin && request.headers.origin !== origin) || (request.method === "POST" && request.headers.origin !== origin) || request.headers["x-novel-sync"] !== "1" || request.headers["content-type"] !== "application/json") { reply(response, 403, { error: "origin" }); return; }
      const session = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("novel_sync_fixture="))?.split("=")[1];
      const principal = session === "owner" ? { accountId: "90000000-0000-4000-8000-000000000001" } : session === "other" ? { accountId: "90000000-0000-4000-8000-000000000002" } : null;
      try {
        if (request.method === "GET") { reply(response, 200, service.read(principal, url.searchParams.get("project") ?? "")); return; }
        if (request.method !== "POST") { reply(response, 405, { error: "method" }); return; }
        const result = service.exchange(principal, await json(request, 10 * 1024 * 1024));
        // The commit succeeds but no acknowledgement arrives. 503 avoids Chromium's
        // transparent retry of a connection reset masking this scenario.
        if (dropResponse) { dropResponse = false; reply(response, 503, { error: "lost-ack-fixture" }); return; }
        reply(response, 200, result); return;
      } catch (error) { const code = error instanceof SyncServiceError ? error.code : "invalid"; reply(response, code === "auth" ? 401 : code === "missing" ? 404 : code === "limit" ? 413 : 400, { error: code }); return; }
    }
    vite.middlewares(request, response);
  })().catch(() => { if (!response.headersSent) reply(response, 400, { error: "invalid" }); else response.destroy(); });
});
await new Promise((resolve) => server.listen(3108, "127.0.0.1", resolve));
async function close() { server.closeAllConnections(); server.close(); await vite.close(); service.close(); await rm(fixtureDirectory, { recursive: true, force: true }); process.exit(0); }
process.on("SIGTERM", () => void close()); process.on("SIGINT", () => void close());
