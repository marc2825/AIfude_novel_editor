import { expect, test } from "@playwright/test";

test("supports paragraph keys and editor history", async ({ page }) => {
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "小説本文" });
  const paragraphs = editor.locator("p");
  await editor.click();

  await page.keyboard.press("Enter");
  await expect(paragraphs).toHaveCount(2);

  await page.keyboard.press("Control+z");
  await expect(paragraphs).toHaveCount(1);

  await page.keyboard.press("Control+Shift+z");
  await expect(paragraphs).toHaveCount(2);

  await page.keyboard.press("Control+z");
  await page.keyboard.press("Shift+Enter");
  await expect(paragraphs).toHaveCount(2);

  await page.keyboard.press("Control+z");
  await page.keyboard.insertText("日本語🙂");
  await expect(editor).toHaveText("日本語🙂");

  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("");

  await page.keyboard.press("Control+y");
  await expect(editor).toHaveText("日本語🙂");
});
