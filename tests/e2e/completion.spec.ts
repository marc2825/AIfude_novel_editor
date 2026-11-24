import type { Editor } from "@tiptap/core";
import { expect, test } from "@playwright/test";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { chooseAiTool, manuscriptEditor, placeCaret, selectParagraphText, tryAiTool } from "./ai-edit-helpers";

for (const operation of ["infill", "continue"] as const) {
  test(`${operation}: tool chosen for the target, bounded context and length, Diff, Accept, Undo/Redo and reload`, async ({ page }) => {
    await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
    const before = "雨が止んだ。", gap = operation === "infill" ? "　　" : "", after = operation === "infill" ? "彼は外へ出た。" : "";
    const initial = before + gap + after; await editor.fill(initial);
    const requests: AiEditRequest[] = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/api/ai/edits")) return;
      const parsed = validateAiEditRequest(request.postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
      requests.push(parsed.data);
    });
    if (operation === "infill") await selectParagraphText(page, gap); else await placeCaret(page, before.length);
    await page.keyboard.press("Control+k");
    // A blank gap can only be filled, so the panel opens with that tool; at a caret the tool is chosen in the panel.
    if (operation === "continue") await chooseAiTool(page, "続きを書く");
    const dialog = page.getByRole("dialog", { name: operation === "infill" ? "AI中間補完" : "AIの続き執筆" });
    await expect(dialog).toBeVisible(); expect(requests).toHaveLength(0);
    const count = dialog.getByRole("spinbutton", { name: "目標文字数" });
    await count.fill("3001"); await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
    await count.fill("200"); await dialog.getByRole("radio", { name: "2案", exact: true }).check();
    await dialog.getByRole("textbox", { name: "編集の指示", exact: true }).focus();
    await page.keyboard.press("Control+Enter");
    await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ operation, targetCharacters: 200, beforeText: before, afterText: after, selectionText: gap });
    expect(requests[0]).not.toHaveProperty("storyMemory");
    await expect(editor).toHaveText(initial);
    await dialog.getByRole("tab", { name: "候補 1", exact: true }).focus(); await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "候補 2", exact: true })).toBeFocused();
    await expect(dialog.getByText(/目標 200文字/u)).toBeVisible();
    await dialog.getByRole("button", { name: "採用", exact: true }).click();
    const expected = before + gap + "【デモ候補2】" + after;
    await expect(editor).toHaveText(expected);
    await page.keyboard.press("Control+z"); await expect(editor).toHaveText(initial);
    await page.keyboard.press("Control+y"); await expect(editor).toHaveText(expected);
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    await page.reload(); await expect(editor).toHaveText(expected);
  });
}

test("empty middle paragraph can be filled, and editing during generation invalidates the completion", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("前。\n\n後。");
  await editor.locator("p").nth(1).click();
  // Tiptap attaches its Editor to the editable DOM element. Wait for the native
  // selectionchange to reach PM; a click can resolve before that browser event.
  await expect.poll(() => editor.evaluate((element) => {
    const tiptapElement = element as HTMLElement & { editor: Editor };
    return tiptapElement.editor.state.selection.from;
  })).toBe(5);
  await page.keyboard.press("Control+k"); await chooseAiTool(page, "中間補完");
  const dialog = page.getByRole("dialog", { name: "AI中間補完" }); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "採用", exact: true }).click();
  await expect(editor.locator("p")).toHaveText(["前。", "【デモ候補1】", "後。"]);
  await page.keyboard.press("Control+z"); await expect(editor.locator("p")).toHaveText(["前。", "", "後。"]);
  await editor.fill("前。　後。"); await selectParagraphText(page, "　"); await page.keyboard.press("Control+k");
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = () => {};
  const arrived = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/ai/edits", async (route) => {
    const response = await route.fetch(); started(); await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await arrived;
  await editor.fill("手で続きを書いた。"); release();
  await expect(dialog.getByText(/この編集コマンドは期限切れです/u)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("手で続きを書いた。");
});

test("writing tools are not offered for selected text, and refuse a mid-sentence caret without requests", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前の文章。後の文章。");
  let count = 0; page.on("request", (request) => { if (request.url().endsWith("/api/ai/edits")) count += 1; });
  await selectParagraphText(page, "前の文章。"); await page.keyboard.press("Control+k");
  const revise = page.getByRole("dialog", { name: "AI編集コマンド" }); await expect(revise).toBeVisible();
  await expect(revise.getByRole("radio", { name: "中間補完", exact: true })).toHaveCount(0);
  await expect(revise.getByRole("radio", { name: "続きを書く", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await placeCaret(page, 2); await page.keyboard.press("Control+k");
  const insert = page.getByRole("dialog", { name: "AI文章挿入" }); await expect(insert).toBeVisible();
  await tryAiTool(page, "中間補完");
  await expect(page.getByText(/前後に本文がある空白だけを選択/u)).toBeVisible();
  await tryAiTool(page, "続きを書く");
  await expect(page.getByText(/続けたい章の本文末尾/u)).toBeVisible();
  // The open session and its tool stay as they were.
  await expect(insert.getByRole("radio", { name: "指示から書く", exact: true })).toBeChecked();
  expect(count).toBe(0); await expect(editor).toHaveText("前の文章。後の文章。");
});
