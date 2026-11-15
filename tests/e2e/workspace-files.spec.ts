import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { manuscriptEditor, openAiCommand, openWorkspacePanel } from "./ai-edit-helpers";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

async function rename(page: Page, title: string) {
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("textbox", { name: /^作品名/u }).fill(title);
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(page.getByText("設定を保存しました。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
}

test("protects unsaved memory on a real reload and clears the warning after explicit save", async ({ page }) => {
  await page.goto("/"); await expect(manuscriptEditor(page)).toBeEditable();
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  const field = page.getByRole("textbox", { name: /^設定メモ/u }); await field.fill("保存前の設定");
  const pendingDialog = page.waitForEvent("dialog"); const reload = page.evaluate(() => window.location.reload());
  const dialog = await pendingDialog; expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss(); await reload;
  await expect(field).toHaveValue("保存前の設定");
  await page.keyboard.press("Control+s"); await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await expect(field).toHaveValue("保存前の設定");
});

test("keeps notes and manuscript when backup replacement is cancelled at the memory warning", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("現在の本文");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  const field = page.getByRole("textbox", { name: /^登場人物メモ/u }); await field.fill("未保存の人物");
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  const messages: string[] = [];
  page.on("dialog", async (dialog) => {
    messages.push(dialog.message());
    if (dialog.message().startsWith("保存していない作品メモリ")) await dialog.dismiss(); else await dialog.accept();
  });
  await page.getByLabel("JSONバックアップを取り込む").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createWorkspaceFixture())) });
  await expect(page.getByText("バックアップの取り込みを取り消しました。", { exact: true })).toBeVisible();
  expect(messages.some((message) => message.startsWith("保存していない作品メモリ"))).toBe(true);
  await openWorkspacePanel(page, "作品メモリ");
  await expect(field).toHaveValue("未保存の人物"); await expect(editor).toHaveText("現在の本文");
});

test("saves, switches, closes and reopens independent files and loads JSON or text into new tabs", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("第一作品🙂\n\n末尾"); await rename(page, "一作目");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill("一作目の主人公");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新規作品", exact: true }).click(); await expect(editor).toHaveText("");
  await editor.fill("第二作品"); await rename(page, "二作目");
  await page.getByRole("tab", { name: "一作目", exact: true }).click(); await expect(editor).toHaveText("第一作品🙂末尾");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^登場人物メモ/u })).toHaveValue("一作目の主人公");
  await page.getByRole("button", { name: "二作目のタブを閉じる", exact: true }).click(); await expect(page.getByRole("tab", { name: "二作目", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "一作目", exact: true })).toBeFocused();
  await page.getByRole("combobox", { name: "保存済み作品を開く", exact: true }).selectOption({ label: "二作目" }); await expect(editor).toHaveText("第二作品");
  await page.reload(); await expect(editor).toHaveText("第二作品"); await expect(page.getByRole("tab", { name: "一作目", exact: true })).toBeVisible();
  const pendingDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "JSONで保存", exact: true }).click();
  const download = await pendingDownload; const path = await download.path(); if (!path) throw new Error("Missing download");
  await page.getByLabel("作品ファイルを開く", { exact: true }).setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: await readFile(path) });
  await expect(page.getByRole("tablist", { name: "開いている作品" }).getByRole("tab")).toHaveCount(3);
  await expect(editor).toHaveText("第二作品");
  await page.getByLabel("作品ファイルを開く", { exact: true }).setInputFiles({ name: "読み込み.txt", mimeType: "text/plain", buffer: Buffer.from("先頭😀\r\n\r\n末尾\r\n") });
  await expect(page.getByRole("tab", { name: "読み込み", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveText("先頭😀末尾");
  expect(await editor.locator("p").allTextContents()).toEqual(["先頭😀", "", "末尾", ""]);
});

test("sends only the selected memory item and allows a budget that cannot fit all notes", async ({ page }) => {
  const requests: AiEditRequest[] = [];
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    requests.push(parsed.data); await route.continue();
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("前対象後");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  for (const label of ["設定メモ", "背景メモ", "登場人物メモ"]) await page.getByRole("textbox", { name: new RegExp(`^${label}`, "u") }).fill("🙂".repeat(2000));
  await page.getByRole("button", { name: "メモリを保存", exact: true }).click(); await expect(page.getByText("作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  const dialog = await openAiCommand(page, "対象"); await dialog.getByRole("checkbox", { name: "保存済み作品メモリを参照する", exact: true }).check();
  await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled(); expect(requests).toHaveLength(0);
  await dialog.getByRole("checkbox", { name: "設定メモを参照", exact: true }).uncheck();
  await dialog.getByRole("checkbox", { name: "背景メモを参照", exact: true }).uncheck();
  await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
  expect(requests[0]?.storyMemory).toEqual({ settingNotes: "", backgroundNotes: "", characterNotes: "🙂".repeat(2000) }); await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("button", { name: "指示・送信設定を変更" }).click();
  await dialog.getByRole("checkbox", { name: "登場人物メモを参照", exact: true }).uncheck();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0); await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
});

test("never applies a delayed AI result to a newly opened work", async ({ page }) => {
  const started = createDeferred<void>(); const release = createDeferred<void>();
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    started.resolve(); await release.promise; await route.fulfill({ json: createAiEditSuccessResponseFixture(parsed.data) }).catch(() => undefined);
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("前対象後");
  const dialog = await openAiCommand(page, "対象"); await dialog.getByRole("button", { name: "生成", exact: true }).click(); await started.promise;
  await page.getByRole("button", { name: "新規作品", exact: true }).click(); await expect(editor).toHaveText(""); release.resolve();
  await expect(page.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await editor.fill("新しい作品の本文"); await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible(); await page.reload(); await expect(editor).toHaveText("新しい作品の本文");
});
