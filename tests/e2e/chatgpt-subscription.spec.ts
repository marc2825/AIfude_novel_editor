import { expect, test } from "@playwright/test";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { CHATGPT_CONNECTION_ID } from "../fixtures/chatgpt";
import { manuscriptEditor, openAiCommand } from "./ai-edit-helpers";

test("connects, confirms plan usage and consent, then explicitly accepts and saves subscription output", async ({ page, context }) => {
  let connected = false;
  let welcomePending = false;
  const requests: AiEditRequest[] = [];
  // Authentication and inference are mocked at the app boundary. Never contact a real account.
  await context.route("https://auth.openai.com/**", (route) => route.abort());
  await page.route("**/api/ai/chatgpt", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { connected, connectionId: connected ? CHATGPT_CONNECTION_ID : null, email: connected ? "writer@example.test" : null, welcomePending } });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    if (typeof body !== "object" || body === null || !("action" in body)) throw new Error("Expected auth action");
    if (body.action === "sign-in") {
      connected = true; welcomePending = true;
      await route.fulfill({ json: { authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=test-only" } });
    } else if (body.action === "acknowledge") {
      welcomePending = false; await route.fulfill({ json: { ok: true } });
    } else {
      connected = false; await route.fulfill({ json: { revocationConfirmed: true } });
    }
  });
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON());
    if (!parsed.success) throw new Error("Invalid edit request");
    requests.push(parsed.data);
    const fixture = createAiEditSuccessResponseFixture(parsed.data);
    await route.fulfill({ json: { ...fixture,
      candidates: fixture.candidates.map((candidate) => ({ ...candidate, model: "gpt-6.1-sol", providerId: "chatgpt" })),
      provider: { model: "gpt-6.1-sol", providerId: "chatgpt" },
    } });
  });
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable(); await editor.fill("前対象後");
  let dialog = await openAiCommand(page, "対象");
  await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
  const welcome = page.getByRole("dialog", { name: "ChatGPTの利用枠を使います" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "確認しました" }).click();
  await expect(welcome).not.toBeVisible();
  await page.getByRole("checkbox", { name: "上記のデータがOpenAIへ送信されることに同意します" }).check();
  await page.getByRole("button", { name: "同意を保存", exact: true }).click();
  await expect(page.getByText("同意済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ connectionId: CHATGPT_CONNECTION_ID, consent: { providerId: "chatgpt", policyVersion: 1 }, modelId: null });
  await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("button", { name: "採用", exact: true }).click();
  await expect(editor).toHaveText("前対象【デモ候補1】後");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前対象後");
  await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText("前対象【デモ候補1】後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("前対象【デモ候補1】後");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("button", { name: "ChatGPTの接続を解除" }).click();
  await expect(page.getByText("未接続", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  dialog = await openAiCommand(page, "対象");
  await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(1);
});

test("shows subscription limits without fallback and expires a preview when disconnected", async ({ page }) => {
  let connected = true;
  let generations = 0;
  await page.route("**/api/ai/chatgpt", async (route) => {
    if (route.request().method() === "POST") { connected = false; await route.fulfill({ json: { revocationConfirmed: true } }); }
    else await route.fulfill({ json: { connected, connectionId: connected ? CHATGPT_CONNECTION_ID : null, email: null, welcomePending: false } });
  });
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON());
    if (!parsed.success) throw new Error("Invalid request");
    generations += 1;
    if (generations === 1) {
      await route.fulfill({ status: 429, json: { error: { code: "SUBSCRIPTION_LIMIT", message: "利用枠不足", retryable: false, requestId: parsed.data.requestId } } });
    } else {
      const fixture = createAiEditSuccessResponseFixture(parsed.data);
      await route.fulfill({ json: { ...fixture,
        candidates: fixture.candidates.map((candidate) => ({ ...candidate, model: "gpt-6.1-sol", providerId: "chatgpt" })),
        provider: { model: "gpt-6.1-sol", providerId: "chatgpt" },
      } });
    }
  });
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable(); await editor.fill("前対象後");
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("checkbox", { name: "上記のデータがOpenAIへ送信されることに同意します" }).check();
  await page.getByRole("button", { name: "同意を保存", exact: true }).click();
  await expect(page.getByText("同意済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  let dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("自動切替は行いません");
  expect(generations).toBe(1);
  await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "ChatGPTの接続を解除" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(/AI参照設定が変更されたため/u)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("前対象後");
  expect(generations).toBe(2);
});
