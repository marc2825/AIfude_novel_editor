import { expect, test } from "@playwright/test";
import { manuscriptEditor, openAiCommand } from "./ai-edit-helpers";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";

test("persists characters, rules and presets, then references only the explicit choice", async ({ page }) => {
  const requests: AiEditRequest[] = [];
  await page.route("**/api/ai/edits", async (route) => { const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("request"); requests.push(parsed.data); await route.continue(); });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("葵は青い空を見る。");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByText("人物と台詞の口調（0）", { exact: true }).click(); await page.getByRole("button", { name: "人物を追加" }).click();
  await page.locator("summary").filter({ hasText: /^新しい人物$/u }).click();
  await page.getByRole("textbox", { name: "名前", exact: true }).fill("葵"); await page.getByRole("textbox", { name: "一人称", exact: true }).fill("僕");
  await page.getByText("推敲プリセット（0）", { exact: true }).click(); await page.getByRole("button", { name: "プリセットを追加" }).click();
  await page.getByRole("textbox", { name: "プリセット名" }).fill("葵の口調"); await page.getByRole("textbox", { name: "保存する推敲指示" }).fill("僕という一人称を保ち、静かな語りに整える。");
  await page.getByRole("button", { name: "人物・文体・ルールを保存", exact: true }).click(); await expect(page.getByText(/人物・文体・ルールを保存しました/u)).toBeVisible();
  await page.reload(); await expect(editor).toHaveText("葵は青い空を見る。");
  const dialog = await openAiCommand(page, "葵は青い空を見る。");
  await dialog.getByLabel("保存した推敲プリセット").selectOption({ label: "葵の口調" });
  await expect(dialog.getByRole("textbox", { name: "編集の指示" })).toHaveValue("僕という一人称を保ち、静かな語りに整える。");
  await dialog.getByText("人物・文体・作品資料の参照", { exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "今回だけ人物・資料を参照する" })).not.toBeChecked();
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByText(/件の候補を受信/u)).toBeVisible();
  expect(requests[0]?.storyMemory).toBeUndefined(); await expect(editor).toHaveText("葵は青い空を見る。");
  await dialog.getByRole("button", { name: "指示・送信設定を変更" }).click();
  await dialog.getByRole("checkbox", { name: "今回だけ人物・資料を参照する" }).check();
  await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "人物：葵（口調・呼称・例文）" }).check();
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByText(/件の候補を受信/u)).toBeVisible();
  expect(requests[1]?.storyMemory?.characterNotes).toContain('"firstPerson":"僕"'); await expect(editor).toHaveText("葵は青い空を見る。");
});

test("reviews individual changes and keyboard Accept uses the chosen partial candidate with Undo/Redo", async ({ page }) => {
  await page.route("**/api/ai/edits", async (route) => {
    const parsed = validateAiEditRequest(route.request().postDataJSON()); if (!parsed.success) throw new Error("request");
    const response = createAiEditSuccessResponseFixture(parsed.data);
    await route.fulfill({ json: { ...response, candidates: response.candidates.map((candidate) => ({ ...candidate, replacementText: candidate.index === 0 ? "空は赤い。風は強い。" : "空は紅い。風は激しい。" })) } });
  });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable(); await editor.fill("前空は青い。風は弱い。後");
  const dialog = await openAiCommand(page, "空は青い。風は弱い。");
  await dialog.getByRole("button", { name: "生成", exact: true }).click(); await expect(dialog.getByText(/件の候補を受信/u)).toBeVisible();
  await dialog.getByText("差分を選んで部分採用", { exact: true }).click(); await dialog.getByRole("checkbox", { name: "採用する差分を自分で選ぶ" }).check();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /差分 2/u }).check(); await expect(editor).toHaveText("前空は青い。風は弱い。後");
  await page.keyboard.press("Control+Enter"); await expect(editor).toHaveText("前空は青い。風は強い。後");
  await editor.focus(); await page.keyboard.press("Control+z"); await expect(editor).toHaveText("前空は青い。風は弱い。後");
  await page.keyboard.press("Control+Shift+z"); await expect(editor).toHaveText("前空は青い。風は強い。後");
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible(); await page.reload(); await expect(editor).toHaveText("前空は青い。風は強い。後");
});
