import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, open, readFile, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const EDITOR_URL = "http://127.0.0.1:3000";
export const LAUNCHER_LOCK = ".novel-editor-launcher.lock";
const applicationRoot = fileURLToPath(new URL("../", import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export class LauncherError extends Error {}

export function isSupportedNodeVersion(version: string, minimum: string): boolean {
  if (!/^24\.\d+\.\d+$/u.test(version) || !/^24\.\d+\.\d+$/u.test(minimum)) return false;
  const [, minor, patch] = version.split(".").map(Number);
  const [, minimumMinor, minimumPatch] = minimum.split(".").map(Number);
  return minor > minimumMinor || (minor === minimumMinor && patch >= minimumPatch);
}

export function healthMatches(value: unknown, launchId: string): boolean {
  return typeof value === "object" && value !== null && "app" in value && value.app === "novel-ai-editor" && "launchId" in value && value.launchId === launchId;
}

export function browserCommand(platform: string, wsl: boolean): readonly [string, readonly string[]] {
  if (wsl) return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${EDITOR_URL}'`]];
  if (platform === "darwin") return ["open", [EDITOR_URL]];
  return ["xdg-open", [EDITOR_URL]];
}

export function startProcess(command: string, args: readonly string[], options: Readonly<{
  cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; quiet?: boolean;
}>) {
  options.signal.throwIfAborted();
  const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, shell: false,
    detached: process.platform !== "win32", stdio: options.quiet ? "ignore" : "inherit" });
  let finished = false; let forceStop: ReturnType<typeof setTimeout> | undefined;
  function kill(signal: NodeJS.Signals) {
    if (!child.pid || finished) return;
    try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); } catch { /* Already exited. */ }
  }
  function stop() {
    if (finished || forceStop) return;
    kill("SIGTERM"); forceStop = setTimeout(() => kill("SIGKILL"), 5_000);
  }
  const done = new Promise<number>((resolve, reject) => {
    function cleanup() { finished = true; clearTimeout(forceStop); options.signal.removeEventListener("abort", stop); }
    child.once("error", () => { cleanup(); reject(new LauncherError("起動コマンドを実行できませんでした。Node.jsと依存の導入を確認してください。")); });
    child.once("close", (code) => { cleanup(); resolve(code ?? 1); });
  });
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  return { done, stop };
}

async function runBounded(command: string, args: readonly string[], options: Parameters<typeof startProcess>[2], milliseconds: number): Promise<number> {
  const deadline = new AbortController();
  const child = startProcess(command, args, { ...options, signal: AbortSignal.any([deadline.signal, options.signal]) });
  const timer = setTimeout(() => deadline.abort(), milliseconds);
  try {
    const code = await child.done;
    if (deadline.signal.aborted) throw new LauncherError("起動処理が時間内に完了しませんでした。");
    options.signal.throwIfAborted(); return code;
  } finally { clearTimeout(timer); child.stop(); }
}

export async function probeReady(url: string, launchId: string, signal: AbortSignal): Promise<boolean> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(1_000)]);
  let remove = () => {};
  const cancelled = new Promise<boolean>((resolve) => {
    const abort = () => resolve(false); bounded.addEventListener("abort", abort, { once: true }); remove = () => bounded.removeEventListener("abort", abort); if (bounded.aborted) abort();
  });
  async function receive() {
    if (bounded.aborted) return false;
    const response = await fetch(`${url}/api/health`, { signal: bounded, redirect: "error", cache: "no-store" });
    if (bounded.aborted) { await response.body?.cancel(); return false; }
    if (!response.ok || !response.body) { await response.body?.cancel(); return false; }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 1_024) return false; chunks.push(chunk.value);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); return healthMatches(value, launchId);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  try { return await Promise.race([receive().catch(() => false), cancelled]); } finally { remove(); }
}

export async function waitForReady(url: string, launchId: string, signal: AbortSignal, milliseconds = 30_000): Promise<void> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]);
  try {
    while (!bounded.aborted) {
      if (await probeReady(url, launchId, bounded)) { bounded.throwIfAborted(); return; }
      await delay(200, undefined, { signal: bounded });
    }
  } catch { signal.throwIfAborted(); }
  throw new LauncherError("サーバーの起動を確認できませんでした。");
}

async function readOwner(filename: string): Promise<string | null> {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat(); if (!info.isFile() || info.size > 1_024) return null;
    const value: unknown = JSON.parse(await handle.readFile("utf8"));
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 || !("id" in value) || typeof value.id !== "string" || !uuid.test(value.id)) return null;
    return value.id;
  } catch { return null; } finally { await handle.close(); }
}

async function checkPort(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new LauncherError("ポート3000が使用中です。先に起動したサーバーを確認してください。別のポートへは自動変更しません。")));
    server.listen({ host: "127.0.0.1", port: 3_000, exclusive: true }, () => server.close((error) => error ? reject(error) : resolve()));
  });
}

export async function launchEditor(options: Readonly<{
  root: string; signal: AbortSignal; openBrowser: boolean; log: (message: string) => void;
}>): Promise<void> {
  if (process.platform === "win32") throw new LauncherError("Windowsではstart-editor.cmdからWSL内で起動してください。");
  const expected = (await readFile(join(options.root, ".node-version"), "utf8")).trim();
  if (!isSupportedNodeVersion(process.versions.node, expected)) throw new LauncherError(".node-version以上のNode.js 24系をPATHへ設定してから起動してください。");
  const next = join(options.root, "node_modules", "next", "dist", "bin", "next");
  try { await access(next); } catch { throw new LauncherError("依存が未導入です。最初にpnpm install --frozen-lockfileを実行してください。"); }
  const filename = join(options.root, LAUNCHER_LOCK); const id = randomUUID();
  async function showBrowser() {
    if (!options.openBrowser || options.signal.aborted) return;
    const [command, args] = browserCommand(process.platform, Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP));
    try {
      const code = await runBounded(command, args, { cwd: options.root, env: process.env, signal: options.signal, quiet: true }, 10_000);
      if (code !== 0) throw new LauncherError("Browser unavailable");
    } catch { if (!options.signal.aborted) options.log(`ブラウザーを自動表示できませんでした。手動で ${EDITOR_URL} を開いてください。`); }
  }
  let lock;
  try { lock = await open(filename, "wx", 0o600); }
  catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const owner = await readOwner(filename).catch(() => null);
    if (owner && await probeReady(EDITOR_URL, owner, options.signal)) { options.log(`起動済みのAIFUDEを開きます：${EDITOR_URL}`); await showBrowser(); return; }
    throw new LauncherError("起動処理中、またはランチャーのlockが残っています。しばらく待って再試行してください。異常終了の場合は全サーバー停止後に.novel-editor-launcher.lockだけを削除してください。");
  }
  const lifetime = new AbortController(); const signal = AbortSignal.any([lifetime.signal, options.signal]);
  let server: ReturnType<typeof startProcess> | null = null;
  try {
    await lock.writeFile(JSON.stringify({ version: 1, id }));
    signal.throwIfAborted(); await checkPort();
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", APP_ORIGIN: EDITOR_URL, NOVEL_EDITOR_LAUNCH_ID: id };
    options.log("AIFUDEをビルドしています。初回は時間がかかることがあります。");
    if (await runBounded(process.execPath, [next, "build"], { cwd: options.root, env, signal }, 300_000) !== 0) throw new LauncherError("ビルドに失敗しました。上のエラーを確認してください。ブラウザーは開いていません。");
    if (await runBounded(process.execPath, [join(options.root, "scripts", "build-offline.mjs")], { cwd: options.root, env, signal }, 30_000) !== 0) throw new LauncherError("オフライン画面の準備に失敗しました。ブラウザーは開いていません。");
    signal.throwIfAborted();
    server = startProcess(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", "3000"], { cwd: options.root, env, signal });
    await Promise.race([waitForReady(EDITOR_URL, id, signal), server.done.then(() => { throw new LauncherError("サーバーを起動できませんでした。"); })]);
    options.log(`起動しました：${EDITOR_URL}\n終了はこのウィンドウでCtrl+C。ブラウザーを閉じてもサーバーは動作します。`);
    await showBrowser();
    const code = await server.done;
    if (code !== 0 && !options.signal.aborted) throw new LauncherError("サーバーが終了しました。エラーを確認してから起動し直してください。");
  } finally {
    lifetime.abort(); server?.stop(); await server?.done.catch(() => undefined); await lock.close();
    if (await readOwner(filename).catch(() => null) === id) await unlink(filename);
  }
}

async function main() {
  if (process.argv.includes("--help")) { console.log("pnpm launch [--no-open]\nローカルサーバーをビルド・起動し、ブラウザーで開きます。--no-openで自動表示を省略できます。"); return; }
  if (process.argv.slice(2).some((argument) => argument !== "--no-open")) throw new LauncherError("使用方法：pnpm launch [--no-open]");
  const controller = new AbortController(); const stop = () => controller.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);
  try { await launchEditor({ root: applicationRoot, signal: controller.signal, openBrowser: !process.argv.includes("--no-open"), log: (message) => console.log(message) }); }
  catch (error: unknown) { if (!controller.signal.aborted) throw error; }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); process.off("SIGHUP", stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error instanceof LauncherError ? error.message : "起動できませんでした。Node.js・依存・フォルダーの権限を確認してください。"); process.exitCode = 1; });
}
