import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3102";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "local-provider.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "next dev --hostname 127.0.0.1 --port 3102",
    env: { NOVEL_AI_SETTINGS_PATH: join(tmpdir(), `novel-ai-e2e-${process.pid}`, "settings.json"),
      AI_PROVIDER: "local",
      AI_COMPARE_PROVIDERS: "",
      APP_ORIGIN: baseURL,
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:3179/v1",
      LOCAL_LLM_MODEL: "local-e2e-model",
      LOCAL_LLM_API_KEY: "",
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
