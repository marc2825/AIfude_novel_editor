import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { manuscriptEditor, openAiCommand, placeCaret } from "./ai-edit-helpers";
import { z } from "zod";
import { aiComparisonRequestSchema } from "../../src/domain/ai-comparison";

let fail = false; let calls = 0;
const server = createServer((request, response) => {
  let body = ""; request.setEncoding("utf8"); request.on("data", (chunk: string) => { body += chunk; });
  request.on("end", () => {
    calls += 1;
    if (fail) { response.writeHead(503).end(); return; }
    const parsed = z.object({ messages: z.array(z.object({ content: z.string() })).min(1) }).parse(JSON.parse(body) as unknown);
    const count = z.object({ candidateCount: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).parse(JSON.parse(parsed.messages.at(-1)?.content ?? "") as unknown).candidateCount;
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ candidates:
      Array.from({ length: count }, (_, index) => ({ replacementText: `雨粒が窓を伝った。${index + 1}`, explanation: "比較用の回答", riskNotes: [] })) }) } }] }));
  });
});
test.beforeAll(async () => { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(3180, "127.0.0.1", resolve); }); });
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
test.beforeEach(() => { fail = false; calls = 0; });

for (const operation of ["insert", "replace"] as const) {
  test(`compares simultaneous provider outputs and adopts only the chosen ${operation} candidate`, async ({ page }) => {
    await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後");
    const dialog = operation === "replace" ? await openAiCommand(page, "対象", "雨の描写") : await (async () => {
      await placeCaret(page, 1); await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "AI文章挿入" }); await dialog.getByRole("textbox", { name: "文章のプロンプト" }).fill("雨の描写"); return dialog;
    })();
    await dialog.getByRole("checkbox", { name: /ローカルデモ/u }).check();
    await dialog.getByRole("checkbox", { name: /ローカルLLM/u }).check();
    await expect(dialog.getByRole("button", { name: "2個のAIへ同時送信" })).toBeDisabled(); expect(calls).toBe(0);
    await dialog.getByRole("checkbox", { name: "選択したAIすべてへの送信と各利用枠の消費に同意します" }).check();
    await dialog.getByRole("button", { name: "2個のAIへ同時送信" }).click();
    await expect(dialog.getByLabel("AI出力の並列比較")).toBeVisible(); await expect(editor).toHaveText("前対象後");
    await dialog.getByRole("article", { name: "localの候補1", exact: true }).getByRole("button", { name: "この候補のDiffを確認" }).click();
    await expect(dialog.getByRole("tabpanel").getByLabel("候補本文")).toHaveText("雨粒が窓を伝った。1");
    await dialog.getByRole("button", { name: "採用", exact: true }).click();
    const result = operation === "insert" ? "前雨粒が窓を伝った。1対象後" : "前雨粒が窓を伝った。1後";
    await expect(editor).toHaveText(result); await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前対象後");
    await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText(result); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    await page.reload(); await expect(editor).toHaveText(result); expect(calls).toBe(1);
  });
}

test("retains successful candidates after one AI fails and keeps the manuscript unchanged", async ({ page }) => {
  fail = true; await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後");
  const dialog = await openAiCommand(page, "対象");
  await dialog.getByRole("checkbox", { name: /ローカルデモ/u }).check(); await dialog.getByRole("checkbox", { name: /ローカルLLM/u }).check();
  await dialog.getByRole("checkbox", { name: "選択したAIすべてへの送信と各利用枠の消費に同意します" }).check();
  await dialog.getByRole("button", { name: "2個のAIへ同時送信" }).click();
  await expect(dialog.getByText("2件の候補を受信しました。")).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("local："); await expect(editor).toHaveText("前対象後"); expect(calls).toBe(1);
});

test("uses the expansion tool for both providers in a simultaneous comparison", async ({ page }) => {
  let preset: unknown;
  await page.route("**/api/ai/comparisons", async (route) => {
    preset = aiComparisonRequestSchema.parse(route.request().postDataJSON()).request.presetId;
    await route.continue();
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後");
  await page.getByRole("radio", { name: "膨らませる（Expand）", exact: true }).check();
  const dialog = await openAiCommand(page, "対象", "原文の描写を詳しくしてください。");
  await dialog.getByRole("checkbox", { name: /ローカルデモ/u }).check();
  await dialog.getByRole("checkbox", { name: /ローカルLLM/u }).check();
  await dialog.getByRole("checkbox", { name: "選択したAIすべてへの送信と各利用枠の消費に同意します" }).check();
  await dialog.getByRole("button", { name: "2個のAIへ同時送信" }).click();
  await expect(dialog.getByLabel("AI出力の並列比較")).toBeVisible();
  await expect(dialog.getByRole("article", { name: "mockの候補1", exact: true })).toBeVisible();
  await expect(dialog.getByRole("article", { name: "localの候補1", exact: true })).toBeVisible();
  expect(preset).toBe("expand"); expect(calls).toBe(1);
  await expect(editor).toHaveText("前対象後");
});

test("compares three providers including the Claude CLI adapter and adopts its output", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後");
  const dialog = await openAiCommand(page, "対象");
  for (const name of [/ローカルデモ/u, /ローカルLLM/u, /Claudeサブスク/u]) await dialog.getByRole("checkbox", { name }).check();
  await dialog.getByRole("checkbox", { name: "選択したAIすべてへの送信と各利用枠の消費に同意します" }).check();
  await dialog.getByRole("button", { name: "3個のAIへ同時送信" }).click();
  const candidate = dialog.getByRole("article", { name: "claudeの候補1", exact: true }); await expect(candidate).toBeVisible();
  await candidate.getByRole("button", { name: "この候補のDiffを確認" }).click(); await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("button", { name: "採用", exact: true }).click(); await expect(editor).toHaveText("前Claudeの比較候補1後");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前対象後"); expect(calls).toBe(1);
});

test("compares contextual insertions with selected memory and adopts only the chosen output", async ({ page }) => {
  let memory: unknown; let sent: unknown;
  await page.route("**/api/ai/comparisons", async (route) => {
    const request = aiComparisonRequestSchema.parse(route.request().postDataJSON()).request;
    memory = request.storyMemory; sent = request; await route.continue();
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByRole("textbox", { name: /^設定メモ/u }).fill("魔法はない"); await page.getByRole("button", { name: "メモリを保存", exact: true }).click();
  await expect(page.getByText("作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "文脈で挿入（Context Insert）", exact: true }).check();
  await placeCaret(page, 1); await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI文脈挿入" });
  await dialog.getByRole("textbox", { name: "書きたい内容", exact: true }).fill("雨の描写");
  await dialog.getByRole("checkbox", { name: "保存済み作品メモリを参照する" }).check();
  await dialog.getByRole("checkbox", { name: /ローカルデモ/u }).check(); await dialog.getByRole("checkbox", { name: /ローカルLLM/u }).check();
  await dialog.getByRole("checkbox", { name: "選択したAIすべてへの送信と各利用枠の消費に同意します" }).check();
  await dialog.getByRole("button", { name: "2個のAIへ同時送信" }).click(); await expect(dialog.getByLabel("AI出力の並列比較")).toBeVisible();
  expect(memory).toEqual({ settingNotes: "魔法はない", backgroundNotes: "", characterNotes: "" });
  expect(sent).toMatchObject({ operation: "context-insert", instruction: "雨の描写", beforeText: "前", afterText: "対象後", selectionText: "" });
  await expect(editor).toHaveText("前対象後"); expect(calls).toBe(1);
  await dialog.getByRole("article", { name: "localの候補1", exact: true }).getByRole("button", { name: "この候補のDiffを確認" }).click();
  await dialog.getByRole("button", { name: "採用", exact: true }).click();
  await expect(editor).toHaveText("前雨粒が窓を伝った。1対象後");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前対象後");
});
