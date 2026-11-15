import { TextSelection } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEditorOptions,
  rejectRichOrFileDrop,
} from "../../src/features/editor/create-editor";
import {
  documentToPlainText,
  normalizeLineEndings,
  plainTextToDocument,
} from "../../src/features/editor/plain-text";
import { plainTextSchema } from "../../src/features/editor/extensions/plain-text-schema";
import {
  createDataTransfer,
  createTestEditor,
  dispatchPaste,
} from "../helpers/editor";

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

describe("plain-text schema", () => {
  it("contains only doc, paragraph, and text nodes with explicit novel annotations", () => {
    expect(Object.keys(plainTextSchema.nodes).sort()).toEqual([
      "doc",
      "paragraph",
      "text",
    ]);
    expect(Object.keys(plainTextSchema.marks).sort()).toEqual(["emphasis", "ruby"]);
    expect(plainTextSchema.nodes.doc.contentMatch.validEnd).toBe(false);
  });

  it.each([
    "",
    "一段落",
    "第一段落\n第二段落",
    "先頭\n\n末尾\n",
    "\n",
    "　空白を保つ  ",
    "日本語とemoji🙂\n𠮷野家",
  ])("round-trips canonical text: %j", (text) => {
    const document = plainTextToDocument(plainTextSchema, text);

    expect(documentToPlainText(document)).toBe(text);
  });

  it("normalizes CRLF and CR without trimming other characters", () => {
    const source = "  一\r\n二\r　\r\n";

    expect(normalizeLineEndings(source)).toBe("  一\n二\n　\n");
    expect(
      documentToPlainText(plainTextToDocument(plainTextSchema, source)),
    ).toBe("  一\n二\n　\n");
  });
});

describe("plain-text editor input boundaries", () => {
  it("accepts normal text input into the ProseMirror document", () => {
    const { editor, getPlainText } = testEditor();

    editor.view.dispatch(editor.state.tr.insertText("日本語🙂", 1));

    expect(getPlainText()).toBe("日本語🙂");
  });

  it("pastes HTML as normalized plain text without marks", () => {
    const { editor, getPlainText } = testEditor("前後");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    );

    dispatchPaste(editor.view.dom, {
      "text/html": "<strong>太字</strong><p><em>次</em></p>",
      "text/plain": "太字\r\n次",
    });

    expect(getPlainText()).toBe("前太字\n次後");
    editor.state.doc.descendants((node) => {
      expect(node.marks).toHaveLength(0);
    });
  });

  it("extracts plain text when a clipboard exposes only HTML", () => {
    const { editor, getPlainText } = testEditor();

    dispatchPaste(editor.view.dom, {
      "text/html": "<p><strong>第一</strong></p><p><em>第二</em></p>",
    });

    expect(getPlainText()).toBe("第一\n第二");
  });

  it("preserves leading, repeated, and trailing newlines on paste", () => {
    const { editor, getPlainText } = testEditor("前後");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    );

    dispatchPaste(editor.view.dom, { "text/plain": "\r\n中\r\n\r\n" });

    expect(getPlainText()).toBe("前\n中\n\n後");
  });

  it("consumes rich and file drops without changing the document", () => {
    const { editor, getPlainText } = testEditor("本文");
    const handleDrop = createEditorOptions("").editorProps?.handleDrop;
    const richTransfer = createDataTransfer({
      "text/html": "<strong>装飾</strong>",
      "text/plain": "装飾",
    });
    const fileTransfer = createDataTransfer({}, [
      new File(["image"], "cover.png", { type: "image/png" }),
    ]);

    expect(rejectRichOrFileDrop({ dataTransfer: richTransfer })).toBe(true);
    expect(rejectRichOrFileDrop({ dataTransfer: fileTransfer })).toBe(true);
    expect(
      handleDrop?.(
        editor.view,
        { dataTransfer: richTransfer } as DragEvent,
        Slice.empty,
        false,
      ),
    ).toBe(true);
    expect(
      handleDrop?.(
        editor.view,
        { dataTransfer: fileTransfer } as DragEvent,
        Slice.empty,
        false,
      ),
    ).toBe(true);
    expect(getPlainText()).toBe("本文");
  });
});
