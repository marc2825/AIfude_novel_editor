import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/sync", fullyParallel: false, workers: 1, retries: 0, forbidOnly: Boolean(process.env.CI),
  use: { baseURL: "http://127.0.0.1:3108", trace: "retain-on-failure" },
  webServer: { command: "node tests/sync-fixture/server.mjs", url: "http://127.0.0.1:3108", timeout: 60_000, reuseExistingServer: false } });
