import { expect, test, type Page } from "@playwright/test";

import {
  validateAiEditRequest,
  type AiEditRequest,
} from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";

async function selectText(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "小説本文" });

  await editor.focus();
  await editor.locator("p").evaluate((paragraph, selectedText) => {
    const node = paragraph.firstChild;

    if (!(node instanceof Text) || node.data.indexOf(selectedText) < 0) {
      throw new Error("selection target was not found");
    }

    const start = node.data.indexOf(selectedText);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, text);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(text);
}

test("requires persisted OpenAI consent, sends only the bounded contract, and revokes it", async ({
  page,
}) => {
  const requests: AiEditRequest[] = [];

  await page.route("**/api/ai/edits", async (route) => {
    const validation = validateAiEditRequest(route.request().postDataJSON());

    if (!validation.success) {
      await route.abort();
      return;
    }

    requests.push(validation.data);
    const fixture = createAiEditSuccessResponseFixture(validation.data);
    const resolvedModel = validation.data.modelId ?? "gpt-5.6-terra";
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...fixture,
        candidates: fixture.candidates.map((candidate) => ({
          ...candidate,
          model: resolvedModel,
          providerId: "openai",
        })),
        provider: { model: resolvedModel, providerId: "openai" },
      },
      status: 200,
    });
  });

  await page.goto("/");
  await expect(
    page.getByLabel("AI実行環境"),
  ).toHaveText("AI：GPT-5.6 Terra（外部送信あり）");
  const editor = page.getByRole("textbox", { name: "小説本文" });
  await expect(editor).toBeEditable();
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });

  await selectText(page, "対象");
  await page.keyboard.press("Control+k");
  let dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await dialog.getByRole("textbox", { name: "編集の指示" }).fill("自然に");
  await expect(dialog.getByText("OpenAIへの外部送信")).toBeVisible();
  await expect(
    dialog.getByText("GPT-5.6 Terra（gpt-5.6-terra）", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "生成" })).toBeDisabled();
  await expect(
    dialog.getByRole("checkbox", {
      name: "上記のデータがOpenAIへ送信されることに同意します",
    }),
  ).not.toBeChecked();
  expect(requests).toHaveLength(0);

  await dialog
    .getByRole("checkbox", {
      name: "上記のデータがOpenAIへ送信されることに同意します",
    })
    .check();
  await dialog.getByRole("button", { name: "同意を保存" }).click();
  await expect(dialog.getByText(/AI参照設定が変更されたため/u)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /期限切れのコマンドを閉じる/u }),
  ).toBeFocused();
  expect(requests).toHaveLength(0);

  await dialog.getByRole("button", { name: /期限切れのコマンドを閉じる/u }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor).toBeEditable();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await expect(page.getByText("同意済み")).toBeVisible();
  const modelSelector = page.getByRole("combobox", { name: "使用モデル" });
  await expect(modelSelector.locator("option")).toHaveText([
    "自動（サーバー既定：GPT-5.6 Terra）",
    "GPT-6 Astra",
    "GPT-5.6 Sol",
    "GPT-5.6 Terra",
    "GPT-5.6 Luna",
  ]);
  await modelSelector.selectOption("gpt-5.6-luna");
  await page.getByRole("button", { name: "モデル設定を保存" }).click();
  await expect(
    page.getByText("AIモデル設定を保存しました。新しいAI編集から有効です。"),
  ).toBeVisible();
  await expect(page.getByText("同意済み")).toBeVisible();
  await page.reload();
  await expect(editor).toBeEditable();
  await expect(page.getByLabel("AI実行環境")).toHaveText(
    "AI：GPT-5.6 Luna（外部送信あり）",
  );
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "使用モデル" })).toHaveValue(
    "gpt-5.6-luna",
  );
  await expect(page.getByText("同意済み")).toBeVisible();
  const apiToggle = page.getByRole("checkbox", { name: "サブスクとは別料金のAPI接続を有効にする" });
  await expect(apiToggle).not.toBeChecked();
  await apiToggle.check();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();

  await selectText(page, "対象");
  await page.keyboard.press("Control+k");
  dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await expect(
    dialog.getByText("GPT-5.6 Luna（gpt-5.6-luna）", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("textbox", { name: "編集の指示" }).fill("自然に");
  await expect(dialog.getByRole("button", { name: "生成" })).toBeEnabled();
  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    consent: { policyVersion: 1, providerId: "openai" },
    instruction: "自然に",
    modelId: "gpt-5.6-luna",
    selectionText: "対象",
  });
  expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
    "afterText",
    "allowPaidApi",
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
  expect(JSON.stringify(requests[0])).not.toMatch(
    /apiKey|editorInstanceId|grantedAt|originalSlice|storageVersion/u,
  );
  expect(requests[0]).not.toHaveProperty("from");
  expect(requests[0]).not.toHaveProperty("to");
  await expect(
    dialog.getByText("GPT-5.6 Luna / gpt-5.6-luna（openai）"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "却下" }).click();

  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("button", { name: "同意を撤回" }).click();
  await expect(page.getByText("未同意")).toBeVisible();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();

  await selectText(page, "対象");
  await page.keyboard.press("Control+k");
  dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await dialog.getByRole("textbox", { name: "編集の指示" }).fill("自然に");
  await expect(dialog.getByRole("button", { name: "生成" })).toBeDisabled();
  expect(requests).toHaveLength(1);
  await expect(editor).toHaveText("前対象後");
});
