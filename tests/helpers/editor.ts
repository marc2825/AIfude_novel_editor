import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { createEditorOptions } from "../../src/features/editor/create-editor";
import { documentToPlainText } from "../../src/features/editor/plain-text";

export function createTestEditor(
  initialText = "",
  initialContentRevision = 0,
) {
  const element = document.createElement("div");
  document.body.append(element);

  const editor = new Editor({
    ...createEditorOptions(initialText, initialContentRevision),
    element,
  });

  return {
    editor,
    destroy() {
      editor.destroy();
      element.remove();
    },
    getPlainText() {
      return documentToPlainText(editor.state.doc);
    },
  };
}

type ClipboardValues = Readonly<Record<string, string>>;

export function dispatchPaste(
  target: HTMLElement,
  values: ClipboardValues,
  files: readonly File[] = [],
) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const dataTransfer = createDataTransfer(values, files);

  Object.defineProperty(event, "clipboardData", { value: dataTransfer });
  target.dispatchEvent(event);
}

export function createDataTransfer(
  values: ClipboardValues,
  files: readonly File[] = [],
): DataTransfer {
  const types = Object.keys(values);

  // jsdom does not provide a constructible DataTransfer. The editor paths
  // under test only read files, types, and getData from this browser object.
  return {
    files,
    getData(type: string) {
      return values[type] ?? "";
    },
    types,
  } as unknown as DataTransfer;
}

type KeyboardEventOptions = Readonly<{
  altKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  metaKey?: boolean;
  shiftKey?: boolean;
}>;

export function dispatchKey(
  target: HTMLElement,
  key: string,
  options: KeyboardEventOptions = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    altKey: options.altKey,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey,
    isComposing: options.isComposing,
    key,
    metaKey: options.metaKey,
    shiftKey: options.shiftKey,
  });

  if (options.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: options.keyCode });
  }

  target.dispatchEvent(event);

  return event;
}

export function dispatchComposition(
  target: HTMLElement,
  type: "compositionstart" | "compositionupdate" | "compositionend",
  data: string,
): CompositionEvent {
  const event = new CompositionEvent(type, {
    bubbles: true,
    cancelable: true,
    data,
  });

  target.dispatchEvent(event);

  return event;
}

export function setCursor(
  editor: Editor,
  paragraphIndex: number,
  textOffset: number,
) {
  let position = 1;

  for (let index = 0; index < paragraphIndex; index += 1) {
    position += editor.state.doc.child(index).nodeSize;
  }

  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, position + textOffset),
    ),
  );
}

export function setTextSelection(
  editor: Editor,
  anchor: number,
  head = anchor,
) {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, anchor, head),
    ),
  );
}
