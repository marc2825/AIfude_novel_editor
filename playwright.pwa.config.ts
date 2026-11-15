import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
const baseURL = "http://127.0.0.1:3106";
export default defineConfig({
  testDir: "./tests/pwa", fullyParallel: false, workers: 1, retries: 0, forbidOnly: Boolean(process.env.CI),
  timeout: 60_000, use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", testIgnore: "**/crash.spec.ts", use: { browserName: "webkit", launchOptions: { executablePath: process.env.NOVEL_WEBKIT_EXECUTABLE } } },
  ],
  webServer: { command: "pnpm build && next start --hostname 127.0.0.1 --port 3106", url: baseURL, reuseExistingServer: false, timeout: 120_000,
    env: { APP_ORIGIN: baseURL, AI_PROVIDER: "mock", AI_ENABLE_PAID_API: "false", NOVEL_AI_SETTINGS_PATH: join(tmpdir(), `novel-pwa-e2e-${process.pid}`, "settings.json") } },
});
