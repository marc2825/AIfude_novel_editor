import { expect, test } from "@playwright/test";
import { manuscriptEditor, placeCaret } from "./ai-edit-helpers";
import { validateAiEditRequest } from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

test("inserts prompt output only after Accept, then undoes, redoes and saves", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/api/ai/edits", async (route) => { requests.push(route.request().postDataJSON()); await route.continue(); });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前後");
  await placeCaret(page, 1); await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI文章挿入" });
  await dialog.getByRole("textbox", { name: "文章のプロンプト" }).fill("雨が降る風景を書いて");
  await expect(dialog.getByRole("radio", { name: "1案" })).toBeChecked();
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByText("1件の候補を受信しました。")).toBeVisible();
  await expect(editor).toHaveText("前後");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ operation: "insert", candidateCount: 1, selectionText: "", beforeText: "", afterText: "", globalContext: { commonPrompt: "", manualStyle: "" } });
  await dialog.getByRole("button", { name: "採用", exact: true }).click(); await expect(editor).toHaveText("前【デモ候補1】後");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前後");
  await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText("前【デモ候補1】後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible(); await page.reload(); await expect(editor).toHaveText("前【デモ候補1】後");
});

test("does not insert a delayed result after the manuscript changes while generating", async ({ page }) => {
  const started = createDeferred<void>(); const release = createDeferred<void>();
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    started.resolve(); await release.promise; await route.fulfill({ json: createAiEditSuccessResponseFixture(parsed.data) });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前後");
  await placeCaret(page, 1); await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI文章挿入" });
  await dialog.getByRole("textbox", { name: "文章のプロンプト" }).fill("雨の描写");
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await started.promise;
  await editor.fill("書き続けた本文"); await expect(dialog.getByRole("button", { name: /期限切れのコマンドを閉じる/u })).toBeVisible();
  release.resolve(); await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("書き続けた本文"); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
});
