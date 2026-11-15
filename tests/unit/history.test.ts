import { history, redoDepth, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";

import { replaceCapturedSelection } from "../../src/features/editor/replace-selection";
import {
  captureSelection,
  type SelectionCaptureContext,
} from "../../src/features/editor/selection";
import {
  createTestEditor,
  dispatchComposition,
  dispatchKey,
  setCursor,
  setTextSelection,
} from "../helpers/editor";

const replacementContext: SelectionCaptureContext = {
  chapterId: "chapter",
  commonPrompt: "",
  contextRevision: 0,
  documentId: "document",
  editable: true,
  manualStyle: "",
  projectId: "project",
};

const activeEditors: ReturnType<typeof createTestEditor>[] = [];

function testEditor(initialText = "") {
  const editor = createTestEditor(initialText);
  activeEditors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of activeEditors.splice(0)) {
    editor.destroy();
  }
});

describe("plain-text history", () => {
  it("registers exactly one history plugin", () => {
    const { editor } = testEditor();
    const historyKey = history().spec.key;
    const historyPlugins = editor.state.plugins.filter(
      (plugin) => plugin.spec.key === historyKey,
    );

    expect(historyPlugins).toHaveLength(1);
  });

  it("undoes and redoes normal typing with a sane caret", () => {
    const { editor, getPlainText } = testEditor("前後");
    setCursor(editor, 0, 1);

    editor.view.dispatch(editor.state.tr.insertText("中"));

    expect(getPlainText()).toBe("前中後");
    expect(editor.state.selection.from).toBe(3);
    expect(undoDepth(editor.state)).toBe(1);

    const undoEvent = dispatchKey(editor.view.dom, "z", {
      ctrlKey: true,
      keyCode: 90,
    });

    expect(undoEvent.defaultPrevented).toBe(true);
    expect(getPlainText()).toBe("前後");
    expect(editor.state.selection.from).toBe(2);
    expect(redoDepth(editor.state)).toBe(1);

    dispatchKey(editor.view.dom, "z", {
      ctrlKey: true,
      keyCode: 90,
      shiftKey: true,
    });

    expect(getPlainText()).toBe("前中後");
    expect(editor.state.selection.from).toBe(3);

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    dispatchKey(editor.view.dom, "y", { ctrlKey: true, keyCode: 89 });

    expect(getPlainText()).toBe("前中後");
  });

  it("keeps normal operations in a predictable undo order", () => {
    const { editor, getPlainText } = testEditor();

    editor.view.dispatch(editor.state.tr.insertText("甲").setTime(1_000));
    editor.view.dispatch(editor.state.tr.insertText("乙").setTime(2_000));

    expect(getPlainText()).toBe("甲乙");

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe("甲");

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe("");

    dispatchKey(editor.view.dom, "z", {
      ctrlKey: true,
      keyCode: 90,
      shiftKey: true,
    });
    expect(getPlainText()).toBe("甲");

    dispatchKey(editor.view.dom, "z", {
      ctrlKey: true,
      keyCode: 90,
      shiftKey: true,
    });
    expect(getPlainText()).toBe("甲乙");
  });

  it("undoes and redoes deletion of a paragraph boundary", () => {
    const { editor, getPlainText } = testEditor("前\n後");
    setCursor(editor, 1, 0);

    dispatchKey(editor.view.dom, "Backspace", { keyCode: 8 });
    expect(getPlainText()).toBe("前後");

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe("前\n後");

    dispatchKey(editor.view.dom, "y", { ctrlKey: true, keyCode: 89 });
    expect(getPlainText()).toBe("前後");
  });

  it("isolates typing before and after an AI-style replacement", () => {
    const { editor, getPlainText } = testEditor("対象");
    editor.view.dispatch(editor.state.tr.insertText("前", 1).setTime(1_000));
    setTextSelection(editor, 2, 4);
    const capture = captureSelection(editor, replacementContext);

    if (capture.status !== "captured") {
      throw new Error(`selection was not captured: ${capture.reason}`);
    }

    expect(
      replaceCapturedSelection(
        editor,
        capture.snapshot,
        "置換",
        replacementContext,
      ),
    ).toMatchObject({ status: "applied" });
    editor.view.dispatch(editor.state.tr.insertText("後").setTime(1_001));
    expect(getPlainText()).toBe("前置換後");
    expect(undoDepth(editor.state)).toBe(3);

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe("前置換");

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe("前対象");

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe("対象");

    dispatchKey(editor.view.dom, "y", { ctrlKey: true, keyCode: 89 });
    expect(getPlainText()).toBe("前対象");

    dispatchKey(editor.view.dom, "y", { ctrlKey: true, keyCode: 89 });
    expect(getPlainText()).toBe("前置換");

    dispatchKey(editor.view.dom, "y", { ctrlKey: true, keyCode: 89 });
    expect(getPlainText()).toBe("前置換後");
  });
});

describe("paragraph input", () => {
  it.each([
    {
      label: "a non-empty paragraph",
      text: "前後",
      paragraph: 0,
      offset: 1,
      expected: "前\n後",
    },
    {
      label: "the beginning",
      text: "本文",
      paragraph: 0,
      offset: 0,
      expected: "\n本文",
    },
    {
      label: "the end",
      text: "本文",
      paragraph: 0,
      offset: 2,
      expected: "本文\n",
    },
    {
      label: "an empty paragraph",
      text: "",
      paragraph: 0,
      offset: 0,
      expected: "\n",
    },
    {
      label: "surrounding paragraphs",
      text: "前段\n対象\n後段",
      paragraph: 1,
      offset: 1,
      expected: "前段\n対\n象\n後段",
    },
    {
      label: "Japanese text and an emoji",
      text: "あ🙂い",
      paragraph: 0,
      offset: 3,
      expected: "あ🙂\nい",
    },
  ])("Enter splits $label", ({ text, paragraph, offset, expected }) => {
    const { editor, getPlainText } = testEditor(text);
    setCursor(editor, paragraph, offset);

    const enterEvent = dispatchKey(editor.view.dom, "Enter", { keyCode: 13 });

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(getPlainText()).toBe(expected);

    dispatchKey(editor.view.dom, "z", { ctrlKey: true, keyCode: 90 });
    expect(getPlainText()).toBe(text);

    dispatchKey(editor.view.dom, "y", { ctrlKey: true, keyCode: 89 });
    expect(getPlainText()).toBe(expected);
  });

  it("Shift+Enter performs the same paragraph split as Enter", () => {
    const { editor, getPlainText } = testEditor("前後");
    setCursor(editor, 0, 1);

    dispatchKey(editor.view.dom, "Enter", {
      keyCode: 13,
      shiftKey: true,
    });

    expect(getPlainText()).toBe("前\n後");
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([
      "doc",
      "paragraph",
      "text",
    ]);
  });
});

describe("composition-safe keyboard handling", () => {
  it("does not split or undo during composition and handles Enter afterward", () => {
    const { editor, getPlainText } = testEditor("本文");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    setCursor(editor, 0, 2);
    editor.view.dispatch(editor.state.tr.insertText("追記"));
    expect(getPlainText()).toBe("本文追記");

    dispatchComposition(editor.view.dom, "compositionstart", "に");
    expect(editor.view.composing).toBe(true);

    dispatchComposition(editor.view.dom, "compositionupdate", "日本");
    const enterDuringComposition = dispatchKey(editor.view.dom, "Enter", {
      isComposing: true,
      keyCode: 13,
    });
    const undoDuringComposition = dispatchKey(editor.view.dom, "z", {
      ctrlKey: true,
      isComposing: true,
      keyCode: 90,
    });

    expect(enterDuringComposition.defaultPrevented).toBe(false);
    expect(undoDuringComposition.defaultPrevented).toBe(false);
    expect(getPlainText()).toBe("本文追記");
    expect(editor.state.doc.childCount).toBe(1);

    dispatchComposition(editor.view.dom, "compositionend", "日本");
    expect(editor.view.composing).toBe(false);

    // ProseMirror intentionally ignores Safari's keydown immediately after
    // compositionend because that event may still be the IME confirmation.
    now.mockReturnValue(1_501);
    const enterAfterComposition = dispatchKey(editor.view.dom, "Enter", {
      keyCode: 13,
    });

    expect(enterAfterComposition.defaultPrevented).toBe(true);
    expect(getPlainText()).toBe("本文追記\n");
  });

  it("leaves keyCode 229 to the browser without changing the document", () => {
    const { editor, getPlainText } = testEditor("変換中");
    setCursor(editor, 0, 3);

    const event = dispatchKey(editor.view.dom, "Enter", { keyCode: 229 });

    expect(event.defaultPrevented).toBe(false);
    expect(getPlainText()).toBe("変換中");
    expect(editor.state.doc.childCount).toBe(1);
  });
});
