import { afterEach, describe, expect, it } from "vitest";
import { undo, redo, undoDepth } from "@tiptap/pm/history";
import { analyzeJapanese } from "../../src/domain/japanese-diagnostics";
import { showDiagnostics, selectDiagnostic } from "../../src/features/feedback/diagnostic-anchors";
import { captureSearch } from "../../src/features/editor/search-replace";
import { captureSelection, type SelectionCaptureContext } from "../../src/features/editor/selection";
import { replaceCapturedSelection } from "../../src/features/editor/replace-selection";
import { createTestEditor, setTextSelection } from "../helpers/editor";

const context: SelectionCaptureContext = { chapterId: "chapter", documentId: "document", projectId: "project", contextRevision: 0, commonPrompt: "", manualStyle: "", editable: true };
const editors: ReturnType<typeof createTestEditor>[] = [];
function setup() {
  const value = createTestEditor("前🙂\n一番最初に会った。\n後"); editors.push(value);
  value.editor.setOptions({ editorProps: { handleScrollToSelection: () => true } });
  return value;
}
afterEach(() => editors.splice(0).forEach((value) => value.destroy()));
describe("diagnostic anchors and confirmed correction", () => {
  it("highlights without changing text/history and uses exact PM positions", () => {
    const { editor, getPlainText } = setup(); const text = getPlainText();
    const snapshot = captureSearch(editor, "", true); const issues = analyzeJapanese(text).issues;
    showDiagnostics(editor, snapshot, issues);
    expect(editor.view.dom.querySelector(".diagnostic-highlight")?.textContent).toBe("一番最初");
    expect(getPlainText()).toBe(text); expect(undoDepth(editor.state)).toBe(0);
    expect(selectDiagnostic(editor, snapshot, issues[0])).toBe(true);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("一番最初");
  });
  it("changes only the selected diagnostic on Accept, with a single Undo/Redo", () => {
    const { editor, getPlainText } = setup(); const original = getPlainText();
    const snapshot = captureSearch(editor, "", true); const issue = analyzeJapanese(original).issues[0];
    selectDiagnostic(editor, snapshot, issue);
    const capture = captureSelection(editor, context); if (capture.status !== "captured") throw new Error("capture");
    expect(replaceCapturedSelection(editor, capture.snapshot, "最初", context).status).toBe("applied");
    expect(getPlainText()).toBe("前🙂\n最初に会った。\n後"); expect(undoDepth(editor.state)).toBe(1);
    undo(editor.state, editor.view.dispatch); expect(getPlainText()).toBe(original);
    redo(editor.state, editor.view.dispatch); expect(getPlainText()).toContain("最初に会った");
  });
  it("drops decorations and refuses anchors even after editing and Undo restores identical text", () => {
    const { editor, getPlainText } = setup(); const snapshot = captureSearch(editor, "", true); const issues = analyzeJapanese(getPlainText()).issues;
    showDiagnostics(editor, snapshot, issues); editor.view.dispatch(editor.state.tr.insertText("追加", 1));
    expect(editor.view.dom.querySelector(".diagnostic-highlight")).toBeNull();
    undo(editor.state, editor.view.dispatch); expect(selectDiagnostic(editor, snapshot, issues[0])).toBe(false);
    expect(selectDiagnostic(setup().editor, snapshot, issues[0])).toBe(false);
  });
  it("rejects selection-stale correction and composing navigation", () => {
    const { editor, getPlainText } = setup(); const original = getPlainText(); const search = captureSearch(editor, "", true); const issue = analyzeJapanese(original).issues[0];
    selectDiagnostic(editor, search, issue); const capture = captureSelection(editor, context); if (capture.status !== "captured") throw new Error("capture");
    setTextSelection(editor, 1); expect(replaceCapturedSelection(editor, capture.snapshot, "最初", context).status).toBe("stale");
    Object.defineProperty(editor.view, "composing", { configurable: true, value: true });
    expect(selectDiagnostic(editor, search, issue)).toBe(false); expect(getPlainText()).toBe(original);
  });
});
