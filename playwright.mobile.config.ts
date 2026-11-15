import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3105";
export default defineConfig({
  testDir: "./tests/mobile",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  reporter: process.env.CI ? "github" : "list",
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } }],
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    // Production excludes development overlays that intercept touch targets.
    command: "pnpm build && next start --hostname 127.0.0.1 --port 3105",
    env: {
      NOVEL_AI_SETTINGS_PATH: join(tmpdir(), `novel-mobile-e2e-${process.pid}`, "settings.json"),
      APP_ORIGIN: baseURL, AI_PROVIDER: "mock", AI_COMPARE_PROVIDERS: "mock,local", AI_ENABLE_PAID_API: "false",
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:3185/v1", LOCAL_LLM_MODEL: "mobile-fixture", LOCAL_LLM_API_KEY: "",
    },
    url: baseURL, reuseExistingServer: false, timeout: 120_000,
  },
});
