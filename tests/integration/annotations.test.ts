import { Editor } from "@tiptap/core";
import { undo, redo, undoDepth } from "@tiptap/pm/history";
import { describe, expect, it } from "vitest";
import { applyAnnotation, hasAnnotationsInRange } from "../../src/features/editor/annotations";
import { captureSelection } from "../../src/features/editor/selection";
import { replaceCapturedSelection } from "../../src/features/editor/replace-selection";
import { applySearchReplacement, captureSearch } from "../../src/features/editor/search-replace";
import { createEditorOptions } from "../../src/features/editor/create-editor";
import { annotationProblems, manuscriptDocumentSchema, manuscriptPlainText } from "../../src/domain/typography";
import { createTestEditor, setTextSelection } from "../helpers/editor";

const context = { chapterId: "c", documentId: "d", projectId: "p", commonPrompt: "", manualStyle: "", editable: true, contextRevision: 0 };
function snapshot(editor: Editor) { const result = captureSelection(editor, context); if (result.status !== "captured") throw new Error("capture"); return result.snapshot; }
describe("annotation editor safety", () => {
  it("changes annotations without changing the text, preserving one Undo/Redo and structured reload", () => {
    const h = createTestEditor("前葵後\n\n🙂"); try {
      setTextSelection(h.editor, 2, 3); const captured = snapshot(h.editor);
      expect(applyAnnotation(h.editor, captured, context, "ruby", "あおい").ok).toBe(true); expect(h.getPlainText()).toBe("前葵後\n\n🙂"); expect(undoDepth(h.editor.state)).toBe(1);
      const body = manuscriptDocumentSchema.parse(h.editor.state.doc.toJSON());
      undo(h.editor.state, h.editor.view.dispatch); expect(hasAnnotationsInRange(h.editor.state.doc, 2, 3)).toBe(false);
      redo(h.editor.state, h.editor.view.dispatch); expect(h.editor.state.doc.toJSON()).toEqual(body);
      const restored = new Editor(createEditorOptions(body)); try { expect(restored.state.doc.toJSON()).toEqual(body); expect(manuscriptPlainText(body)).toBe(h.getPlainText()); } finally { restored.destroy(); }
    } finally { h.destroy(); }
  });
  it.each(["selection", "document", "context", "composition"] as const)("rejects unsafe annotation application: %s", (change) => {
    const h = createTestEditor("前葵後"); try {
      setTextSelection(h.editor, 2, 3); const captured = snapshot(h.editor);
      if (change === "selection") setTextSelection(h.editor, 1, 2);
      if (change === "document") h.editor.view.dispatch(h.editor.state.tr.insertText("加", 1));
      if (change === "composition") Object.defineProperty(h.editor.view, "composing", { configurable: true, value: true });
      const before = h.editor.state.doc.toJSON();
      expect(applyAnnotation(h.editor, captured, change === "context" ? { ...context, contextRevision: 1 } : context, "emphasis").ok).toBe(false); expect(h.editor.state.doc.toJSON()).toEqual(before);
    } finally { h.destroy(); }
  });
  it("blocks AI/search replacement of annotations, allows changes outside, and removes annotations explicitly", () => {
    const h = createTestEditor("前葵後"); h.editor.setOptions({ editorProps: { handleScrollToSelection: () => true } }); try {
      setTextSelection(h.editor, 2, 3); expect(applyAnnotation(h.editor, snapshot(h.editor), context, "ruby", "あおい").ok).toBe(true);
      const captured = snapshot(h.editor); const before = h.editor.state.doc.toJSON();
      expect(replaceCapturedSelection(h.editor, captured, "凪", context).status).toBe("unsafe-replacement");
      expect(() => applySearchReplacement(h.editor, captureSearch(h.editor, "葵", true), "凪", "all")).toThrow("注釈"); expect(h.editor.state.doc.toJSON()).toEqual(before);
      setTextSelection(h.editor, 1, 2); expect(replaceCapturedSelection(h.editor, snapshot(h.editor), "先", context).status).toBe("applied"); expect(hasAnnotationsInRange(h.editor.state.doc, 2, 3)).toBe(true);
      setTextSelection(h.editor, 2, 3); expect(applyAnnotation(h.editor, snapshot(h.editor), context, "remove").ok).toBe(true); expect(hasAnnotationsInRange(h.editor.state.doc, 2, 3)).toBe(false);
    } finally { h.destroy(); }
  });
  it("refuses split graphemes and multi-paragraph ruby ranges", () => {
    const h = createTestEditor("が\n葵"); try {
      setTextSelection(h.editor, 1, 2); expect(applyAnnotation(h.editor, snapshot(h.editor), context, "ruby", "か").ok).toBe(false);
      setTextSelection(h.editor, 1, 6); expect(applyAnnotation(h.editor, snapshot(h.editor), context, "ruby", "かあおい").ok).toBe(false);
    } finally { h.destroy(); }
  });
  it("retains reading metadata when native editing changes a ruby base and requires reconfirmation", () => {
    const h = createTestEditor("青空"); try {
      setTextSelection(h.editor, 1, 3); expect(applyAnnotation(h.editor, snapshot(h.editor), context, "ruby", "あおぞら").ok).toBe(true);
      h.editor.view.dispatch(h.editor.state.tr.insertText("い", 2));
      const body = manuscriptDocumentSchema.parse(h.editor.state.doc.toJSON());
      expect(manuscriptPlainText(body)).toBe("青い空"); expect(JSON.stringify(body)).toContain("あおぞら"); expect(annotationProblems(body)).toHaveLength(1);
    } finally { h.destroy(); }
  });
});
