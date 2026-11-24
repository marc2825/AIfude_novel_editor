import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { publicConnectionStateSchema } from "../../src/domain/ai-connections";
import { manuscriptEditor, openWorkspacePanel, workMenuButton } from "./ai-edit-helpers";

const metadataRequests: { method: string | undefined; url: string | undefined; body: string }[] = [];
const server = createServer((request, response) => {
  let body = ""; request.setEncoding("utf8"); request.on("data", (chunk: string) => { body += chunk; });
  request.on("end", () => {
    metadataRequests.push({ method: request.method, url: request.url, body });
    if (request.method === "GET" && request.url === "/v1/models") response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "diagnostic-fixture" }] }));
    else response.writeHead(404).end();
  });
});
let localUrl = "";
test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback address");
  localUrl = `http://127.0.0.1:${address.port}/v1`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
test.afterEach(async ({ request }) => {
  const response = await request.get("/api/ai/connections"); const state = publicConnectionStateSchema.parse(await response.json());
  if (state.revision) {
    const reset = await request.post("/api/ai/connections", { headers: { Origin: "http://127.0.0.1:3100" }, data: { action: "reset", expectedRevision: state.revision } });
    expect(reset.ok()).toBe(true);
  }
});

test("protects unsaved work settings on reload and switching, then saves them through Ctrl+S", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("保護する本文");
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  const title = page.getByRole("textbox", { name: /^作品名/u }); await title.fill("保存する題名");
  await page.getByRole("textbox", { name: /^共通プロンプト/u }).fill("固有名詞を保つ");
  await page.getByRole("textbox", { name: /^手動文体設定/u }).fill("静かな文体");
  const leaving = page.waitForEvent("dialog"); const reload = page.evaluate(() => window.location.reload());
  const warning = await leaving; expect(warning.type()).toBe("beforeunload"); await warning.dismiss(); await reload;
  await expect(title).toHaveValue("保存する題名"); await expect(editor).toHaveText("保護する本文");
  page.once("dialog", (dialog) => dialog.dismiss()); await (await workMenuButton(page, "新規作品")).click();
  await expect(page.getByText("作品の切替を取り消しました。", { exact: true })).toBeVisible(); await expect(title).toHaveValue("保存する題名");
  await title.focus(); await page.keyboard.press("Control+s"); await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("保護する本文"); await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await expect(title).toHaveValue("保存する題名"); await expect(page.getByRole("textbox", { name: /^共通プロンプト/u })).toHaveValue("固有名詞を保つ");
  await expect(page.getByRole("textbox", { name: /^手動文体設定/u })).toHaveValue("静かな文体");
});

test("restores chapters and deleted works without history, and confirms permanent deletion", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("消して戻す章😀");
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("button", { name: "章を追加", exact: true }).click(); await expect(editor).toHaveText(""); await editor.fill("残す章");
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("button", { name: "第一章", exact: true }).click(); await expect(editor).toHaveText("消して戻す章😀");
  await openWorkspacePanel(page, "章とアウトライン");
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "現在の章を削除", exact: true }).click(); await expect(editor).toHaveText("残す章");
  await openWorkspacePanel(page, "ファイルとバックアップ");
  await page.getByRole("button", { name: "ごみ箱・削除の復元", exact: true }).click();
  const restoreChapter = page.getByRole("button", { name: "章：第一章（無題の作品）を復元", exact: true }); await expect(restoreChapter).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await restoreChapter.click(); await expect(restoreChapter).toHaveCount(0); await expect(editor).toHaveText("残す章");
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("button", { name: "第一章", exact: true }).click(); await expect(editor).toHaveText("消して戻す章😀");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click(); await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill("復元する人物");
  await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "ローカルデータを削除", exact: true }).click(); await expect(editor).toHaveCount(0);
  const trashToggle = page.getByRole("button", { name: "ごみ箱・削除の復元", exact: true });
  if (await trashToggle.getAttribute("aria-expanded") !== "true") await trashToggle.click();
  const restoreWork = page.getByRole("button", { name: "作品：無題の作品を復元", exact: true });
  await expect(restoreWork).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss()); await page.getByRole("button", { name: "作品：無題の作品を完全削除", exact: true }).click(); await expect(restoreWork).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await restoreWork.click(); await expect(editor).toHaveText("消して戻す章😀");
  await page.reload(); await expect(editor).toHaveText("消して戻す章😀"); await page.getByRole("button", { name: "作品メモリ", exact: true }).click(); await expect(page.getByRole("textbox", { name: /^登場人物メモ/u })).toHaveValue("復元する人物");
  await openWorkspacePanel(page, "章とアウトライン");
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "現在の章を削除", exact: true }).click(); await expect(editor).toHaveText("残す章");
  await openWorkspacePanel(page, "ファイルとバックアップ");
  await page.getByRole("button", { name: "ごみ箱・削除の復元", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "章：第一章（無題の作品）を完全削除", exact: true }).click(); await expect(page.getByText("ごみ箱は空です。", { exact: true })).toBeVisible();
});

test("saves a local connection without restart and diagnoses only model metadata, keeping API access OFF", async ({ page }) => {
  metadataRequests.length = 0; await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("診断へ送らない秘密の本文");
  await page.getByRole("button", { name: "AI接続の設定・診断", exact: true }).click();
  const primary = page.getByRole("combobox", { name: "主に使うAI", exact: true }); await primary.selectOption("local");
  await page.getByRole("textbox", { name: "ローカルLLMの接続モデルID", exact: true }).fill("diagnostic-fixture"); await page.getByRole("textbox", { name: "ローカルLLMの接続URL", exact: true }).fill(localUrl);
  await expect(page.getByRole("button", { name: "ローカルLLMの接続を診断", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "AI接続設定を保存", exact: true }).click(); await expect(page.getByText("AI接続設定を保存しました。次の生成から反映されます。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AI実行環境")).toContainText("ローカルLLM：diagnostic-fixture"); expect(metadataRequests).toHaveLength(0);
  await page.getByRole("button", { name: "ローカルLLMの接続を診断", exact: true }).click(); await expect(page.getByText(/ローカルLLM：接続と設定モデルの一覧掲載を確認しました/u)).toBeVisible();
  expect(metadataRequests).toEqual([{ method: "GET", url: "/v1/models", body: "" }]); await expect(editor).toHaveText("診断へ送らない秘密の本文");
  await expect(page.getByRole("checkbox", { name: /サブスクと別料金のAPI利用・診断を許可/u })).not.toBeChecked(); await expect(page.getByRole("button", { name: "OpenAIの接続を診断", exact: true })).toBeDisabled();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByLabel("AI実行環境")).toContainText("ローカルLLM：diagnostic-fixture");
  await page.getByRole("button", { name: "AI接続の設定・診断", exact: true }).click(); await expect(primary).toHaveValue("local"); await expect(page.getByRole("textbox", { name: "ローカルLLMの接続URL", exact: true })).toHaveValue(localUrl);
  expect(metadataRequests).toHaveLength(1);
});
