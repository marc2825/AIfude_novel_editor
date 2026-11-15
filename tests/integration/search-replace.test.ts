import { afterEach, describe, expect, it } from "vitest";
import { undo, redo, undoDepth } from "@tiptap/pm/history";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { applySearchReplacement, captureSearch, findSearchMatches, isSearchCurrent } from "../../src/features/editor/search-replace";

const editors: ReturnType<typeof createTestEditor>[] = [];
function setup(text: string) { const result = createTestEditor(text); editors.push(result); return result; }
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
describe("confirmed search replacement", () => {
  it("replaces literal metacharacters and Unicode across paragraphs with one Undo and Redo", () => {
    const { editor, getPlainText } = setup("前🙂.*\n\n🙂.*\n後");
    const search = captureSearch(editor, "🙂.*", true);
    expect(search.matches).toHaveLength(2);
    expect(applySearchReplacement(editor, search, "二\n行", "all")).toBe(true);
    expect(getPlainText()).toBe("前二\n行\n\n二\n行\n後"); expect(undoDepth(editor.state)).toBe(1);
    undo(editor.state, editor.view.dispatch); expect(getPlainText()).toBe("前🙂.*\n\n🙂.*\n後");
    redo(editor.state, editor.view.dispatch); expect(getPlainText()).toBe("前二\n行\n\n二\n行\n後");
  });
  it("matches paragraph separators, joins them and preserves a trailing empty paragraph", () => {
    const { editor, getPlainText } = setup("一\n\n二\n");
    expect(applySearchReplacement(editor, captureSearch(editor, "一\n\n二", true), "三", 0)).toBe(true);
    expect(getPlainText()).toBe("三\n"); undo(editor.state, editor.view.dispatch); expect(getPlainText()).toBe("一\n\n二\n");
  });
  it("allows a selection change but rejects changed-and-undone text and a different editor", () => {
    const { editor } = setup("対象対象"); const search = captureSearch(editor, "対象", true);
    setTextSelection(editor, 2); expect(isSearchCurrent(editor, search)).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText("追記", 1)); undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.eq(search.document)).toBe(true);
    expect(applySearchReplacement(editor, search, "新", "all")).toBe(false);
    expect(applySearchReplacement(setup("対象対象").editor, search, "新", "all")).toBe(false);
  });
  it("supports empty replacement, optional case folding and blocks read-only/composing editors", () => {
    const { editor, getPlainText } = setup("A😀 a😀");
    expect(findSearchMatches(editor.state.doc, "a😀", true)).toHaveLength(1);
    const search = captureSearch(editor, "a😀", false); expect(search.matches).toHaveLength(2);
    editor.setEditable(false); expect(applySearchReplacement(editor, search, "", "all")).toBe(false);
    editor.setEditable(true); Object.defineProperty(editor.view, "composing", { configurable: true, value: true });
    expect(applySearchReplacement(editor, search, "", "all")).toBe(false);
    Object.defineProperty(editor.view, "composing", { configurable: true, value: false });
    expect(applySearchReplacement(editor, search, "", "all")).toBe(true); expect(getPlainText()).toBe(" ");
  });
  it("bounds inputs and leaves text intact when validation fails", () => {
    const { editor, getPlainText } = setup("原文");
    expect(() => captureSearch(editor, "a".repeat(501), true)).toThrow();
    expect(() => captureSearch(editor, "\ud800", true)).toThrow();
    expect(() => applySearchReplacement(editor, captureSearch(editor, "原文", true), "a".repeat(3001), "all")).toThrow();
    expect(getPlainText()).toBe("原文");
  });
});
