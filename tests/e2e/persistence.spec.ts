import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("autosaves manuscript text and restores it after reload", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "小説本文" });
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();

  await editor.fill("保存される本文\n\n末尾");
  await expect(page.getByText("未保存")).toBeVisible();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();

  await page.reload();

  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await expect(editor.locator("p")).toHaveText([
    "保存される本文",
    "",
    "末尾",
  ]);
});

test("holds one editing lock and allows a later session after release", async ({
  context,
  page,
}) => {
  let secondPageAiRequests = 0;
  await page.goto("/");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();

  const secondPage = await context.newPage();
  await secondPage.route("**/api/ai/edits", async (route) => {
    secondPageAiRequests += 1;
    await route.abort();
  });
  await secondPage.goto("/");
  await expect(
    secondPage.getByText("他のタブが編集中のため読み取り専用"),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("textbox", { name: "小説本文" }),
  ).toHaveAttribute("contenteditable", "false");
  await secondPage
    .getByRole("textbox", { name: "小説本文" })
    .press("Control+k");
  await expect(
    secondPage.getByRole("dialog", { name: "AI編集コマンド" }),
  ).toHaveCount(0);
  expect(secondPageAiRequests).toBe(0);

  await page.close();
  await expect
    .poll(async () =>
      secondPage.evaluate(async () => {
        const snapshot = await navigator.locks.query();
        return snapshot.held?.length ?? 0;
      }),
    )
    .toBe(0);

  await secondPage.reload();
  await expect(secondPage.getByText("保存済み", { exact: true })).toBeVisible();
  await expect(
    secondPage.getByRole("textbox", { name: "小説本文" }),
  ).toHaveAttribute("contenteditable", "true");
});

test("exports the current manuscript as a canonical JSON backup", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByLabel(/作品名/u).fill("E2E作品");
  await page.getByLabel(/共通プロンプト/u).fill("固有名詞を保つ");
  await page.getByLabel(/手動文体設定/u).fill("簡潔に書く");
  await page
    .getByRole("button", { name: "設定を保存", exact: true })
    .click();
  await expect(page.getByText("設定を保存しました。")).toBeVisible();

  await page.reload();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await expect(page.getByLabel(/作品名/u)).toHaveValue(
    "E2E作品",
  );
  await expect(page.getByLabel(/共通プロンプト/u)).toHaveValue(
    "固有名詞を保つ",
  );
  await expect(page.getByLabel(/手動文体設定/u)).toHaveValue(
    "簡潔に書く",
  );
  await page
    .getByRole("textbox", { name: "小説本文" })
    .fill("書き出す本文\n\n末尾");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONバックアップを書き出す" })
    .click();
  const download = await downloadPromise;
  const path = await download.path();

  expect(download.suggestedFilename()).toBe("E2E作品-backup.json");
  expect(path).not.toBeNull();

  if (path === null) {
    throw new Error("Expected a local backup download path");
  }

  const snapshot = JSON.parse(await readFile(path, "utf8")) as {
    chapter: { body: unknown };
    schemaVersion: number;
  };
  expect(snapshot.schemaVersion).toBe(6);
  expect(snapshot.chapter.body).toEqual({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "書き出す本文" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "末尾" }] },
    ],
  });
});
