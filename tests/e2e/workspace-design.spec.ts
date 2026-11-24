import { expect, test } from "@playwright/test";
import { manuscriptEditor, placeCaret, selectParagraphText } from "./ai-edit-helpers";
import { WRITING_TOOL_GROUPS, WRITING_TOOLS } from "../../src/features/ai-edit/writing-tools";

test("keeps one quiet rail, offers the tools inside the AI panel, and never sends or edits by choosing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  let requests = 0;
  page.on("request", (request) => { if (/\/api\/ai\/(edits|comparisons|dictionary)/u.test(request.url())) requests++; });
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable();
  await editor.fill("本文はツールの選択だけでは変更しません。");
  // Every auxiliary panel has one entry, in one rail. No tool list is shown while writing.
  const rail = page.getByRole("navigation", { name: "執筆の補助", exact: true });
  await expect(rail.getByRole("button")).toHaveCount(8);
  await expect(page.getByRole("radio")).toHaveCount(0);
  for (const button of await rail.getByRole("button").all()) {
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44); expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(await button.locator("span").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
  }
  // The tools appear after the target is chosen: revising tools for text, writing tools for a caret.
  await selectParagraphText(page, "本文");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  const revise = WRITING_TOOLS.filter((tool) => tool.group !== "write");
  for (const tool of revise) {
    const radio = dialog.getByRole("radio", { name: tool.label, exact: true });
    const chip = radio.locator("..");
    expect(await chip.evaluate((element) => parseFloat(getComputedStyle(element.querySelector("span") ?? element).fontSize))).toBeGreaterThanOrEqual(14);
    const bounds = await chip.boundingBox();
    // Sub-pixel layout can report 35.99…px for a 2.25rem chip.
    expect(Math.round(bounds?.height ?? 0)).toBeGreaterThanOrEqual(36); expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  await expect(dialog.getByRole("radio")).toHaveCount(revise.length + 2); // plus the two candidate-count radios
  await dialog.getByRole("radio", { name: "書き直し", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "文体変換", exact: true })).toBeChecked();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  // placeCaret waits until the collapsed selection reaches ProseMirror before the shortcut.
  await placeCaret(page, "本文はツールの選択だけでは変更しません。".length); await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "AI文章挿入" })).toBeVisible();
  const write = WRITING_TOOLS.filter((tool) => tool.group === "write");
  for (const tool of write) await expect(page.getByRole("dialog").getByRole("radio", { name: tool.label, exact: true })).toHaveCount(1);
  expect(WRITING_TOOL_GROUPS.map((group) => group.id)).toEqual(["revise", "write", "lookup"]);
  await page.keyboard.press("Escape");
  // The AI panel sits in the margin column and leaves the manuscript uncovered.
  await selectParagraphText(page, "本文"); await page.keyboard.press("Control+k");
  const panelBox = await dialog.boundingBox(); const editorBox = await editor.boundingBox();
  if (!panelBox || !editorBox) throw new Error("Missing layout boxes");
  expect(panelBox.x).toBeGreaterThanOrEqual(editorBox.x + editorBox.width);
  await expect(editor.locator(".ai-target")).toHaveText("本文");
  await page.keyboard.press("Escape"); await expect(editor.locator(".ai-target")).toHaveCount(0);
  await rail.getByRole("button", { name: "作品メモリ", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "サイドパネルを閉じる" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(rail.getByRole("button", { name: "作品メモリ", exact: true })).toBeFocused();
  await expect(editor).toHaveText("本文はツールの選択だけでは変更しません。");
  expect(requests).toBe(0);
});

test("keeps the manuscript prominent and preserves hidden panel drafts and the editor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  const editor = manuscriptEditor(page);
  await expect(editor).toBeEditable();
  await editor.fill("雨の匂いが、窓の隙間から流れ込んでいた。\n「まだ、帰らないの」\n彼女は答えず、遠くの灯りを見つめていた。");
  const bounds = await editor.boundingBox();
  // One top bar and one slim toolbar above the text; the line stays near 40 characters.
  expect(bounds?.y).toBeLessThan(120); expect(bounds?.width).toBeGreaterThan(700); expect(bounds?.width).toBeLessThanOrEqual(800);
  await expect(page.getByRole("complementary", { name: "執筆サイドパネル" })).toBeHidden();
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await page.getByRole("textbox", { name: /^登場人物メモ/u }).fill("葵：言葉にするまで少し時間がかかる。");
  await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  await page.getByRole("textbox", { name: /^作品名/u }).fill("雨のあとに");
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).click();
  await expect(page.getByRole("button", { name: "設定とバックアップ", exact: true })).toBeFocused();
  await editor.focus(); await page.keyboard.press("Control+s");
  await expect(page.getByText("本文と作品メモリを保存しました。", { exact: true })).toBeVisible();
  await expect(editor).toContainText("彼女は答えず");
  await page.reload(); await expect(editor).toContainText("彼女は答えず");
  await page.getByRole("button", { name: "作品メモリ", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^登場人物メモ/u })).toHaveValue("葵：言葉にするまで少し時間がかかる。");
  await page.screenshot({ path: "/tmp/novel-editor-workspace.png" });
});

test("opens suggestions from a real right click and compares before one-step adoption and Undo", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  let requests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/ai/edits")) requests++; });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("前。彼女は遠くの灯りを見つめていた。後。");
  const target = "彼女は遠くの灯りを見つめていた。";
  await selectParagraphText(page, target);
  const point = await page.evaluate(() => {
    const box = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    if (!box) throw new Error("No selection");
    return { x: box.left + 8, y: box.top + box.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "選択した文章の操作" });
  await expect(menu).toBeVisible(); expect(requests).toBe(0);
  await menu.getByRole("menuitem", { name: /AI提案/u }).click();
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await expect(dialog.getByRole("textbox", { name: "編集の指示" })).toBeFocused();
  await expect(dialog.getByRole("region", { name: "推敲する原文" })).toContainText(target);
  await dialog.getByRole("button", { name: "文のリズム", exact: true }).click();
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("tablist", { name: "編集候補" })).toBeVisible();
  // Candidates start with the diff in view; the original is not repeated above it.
  await expect(dialog.getByRole("region", { name: "候補 1 の原文との差分" })).toBeInViewport();
  await expect(dialog.getByRole("region", { name: "推敲する原文" })).toHaveCount(0);
  await expect(editor).toHaveText(`前。${target}後。`);
  await dialog.getByRole("tab", { name: "候補 2", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "候補 2 の原文との差分" })).toBeVisible();
  await page.screenshot({ path: "/tmp/novel-editor-suggestions.png" });
  await dialog.getByRole("button", { name: "採用", exact: true }).click();
  await expect(editor).toHaveText(`前。${target}【デモ候補2】後。`);
  await page.keyboard.press("Control+z"); await expect(editor).toHaveText(`前。${target}後。`);
  await page.keyboard.press("Control+y"); await expect(editor).toHaveText(`前。${target}【デモ候補2】後。`);
  expect(requests).toBe(1);
});

test("keyboard context menu dismisses without altering selection and closes on a new selection", async ({ page }) => {
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("前対象後"); await selectParagraphText(page, "対象");
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: /AI提案/u })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(editor).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("region", { name: "推敲する原文" })).toContainText("対象");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+F10"); await expect(page.getByRole("menu")).toBeVisible();
  await editor.click(); await expect(page.getByRole("menu")).toBeHidden();
  await expect(editor).toHaveText("前対象後");
});

test("keeps the popup inside a narrow viewport after candidates arrive", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto("/"); const editor = manuscriptEditor(page); await expect(editor).toBeEditable();
  await editor.fill("前対象後"); await selectParagraphText(page, "対象"); await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await dialog.getByRole("button", { name: "自然に", exact: true }).click();
  await dialog.getByRole("button", { name: "生成", exact: true }).click();
  await expect(dialog.getByRole("tablist", { name: "編集候補" })).toBeVisible();
  await expect.poll(async () => {
    const box = await dialog.boundingBox(); return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= 640 && box.y + box.height <= 720;
  }).toBe(true);
  await dialog.getByRole("button", { name: "却下", exact: true }).click();
  await expect(editor).toHaveText("前対象後");
});
