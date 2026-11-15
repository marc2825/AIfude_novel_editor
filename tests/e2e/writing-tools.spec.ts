import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { manuscriptEditor, placeCaret, openWorkspacePanel } from "./ai-edit-helpers";

async function save(page: Page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
}
async function nameChapter(page: Page, title: string, outline = "") {
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("textbox", { name: "章タイトル", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "章のアウトライン", exact: true }).fill(outline);
  await page.getByRole("button", { name: "章の設定を保存", exact: true }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
}

test("manages chapter outlines and order, counts the whole work and persists a writing goal", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("一😀\n二");
  await nameChapter(page, "旅立ち", "町を出る\n仲間と会う");
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("button", { name: "章を追加", exact: true }).click(); await expect(editor).toHaveText("");
  await editor.fill("再会"); await nameChapter(page, "再会の章", "二人が合流する");
  await expect(page.getByLabel("文字数と執筆進捗")).toContainText("現在の章：2文字 ／ 作品全体：5文字");
  page.once("dialog", (dialog) => dialog.accept("10")); await page.getByRole("button", { name: "目標文字数を設定", exact: true }).click();
  await expect(page.getByLabel("文字数と執筆進捗")).toContainText("50%");
  await page.getByRole("button", { name: "再会の章を上へ", exact: true }).click(); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("再会");
  await openWorkspacePanel(page, "章とアウトライン");
  await expect(page.getByRole("textbox", { name: "章のアウトライン", exact: true })).toHaveValue("二人が合流する");
  const chapters = page.getByRole("region", { name: "章とアウトライン", exact: true }).locator("ol > li");
  await expect(chapters.nth(0)).toContainText("再会の章"); await expect(chapters.nth(1)).toContainText("旅立ち");
  await page.getByRole("button", { name: "旅立ち", exact: true }).click(); await expect(editor).toHaveText("一😀二");
  page.once("dialog", (dialog) => dialog.dismiss()); await page.getByRole("button", { name: "現在の章を削除", exact: true }).click(); await expect(editor).toHaveText("一😀二");
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "現在の章を削除", exact: true }).click(); await expect(editor).toHaveText("再会");
  await expect(page.getByRole("button", { name: "現在の章を削除", exact: true })).toBeDisabled();
});

test("preserves live Undo and caret through file/chapter switches and restores caret and closed tabs on reload", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("第一作品"); await save(page); await placeCaret(page, 2);
  await page.getByRole("button", { name: "新規作品", exact: true }).click(); await expect(editor).toHaveText(""); await editor.fill("第二作品"); await save(page);
  const tabs = page.getByRole("tablist", { name: "開いている作品", exact: true }).getByRole("tab");
  await tabs.nth(0).click(); await expect(editor).toHaveText("第一作品"); await editor.focus();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset)).toBe(2);
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("button", { name: "章を追加", exact: true }).click(); await expect(editor).toHaveText("");
  await page.getByRole("button", { name: "第一章", exact: true }).click(); await expect(editor).toHaveText("第一作品");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("");
  await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText("第一作品"); await save(page); await placeCaret(page, 1);
  await page.getByRole("button", { name: "無題の作品のタブを閉じる", exact: true }).nth(1).click();
  await expect(tabs).toHaveCount(1); await page.reload(); await expect(editor).toHaveText("第一作品"); await expect(tabs).toHaveCount(1);
  await editor.focus(); await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset)).toBe(1);
});

test("confirms search replacement, rejects stale results, and isolates Undo/Redo", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("猫😀\n猫😀\n"); await save(page);
  await editor.focus(); await page.keyboard.press("Control+h");
  const search = page.getByRole("region", { name: "本文の検索と置換", exact: true });
  await search.getByRole("textbox", { name: "検索語", exact: true }).fill("猫😀"); await search.getByRole("button", { name: "検索", exact: true }).click();
  await search.getByRole("textbox", { name: "置換後の文章", exact: true }).fill("犬");
  page.once("dialog", (dialog) => dialog.dismiss()); await search.getByRole("button", { name: "確認してすべて置換", exact: true }).click(); await expect(editor).toHaveText("猫😀猫😀");
  page.once("dialog", (dialog) => dialog.accept()); await search.getByRole("button", { name: "確認してすべて置換", exact: true }).click(); await expect(editor).toHaveText("犬犬");
  expect(await editor.locator("p").allTextContents()).toEqual(["犬", "犬", ""]);
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("猫😀猫😀");
  await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText("犬犬");
  await search.getByRole("textbox", { name: "検索語", exact: true }).fill("犬"); await search.getByRole("button", { name: "検索", exact: true }).click();
  await editor.fill("変更後"); await expect(search.getByText("本文が変更されたため、再検索してください。", { exact: true })).toBeVisible();
  await expect(search.getByRole("button", { name: "確認してすべて置換", exact: true })).toBeDisabled();
});

test("restores manuscript and notes only after preview and confirmation, with the current version retained", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("初稿");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  const note = page.getByRole("textbox", { name: /^登場人物メモ/u }); await note.fill("初期の人物"); await save(page);
  await page.getByRole("button", { name: "保存履歴・復元", exact: true }).click();
  await page.getByRole("textbox", { name: "履歴の名前", exact: true }).fill("初稿の保存");
  await page.getByRole("button", { name: "現在の状態を履歴に保存", exact: true }).click(); await expect(page.getByRole("button", { name: /^初稿の保存/u })).toBeVisible();
  await editor.fill("改稿後"); await openWorkspacePanel(page, "作品メモリ"); await note.fill("変更した人物"); await save(page);
  await openWorkspacePanel(page, "保存履歴・復元");
  await page.getByRole("button", { name: /^初稿の保存/u }).click(); await expect(page.getByLabel("履歴の復元プレビュー", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss()); await page.getByRole("button", { name: "確認してこの履歴を復元", exact: true }).click(); await expect(editor).toHaveText("改稿後");
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "確認してこの履歴を復元", exact: true }).click(); await expect(editor).toHaveText("初稿");
  await expect(page.getByRole("button", { name: /^復元前の状態/u })).toBeVisible();
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click(); await expect(note).toHaveValue("初期の人物");
  await page.reload(); await expect(editor).toHaveText("初稿"); await page.getByRole("button", { name: "保存履歴・復元", exact: true }).click(); await expect(page.getByRole("button", { name: /^復元前の状態/u })).toBeVisible();
});

test("exports every work and restores copies with chapters and history, preserving the active manuscript", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await editor.fill("一章の本文"); await nameChapter(page, "一章", "始まり");
  await openWorkspacePanel(page, "章とアウトライン");
  await page.getByRole("button", { name: "章を追加", exact: true }).click(); await expect(editor).toHaveText(""); await editor.fill("二章の本文"); await nameChapter(page, "二章", "終わり");
  await page.getByRole("button", { name: "保存履歴・復元", exact: true }).click(); await page.getByRole("textbox", { name: "履歴の名前", exact: true }).fill("作品の履歴");
  await page.getByRole("button", { name: "現在の状態を履歴に保存", exact: true }).click(); await expect(page.getByRole("button", { name: /^作品の履歴/u })).toBeVisible();
  await page.getByRole("button", { name: "新規作品", exact: true }).click(); await expect(editor).toHaveText(""); await editor.fill("別作品"); await save(page);
  await openWorkspacePanel(page, "ファイルとバックアップ");
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "全作品を一括バックアップ", exact: true }).click(); const download = await pending;
  const path = await download.path(); if (!path) throw new Error("Missing backup"); const buffer = await readFile(path);
  const bundle = JSON.parse(buffer.toString()); expect(bundle.workspaces).toHaveLength(2); expect(bundle.history).toHaveLength(1);
  const input = page.getByLabel("一括バックアップファイル", { exact: true });
  page.once("dialog", (dialog) => dialog.dismiss()); await input.setInputFiles({ name: "library.json", mimeType: "application/json", buffer });
  await expect(page.getByText("復元を取り消しました。", { exact: true })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "開いている作品", exact: true }).getByRole("tab"); await expect(tabs).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept()); await input.setInputFiles({ name: "library.json", mimeType: "application/json", buffer });
  await expect(page.getByText("2作品をコピーとして復元しました。", { exact: true })).toBeVisible(); await expect(tabs).toHaveCount(4); await expect(editor).toHaveText("別作品");
  await page.reload(); await expect(tabs).toHaveCount(4); await expect(editor).toHaveText("別作品");
});
