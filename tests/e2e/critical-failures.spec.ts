import { expect, test } from "@playwright/test";

import {
  validateAiEditRequest,
  type AiEditRequest,
} from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";
import {
  manuscriptEditor,
  openAiCommand,
} from "./ai-edit-helpers";

function parseRequest(value: unknown): AiEditRequest {
  const result = validateAiEditRequest(value);

  if (!result.success) {
    throw new Error("E2E request was not canonical");
  }

  return result.data;
}

test("rejects a preview without changing or persisting the manuscript", async ({
  page,
}) => {
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  const dialog = await openAiCommand(page, "対象");

  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("button", { name: "却下" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(editor).toHaveText("前対象後");
  await page.reload();
  await expect(editor).toHaveText("前対象後");
});

test("applies only the selected middle occurrence of repeated text", async ({
  page,
}) => {
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("同じ・同じ・同じ");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  const dialog = await openAiCommand(page, "同じ", "中央だけ自然に", 1);

  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(editor).toHaveText("同じ・同じ・同じ");
  await dialog.getByRole("tab", { name: "候補 2" }).click();
  await dialog.getByRole("button", { name: "採用" }).click();

  await expect(editor).toHaveText("同じ・同じ【デモ候補2】・同じ");
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("同じ・同じ・同じ");
});

test("keeps editing and saving available after a safe API failure and Retry", async ({
  page,
}) => {
  const requestIds: string[] = [];

  await page.route("**/api/ai/edits", async (route) => {
    const request = parseRequest(route.request().postDataJSON());
    requestIds.push(request.requestId);

    if (requestIds.length === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          error: {
            code: "PROVIDER_FAILURE",
            message: "private provider diagnostic",
            requestId: request.requestId,
            retryable: true,
          },
        },
        status: 502,
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
  const dialog = await openAiCommand(page, "対象");

  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByText("AIの処理に失敗しました。")).toBeVisible();
  await expect(dialog.getByText("private provider diagnostic")).toHaveCount(0);
  await expect(editor).toHaveText("前対象後");

  await dialog.getByRole("button", { name: "再試行" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).not.toBe(requestIds[1]);
  await dialog.getByRole("button", { name: "却下" }).click();

  await editor.focus();
  await page.keyboard.press("End");
  await page.keyboard.insertText("追記🙂");
  await expect(editor).toHaveText("前対象後追記🙂");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  await page.reload();
  await expect(editor).toHaveText("前対象後追記🙂");
});

test("makes a delayed response stale after a manuscript edit", async ({
  page,
}) => {
  const requestStarted = createDeferred<void>();
  const releaseResponse = createDeferred<void>();

  await page.route("**/api/ai/edits", async (route) => {
    const request = parseRequest(route.request().postDataJSON());
    requestStarted.resolve();
    await releaseResponse.promise;
    await route
      .fulfill({
        contentType: "application/json",
        json: createAiEditSuccessResponseFixture(request),
        status: 200,
      })
      .catch(() => undefined);
  });

  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  const dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("button", { name: "生成" }).click();
  await requestStarted.promise;

  await editor.focus();
  await page.keyboard.insertText("手入力🙂");
  await expect(dialog.getByText(/本文が変更されたため/u)).toBeVisible();
  releaseResponse.resolve();

  await expect(dialog.getByText("2件の候補を受信しました。")).toHaveCount(0);
  await expect(editor).toHaveText("前手入力🙂後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  await page.reload();
  await expect(editor).toHaveText("前手入力🙂後");
});

test("makes a delayed response stale after selection-only movement", async ({
  page,
}) => {
  const requestStarted = createDeferred<void>();
  const releaseResponse = createDeferred<void>();

  await page.route("**/api/ai/edits", async (route) => {
    const request = parseRequest(route.request().postDataJSON());
    requestStarted.resolve();
    await releaseResponse.promise;
    await route
      .fulfill({
        contentType: "application/json",
        json: createAiEditSuccessResponseFixture(request),
        status: 200,
      })
      .catch(() => undefined);
  });

  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  const dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("button", { name: "生成" }).click();
  await requestStarted.promise;

  await editor.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(/選択範囲が変更されたため/u)).toBeVisible();
  releaseResponse.resolve();

  await expect(dialog.getByText("2件の候補を受信しました。")).toHaveCount(0);
  await expect(editor).toHaveText("前対象後");
});

test("keeps a newer session authoritative when an aborted old response arrives last", async ({
  page,
}) => {
  const firstRequestStarted = createDeferred<void>();
  const firstResponseFinished = createDeferred<void>();
  const releaseFirstResponse = createDeferred<void>();
  let requests = 0;

  await page.route("**/api/ai/edits", async (route) => {
    const request = parseRequest(route.request().postDataJSON());
    requests += 1;
    const requestNumber = requests;

    if (requestNumber === 1) {
      firstRequestStarted.resolve();
      await releaseFirstResponse.promise;
    }

    await route
      .fulfill({
        contentType: "application/json",
        json: createAiEditSuccessResponseFixture(request),
        status: 200,
      })
      .catch(() => undefined);

    if (requestNumber === 1) {
      firstResponseFinished.resolve();
    }
  });

  await page.goto("/");
  const editor = manuscriptEditor(page);
  await editor.fill("春風と夏雨");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 3_000 });
  let dialog = await openAiCommand(page, "春風");
  await dialog.getByRole("button", { name: "生成" }).click();
  await firstRequestStarted.promise;
  await dialog
    .getByRole("button", { name: "AI編集をキャンセル" })
    .click();
  await expect(dialog).not.toBeVisible();

  dialog = await openAiCommand(page, "夏雨");
  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(dialog.getByLabel("候補本文").first()).toContainText(
    "夏雨【デモ候補1】",
  );

  releaseFirstResponse.resolve();
  await firstResponseFinished.promise;
  await expect(dialog.getByLabel("候補本文").first()).toContainText(
    "夏雨【デモ候補1】",
  );
  await dialog.getByRole("button", { name: "採用" }).click();
  await expect(editor).toHaveText("春風と夏雨【デモ候補1】");
  expect(requests).toBe(2);
});
