import { expect, test, type Page } from "@playwright/test";
import { manuscriptEditor, savedWorkButtons } from "./ai-edit-helpers";

const SECRET = "誰にも見せない秘密の本文";
const PASSWORD = "secret password 1";

async function storedText(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open("novel-ai-editor");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const stores = ["workspaces", "workspace-files", "workspace-history", "workspace-trash"].filter((name) => database.objectStoreNames.contains(name));
      const tx = database.transaction(stores, "readonly");
      const values: unknown[] = [];
      for (const name of stores) { const all = tx.objectStore(name).getAll(); all.onsuccess = () => { values.push(all.result); }; }
      tx.oncomplete = () => { database.close(); resolve(JSON.stringify(values)); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

async function makeSecret(page: Page) {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill(SECRET); await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  const section = page.getByRole("region", { name: "シークレット作品" });
  await section.getByRole("button", { name: "この作品をシークレットにする" }).click();
  await section.getByLabel("新しいパスワード（8文字以上）").fill(PASSWORD);
  await section.getByLabel("もう一度入力").fill(PASSWORD);
  await expect(section.getByRole("button", { name: "パスワードを設定して暗号化" })).toBeDisabled();
  await section.getByRole("checkbox", { name: /復元できないことを理解しました/u }).check();
  await section.getByRole("button", { name: "パスワードを設定して暗号化" }).click();
  await expect(section.getByText("この作品はシークレットです（暗号化して保存）。")).toBeVisible({ timeout: 15_000 });
  return { editor, section };
}

test("encrypts a secret work at rest, locks on reload and opens only with the password", async ({ page }) => {
  const { editor } = await makeSecret(page);
  expect(await storedText(page)).not.toContain(SECRET);
  await editor.focus(); await page.keyboard.press("End"); await page.keyboard.type("・追記");
  await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  expect(await storedText(page)).not.toContain("追記");

  await page.reload();
  const lock = page.getByRole("region", { name: "シークレット作品はロックされています" });
  await expect(lock).toBeVisible(); await expect(page.getByText(SECRET)).toHaveCount(0);
  await expect(savedWorkButtons(page)).toHaveText("シークレット作品");
  await lock.getByLabel("パスワード").fill("wrong password");
  await lock.getByRole("button", { name: "解錠", exact: true }).click();
  await expect(lock.getByRole("alert")).toHaveText("パスワードが違います。");
  await lock.getByLabel("パスワード").fill(PASSWORD);
  await lock.getByRole("button", { name: "解錠", exact: true }).click();
  await expect(manuscriptEditor(page)).toHaveText(`${SECRET}・追記`, { timeout: 15_000 });

  await page.getByRole("button", { name: "シークレット作品をロック" }).click();
  await expect(page.getByRole("region", { name: "シークレット作品はロックされています" })).toBeVisible();
  await expect(page.getByText(SECRET)).toHaveCount(0);
});

test("locks itself after ten idle minutes and turns secret storage off on request", async ({ page }) => {
  await page.clock.install();
  await makeSecret(page);
  await page.clock.fastForward("10:30");
  const lock = page.getByRole("region", { name: "シークレット作品はロックされています" });
  await expect(lock).toBeVisible();
  await lock.getByLabel("パスワード").fill(PASSWORD);
  await lock.getByRole("button", { name: "解錠", exact: true }).click();
  await expect(manuscriptEditor(page)).toHaveText(SECRET, { timeout: 15_000 });
  const settings = page.getByRole("button", { name: "設定とバックアップ", exact: true });
  if (await settings.getAttribute("aria-expanded") !== "true") await settings.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("region", { name: "シークレット作品" }).getByRole("button", { name: "シークレットを解除" }).click();
  await expect(page.getByText("この作品は通常の保存です。")).toBeVisible({ timeout: 15_000 });
  expect(await storedText(page)).toContain(SECRET);
  await page.reload(); await expect(manuscriptEditor(page)).toHaveText(SECRET);
});

test("saves unsaved memo drafts before locking so nothing typed is lost", async ({ page }) => {
  await makeSecret(page);
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByRole("textbox", { name: /^設定メモ/u }).fill("ロック前に書いた設定");
  await page.getByRole("button", { name: "シークレット作品をロック" }).click();
  const lock = page.getByRole("region", { name: "シークレット作品はロックされています" });
  await expect(lock).toBeVisible();
  expect(await storedText(page)).not.toContain("ロック前に書いた設定");
  await lock.getByLabel("パスワード").fill(PASSWORD);
  await lock.getByRole("button", { name: "解錠", exact: true }).click();
  await expect(manuscriptEditor(page)).toHaveText(SECRET, { timeout: 15_000 });
  const memory = page.getByRole("button", { name: "作品メモリ", exact: true });
  if (await memory.getAttribute("aria-expanded") !== "true") await memory.click();
  await expect(page.getByRole("textbox", { name: /^設定メモ/u })).toHaveValue("ロック前に書いた設定");
});
