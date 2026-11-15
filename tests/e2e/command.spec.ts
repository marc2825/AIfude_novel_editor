import { expect, test } from "@playwright/test";

import { validateAiEditRequest } from "../../src/domain/ai-edit";
import { createDeferred } from "../helpers/deferred";

test("previews, explicitly accepts, undoes, redoes, and saves a local candidate", async ({
  page,
}) => {
  const requestStarted = createDeferred<void>();
  const releaseRequest = createDeferred<void>();
  let requestBody: unknown = null;
  let editRequests = 0;

  await page.route("**/api/ai/edits", async (route) => {
    editRequests += 1;
    requestBody = route.request().postDataJSON();
    requestStarted.resolve();
    await releaseRequest.promise;
    await route.continue();
  });

  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "小説本文" });
  await expect(editor).toBeEditable();
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });

  await editor.focus();
  await editor.locator("p").evaluate((paragraph) => {
    const text = paragraph.firstChild;

    if (!(text instanceof Text)) {
      throw new Error("manuscript text node was not found");
    }

    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("対象");
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  const instruction = dialog.getByRole("textbox", { name: "編集の指示" });
  const generate = dialog.getByRole("button", { name: "生成" });
  await expect(dialog).toBeVisible();
  await expect(instruction).toBeFocused();
  await expect(generate).toBeDisabled();

  await instruction.fill("余韻を残して、自然な日本語にする");
  await expect(generate).toBeEnabled();
  await generate.click();
  await requestStarted.promise;

  await expect(
    dialog.getByText("候補を生成しています。本文編集は続けられます。"),
  ).toBeVisible();
  await expect(instruction).toBeDisabled();

  const requestValidation = validateAiEditRequest(requestBody);
  expect(requestValidation.success).toBe(true);
  if (!requestValidation.success) {
    throw new Error("request body was not canonical");
  }

  expect(Object.keys(requestValidation.data).sort()).toEqual([
    "afterText",
    "beforeText",
    "candidateCount",
    "consent",
    "globalContext",
    "instruction",
    "modelId",
    "presetId",
    "requestId",
    "schemaVersion",
    "selectionText",
  ]);
  expect(requestValidation.data).toMatchObject({
    candidateCount: 2,
    consent: null,
    instruction: "余韻を残して、自然な日本語にする",
    modelId: null,
    selectionText: "対象",
  });

  releaseRequest.resolve();

  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(
    dialog.getByText("ローカルデモ候補（外部送信なし）"),
  ).toBeVisible();
  const firstDiff = dialog.getByRole("region", {
    name: "候補 1 の原文との差分",
  });
  await expect(
    firstDiff.getByTestId("candidate-diff-parts").locator("ins"),
  ).toHaveText("【デモ候補1】");
  await expect(firstDiff.getByText(/原文から削る箇所/u)).toBeVisible();
  await expect(firstDiff.getByText(/候補で加える箇所/u)).toBeVisible();
  await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("tab", { name: "候補 1" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("候補 2 / 2")).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "候補 2" })).toBeFocused();
  const secondDiff = dialog.getByRole("region", {
    name: "候補 2 の原文との差分",
  });
  await expect(
    secondDiff.getByTestId("candidate-diff-parts").locator("ins"),
  ).toHaveText("【デモ候補2】");
  await expect(editor).toHaveText("前対象後");
  expect(editRequests).toBe(1);

  await page.keyboard.press("Control+Enter");
  await expect(dialog).not.toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("前対象【デモ候補2】後");

  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("前対象後");
  await page.keyboard.press("Control+y");
  await expect(editor).toHaveText("前対象【デモ候補2】後");

  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  await page.reload();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("前対象【デモ候補2】後");
  expect(editRequests).toBe(1);
});
