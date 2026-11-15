import { expect, test } from "@playwright/test";
import { manuscriptEditor } from "./ai-edit-helpers";
import { feedbackRequestSchema } from "../../src/domain/feedback";

test("J-01/02/03: local diagnostic, ignore, confirmed correction, Undo/Redo and reload", async ({ page }) => {
  let aiRequests = 0; page.on("request", (request) => { if (request.url().includes("/api/ai/") && request.method() === "POST") aiRequests++; });
  await page.goto("/"); const editor = manuscriptEditor(page); const original = "前🙂 一番最初に会った。後ろはそのまま。";
  await editor.fill(original); await page.getByRole("button", { name: "日本語診断とFeedback", exact: true }).click();
  const panel = page.getByRole("region", { name: "日本語診断とFeedback", exact: true });
  await panel.getByRole("button", { name: "章を解析", exact: true }).click();
  await expect(panel.getByText("冗長表現の確認", { exact: true })).toBeVisible();
  await expect(editor.locator(".diagnostic-highlight")).toHaveText("一番最初");
  await panel.getByRole("button", { name: "この表現を無視" }).click();
  await expect(editor.locator(".diagnostic-highlight")).toHaveCount(0);
  await panel.getByRole("button", { name: /無視を解除/ }).click();
  await panel.getByRole("button", { name: "個別修正" }).click();
  await panel.getByRole("textbox", { name: "修正案" }).fill("最初");
  await expect(editor).toHaveText(original);
  await panel.getByRole("button", { name: "修正を採用" }).click();
  await expect(editor).toHaveText("前🙂 最初に会った。後ろはそのまま。");
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).click();
  await page.getByRole("button", { name: "元に戻す", exact: true }).click(); await expect(editor).toHaveText(original);
  await page.getByRole("button", { name: "やり直す", exact: true }).click(); await expect(editor).toContainText("最初に会った");
  await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: /^保存済み$/ })).toBeVisible();
  await page.reload(); await expect(manuscriptEditor(page)).toHaveText("前🙂 最初に会った。後ろはそのまま。");
  expect(aiRequests).toBe(0);
});

test("J-03: diagnostic prepares a new AI session, requiring Generate and Accept", async ({ page }) => {
  let edits = 0; page.on("request", (request) => { if (request.url().endsWith("/api/ai/edits") && request.method() === "POST") edits++; });
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("一番最初に会った。");
  await page.getByRole("button", { name: "日本語診断とFeedback", exact: true }).click();
  await page.getByRole("button", { name: "章を解析", exact: true }).click();
  await page.getByRole("button", { name: "AI推敲を準備" }).click();
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "編集の指示", exact: true })).toHaveValue(/冗長表現/);
  expect(edits).toBe(0); await expect(editor).toHaveText("一番最初に会った。");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeEnabled();
  await expect(editor).toHaveText("一番最初に会った。");
  await dialog.getByRole("button", { name: "採用", exact: true }).click();
  await expect(editor).toContainText("【デモ候補1】に会った。");
});

test("J-07: bounded chapter Feedback is explicit, read-only and stale on editing", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("一番最初に会った。静かな朝だった。");
  await page.getByRole("button", { name: "日本語診断とFeedback", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI Feedback", exact: true });
  await expect(panel.getByRole("button", { name: "AIコメントを生成" })).toBeDisabled();
  await panel.getByRole("button", { name: "章全体を対象にする" }).click();
  await panel.getByRole("button", { name: "AIコメントを生成" }).click();
  await expect(panel.getByRole("region", { name: "AIの主観的コメント" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("一番最初に会った。静かな朝だった。");
  await editor.fill("改稿した本文。");
  await expect(panel.getByRole("region", { name: "AIの主観的コメント" })).toHaveCount(0);
  await expect(panel.getByText(/対象を指定し直して/)).toBeVisible();
});

test("J-07/M-01: narrow drawer rejects a late Feedback response and keeps saving", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; });
  let received = false;
  await page.route("**/api/ai/feedback", async (route) => {
    const request = feedbackRequestSchema.parse(route.request().postDataJSON()); received = true; await held;
    await route.fulfill({ json: { schemaVersion: 1, requestId: request.requestId, provider: { providerId: "mock", model: "local-demo-model" },
      comments: [{ id: "10000000-0000-4000-8000-000000000001", quote: "朝", comment: "遅れて届いたコメント", cautions: [] }] } });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("朝だった。");
  await page.getByRole("button", { name: "日本語診断とFeedback", exact: true }).click();
  await page.getByRole("button", { name: "章全体を対象にする" }).click();
  await page.getByRole("button", { name: "AIコメントを生成" }).click();
  await expect.poll(() => received).toBe(true);
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).click();
  await editor.fill("新しい朝だった。"); release?.();
  await page.getByRole("button", { name: "日本語診断とFeedback", exact: true }).click();
  await expect(page.getByText("遅れて届いたコメント")).toHaveCount(0);
  await expect(page.getByText(/対象を指定し直して/)).toBeVisible();
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^保存済み$/ })).toBeVisible();
  await page.reload(); await expect(manuscriptEditor(page)).toHaveText("新しい朝だった。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
