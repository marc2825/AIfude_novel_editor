import { expect, type Locator, type Page } from "@playwright/test";

export function manuscriptEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "小説本文" });
}

/** Picks a tool inside the open AI panel. The radios are visually replaced by chips, so the click is forced. */
export async function chooseAiTool(page: Page, label: string): Promise<void> {
  const radio = page.getByRole("dialog").getByRole("radio", { name: label, exact: true });
  await radio.click({ force: true });
  await expect(radio).toBeChecked();
}

/** Tries a tool that may not fit the target; the panel then keeps its current tool. */
export async function tryAiTool(page: Page, label: string): Promise<void> {
  await page.getByRole("dialog").getByRole("radio", { name: label, exact: true }).click({ force: true });
}

/** Opens the AI panel for the current caret or selection and switches to the given tool. */
export async function openAiTool(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await chooseAiTool(page, label);
}

/** The work switcher in the top bar keeps the saved works and the file actions in a menu. */
export async function openWorkMenu(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /作品の切替と操作/u });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
}

export async function workMenuButton(page: Page, name: string): Promise<Locator> {
  await openWorkMenu(page);
  return page.getByRole("button", { name, exact: true });
}

/**
 * The saved works listed in the work menu. The menu stays in the DOM while it is closed, so
 * counts and titles can be checked without opening it; open it with openWorkMenu before clicking.
 */
export function savedWorkButtons(page: Page): Locator {
  return page.getByRole("list", { name: "作品を切り替える", includeHidden: true }).getByRole("button", { includeHidden: true });
}

export async function placeCaret(page: Page, offset: number): Promise<void> {
  const editor = manuscriptEditor(page);
  await editor.focus();
  await editor.evaluate((element, offset) => {
    const text = element.querySelector("p")?.firstChild;
    if (!(text instanceof Text)) throw new Error("Missing paragraph text");
    const range = document.createRange(); range.setStart(text, offset); range.collapse(true);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, offset);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset)).toBe(offset);
}

export async function selectParagraphText(
  page: Page,
  text: string,
  occurrence = 0,
): Promise<void> {
  const editor = manuscriptEditor(page);

  await editor.focus();
  await editor.evaluate(
    (element, selection) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let remaining = selection.occurrence;
      let node = walker.nextNode();

      while (node !== null) {
        if (node instanceof Text) {
          let offset = node.data.indexOf(selection.text);

          while (offset >= 0) {
            if (remaining === 0) {
              const range = document.createRange();
              range.setStart(node, offset);
              range.setEnd(node, offset + selection.text.length);
              const browserSelection = window.getSelection();
              browserSelection?.removeAllRanges();
              browserSelection?.addRange(range);
              document.dispatchEvent(new Event("selectionchange"));
              return;
            }

            remaining -= 1;
            offset = node.data.indexOf(selection.text, offset + 1);
          }
        }

        node = walker.nextNode();
      }

      throw new Error("selection target was not found");
    },
    { occurrence, text },
  );
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(text);
}

export async function selectAcrossParagraphs(
  page: Page,
  range: Readonly<{
    endOffset: number;
    endParagraph: number;
    startOffset: number;
    startParagraph: number;
  }>,
): Promise<void> {
  const editor = manuscriptEditor(page);

  await editor.focus();
  await editor.evaluate((element, selection) => {
    const paragraphs = element.querySelectorAll("p");
    const start = paragraphs[selection.startParagraph]?.firstChild;
    const end = paragraphs[selection.endParagraph]?.firstChild;

    if (!(start instanceof Text) || !(end instanceof Text)) {
      throw new Error("cross-paragraph selection endpoint was not found");
    }

    const domRange = document.createRange();
    domRange.setStart(start, selection.startOffset);
    domRange.setEnd(end, selection.endOffset);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(domRange);
    document.dispatchEvent(new Event("selectionchange"));
  }, range);
}

export async function openAiCommand(
  page: Page,
  selectionText: string,
  instruction = "自然に",
  occurrence = 0,
): Promise<Locator> {
  await selectParagraphText(page, selectionText, occurrence);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "AI編集コマンド" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "編集の指示" })
    .fill(instruction);
  return dialog;
}

export async function openWorkspacePanel(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole("button", { name, exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}
