import { authoringProfilesEqual, snapshotAuthoringProfile, type AuthoringProfile } from "../../domain/authoring-profile";
import type { Editor } from "@tiptap/core";
import { isCompletionOperation, isCompletionTextTarget, type AiTextOperation } from "../../domain/completion";
import type { Node, Slice } from "@tiptap/pm/model";
import {
  AllSelection,
  Selection as ProseMirrorSelection,
  TextSelection,
} from "@tiptap/pm/state";

import { documentToPlainText } from "./plain-text";
import { getEditGuardState } from "./plugins/edit-guard";
import { storyMemoriesEqual, type StoryMemory } from "../../domain/story-memory";

export type SelectionCaptureContext = Readonly<{
  authoringProfile?: AuthoringProfile;
  storyMemory?: StoryMemory;
  chapterId: string;
  commonPrompt: string;
  contextRevision: number;
  documentId: string;
  editable: boolean;
  manualStyle: string;
  projectId: string;
}>;

export type EditorIdentity = Readonly<{
  chapterId: string;
  contentRevision: number;
  contextRevision: number;
  documentId: string;
  editorInstanceId: string;
  projectId: string;
  selectionRevision: number;
}>;

export type SelectionSnapshot = Readonly<{
  authoringProfile?: AuthoringProfile;
  storyMemory?: StoryMemory;
  operation?: AiTextOperation;
  afterText: string;
  beforeText: string;
  commonPrompt: string;
  from: number;
  identity: EditorIdentity;
  manualStyle: string;
  originalSelection: ProseMirrorSelection;
  originalSlice: Slice;
  originalText: string;
  plainTextFrom: number;
  plainTextTo: number;
  to: number;
}>;

export type SelectionCaptureUnavailableReason =
  | "invalid-completion-target"
  | "blank-selection"
  | "editor-composing"
  | "editor-destroyed"
  | "editor-not-ready"
  | "editor-read-only"
  | "empty-selection"
  | "guard-unavailable"
  | "invalid-range"
  | "invalid-text-boundary"
  | "unsupported-selection";

export type SelectionCaptureResult =
  | Readonly<{
      reason: SelectionCaptureUnavailableReason;
      status: "unavailable";
    }>
  | Readonly<{
      snapshot: SelectionSnapshot;
      status: "captured";
    }>;

export type SelectionStaleReason =
  | "context-changed"
  | "document-changed"
  | "editor-destroyed"
  | "editor-instance-changed"
  | "editor-read-only"
  | "selection-changed"
  | "target-changed"
  | "workspace-changed";

export type SelectionGuardResult =
  | Readonly<{ status: "valid" }>
  | Readonly<{
      reason: "editor-composing" | "editor-not-ready" | "guard-unavailable";
      status: "unavailable";
    }>
  | Readonly<{
      reason: SelectionStaleReason;
      status: "stale";
    }>;

function isUtf16Boundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return false;
  }

  if (offset === 0 || offset === text.length) {
    return true;
  }

  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);

  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  );
}

export function proseMirrorPositionToPlainTextOffset(
  document: Node,
  proseMirrorPosition: number,
): number | null {
  if (!Number.isInteger(proseMirrorPosition)) {
    return null;
  }

  let plainTextStart = 0;
  let result: number | null = null;

  document.forEach((paragraph, paragraphOffset, paragraphIndex) => {
    if (result !== null) {
      return;
    }

    const contentStart = paragraphOffset + 1;
    const contentEnd = contentStart + paragraph.content.size;

    if (
      proseMirrorPosition >= contentStart &&
      proseMirrorPosition <= contentEnd
    ) {
      const localOffset = proseMirrorPosition - contentStart;

      if (isUtf16Boundary(paragraph.textContent, localOffset)) {
        result = plainTextStart + localOffset;
      }
    }

    plainTextStart += paragraph.textContent.length;

    if (paragraphIndex < document.childCount - 1) {
      plainTextStart += 1;
    }
  });

  return result;
}

export function plainTextOffsetToProseMirrorPosition(
  document: Node,
  plainTextOffset: number,
): number | null {
  const plainText = documentToPlainText(document);

  if (!isUtf16Boundary(plainText, plainTextOffset)) {
    return null;
  }

  let plainTextStart = 0;
  let result: number | null = null;

  document.forEach((paragraph, paragraphOffset) => {
    if (result !== null) {
      return;
    }

    const plainTextEnd = plainTextStart + paragraph.textContent.length;

    if (plainTextOffset >= plainTextStart && plainTextOffset <= plainTextEnd) {
      result = paragraphOffset + 1 + (plainTextOffset - plainTextStart);
      return;
    }

    plainTextStart = plainTextEnd + 1;
  });

  return result;
}

function normalizedSelectionRange(
  selection: ProseMirrorSelection,
  document: Node,
): Readonly<{ from: number; to: number }> | null {
  if (selection instanceof TextSelection) {
    return { from: selection.from, to: selection.to };
  }

  if (selection instanceof AllSelection) {
    const firstParagraph = document.firstChild;
    const lastParagraph = document.lastChild;

    if (firstParagraph === null || lastParagraph === null) {
      return null;
    }

    return {
      from: 1,
      to: document.content.size - 1,
    };
  }

  return null;
}

function unavailable(
  reason: SelectionCaptureUnavailableReason,
): SelectionCaptureResult {
  return { reason, status: "unavailable" };
}

function editorUnavailableReason(
  editor: Editor | null,
  editable: boolean,
): SelectionCaptureUnavailableReason | null {
  if (editor === null) {
    return "editor-not-ready";
  }

  if (editor.isDestroyed) {
    return "editor-destroyed";
  }

  if (!editable || !editor.isEditable) {
    return "editor-read-only";
  }

  if (editor.view.composing) {
    return "editor-composing";
  }

  return null;
}

export function captureSelection(
  editor: Editor | null,
  context: SelectionCaptureContext,
  operation?: AiTextOperation,
): SelectionCaptureResult {
  const unavailableReason = editorUnavailableReason(
    editor,
    context.editable,
  );

  if (unavailableReason !== null || editor === null) {
    return unavailable(unavailableReason ?? "editor-not-ready");
  }

  const guard = getEditGuardState(editor.state);

  if (guard === null) {
    return unavailable("guard-unavailable");
  }

  const selection = editor.state.selection;
  if ((operation === "insert" || operation === "continue" || operation === "context-insert") && (!(selection instanceof TextSelection) || !selection.empty)) {
    return unavailable("unsupported-selection");
  }
  const range = normalizedSelectionRange(selection, editor.state.doc);

  if (range === null) {
    return unavailable("unsupported-selection");
  }

  if (range.from < 0 || range.to > editor.state.doc.content.size) {
    return unavailable("invalid-range");
  }

  if (range.from === range.to && operation === undefined) {
    return unavailable("empty-selection");
  }

  const plainTextFrom = proseMirrorPositionToPlainTextOffset(
    editor.state.doc,
    range.from,
  );
  const plainTextTo = proseMirrorPositionToPlainTextOffset(
    editor.state.doc,
    range.to,
  );

  if (plainTextFrom === null || plainTextTo === null) {
    return unavailable("invalid-text-boundary");
  }

  if (plainTextFrom > plainTextTo) {
    return unavailable("invalid-range");
  }

  const plainText = documentToPlainText(editor.state.doc);
  const originalText = plainText.slice(plainTextFrom, plainTextTo);

  if (operation === undefined && /^\s*$/u.test(originalText)) {
    return unavailable("blank-selection");
  }

  if (isCompletionOperation(operation) && (
    !(selection instanceof TextSelection) ||
    !isCompletionTextTarget(operation, originalText, plainText.slice(0, plainTextFrom), plainText.slice(plainTextTo)) ||
    (operation === "infill" && selection.empty && selection.$from.parent.content.size !== 0)
  )) return unavailable("invalid-completion-target");

  const identity = Object.freeze({
    chapterId: context.chapterId,
    contentRevision: guard.contentRevision,
    contextRevision: context.contextRevision,
    documentId: context.documentId,
    editorInstanceId: guard.editorInstanceId,
    projectId: context.projectId,
    selectionRevision: guard.selectionRevision,
  });
  const snapshot = Object.freeze({
    ...(context.authoringProfile === undefined ? {} : { authoringProfile: snapshotAuthoringProfile(context.authoringProfile) }),
    ...(context.storyMemory === undefined ? {} : { storyMemory: Object.freeze({ ...context.storyMemory }) }),
    ...(operation === undefined ? {} : { operation }),
    afterText: plainText.slice(plainTextTo),
    beforeText: plainText.slice(0, plainTextFrom),
    commonPrompt: context.commonPrompt,
    from: range.from,
    identity,
    manualStyle: context.manualStyle,
    originalSelection: selection,
    originalSlice: editor.state.doc.slice(range.from, range.to),
    originalText,
    plainTextFrom,
    plainTextTo,
    to: range.to,
  });

  return { snapshot, status: "captured" };
}

function stale(reason: SelectionStaleReason): SelectionGuardResult {
  return { reason, status: "stale" };
}

export function validateSelectionSnapshot(
  editor: Editor | null,
  snapshot: SelectionSnapshot,
  context: SelectionCaptureContext,
): SelectionGuardResult {
  if (editor === null) {
    return { reason: "editor-not-ready", status: "unavailable" };
  }

  if (editor.isDestroyed) {
    return stale("editor-destroyed");
  }

  const guard = getEditGuardState(editor.state);

  if (guard === null) {
    return { reason: "guard-unavailable", status: "unavailable" };
  }

  if (!context.editable || !editor.isEditable) {
    return stale("editor-read-only");
  }

  if (editor.view.composing) {
    return { reason: "editor-composing", status: "unavailable" };
  }

  if (
    snapshot.identity.projectId !== context.projectId ||
    snapshot.identity.documentId !== context.documentId ||
    snapshot.identity.chapterId !== context.chapterId
  ) {
    return stale("workspace-changed");
  }

  if (snapshot.identity.editorInstanceId !== guard.editorInstanceId) {
    return stale("editor-instance-changed");
  }

  if (snapshot.identity.contentRevision !== guard.contentRevision) {
    return stale("document-changed");
  }

  if (snapshot.identity.selectionRevision !== guard.selectionRevision) {
    return stale("selection-changed");
  }

  if (
    snapshot.identity.contextRevision !== context.contextRevision ||
    snapshot.commonPrompt !== context.commonPrompt ||
    snapshot.manualStyle !== context.manualStyle ||
    !storyMemoriesEqual(snapshot.storyMemory, context.storyMemory) ||
    !authoringProfilesEqual(snapshot.authoringProfile, context.authoringProfile)
  ) {
    return stale("context-changed");
  }

  if (!snapshot.originalSelection.eq(editor.state.selection)) {
    return stale("selection-changed");
  }

  if (
    !Number.isInteger(snapshot.from) ||
    !Number.isInteger(snapshot.to) ||
    snapshot.from < 0 ||
    (snapshot.operation === "insert" || snapshot.operation === "continue" || snapshot.operation === "context-insert"
      ? snapshot.from !== snapshot.to || snapshot.originalText !== "" || !(snapshot.originalSelection instanceof TextSelection) || !snapshot.originalSelection.empty
      : snapshot.operation === "infill" ? snapshot.from > snapshot.to : snapshot.from >= snapshot.to) ||
    snapshot.to > editor.state.doc.content.size
  ) {
    return stale("target-changed");
  }

  const plainTextFrom = proseMirrorPositionToPlainTextOffset(
    editor.state.doc,
    snapshot.from,
  );
  const plainTextTo = proseMirrorPositionToPlainTextOffset(
    editor.state.doc,
    snapshot.to,
  );

  if (
    plainTextFrom === null ||
    plainTextTo === null ||
    plainTextFrom !== snapshot.plainTextFrom ||
    plainTextTo !== snapshot.plainTextTo
  ) {
    return stale("target-changed");
  }

  const plainText = documentToPlainText(editor.state.doc);
  const currentText = plainText.slice(plainTextFrom, plainTextTo);
  if (isCompletionOperation(snapshot.operation) && (
    !(snapshot.originalSelection instanceof TextSelection) ||
    !isCompletionTextTarget(snapshot.operation, currentText, plainText.slice(0, plainTextFrom), plainText.slice(plainTextTo)) ||
    (snapshot.operation === "infill" && snapshot.from === snapshot.to && editor.state.selection.$from.parent.content.size !== 0)
  )) return stale("target-changed");
  const currentSlice = editor.state.doc.slice(snapshot.from, snapshot.to);

  if (
    plainText.slice(0, plainTextFrom) !== snapshot.beforeText ||
    currentText !== snapshot.originalText ||
    plainText.slice(plainTextTo) !== snapshot.afterText ||
    !currentSlice.eq(snapshot.originalSlice)
  ) {
    return stale("target-changed");
  }

  return { status: "valid" };
}
