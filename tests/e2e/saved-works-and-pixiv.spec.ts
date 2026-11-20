import { expect, test } from "@playwright/test";
import { manuscriptEditor, selectParagraphText } from "./ai-edit-helpers";

test("moves a saved, non-open work to the trash after confirmation and keeps the open manuscript", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("最初の作品の本文"); await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "新規作品", exact: true }).click();
  await expect(editor).toBeEditable(); await editor.fill("開いている作品の本文");
  await page.getByRole("button", { name: "作品を管理", exact: true }).click();
  const list = page.getByRole("region", { name: "保存済みの作品" }).getByRole("listitem");
  await expect(list).toHaveCount(2);
  const other = list.filter({ hasNotText: "開いています" });
  await page.getByRole("button", { name: "ごみ箱・削除の復元" }).click();
  const trash = page.getByRole("region", { name: "ごみ箱" });
  await expect(trash.getByText("ごみ箱は空です。")).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await other.getByRole("button", { name: /ごみ箱へ移す$/u }).click(); await expect(list).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await other.getByRole("button", { name: /ごみ箱へ移す$/u }).click();
  await expect(page.getByText("作品をごみ箱へ移しました。ごみ箱から復元できます。")).toBeVisible();
  await expect(list).toHaveCount(1); await expect(editor).toHaveText("開いている作品の本文");
  await expect(page.getByRole("tablist", { name: "開いている作品" }).getByRole("tab")).toHaveCount(1);
  await expect(trash.getByRole("listitem")).toHaveCount(1);
});

test("exports pixiv ruby only after confirmation and refuses unsupported emphasis", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前葵後"); await selectParagraphText(page, "葵");
  await page.getByRole("button", { name: "組版と投稿用出力", exact: true }).click(); await page.getByText("ルビ・傍点", { exact: true }).click();
  await page.getByRole("button", { name: "選択範囲の注釈を準備" }).click(); await page.getByRole("textbox", { name: "ルビの読み" }).fill("あおい");
  await page.getByRole("button", { name: "注釈を採用" }).click(); await expect(editor.locator("[data-novel-ruby]")).toHaveText("葵");
  await page.getByText("投稿用テキストを書き出す", { exact: true }).click();
  await page.getByRole("combobox", { name: "投稿先の記法" }).selectOption("pixiv");
  await page.getByRole("button", { name: "投稿用出力を確認" }).click();
  await expect(page.locator("pre")).toHaveText("前[[rb:葵 > あおい]]後");
  await expect(editor).toHaveText("前葵後");
});
