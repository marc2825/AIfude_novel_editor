// @vitest-environment node
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_URL, LAUNCHER_LOCK, launchEditor, startProcess } from "../../scripts/launch";

let root: string;
const tasks: { controller: AbortController; task: Promise<void> }[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "novel launcher space "));
  const directory = join(root, "node_modules/next/dist/bin"); await mkdir(directory, { recursive: true });
  await copyFile(resolve("tests/fixtures/launcher-next.mjs"), join(directory, "next"));
  await writeFile(join(root, "node_modules/next/package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(root, ".node-version"), process.versions.node);
  await mkdir(join(root, "scripts")); await mkdir(join(root, "public"));
  await copyFile(resolve("scripts/build-offline.mjs"), join(root, "scripts/build-offline.mjs"));
});
afterEach(async () => {
  for (const value of tasks) value.controller.abort();
  await Promise.allSettled(tasks.map((value) => value.task)); tasks.length = 0;
  await rm(root, { recursive: true, force: true });
});
function launch(openBrowser = false) {
  const controller = new AbortController(); const log = vi.fn<(message: string) => void>();
  const task = launchEditor({ root, signal: controller.signal, openBrowser, log }); void task.catch(() => undefined);
  tasks.push({ controller, task }); return { controller, task, log };
}
describe("local launcher process lifecycle", () => {
  it("builds, waits for readiness, reuses only its own server, and removes the lock on stop", async () => {
    const first = launch(); await vi.waitFor(() => expect(first.log).toHaveBeenCalledWith(expect.stringContaining("起動しました")), { timeout: 5_000 });
    expect(JSON.parse(await readFile(join(root, "started.json"), "utf8"))).toEqual({ args: ["--hostname", "127.0.0.1", "--port", "3000"], origin: EDITOR_URL, mode: "production" });
    const duplicate = launch(); await duplicate.task; expect(duplicate.log).toHaveBeenCalledWith(expect.stringContaining("起動済み"));
    expect(await readFile(join(root, "calls.txt"), "utf8")).toBe("build\nstart\n");
    expect(await readFile(join(root, "public/sw-assets.js"), "utf8")).toContain("/_next/static/chunks/offline-fixture.js");
    first.controller.abort(); await first.task; await expect(access(join(root, LAUNCHER_LOCK))).rejects.toThrow();
  });
  it("keeps the server running when the browser cannot be opened", async () => {
    vi.stubEnv("PATH", root); const running = launch(true);
    try {
      await vi.waitFor(() => expect(running.log).toHaveBeenCalledWith(expect.stringContaining("ブラウザーを自動表示できません")), { timeout: 5_000 });
      expect((await fetch(`${EDITOR_URL}/api/health`)).ok).toBe(true);
    } finally { vi.unstubAllEnvs(); running.controller.abort(); await running.task; }
  });
  it.each(["build-fails", "offline-fails", "start-fails"])("cleans up after %s without reporting readiness", async (marker) => {
    await writeFile(join(root, marker), ""); const running = launch();
    await expect(running.task).rejects.toThrow(); expect(running.log).not.toHaveBeenCalledWith(expect.stringContaining("起動しました"));
    await expect(access(join(root, LAUNCHER_LOCK))).rejects.toThrow();
  });
  it("rejects a busy port without building or stopping that server", async () => {
    const server = createServer(); await new Promise<void>((resolve) => server.listen(3_000, "127.0.0.1", resolve));
    try {
      await expect(launch().task).rejects.toThrow("ポート3000"); expect(server.listening).toBe(true);
      await expect(access(join(root, "calls.txt"))).rejects.toThrow(); await expect(access(join(root, LAUNCHER_LOCK))).rejects.toThrow();
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it.each(["not-json", JSON.stringify({ version: 99, id: crypto.randomUUID() }), JSON.stringify({ version: 1, id: crypto.randomUUID() })])("never overwrites an invalid or stale lock: %s", async (contents) => {
    await writeFile(join(root, LAUNCHER_LOCK), contents);
    await expect(launch().task).rejects.toThrow("lock"); expect(await readFile(join(root, LAUNCHER_LOCK), "utf8")).toBe(contents);
  });
  it("stops and releases the lock when cancelled during build", async () => {
    await writeFile(join(root, "hang-build"), ""); const running = launch();
    await vi.waitFor(async () => expect(await readFile(join(root, "calls.txt"), "utf8")).toBe("build\n"));
    running.controller.abort(); await expect(running.task).rejects.toThrow(); await expect(access(join(root, LAUNCHER_LOCK))).rejects.toThrow();
  });
  it("forces termination when a child ignores SIGTERM", async () => {
    const controller = new AbortController();
    const child = startProcess(process.execPath, ["-e", "const fs = require('node:fs'); process.on('SIGTERM', () => fs.writeFileSync('signal', 'ignored')); fs.writeFileSync('ready', 'yes'); setInterval(() => {}, 1000);"], { cwd: root, env: process.env, signal: controller.signal, quiet: true });
    try {
      await vi.waitFor(() => access(join(root, "ready"))); controller.abort();
      await vi.waitFor(() => access(join(root, "signal"))); expect(await child.done).toBe(1);
    } finally { child.stop(); await child.done; }
  }, 10_000);
  it("runs the shell entrypoint from another directory, including a project path with spaces", async () => {
    await copyFile(resolve("scripts/launch.ts"), join(root, "scripts/launch.ts"));
    await copyFile(resolve("start-editor.sh"), join(root, "start-editor.sh"));
    const result = await promisify(execFile)("sh", [join(root, "start-editor.sh"), "--help"], { cwd: tmpdir() });
    expect(result.stdout).toContain("pnpm launch [--no-open]");
  });
});
