import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3103";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "chatgpt-subscription.spec.ts", fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1, reporter: process.env.CI ? "github" : "list",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "next dev --hostname 127.0.0.1 --port 3103",
    env: { NOVEL_AI_SETTINGS_PATH: join(tmpdir(), `novel-ai-e2e-${process.pid}`, "settings.json"), AI_PROVIDER: "chatgpt", AI_COMPARE_PROVIDERS: "", APP_ORIGIN: baseURL, CHATGPT_MODEL: "gpt-6.1-sol", CHATGPT_AUTH_DIR: "/tmp/novel-editor-unused-e2e-auth" },
    url: baseURL, reuseExistingServer: false, timeout: 120_000,
  },
});
