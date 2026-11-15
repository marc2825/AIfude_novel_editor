import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, expect, test } from "@playwright/test";
import { manuscriptEditor, selectParagraphText } from "../e2e/ai-edit-helpers";
import { prepareOffline, saveText } from "./helpers";
import { networkOutageProxy } from "./network-outage";

test("production pages retain CSP without development eval permission", async ({ request }) => {
  for (const path of ["/", "/offline"]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const csp = response.headers()["content-security-policy"];
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  }
});

test("P-01–05: offline editing survives browser restart, caches are public only, recovery never sends AI", async ({ browserName, baseURL }) => {
  if (!baseURL) throw new Error("Missing URL");
  const proxy = await networkOutageProxy(baseURL); baseURL = proxy.origin;
  const directory = await mkdtemp(join(tmpdir(), "novel-offline-profile-"));
  const engine = browserName === "webkit" ? webkit : chromium;
  const executablePath = browserName === "webkit" ? process.env.NOVEL_WEBKIT_EXECUTABLE : undefined;
  let context = await engine.launchPersistentContext(directory, { executablePath, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = context.pages()[0]!; let aiRequests = 0;
    context.on("request", (r) => { if (/\/api\/ai\/(edits|comparisons|feedback)/u.test(r.url())) aiRequests++; });
    await prepareOffline(page, baseURL);
    await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
    await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
    await page.getByRole("button", { name: "オフライン画面の更新を確認" }).click();
    await expect(page.getByText("オフライン利用の準備ができました。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "サイドパネルを閉じる" }).click();
    await saveText(page, "秘密の原稿。雨が降った。😀");
    await context.setOffline(true);
    await expect(page.getByText(/^オフラインです。/u)).toBeVisible();
    proxy.setOffline(true); await context.setOffline(false);
    await page.reload(); await expect(page.getByText(/^オフライン用画面です。/u)).toBeVisible();
    await expect(manuscriptEditor(page)).toHaveText("秘密の原稿。雨が降った。😀");
    await saveText(page, "オフラインで書いた続き。😀");
    await selectParagraphText(page, "書いた"); await page.getByRole("button", { name: "AI提案", exact: true }).click();
    await expect(page.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
    expect(aiRequests).toBe(0);
    await context.close();
    context = await engine.launchPersistentContext(directory, { executablePath, viewport: { width: 390, height: 844 }, hasTouch: true });
    context.on("request", (r) => { if (/\/api\/ai\/(edits|comparisons|feedback)/u.test(r.url())) aiRequests++; });
    const restored = context.pages()[0]!; await restored.goto(baseURL);
    await expect(manuscriptEditor(restored)).toHaveText("オフラインで書いた続き。😀");
    await expect(manuscriptEditor(restored)).toBeEditable();
    await restored.setViewportSize({ width: 844, height: 390 });
    expect(await restored.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const contents = await restored.evaluate(async () => {
      const result: { path: string; text: string }[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) {
          const response = await cache.match(request); const type = response?.headers.get("content-type") ?? "";
          result.push({ path: new URL(request.url).pathname, text: /text|javascript|json/u.test(type) ? await response!.text() : "" });
        }
      }
      return result;
    });
    expect(contents.length).toBeGreaterThan(5);
    for (const entry of contents) {
      expect(entry.path).toMatch(/^\/(offline$|manifest\.webmanifest$|icons\/|_next\/static\/)/u);
      expect(entry.text).not.toContain("秘密の原稿"); expect(entry.text).not.toContain("オフラインで書いた続き");
    }
    proxy.setOffline(false);
    await expect(restored.getByText(/^オフライン用画面です。/u)).toBeVisible();
    expect(aiRequests).toBe(0);
    await restored.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
    await restored.getByRole("button", { name: "保存してオンライン画面へ戻る" }).click();
    await expect(restored).toHaveURL(`${baseURL}/`);
    await expect(manuscriptEditor(restored)).toHaveText("オフラインで書いた続き。😀"); expect(aiRequests).toBe(0);
  } finally { await context.close(); await proxy.close(); await rm(directory, { recursive: true, force: true }); }
});

test("P-03: disconnect invalidates visible AI candidates; reconnect does not retry", async ({ page, context, baseURL }) => {
  await page.goto(baseURL!); await saveText(page, "彼女は雨を見た。");
  await selectParagraphText(page, "雨を見た"); await page.getByRole("button", { name: "AI提案", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "自然に", exact: true }).click();
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeEnabled();
  let sends = 0; page.on("request", (r) => { if (r.url().endsWith("/api/ai/edits")) sends++; });
  await context.setOffline(true);
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await context.setOffline(false); await expect(manuscriptEditor(page)).toHaveText("彼女は雨を見た。"); expect(sends).toBe(0);
});
