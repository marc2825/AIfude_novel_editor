// CDP is Chromium-only. WebKit browser restart is covered by offline.spec.ts.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { manuscriptEditor } from "../e2e/ai-edit-helpers";
import { prepareOffline, saveText } from "./helpers";
test("P-02/05: committed offline edits survive Chromium browser process crash", async ({ baseURL }) => {
  const directory = await mkdtemp(join(tmpdir(), "novel-crash-profile-"));
  let context = await chromium.launchPersistentContext(directory);
  try {
    const page = context.pages()[0]!; await prepareOffline(page, baseURL!);
    await context.setOffline(true); await saveText(page, "クラッシュ前に保存した原稿。😀");
    const browser = context.browser(); if (!browser) throw new Error("Missing browser process");
    const cdp = await browser.newBrowserCDPSession();
    const info = await cdp.send("SystemInfo.getProcessInfo");
    const pid = info.processInfo.find((item) => item.type === "browser")?.id;
    if (!pid || !Number.isSafeInteger(pid)) throw new Error("Missing owned Chromium PID");
    const disconnected = new Promise<void>((resolve) => browser.once("disconnected", () => resolve()));
    process.kill(pid, "SIGKILL"); await disconnected;
    context = await chromium.launchPersistentContext(directory, { offline: true });
    const restored = context.pages()[0]!; await restored.goto(baseURL!);
    await expect(manuscriptEditor(restored)).toHaveText("クラッシュ前に保存した原稿。😀"); await expect(manuscriptEditor(restored)).toBeEditable();
  } finally { await context.close(); await rm(directory, { recursive: true, force: true }); }
});
