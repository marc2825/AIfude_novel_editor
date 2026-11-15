import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

import { manuscriptEditor, openAiCommand } from "./ai-edit-helpers";

// Exercise the actual app route and adapter against a local HTTP fixture.
// No inference engine, downloaded model, external account or API key is used.
const requests: unknown[] = [];
let failRequests = false;
const server = createServer((request, response) => {
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => { body += chunk; });
  request.on("end", () => {
    try {
      const value: unknown = JSON.parse(body);
      requests.push(value);
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (failRequests) {
      response.writeHead(503).end("private local error");
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({ candidates: [1, 2].map((index) => ({
            explanation: `ローカル接続の確認候補${index}`,
            replacementText: `候補${index}`,
            riskNotes: [],
          })) }),
          role: "assistant",
        },
      }],
    }));
  });
});

test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3179, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test.beforeEach(() => {
  requests.length = 0;
  failRequests = false;
});

test("generates through the local adapter, previews, accepts, undoes and saves without cloud consent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("AI実行環境"))
    .toHaveText("AI：ローカルLLM：local-e2e-model（外部送信なし）");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable();
  expect(requests).toHaveLength(0);
  await editor.fill("前対象後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  const dialog = await openAiCommand(page, "対象");
  await expect(dialog.getByRole("checkbox", { name: /上記のデータが/u })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "保存済み作品メモリを参照する" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "生成" })).toBeEnabled();
  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(editor).toHaveText("前対象後");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    max_tokens: 8_192,
    model: "local-e2e-model",
    response_format: { type: "json_schema", json_schema: { strict: true } },
    stream: false,
  });
  await dialog.getByRole("button", { name: "採用" }).click();
  await expect(editor).toHaveText("前候補1後");
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("前対象後");
  await page.keyboard.press("Control+Shift+z");
  await expect(editor).toHaveText("前候補1後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText("前候補1後");
  expect(requests).toHaveLength(1);
});

test("keeps editing and saving after local inference fails without retrying", async ({ page }) => {
  failRequests = true;
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable();
  await editor.fill("前対象後");
  const dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("button", { name: "生成" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(editor).toHaveText("前対象後");
  expect(requests).toHaveLength(1);
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await editor.fill("障害後も編集と保存");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor).toHaveText("障害後も編集と保存");
  expect(requests).toHaveLength(1);
});
