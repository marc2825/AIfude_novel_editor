import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { chooseAiTool, manuscriptEditor, placeCaret, selectParagraphText } from "./ai-edit-helpers";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";

test("adds structured ruby, keeps Undo/Redo and reload, previews vertically and exports a lossless JSON backup", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前葵後"); await selectParagraphText(page, "葵");
  await page.getByRole("button", { name: "組版と投稿用出力", exact: true }).click(); await page.getByText("ルビ・傍点", { exact: true }).click();
  await page.getByRole("button", { name: "選択範囲の注釈を準備" }).click(); await page.getByRole("textbox", { name: "ルビの読み" }).fill("あおい");
  await expect(editor.locator("[data-novel-ruby]")).toHaveCount(0); await page.getByRole("button", { name: "注釈を採用" }).click();
  await expect(editor.locator("[data-novel-ruby]")).toHaveText("葵"); await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor.locator("[data-novel-ruby]")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z"); await expect(editor.locator("[data-novel-ruby]")).toHaveText("葵"); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("前葵後"); await expect(editor.locator("[data-novel-ruby]")).toHaveAttribute("data-novel-ruby", "あおい");
  await page.getByRole("button", { name: "組版と投稿用出力", exact: true }).click(); await page.getByText("縦書きプレビュー", { exact: true }).click(); await page.getByRole("checkbox", { name: "縦書きで読む" }).check();
  const preview = page.getByRole("region", { name: "原稿プレビュー（閲覧専用）" }); await expect(preview).toHaveCSS("writing-mode", "vertical-rl"); await expect(preview.locator("rt")).toHaveText("あおい"); await expect(editor).toHaveText("前葵後");
  await page.getByText("投稿用テキストを書き出す", { exact: true }).click(); await page.getByRole("button", { name: "投稿用出力を確認" }).click();
  const textDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "確認した投稿用txtを保存" }).click(); const textPath = await (await textDownload).path(); if (!textPath) throw new Error("text"); expect(await readFile(textPath, "utf8")).toBe("前｜葵《あおい》後");
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click(); const jsonDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "JSONバックアップを書き出す" }).click(); const path = await (await jsonDownload).path(); if (!path) throw new Error("json");
  const snapshot = parseWorkspaceSnapshot(JSON.parse(await readFile(path, "utf8"))); expect(snapshot.schemaVersion).toBe(6); expect(JSON.stringify(snapshot.chapter.body)).toContain('"reading":"あおい"');
  await editor.fill("復元前の仮本文"); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByLabel("JSONバックアップを取り込む", { exact: false }).setInputFiles(path); await expect(editor.locator("[data-novel-ruby]")).toHaveText("葵");
});

test("protects annotated targets from AI and confirms Japanese formatting before mutation", async ({ page }) => {
  let requests = 0; await page.route("**/api/ai/edits", async (route) => { requests++; await route.continue(); });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("葵は叫ぶ!?..."); await selectParagraphText(page, "葵");
  await page.getByRole("button", { name: "組版と投稿用出力", exact: true }).click(); await page.getByText("ルビ・傍点", { exact: true }).click();
  await page.getByRole("button", { name: "選択範囲の注釈を準備" }).click(); await page.getByRole("textbox", { name: "ルビの読み" }).fill("あおい"); await page.getByRole("button", { name: "注釈を採用" }).click();
  await selectParagraphText(page, "葵"); await page.keyboard.press("Control+k"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByText(/対象にルビ・傍点があります/u)).toBeVisible(); expect(requests).toBe(0);
  await selectParagraphText(page, "は叫ぶ!?..."); await page.getByText("日本語入力の補助", { exact: true }).click(); await page.getByRole("button", { name: "全角記号の候補を確認" }).click();
  await expect(editor).toHaveText("葵は叫ぶ!?..."); await page.getByRole("button", { name: "整形案を採用" }).click(); await expect(editor).toHaveText("葵は叫ぶ！？……"); await expect(editor.locator("[data-novel-ruby]")).toHaveText("葵");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("葵は叫ぶ!?..."); await expect(editor.locator("[data-novel-ruby]")).toHaveText("葵");
});

for (const [tool, label, briefLabel] of [["describe", "描写を足す", "描きたい対象・場面"], ["guided-write", "展開を指定", "次に起こしたいこと"]] as const) {
  test(`${tool}: compares two contextual candidates and inserts only after explicit acceptance`, async ({ page }) => {
    const requests: AiEditRequest[] = [];
    await page.route("**/api/ai/edits", async (route) => { const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("request"); requests.push(parsed.data); await route.continue(); });
    await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前。後。");
    await placeCaret(page, 2); await page.keyboard.press("Control+k"); await chooseAiTool(page, label);
    const dialog = page.getByRole("dialog", { name: "AI文脈挿入" }); await dialog.getByRole("textbox", { name: briefLabel }).fill("雨が窓を打つ音");
    await expect(dialog.getByRole("checkbox", { name: /追加事実/u })).not.toBeChecked(); await dialog.getByRole("button", { name: "条件を編集指示へ反映" }).click(); await dialog.getByRole("spinbutton", { name: "目標文字数" }).fill("120");
    expect(requests).toHaveLength(0); await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByRole("tab", { name: "候補 2", exact: true })).toBeVisible();
    expect(requests[0]).toMatchObject({ operation: "context-insert", candidateCount: 2, targetCharacters: 120, beforeText: "前。", afterText: "後。" }); expect(requests[0].instruction).toContain("追加しない");
    await expect(editor).toHaveText("前。後。"); await dialog.getByRole("tab", { name: "候補 2", exact: true }).click(); await dialog.getByRole("button", { name: "採用", exact: true }).click();
    await expect(editor).not.toHaveText("前。後。"); await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前。後。");
  });
}
