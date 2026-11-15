import { expect, test } from "@playwright/test";
import { dictionaryRequestSchema } from "../../src/domain/dictionary";
import { manuscriptEditor, selectParagraphText } from "./ai-edit-helpers";

async function openDictionary(page: import("@playwright/test").Page) {
  const toolSelect = page.getByRole("combobox", { name: "AIツール", exact: true });
  if (await toolSelect.isVisible()) await toolSelect.selectOption("dictionary");
  else await page.getByRole("radio", { name: "辞書（Dictionary）", exact: true }).check();
  await selectParagraphText(page, "余韻");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "語句を調べる", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}

test("right-click dictionary uses the real API with only the word and never offers text adoption", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("秘密の前文。余韻。秘密の後文。");
  let calls = 0;
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/ai/dictionary")) return;
    calls++;
    const value: unknown = request.postDataJSON();
    expect(dictionaryRequestSchema.parse(value).query).toBe("余韻");
    expect(JSON.stringify(value)).not.toContain("秘密");
    expect(value).not.toHaveProperty("storyMemory");
    expect(value).not.toHaveProperty("selectionText");
  });
  await page.getByRole("radio", { name: "辞書（Dictionary）", exact: true }).check();
  await selectParagraphText(page, "余韻");
  const point = await page.evaluate(() => {
    const box = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    if (!box) throw new Error("Missing selection");
    return { x: box.left + 4, y: box.top + box.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: /辞書で調べる/u }).click();
  const dialog = page.getByRole("dialog", { name: "語句を調べる" });
  await expect(dialog.getByRole("button", { name: "LLMで調べる" })).toBeFocused();
  expect(calls).toBe(0);
  await dialog.getByRole("button", { name: "LLMで調べる" }).click();
  await expect(dialog.getByRole("region", { name: "LLMによる語句の説明" })).toBeVisible();
  await expect(dialog.getByText("デモ応答です。実際の語義説明ではありません。")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("秘密の前文。余韻。秘密の後文。");
  await page.keyboard.press("Escape"); await expect(editor).toBeFocused();
  await page.keyboard.press("Control+s"); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("秘密の前文。余韻。秘密の後文。");
  expect(calls).toBe(1);
});

test("explicit search opens only the selected word in a new tab without a referrer or LLM call", async ({ page, context }) => {
  let searches = 0; let lookups = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/ai/dictionary")) lookups++; });
  await context.route("https://www.google.com/**", async (route) => {
    searches++;
    const url = new URL(route.request().url());
    expect(url.searchParams.get("q")).toBe("余韻 意味");
    expect(await route.request().headerValue("referer")).toBeNull();
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<title>検索確認</title>" });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("秘密。余韻。秘密。"); const dialog = await openDictionary(page);
  expect(searches).toBe(0); expect(lookups).toBe(0);
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Googleで意味を検索（別タブ）" }).click();
  const popup = await popupPromise; await popup.waitForLoadState();
  await expect(popup).toHaveTitle("検索確認");
  expect(searches).toBe(1); expect(lookups).toBe(0);
  await popup.close(); await expect(editor).toHaveText("秘密。余韻。秘密。");
});

test("dictionary failure permits explicit Retry or search and preserves manuscript editing", async ({ page }) => {
  await page.route("**/api/ai/dictionary", async (route) => {
    const request = dictionaryRequestSchema.parse(route.request().postDataJSON());
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { requestId: request.requestId, code: "AI_UNAVAILABLE", message: "raw provider text", retryable: false } }) });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("前。余韻。後。"); const dialog = await openDictionary(page);
  await dialog.getByRole("button", { name: "LLMで調べる" }).click();
  await expect(dialog.getByRole("alert")).toContainText("AI_UNAVAILABLE");
  await expect(dialog.getByRole("alert")).not.toContainText("raw provider text");
  await expect(dialog.getByRole("link", { name: "Googleで意味を検索（別タブ）" })).toBeVisible();
  await expect(editor).toHaveText("前。余韻。後。");
  await editor.fill("編集を続けられる");
  await expect(dialog.getByText(/この辞書照会は期限切れ/u)).toBeVisible();
  await page.keyboard.press("Control+s"); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
});

test("dictionary results expire on selection changes and mode switching closes the lookup", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("余韻と余白"); const dialog = await openDictionary(page);
  await dialog.getByRole("button", { name: "LLMで調べる" }).click();
  await expect(dialog.getByRole("region", { name: "LLMによる語句の説明" })).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 640 && bounds.y + bounds.height <= 720).toBe(true);
  await dialog.getByRole("button", { name: "本文へ", exact: true }).click();
  await selectParagraphText(page, "余白");
  await page.getByRole("button", { name: "AI画面に戻る" }).click();
  await expect(dialog.getByText(/この辞書照会は期限切れ/u)).toBeVisible();
  await expect(dialog.getByRole("region", { name: "LLMによる語句の説明" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "本文へ", exact: true }).click();
  await page.getByRole("combobox", { name: "AIツール", exact: true }).selectOption("rewrite");
  await expect(dialog).toHaveCount(0); await expect(editor).toHaveText("余韻と余白");
});

test("dictionary requires a word selection and rejects oversized queries without sending", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("語".repeat(101));
  await page.getByRole("radio", { name: "自由指示（Custom）", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "辞書（Dictionary）", exact: true })).toBeChecked();
  await editor.focus(); await page.keyboard.press("Control+k");
  await expect(page.getByText("意味を調べる語句を選択してください。")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectParagraphText(page, "語".repeat(101)); await page.keyboard.press("Control+k");
  await expect(page.getByText("意味を調べる語句を1〜100文字で選択してください。")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
