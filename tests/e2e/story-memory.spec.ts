import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { manuscriptEditor, openAiCommand, placeCaret, openWorkspacePanel } from "./ai-edit-helpers";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

const memory = { settingNotes: "この世界には魔法がない。", backgroundNotes: "海辺の町。百年前に港が作られた。", characterNotes: "葵：慎重。\n<script>人物メモ</script>" };
async function saveMemory(page: Page) {
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByRole("textbox", { name: /^設定メモ/u }).fill(memory.settingNotes);
  await page.getByRole("textbox", { name: /^背景メモ/u }).fill(memory.backgroundNotes);
  await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill(memory.characterNotes);
  await page.getByRole("button", { name: "メモリを保存", exact: true }).click();
  await expect(page.getByText("作品メモリを保存しました。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
}

test("saves memory, reloads it and restores it through a JSON backup without altering manuscript", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後");
  await saveMemory(page); await expect(editor).toHaveText("前対象後"); await page.reload(); await expect(editor).toHaveText("前対象後");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^登場人物メモ/u })).toHaveValue(memory.characterNotes);
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  const pendingDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "JSONバックアップを書き出す" }).click();
  const download = await pendingDownload; const path = await download.path(); if (!path) throw new Error("Missing backup");
  const snapshot = parseWorkspaceSnapshot(JSON.parse(await readFile(path, "utf8")) as unknown);
  expect(snapshot.schemaVersion).toBe(6); expect(snapshot.project.storyMemory).toEqual(memory);
  expect(JSON.stringify(snapshot)).not.toContain("useStoryMemory");
  await openWorkspacePanel(page, "作品メモリ");
  await page.getByRole("textbox", { name: /^設定メモ/u }).fill("変更したメモ"); await page.getByRole("button", { name: "メモリを保存", exact: true }).click();
  await expect(page.getByText("作品メモリを保存しました。", { exact: true })).toBeVisible();
  await openWorkspacePanel(page, "設定とバックアップ");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("JSONバックアップを取り込む", { exact: false }).setInputFiles(path);
  // Successful import remounts the settings and memory panels with the editor.
  await expect(page.getByRole("textbox", { name: /^設定メモ/u })).toBeHidden();
  await expect(editor).toHaveText("前対象後");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^設定メモ/u })).toHaveValue(memory.settingNotes);
  await expect(page.getByRole("textbox", { name: /^背景メモ/u })).toHaveValue(memory.backgroundNotes);
  await expect(page.getByRole("textbox", { name: /^登場人物メモ/u })).toHaveValue(memory.characterNotes);
});

for (const operation of ["replace", "insert"] as const) {
  test(`keeps memory OFF by default, sends it on opt-in, and applies only after Accept: ${operation}`, async ({ page }) => {
    const requests: AiEditRequest[] = [];
    await page.route("**/api/ai/edits", async (route) => {
      const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
      requests.push(parsed.data); await route.continue();
    });
    await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後"); await saveMemory(page);
    async function open() {
      if (operation === "replace") return openAiCommand(page, "対象");
      await placeCaret(page, 1); await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "AI文章挿入" }); await dialog.getByRole("textbox", { name: "文章のプロンプト" }).fill("町の風景を書いて"); return dialog;
    }
    let dialog = await open(); const toggleName = "保存済み作品メモリを参照する";
    await expect(dialog.getByRole("checkbox", { name: toggleName })).not.toBeChecked();
    await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByText(/件の候補を受信しました/u)).toBeVisible();
    expect(requests[0]).not.toHaveProperty("storyMemory"); await expect(editor).toHaveText("前対象後");
    await dialog.getByRole("button", { name: "指示・送信設定を変更" }).click();
    await dialog.getByRole("checkbox", { name: toggleName }).check(); await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
    await dialog.getByText("送信するメモを確認", { exact: true }).click();
    await expect(dialog.getByText(memory.characterNotes, { exact: true })).toBeVisible(); expect(await dialog.locator("script").count()).toBe(0);
    await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByText(/件の候補を受信しました/u)).toBeVisible();
    expect(requests[1]?.storyMemory).toEqual(memory); await expect(editor).toHaveText("前対象後");
    await dialog.getByRole("button", { name: "採用", exact: true }).click(); const applied = await editor.innerText(); expect(applied).toContain("【デモ候補1】");
    await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前対象後");
    await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText(applied);
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    dialog = await open(); await expect(dialog.getByRole("checkbox", { name: toggleName })).not.toBeChecked();
  });
}

test("stales a pending request on memory save and preserves editing when the late response arrives", async ({ page }) => {
  const started = createDeferred<void>(); const release = createDeferred<void>();
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("Invalid request");
    started.resolve(); await release.promise; await route.fulfill({ json: createAiEditSuccessResponseFixture(parsed.data) });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前対象後"); await saveMemory(page);
  const dialog = await openAiCommand(page, "対象"); await dialog.getByRole("checkbox", { name: "保存済み作品メモリを参照する" }).check();
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await started.promise;
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill("変更後の人物メモ"); await page.getByRole("button", { name: "メモリを保存", exact: true }).click();
  await expect(dialog.getByText(/AI参照設定が変更されたため/u)).toBeVisible(); release.resolve();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0); await expect(editor).toHaveText("前対象後");
  await dialog.getByRole("button", { name: "期限切れのコマンドを閉じる" }).click(); await editor.fill("書き続ける本文"); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
});
