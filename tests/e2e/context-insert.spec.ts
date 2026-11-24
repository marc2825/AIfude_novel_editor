import { expect, test } from "@playwright/test";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";
import { manuscriptEditor, openAiTool, placeCaret, selectParagraphText } from "./ai-edit-helpers";

test("inserts supplied content at a mid-sentence caret with adjacent context, comparison, Undo/Redo and save", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  const before = "彼女は頷いた。", after = "彼は席を立った。", content = "彼女が返事をためらう仕草を描いて";
  await editor.fill(before + after);
  const requests: AiEditRequest[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/ai/edits")) return;
    const parsed = validateAiEditRequest(request.postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    requests.push(parsed.data);
  });
  await placeCaret(page, before.length);
  await openAiTool(page, "文脈で挿入");
  const dialog = page.getByRole("dialog", { name: "AI文脈挿入" });
  const prompt = dialog.getByRole("textbox", { name: "書きたい内容", exact: true });
  await expect(prompt).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled(); expect(requests).toHaveLength(0);
  await prompt.fill(content); await dialog.getByRole("spinbutton", { name: "目標文字数" }).fill("200");
  await dialog.getByRole("radio", { name: "2案", exact: true }).check(); await prompt.focus(); await page.keyboard.press("Control+Enter");
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ operation: "context-insert", instruction: content, beforeText: before, afterText: after, selectionText: "", targetCharacters: 200, presetId: null });
  expect(requests[0]).not.toHaveProperty("storyMemory"); expect(requests[0]).not.toHaveProperty("from");
  await expect(editor).toHaveText(before + after);
  await dialog.getByRole("tab", { name: "候補 1", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "候補 2", exact: true })).toBeFocused();
  await expect(dialog.getByText(/目標 200文字/u)).toBeVisible();
  await dialog.getByRole("button", { name: "採用", exact: true }).click();
  const expected = before + "【デモ候補2】" + after; await expect(editor).toHaveText(expected);
  await page.keyboard.press("Control+z"); await expect(editor).toHaveText(before + after);
  await page.keyboard.press("Control+y"); await expect(editor).toHaveText(expected);
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible(); await page.reload(); await expect(editor).toHaveText(expected);
});

test("is not offered for a selected range and discards a late insertion after the caret changes", async ({ page }) => {
  const started = createDeferred<void>(); const release = createDeferred<void>();
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    started.resolve(); await release.promise; await route.fulfill({ json: createAiEditSuccessResponseFixture(parsed.data) }).catch(() => undefined);
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前の文章。後の文章。");
  await selectParagraphText(page, "前の文章。"); await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "AI編集コマンド" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "文脈で挿入", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await placeCaret(page, 5); await openAiTool(page, "文脈で挿入");
  const dialog = page.getByRole("dialog", { name: "AI文脈挿入" });
  await dialog.getByRole("textbox", { name: "書きたい内容", exact: true }).fill("足音が聞こえる描写");
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await started.promise;
  await placeCaret(page, 2); await expect(dialog.getByText(/この編集コマンドは期限切れです/u)).toBeVisible();
  release.resolve(); await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("前の文章。後の文章。");
});

test("supports empty manuscripts and explicit Retry after failure without modifying the document", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    expect(parsed.data).toMatchObject({ beforeText: "", afterText: "", selectionText: "", operation: "context-insert" }); attempts += 1;
    await route.fulfill(attempts === 1 ? { status: 503, json: { error: { code: "PROVIDER_TIMEOUT", message: "検査用", retryable: true, requestId: parsed.data.requestId } } } : { json: createAiEditSuccessResponseFixture(parsed.data) });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.focus(); await openAiTool(page, "文脈で挿入");
  const dialog = page.getByRole("dialog", { name: "AI文脈挿入" });
  await dialog.getByRole("textbox", { name: "書きたい内容", exact: true }).fill("海辺の風景を描いて");
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(editor).toHaveText(""); expect(attempts).toBe(1);
  await dialog.getByRole("button", { name: "再試行", exact: true }).click(); await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
  await expect(editor).toHaveText(""); expect(attempts).toBe(2);
  await dialog.getByRole("button", { name: "採用", exact: true }).click(); await expect(editor).toHaveText("【デモ候補1】");
  await page.keyboard.press("Control+z"); await expect(editor).toHaveText("");
});
