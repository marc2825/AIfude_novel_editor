import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  validateAiEditRequest,
  type AiEditRequest,
} from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import {
  manuscriptEditor,
  selectAcrossParagraphs,
  selectParagraphText,
} from "./ai-edit-helpers";

function parseRequest(value: unknown): AiEditRequest {
  const result = validateAiEditRequest(value);

  if (!result.success) {
    throw new Error("E2E request was not canonical");
  }

  return result.data;
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }

    await page.keyboard.press("Tab");
  }

  await expect(target).toBeFocused();
}

test("completes candidate navigation and Accept using only scoped keyboard controls", async ({
  page,
}) => {
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  await selectParagraphText(page, "対象");

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  const instruction = dialog.getByRole("textbox", { name: "編集の指示" });
  await expect(instruction).toBeFocused();
  await page.keyboard.type("自然に");
  await page.keyboard.press("Control+Enter");
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();

  await tabTo(page, dialog.getByRole("tab", { name: "候補 1" }));
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "候補 2" })).toBeFocused();
  await page.keyboard.press("Control+Enter");

  await expect(dialog).not.toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("前対象【デモ候補2】後");
});

test("supports keyboard Retry, Reject, and Escape without manuscript mutation", async ({
  page,
}) => {
  let requests = 0;

  await page.route("**/api/ai/edits", async (route) => {
    const request = parseRequest(route.request().postDataJSON());
    requests += 1;

    if (requests === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          error: {
            code: "RATE_LIMITED",
            message: "safe",
            requestId: request.requestId,
            retryable: true,
          },
        },
        status: 429,
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: createAiEditSuccessResponseFixture(request),
      status: 200,
    });
  });

  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  await selectParagraphText(page, "対象");
  await page.keyboard.press("Control+k");
  let dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await page.keyboard.type("自然に");
  await page.keyboard.press("Control+Enter");
  await expect(dialog.getByText(/AIの利用上限/u)).toBeVisible();

  await tabTo(page, dialog.getByRole("button", { name: "再試行" }));
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "却下" }));
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(editor).toHaveText("前対象後");

  await selectParagraphText(page, "対象");
  await page.keyboard.press("Control+k");
  dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(editor).toHaveText("前対象後");
  expect(requests).toBe(2);
});

test("opens insertion at a caret and rejects blank-only and oversized edit selections", async ({ page }) => {
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill(`前　 後${"長".repeat(2_001)}`);

  await editor.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "AI文章挿入" })).toBeVisible();
  await page.keyboard.press("Escape");

  await selectParagraphText(page, "　 ");
  await page.keyboard.press("Control+k");
  await expect(page.getByText("編集する文字列を選択してください")).toBeVisible();

  await selectParagraphText(page, "長".repeat(2_001));
  await page.keyboard.press("Control+k");
  await expect(page.getByText(/現在2,001文字／上限2,000文字/u)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "AI編集コマンド" })).toHaveCount(0);
});

test("accepts an exact multiline Unicode range while preserving the trailing paragraph", async ({
  page,
}) => {
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("前🙂\n\n対象　後\n");
  await expect(editor.locator("p")).toHaveText(["前🙂", "", "対象　後", ""]);
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  await selectAcrossParagraphs(page, {
    endOffset: 3,
    endParagraph: 2,
    startOffset: 1,
    startParagraph: 0,
  });
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await dialog.getByRole("textbox", { name: "編集の指示" }).fill("自然に");
  await dialog.getByRole("button", { name: "生成" }).click();

  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(editor.locator("p")).toHaveText(["前🙂", "", "対象　後", ""]);
  await dialog.getByRole("button", { name: "採用" }).click();
  await expect(editor.locator("p")).toHaveText([
    "前🙂",
    "",
    "対象　【デモ候補1】後",
    "",
  ]);

  await page.keyboard.press("Control+z");
  await expect(editor.locator("p")).toHaveText(["前🙂", "", "対象　後", ""]);
  await page.keyboard.press("Control+y");
  await expect(editor.locator("p")).toHaveText([
    "前🙂",
    "",
    "対象　【デモ候補1】後",
    "",
  ]);
});
