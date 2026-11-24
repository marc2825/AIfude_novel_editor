import { expect, test } from "@playwright/test";
import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { chooseAiTool, manuscriptEditor, selectParagraphText } from "./ai-edit-helpers";

const tools = [
  { label: "書き直し", title: "書き直し", preset: "polish", intent: "polish" },
  { label: "文体変換", title: "文体変換", preset: "transform", intent: "transform" },
  { label: "膨らませる", title: "膨らませる", preset: "expand", intent: "expand" },
  { label: "短くする", title: "短くする", preset: "shorten", intent: "shorten" },
  { label: "自由指示", title: "自由指示", preset: "freeform", intent: "freeform" },
] as const;

for (const tool of tools) {
  test(`${tool.title}: opens from the right-click menu, picks the tool in the panel and previews before Accept and one-step Undo`, async ({ page }) => {
    await page.goto("/");
    const editor = manuscriptEditor(page);
    await expect(editor).toBeEditable();
    await editor.fill("前。雨が降っていた。後。");
    const requests: AiEditRequest[] = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/api/ai/edits")) return;
      const parsed = validateAiEditRequest(request.postDataJSON());
      if (!parsed.success) throw new Error("Invalid edit request");
      requests.push(parsed.data);
    });
    await selectParagraphText(page, "雨が降っていた。");
    const point = await page.evaluate(() => {
      const box = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
      if (!box) throw new Error("Missing selection");
      return { x: box.left + 5, y: box.top + box.height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByRole("menuitem", { name: /AI提案/u }).click();
    const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
    // A new session starts with the default tool; the tool is chosen after the selection, inside the panel.
    await expect(dialog.getByRole("radio", { name: tools[0].label, exact: true })).toBeChecked();
    await chooseAiTool(page, tool.label);
    // Choosing a tool never sends or edits.
    expect(requests).toHaveLength(0);
    await expect(editor).toHaveText("前。雨が降っていた。後。");
    if (tool.preset === "polish") await dialog.getByRole("button", { name: "自然に", exact: true }).click();
    if (tool.preset === "transform") {
      await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
      await dialog.getByRole("textbox", { name: "雰囲気・概念", exact: true }).fill("幻想的で静かな余韻");
      await dialog.getByRole("combobox", { name: "変換の強さ", exact: true }).selectOption("強め");
    }
    if (tool.preset === "freeform") {
      await expect(dialog.getByRole("button", { name: "生成", exact: true })).toBeDisabled();
      await dialog.getByRole("textbox", { name: "編集の指示", exact: true }).fill("敬体で、余韻を残して");
    }
    // Additional instructions must not silently turn Expand/Condense into similar-length custom intent.
    if (tool.preset === "expand" || tool.preset === "shorten") {
      const instruction = dialog.getByRole("textbox", { name: "編集の指示", exact: true });
      await instruction.fill(`${await instruction.inputValue()}\n雨という言葉は残してください。`);
    }
    expect(requests).toHaveLength(0);
    const response = page.waitForResponse((response) => response.url().endsWith("/api/ai/edits"));
    await dialog.getByRole("button", { name: "生成", exact: true }).click();
    const payload: unknown = await (await response).json();
    expect(payload).toMatchObject({ intent: { kind: tool.intent } });
    await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.presetId).toBe(tool.preset);
    if (tool.preset === "transform") expect(requests[0]?.instruction).toContain("変換の強さ：強め");
    await expect(editor).toHaveText("前。雨が降っていた。後。");
    await dialog.getByRole("button", { name: "採用", exact: true }).click();
    await expect(editor).toHaveText("前。雨が降っていた。【デモ候補1】後。");
    await page.keyboard.press("Control+z");
    await expect(editor).toHaveText("前。雨が降っていた。後。");
    await page.keyboard.press("Control+y");
    await expect(editor).toHaveText("前。雨が降っていた。【デモ候補1】後。");
    await page.reload();
    await expect(editor).toHaveText("前。雨が降っていた。【デモ候補1】後。");
    // The remembered tool is not persisted across reloads.
    await selectParagraphText(page, "雨が降っていた。"); await page.keyboard.press("Control+k");
    await expect(dialog.getByRole("radio", { name: tools[0].label, exact: true })).toBeChecked();
  });
}

test("arrow keys choose a tool, switching dismisses old candidates, and changed text makes expansion stale", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto("/");
  const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("前。雨が降っていた。後。");
  let requests = 0; page.on("request", (request) => { if (request.url().endsWith("/api/ai/edits")) requests += 1; });
  await selectParagraphText(page, "雨が降っていた。");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  // Native radios: arrow keys move and select, and focus stays in the picker between steps.
  await dialog.getByRole("radio", { name: "書き直し", exact: true }).focus();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "膨らませる", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "膨らませる", exact: true })).toBeFocused();
  expect(requests).toBe(0);
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "指示・送信設定を変更", exact: true }).click();
  await chooseAiTool(page, "短くする");
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("前。雨が降っていた。後。");
  await chooseAiTool(page, "膨らませる");
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "本文へ", exact: true }).click();
  await editor.fill("書き足した本文");
  await page.getByRole("button", { name: "AI画面に戻る" }).click();
  await expect(dialog.getByText(/この編集コマンドは期限切れです/u)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);
  await expect(editor).toHaveText("書き足した本文");
});
