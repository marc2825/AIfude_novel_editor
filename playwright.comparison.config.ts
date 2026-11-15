import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const baseURL = "http://127.0.0.1:3104";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "ai-comparison.spec.ts", fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1, reporter: process.env.CI ? "github" : "list",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "next dev --hostname 127.0.0.1 --port 3104",
    env: { NOVEL_AI_SETTINGS_PATH: join(tmpdir(), `novel-ai-e2e-${process.pid}`, "settings.json"), APP_ORIGIN: baseURL, AI_PROVIDER: "mock", AI_COMPARE_PROVIDERS: "mock,local,claude", AI_ENABLE_PAID_API: "false",
      CLAUDE_MODEL: "claude-sonnet-5", CLAUDE_AUTH_DIR: "/tmp/novel-editor-e2e-claude-unused-auth", CLAUDE_CLI_PATH: fileURLToPath(new URL("./tests/fixtures/claude-cli.mjs", import.meta.url)),
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:3180/v1", LOCAL_LLM_MODEL: "comparison-fixture-model", LOCAL_LLM_API_KEY: "" },
    url: baseURL, reuseExistingServer: false, timeout: 120_000,
  },
});
