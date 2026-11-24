import { afterEach, describe, expect, it } from "vitest";
import { undoDepth } from "@tiptap/pm/history";
import { hasAiTarget, showAiTarget } from "../../src/features/editor/extensions/ai-target";
import { getEditGuardState } from "../../src/features/editor/plugins/edit-guard";
import { captureSelection, validateSelectionSnapshot, type SelectionCaptureContext } from "../../src/features/editor/selection";
import { createTestEditor, setTextSelection } from "../helpers/editor";

const context: SelectionCaptureContext = { chapterId: "chapter", documentId: "document", projectId: "project", contextRevision: 0, commonPrompt: "", manualStyle: "", editable: true };
const editors: ReturnType<typeof createTestEditor>[] = [];
function setup(text = "前🙂対象の文。\n後ろ") { const value = createTestEditor(text); editors.push(value); return value; }
afterEach(() => editors.splice(0).forEach((value) => value.destroy()));

describe("AI target marker", () => {
  it("marks the exact range as a view decoration without touching text, selection, revisions or history", () => {
    const { editor, getPlainText } = setup(); const text = getPlainText();
    setTextSelection(editor, 4, 9);
    const capture = captureSelection(editor, context); if (capture.status !== "captured") throw new Error("capture");
    const before = { json: JSON.stringify(editor.state.doc.toJSON()), guard: getEditGuardState(editor.state), selection: editor.state.selection };
    showAiTarget(editor, { from: capture.snapshot.from, to: capture.snapshot.to });
    expect(editor.view.dom.querySelector(".ai-target")?.textContent).toBe("対象の文。");
    expect(hasAiTarget(editor)).toBe(true);
    expect(getPlainText()).toBe(text); expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before.json);
    expect(getEditGuardState(editor.state)).toBe(before.guard); expect(editor.state.selection.eq(before.selection)).toBe(true);
    expect(undoDepth(editor.state)).toBe(0);
    // The marker must not make the captured selection stale.
    expect(validateSelectionSnapshot(editor, capture.snapshot, context).status).toBe("valid");
    showAiTarget(editor, null);
    expect(editor.view.dom.querySelector(".ai-target")).toBeNull(); expect(hasAiTarget(editor)).toBe(false);
    expect(getEditGuardState(editor.state)).toBe(before.guard); expect(undoDepth(editor.state)).toBe(0);
  });

  it("shows a caret marker for an insertion point and keeps the paragraph text intact", () => {
    const { editor, getPlainText } = setup("前後"); const text = getPlainText();
    showAiTarget(editor, { from: 2, to: 2 });
    const marker = editor.view.dom.querySelector(".ai-target-caret");
    expect(marker).not.toBeNull(); expect(marker?.getAttribute("aria-hidden")).toBe("true");
    expect(getPlainText()).toBe(text); expect(editor.state.doc.textContent).toBe("前後"); expect(undoDepth(editor.state)).toBe(0);
  });

  it("drops the marker when the document changes instead of moving it onto other text", () => {
    const { editor } = setup("前対象後");
    showAiTarget(editor, { from: 2, to: 4 });
    editor.view.dispatch(editor.state.tr.insertText("追加", 1));
    expect(hasAiTarget(editor)).toBe(false); expect(editor.view.dom.querySelector(".ai-target")).toBeNull();
  });

  it("ignores ranges outside the document and a destroyed editor", () => {
    const { editor, destroy } = setup("短い");
    const guard = getEditGuardState(editor.state);
    showAiTarget(editor, { from: 3, to: 99 }); showAiTarget(editor, { from: 4, to: 2 }); showAiTarget(editor, { from: -1, to: 1 });
    expect(hasAiTarget(editor)).toBe(false); expect(getEditGuardState(editor.state)).toBe(guard);
    destroy(); editors.length = 0;
    expect(() => showAiTarget(editor, { from: 1, to: 2 })).not.toThrow();
  });
});
