import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { aiComparisonRequestSchema } from "../../src/domain/ai-comparison";
import { WRITING_TOOLS, writingToolOperation } from "../../src/features/ai-edit/writing-tools";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { manuscriptEditor, placeCaret, selectParagraphText } from "../e2e/ai-edit-helpers";

// DOM selection emulates the result of native handles; OS long-press/IME is a separate NOT RUN gate.
async function start(page: Page, text = "前。彼女は窓を見つめていた。後。") {
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable(); await editor.fill(text);
  return editor;
}
async function tapCommand(page: Page, label = "AI提案") {
  await page.getByRole("button", { name: label, exact: true }).tap();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); return dialog;
}
async function insideViewport(page: Page, locator: Locator) {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box !== null && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= (page.viewportSize()?.width ?? 0) + 1 && box.y + box.height <= (page.viewportSize()?.height ?? 0) + 1;
  }).toBe(true);
}

for (const width of [320, 375, 390, 430, 768, 1024]) {
  test(`M-01/02/05/06: ${width}px layout, panels and candidate controls stay in the viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.name));
    await start(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of ["保存", "章とアウトライン", "作品メモリ", "AI提案"]) {
      const control = page.getByRole("button", { name, exact: true });
      await insideViewport(page, control);
      const box = await control.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44); expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "作品メモリ", exact: true }).tap();
    await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill("葵：考えてから話す。");
    await page.getByRole("button", { name: "サイドパネルを閉じる" }).tap();
    await expect(page.getByRole("button", { name: "作品メモリ", exact: true })).toBeFocused();
    await selectParagraphText(page, "彼女は窓を見つめていた。");
    const dialog = await tapCommand(page); await insideViewport(page, dialog);
    await dialog.getByRole("button", { name: "自然に", exact: true }).tap();
    await dialog.getByRole("button", { name: "生成", exact: true }).tap();
    await expect(dialog.getByRole("tab", { name: "候補 2", exact: true })).toBeVisible();
    await insideViewport(page, dialog);
    await dialog.getByRole("tab", { name: "候補 2", exact: true }).tap();
    await expect(dialog.getByRole("region", { name: "候補 2 の原文との差分" })).toBeVisible();
    await insideViewport(page, dialog.getByRole("button", { name: "採用", exact: true }));
    await dialog.getByRole("button", { name: "却下", exact: true }).tap();
    await expect(manuscriptEditor(page)).toHaveText("前。彼女は窓を見つめていた。後。");
    expect(errors).toEqual([]);
  });
}

test("M-03/07: Japanese selection → tap → Diff → Accept → touch Undo/Redo → save/reload", async ({ page }) => {
  const text = "前。雨音だけが部屋に響いた😀。後。";
  const editor = await start(page, text);
  await selectParagraphText(page, "雨音だけが部屋に響いた😀。");
  const dialog = await tapCommand(page);
  await expect(dialog.getByRole("region", { name: "推敲する原文" })).toContainText("雨音だけが部屋に響いた😀。");
  await dialog.getByRole("button", { name: "自然に", exact: true }).tap();
  await dialog.getByRole("button", { name: "生成", exact: true }).tap();
  await dialog.getByRole("tab", { name: "候補 2", exact: true }).tap();
  await expect(editor).toHaveText(text);
  await dialog.getByRole("button", { name: "採用", exact: true }).tap();
  const adopted = text.replace("😀。", "😀。【デモ候補2】");
  await expect(editor).toHaveText(adopted);
  await page.getByRole("button", { name: "元に戻す", exact: true }).tap(); await expect(editor).toHaveText(text);
  await page.getByRole("button", { name: "やり直す", exact: true }).tap(); await expect(editor).toHaveText(adopted);
  await page.getByRole("button", { name: "保存", exact: true }).tap();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText(adopted);
});

for (const tool of WRITING_TOOLS) {
  test(`M-03: touch opens and runs ${tool.english} without a shortcut`, async ({ page }) => {
    const editor = await start(page, "前。　後。");
    await page.getByRole("combobox", { name: "AIツール", exact: true }).selectOption(tool.id);
    if (tool.id === "infill") await selectParagraphText(page, "　");
    else if (tool.id === "continue") await placeCaret(page, 5);
    else if (writingToolOperation(tool.id) === "context-insert") await placeCaret(page, 2);
    else await selectParagraphText(page, "前。");
    const label = tool.id === "dictionary" ? "辞書で調べる" : writingToolOperation(tool.id) === "context-insert" ? "文脈で挿入" : ["infill", "continue"].includes(tool.id) ? tool.label : "AI提案";
    const dialog = await tapCommand(page, label);
    if (tool.id === "dictionary") {
      await dialog.getByRole("button", { name: "LLMで調べる", exact: true }).tap();
      await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("region", { name: "LLMによる語句の説明" })).toBeVisible();
    } else {
      await dialog.getByRole("textbox", { name: writingToolOperation(tool.id) === "context-insert" ? "書きたい内容" : "編集の指示", exact: true }).fill("雨音を自然に描いて");
      await dialog.getByRole("button", { name: "生成", exact: true }).tap();
      await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
    }
    await expect(editor).toHaveText("前。　後。");
  });
}

test("M-05: comparison consent, provider tabs and selected Diff precede adoption", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/ai/comparisons", async (route) => {
    requests++;
    const { request, targets } = aiComparisonRequestSchema.parse(route.request().postDataJSON());
    const fixture = createAiEditSuccessResponseFixture(request);
    await route.fulfill({ json: { requestId: request.requestId, results: targets.map(({ providerId }) => ({
      success: true, providerId, data: { ...fixture, provider: { providerId, model: providerId === "mock" ? fixture.provider.model : "mobile-fixture" },
        candidates: fixture.candidates.map((candidate) => ({ ...candidate, id: randomUUID(), providerId,
          model: providerId === "mock" ? fixture.provider.model : "mobile-fixture", replacementText: `${request.selectionText}（${providerId}）` + candidate.index })) },
    })) } });
  });
  const editor = await start(page); await selectParagraphText(page, "彼女は窓を見つめていた。");
  const dialog = await tapCommand(page); await dialog.getByRole("button", { name: "自然に", exact: true }).tap();
  await dialog.getByRole("checkbox", { name: /ローカルデモ/u }).tap();
  await dialog.getByRole("checkbox", { name: /ローカルLLM/u }).tap();
  await expect(dialog.getByRole("button", { name: "2個のAIへ同時送信" })).toBeDisabled(); expect(requests).toBe(0);
  await dialog.getByRole("checkbox", { name: "選択したAIすべてへの送信と各利用枠の消費に同意します" }).tap();
  await dialog.getByRole("button", { name: "2個のAIへ同時送信" }).tap();
  await dialog.getByRole("tab", { name: /local.*候補 3/u }).tap();
  await expect(dialog.getByRole("region", { name: "候補 3 の原文との差分" })).toBeVisible();
  await expect(dialog.getByRole("tabpanel").getByLabel("候補本文")).toContainText("（local）0");
  await dialog.getByRole("button", { name: "採用", exact: true }).tap();
  await expect(editor).toHaveText("前。彼女は窓を見つめていた。（local）0後。"); expect(requests).toBe(1);
});

for (const change of ["selection", "document"] as const) {
  test(`M-03/07: ${change} change rejects a late response, editing and saving continue`, async ({ page }) => {
    let release = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
    let arrived = () => {}; const pending = new Promise<void>((resolve) => { arrived = resolve; });
    let completed = () => {}; const responseDone = new Promise<void>((resolve) => { completed = resolve; });
    await page.route("**/api/ai/edits", async (route) => {
      const response = await route.fetch(); arrived(); await held;
      await route.fulfill({ response }).catch(() => undefined); completed();
    });
    const editor = await start(page); await selectParagraphText(page, "彼女は窓を見つめていた。");
    const dialog = await tapCommand(page); await dialog.getByRole("button", { name: "自然に", exact: true }).tap();
    await dialog.getByRole("button", { name: "生成", exact: true }).tap(); await pending;
    await dialog.getByRole("button", { name: "本文へ", exact: true }).tap();
    await expect(dialog).toBeHidden(); await expect(editor).toBeFocused();
    if (change === "selection") await editor.locator("p").first().tap({ position: { x: 2, y: 10 } });
    else await editor.fill("手書きの続き。");
    await expect(page.getByText("AIの対象は期限切れです", { exact: true })).toBeVisible();
    release(); await responseDone;
    await page.getByRole("button", { name: "AI画面に戻る" }).tap();
    await expect(dialog.getByText(/この編集コマンドは期限切れです/u)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "期限切れのコマンドを閉じる" }).tap();
    await editor.fill("安全に書き続ける。"); await page.getByRole("button", { name: "保存", exact: true }).tap();
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible(); await page.reload(); await expect(editor).toHaveText("安全に書き続ける。");
  });
}

test("M-02/07: chapter and project changes protect drafts across drawer switches and rotation", async ({ page }) => {
  const editor = await start(page, "第一章の本文。");
  await page.getByRole("button", { name: "章とアウトライン", exact: true }).tap();
  await page.getByRole("button", { name: "章を追加", exact: true }).tap();
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).tap();
  await editor.fill("第二章の本文。");
  await page.getByRole("button", { name: "章とアウトライン", exact: true }).tap();
  await page.getByRole("textbox", { name: "章のアウトライン", exact: true }).fill("未保存の構想");
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).tap();
  await expect(page.getByText("メモ・設定に未保存の入力があります。「保存」で保存できます。", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 850, height: 390 });
  await page.getByRole("button", { name: "作品メモリ", exact: true }).tap();
  await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill("未保存の人物メモ");
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).tap();
  await page.setViewportSize({ width: 390, height: 850 });
  await page.getByRole("button", { name: "章とアウトライン", exact: true }).tap();
  await expect(page.getByRole("textbox", { name: "章のアウトライン", exact: true })).toHaveValue("未保存の構想");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "第一章", exact: true }).tap();
  await expect(editor).toHaveText("第二章の本文。");
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).tap();
  await page.getByRole("button", { name: "作品操作", exact: true }).tap();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "新規作品", exact: true }).tap();
  await expect(editor).toHaveText("第二章の本文。");
  await page.getByRole("button", { name: "作品操作", exact: true }).tap();
  await page.getByRole("button", { name: "保存", exact: true }).tap();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("第二章の本文。");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).tap();
  await expect(page.getByRole("textbox", { name: /^登場人物メモ/u })).toHaveValue("未保存の人物メモ");
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).tap();
  await page.getByRole("button", { name: "章とアウトライン", exact: true }).tap();
  await page.getByRole("button", { name: "第一章", exact: true }).tap(); await expect(editor).toHaveText("第一章の本文。");
});


test("M-02/04/07: return to the manuscript preserves the AI draft and candidate across rotation", async ({ page }) => {
  const editor = await start(page); await selectParagraphText(page, "彼女は窓を見つめていた。");
  const dialog = await tapCommand(page);
  await dialog.getByRole("textbox", { name: "編集の指示", exact: true }).fill("余韻を大切に");
  await dialog.getByRole("button", { name: "本文へ", exact: true }).tap();
  await expect(dialog).toBeHidden(); await expect(editor).toBeFocused();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "AI画面に戻る" }).tap();
  await expect(dialog.getByRole("textbox", { name: "編集の指示", exact: true })).toHaveValue("余韻を大切に");
  await dialog.getByRole("button", { name: "生成", exact: true }).tap();
  await dialog.getByRole("tab", { name: "候補 2", exact: true }).tap();
  await dialog.getByRole("button", { name: "本文へ", exact: true }).tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "AI画面に戻る" }).tap();
  await expect(dialog.getByRole("tab", { name: "候補 2", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeEnabled();
  await expect(editor).toHaveText("前。彼女は窓を見つめていた。後。");
  await dialog.getByRole("button", { name: "採用", exact: true }).tap();
  await expect(editor).toHaveText("前。彼女は窓を見つめていた。【デモ候補2】後。");
});
