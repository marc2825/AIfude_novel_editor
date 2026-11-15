import { undo } from "@tiptap/pm/history";
import {
  AllSelection,
  NodeSelection,
  TextSelection,
} from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import {
  captureSelection,
  plainTextOffsetToProseMirrorPosition,
  proseMirrorPositionToPlainTextOffset,
  validateSelectionSnapshot,
  type SelectionCaptureContext,
  type SelectionSnapshot,
} from "../../src/features/editor/selection";
import { getEditGuardState } from "../../src/features/editor/plugins/edit-guard";
import {
  createTestEditor,
  dispatchComposition,
  setTextSelection,
} from "../helpers/editor";

const context: SelectionCaptureContext = {
  chapterId: "chapter",
  commonPrompt: "余韻を保つ",
  contextRevision: 4,
  documentId: "document",
  editable: true,
  manualStyle: "静かな文体",
  projectId: "project",
};

function capturedSnapshot(
  result: ReturnType<typeof captureSelection>,
): SelectionSnapshot {
  if (result.status !== "captured") {
    throw new Error(`selection was not captured: ${result.reason}`);
  }

  return result.snapshot;
}

describe("selection position conversion", () => {
  it("maps PM positions and canonical UTF-16 offsets across blank paragraphs", () => {
    const testEditor = createTestEditor("A🙂\n\n日");
    const { doc } = testEditor.editor.state;

    expect(
      [1, 2, 3, 4, 6, 8, 9].map((position) =>
        proseMirrorPositionToPlainTextOffset(doc, position),
      ),
    ).toEqual([0, 1, null, 3, 4, 5, 6]);
    expect(
      [0, 1, 2, 3, 4, 5, 6].map((offset) =>
        plainTextOffsetToProseMirrorPosition(doc, offset),
      ),
    ).toEqual([1, 2, null, 4, 6, 8, 9]);

    testEditor.destroy();
  });
});

describe("selection capture", () => {
  it("captures an immutable single-paragraph selection without side effects", () => {
    const testEditor = createTestEditor("前  日本語🙂  後", 12);
    const { editor } = testEditor;
    setTextSelection(editor, 2, 10);
    const documentBefore = editor.state.doc;
    const selectionBefore = editor.state.selection;
    const guardBefore = getEditGuardState(editor.state);

    const snapshot = capturedSnapshot(captureSelection(editor, context));

    expect(snapshot).toMatchObject({
      afterText: " 後",
      beforeText: "前",
      from: 2,
      originalText: "  日本語🙂 ",
      plainTextFrom: 1,
      plainTextTo: 9,
      to: 10,
    });
    expect(snapshot.identity).toMatchObject({
      contentRevision: 12,
      contextRevision: 4,
      selectionRevision: 1,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.identity)).toBe(true);
    expect(editor.state.doc).toBe(documentBefore);
    expect(editor.state.selection).toBe(selectionBefore);
    expect(getEditGuardState(editor.state)).toBe(guardBefore);
    expect(undo(editor.state, editor.view.dispatch)).toBe(false);

    testEditor.destroy();
  });

  it("captures reverse multi-paragraph selections with blank paragraphs and LF", () => {
    const testEditor = createTestEditor("A🙂\n\n日本語");
    const { editor } = testEditor;
    setTextSelection(editor, 11, 2);

    const snapshot = capturedSnapshot(captureSelection(editor, context));

    expect(snapshot).toMatchObject({
      beforeText: "A",
      from: 2,
      originalText: "🙂\n\n日本語",
      plainTextFrom: 1,
      plainTextTo: 8,
      to: 11,
    });
    expect(snapshot.originalSelection).toBeInstanceOf(TextSelection);
    expect(snapshot.originalSelection.anchor).toBe(11);
    expect(snapshot.originalSelection.head).toBe(2);

    testEditor.destroy();
  });

  it("normalizes AllSelection to the first and last paragraph content", () => {
    const testEditor = createTestEditor("先頭\n\n末尾\n");
    const { editor } = testEditor;
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );

    const snapshot = capturedSnapshot(captureSelection(editor, context));

    expect(snapshot.from).toBe(1);
    expect(snapshot.to).toBe(editor.state.doc.content.size - 1);
    expect(snapshot.originalText).toBe("先頭\n\n末尾\n");
    expect(snapshot.originalSelection).toBeInstanceOf(AllSelection);

    testEditor.destroy();
  });

  it("rejects caret, blank, unsupported, and surrogate-splitting selections", () => {
    const caretEditor = createTestEditor("本文");
    expect(captureSelection(caretEditor.editor, context)).toEqual({
      reason: "empty-selection",
      status: "unavailable",
    });
    caretEditor.destroy();

    const blankEditor = createTestEditor(" \n　");
    blankEditor.editor.view.dispatch(
      blankEditor.editor.state.tr.setSelection(
        new AllSelection(blankEditor.editor.state.doc),
      ),
    );
    expect(captureSelection(blankEditor.editor, context)).toEqual({
      reason: "blank-selection",
      status: "unavailable",
    });
    blankEditor.destroy();

    const unsupportedEditor = createTestEditor("本文");
    unsupportedEditor.editor.view.dispatch(
      unsupportedEditor.editor.state.tr.setSelection(
        NodeSelection.create(unsupportedEditor.editor.state.doc, 0),
      ),
    );
    expect(captureSelection(unsupportedEditor.editor, context)).toEqual({
      reason: "unsupported-selection",
      status: "unavailable",
    });
    unsupportedEditor.destroy();

    const emojiEditor = createTestEditor("🙂本文");
    setTextSelection(emojiEditor.editor, 2, 3);
    expect(captureSelection(emojiEditor.editor, context)).toEqual({
      reason: "invalid-text-boundary",
      status: "unavailable",
    });
    emojiEditor.destroy();
  });

  it("rejects unavailable editor states", () => {
    expect(captureSelection(null, context)).toEqual({
      reason: "editor-not-ready",
      status: "unavailable",
    });

    const readOnly = createTestEditor("本文");
    setTextSelection(readOnly.editor, 1, 3);
    expect(
      captureSelection(readOnly.editor, { ...context, editable: false }),
    ).toEqual({
      reason: "editor-read-only",
      status: "unavailable",
    });
    readOnly.destroy();

    const destroyed = createTestEditor("本文");
    setTextSelection(destroyed.editor, 1, 3);
    destroyed.destroy();
    expect(captureSelection(destroyed.editor, context)).toEqual({
      reason: "editor-destroyed",
      status: "unavailable",
    });

    const composing = createTestEditor("本文");
    setTextSelection(composing.editor, 1, 3);
    const composingSnapshot = capturedSnapshot(
      captureSelection(composing.editor, context),
    );
    dispatchComposition(composing.editor.view.dom, "compositionstart", "ほ");
    expect(captureSelection(composing.editor, context)).toEqual({
      reason: "editor-composing",
      status: "unavailable",
    });
    expect(
      validateSelectionSnapshot(
        composing.editor,
        composingSnapshot,
        context,
      ),
    ).toEqual({ reason: "editor-composing", status: "unavailable" });
    dispatchComposition(composing.editor.view.dom, "compositionend", "本文");
    composing.destroy();
  });
});

describe("strict stale guard", () => {
  function setup() {
    const testEditor = createTestEditor("前 [対象] 後", 7);
    setTextSelection(testEditor.editor, 4, 6);
    const snapshot = capturedSnapshot(
      captureSelection(testEditor.editor, context),
    );

    return { ...testEditor, snapshot };
  }

  it("accepts an unchanged editor, selection, and context", () => {
    const session = setup();

    expect(
      validateSelectionSnapshot(session.editor, session.snapshot, context),
    ).toEqual({ status: "valid" });

    session.destroy();
  });

  it.each([
    ["inside", 4],
    ["before", 1],
    ["after", 10],
  ])("marks an edit %s the target stale", (_label, position) => {
    const session = setup();
    session.editor.view.dispatch(
      session.editor.state.tr.insertText("追", position),
    );

    expect(
      validateSelectionSnapshot(session.editor, session.snapshot, context),
    ).toEqual({ reason: "document-changed", status: "stale" });

    session.destroy();
  });

  it("remains stale after Undo restores identical visible text", () => {
    const session = setup();
    const originalDocument = session.editor.state.doc.toJSON();
    session.editor.view.dispatch(session.editor.state.tr.insertText("追", 4));
    expect(undo(session.editor.state, session.editor.view.dispatch)).toBe(true);
    expect(session.editor.state.doc.toJSON()).toEqual(originalDocument);

    expect(
      validateSelectionSnapshot(session.editor, session.snapshot, context),
    ).toEqual({ reason: "document-changed", status: "stale" });
    expect(getEditGuardState(session.editor.state)?.contentRevision).toBe(9);

    session.destroy();
  });

  it("invalidates a moved selection permanently but ignores an equal reset", () => {
    const unchanged = setup();
    unchanged.editor.view.dispatch(
      unchanged.editor.state.tr.setSelection(
        TextSelection.create(
          unchanged.editor.state.doc,
          unchanged.snapshot.originalSelection.anchor,
          unchanged.snapshot.originalSelection.head,
        ),
      ),
    );
    expect(
      validateSelectionSnapshot(
        unchanged.editor,
        unchanged.snapshot,
        context,
      ),
    ).toEqual({ status: "valid" });
    unchanged.destroy();

    const moved = setup();
    setTextSelection(moved.editor, 1);
    setTextSelection(
      moved.editor,
      moved.snapshot.originalSelection.anchor,
      moved.snapshot.originalSelection.head,
    );
    expect(moved.editor.state.selection.eq(moved.snapshot.originalSelection)).toBe(
      true,
    );
    expect(
      validateSelectionSnapshot(moved.editor, moved.snapshot, context),
    ).toEqual({ reason: "selection-changed", status: "stale" });

    moved.destroy();
  });

  it("invalidates context changes but not an unrelated title change", () => {
    const revision = setup();
    expect(
      validateSelectionSnapshot(revision.editor, revision.snapshot, {
        ...context,
        contextRevision: context.contextRevision + 1,
      }),
    ).toEqual({ reason: "context-changed", status: "stale" });
    revision.destroy();

    const commonPrompt = setup();
    expect(
      validateSelectionSnapshot(commonPrompt.editor, commonPrompt.snapshot, {
        ...context,
        commonPrompt: "変更後",
      }),
    ).toEqual({ reason: "context-changed", status: "stale" });
    commonPrompt.destroy();

    const manualStyle = setup();
    expect(
      validateSelectionSnapshot(manualStyle.editor, manualStyle.snapshot, {
        ...context,
        manualStyle: "変更後",
      }),
    ).toEqual({ reason: "context-changed", status: "stale" });
    manualStyle.destroy();

    const titleOnly = setup();
    expect(
      validateSelectionSnapshot(titleOnly.editor, titleOnly.snapshot, context),
    ).toEqual({ status: "valid" });
    titleOnly.destroy();
  });

  it("uses direct target checks even when revisions match", () => {
    const session = setup();
    const alteredSnapshot: SelectionSnapshot = {
      ...session.snapshot,
      originalText: "別の文字列",
    };

    expect(
      validateSelectionSnapshot(session.editor, alteredSnapshot, context),
    ).toEqual({ reason: "target-changed", status: "stale" });

    session.destroy();
  });

  it("invalidates workspace identity and edit ownership changes", () => {
    const workspace = setup();
    expect(
      validateSelectionSnapshot(workspace.editor, workspace.snapshot, {
        ...context,
        chapterId: "replacement-chapter",
      }),
    ).toEqual({ reason: "workspace-changed", status: "stale" });
    workspace.destroy();

    const readOnly = setup();
    expect(
      validateSelectionSnapshot(readOnly.editor, readOnly.snapshot, {
        ...context,
        editable: false,
      }),
    ).toEqual({ reason: "editor-read-only", status: "stale" });
    readOnly.destroy();
  });
});
