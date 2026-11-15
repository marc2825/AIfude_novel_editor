import type { EditorOptions } from "@tiptap/core";
import { persistedDocumentSchema, type PersistedDocument } from "../../domain/workspace";
import type { Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import {
  plainTextToDocument,
  plainTextToSlice,
  sliceToPlainText,
} from "./plain-text";
import {
  plainTextExtensions,
  plainTextSchema,
} from "./extensions/plain-text-schema";
import { PlainTextHistory } from "./extensions/plain-text-history";
import { createEditGuardExtension } from "./plugins/edit-guard";
import { DiagnosticHighlights } from "../feedback/diagnostic-anchors";
import {
  createAiCommandExtension,
  type AiCommandHandler,
} from "../ai-edit/editor-command";

function clipboardTypes(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.types);
}

export function handlePlainTextPaste(
  view: EditorView,
  event: ClipboardEvent,
  parsedSlice: Slice,
): boolean {
  const dataTransfer = event.clipboardData;

  if (dataTransfer === null || dataTransfer.files.length > 0) {
    return true;
  }

  const types = clipboardTypes(dataTransfer);
  const text = types.includes("text/plain")
    ? dataTransfer.getData("text/plain")
    : types.includes("text/html")
      ? sliceToPlainText(parsedSlice)
      : null;

  if (text === null || text.length === 0) {
    return true;
  }

  const transaction = view.state.tr
    .replaceSelection(plainTextToSlice(view.state.schema, text))
    .scrollIntoView()
    .setMeta("paste", true)
    .setMeta("uiEvent", "paste");

  view.dispatch(transaction);

  return true;
}

export function rejectRichOrFileDrop(
  event: Pick<DragEvent, "dataTransfer">,
): boolean {
  const dataTransfer = event.dataTransfer;

  if (dataTransfer === null || dataTransfer.files.length > 0) {
    return true;
  }

  return clipboardTypes(dataTransfer).some((type) => type !== "text/plain");
}

export function createEditorOptions(
  initialText: string | PersistedDocument,
  initialContentRevision = 0,
  onAiCommand?: AiCommandHandler,
): Partial<EditorOptions> {
  return {
    content: typeof initialText === "string" ? plainTextToDocument(plainTextSchema, initialText).toJSON() : persistedDocumentSchema.parse(initialText),
    extensions: [
      ...plainTextExtensions,
      PlainTextHistory,
      createEditGuardExtension(initialContentRevision),
      DiagnosticHighlights,
      ...(onAiCommand === undefined
        ? []
        : [createAiCommandExtension(onAiCommand)]),
    ],
    injectCSS: false,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        "aria-label": "小説本文",
        "aria-multiline": "true",
        role: "textbox",
      },
      handleDrop: (_view, event) => rejectRichOrFileDrop(event),
      handlePaste: (view, event, slice) =>
        handlePlainTextPaste(view, event, slice),
    },
  };
}
