import { expect, type Page } from "@playwright/test";
import { manuscriptEditor } from "../e2e/ai-edit-helpers";
export async function prepareOffline(page: Page, baseURL: string) {
  await page.goto(baseURL);
  await expect(manuscriptEditor(page)).toBeEditable();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("button", { name: "オフライン利用を準備", exact: true }).click();
  await expect(page.getByText("オフライン利用の準備ができました。", { exact: true })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).click();
}
export async function saveText(page: Page, text: string) {
  await manuscriptEditor(page).fill(text);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
}
