import { hasAnnotationsInRange } from "./annotations";
import type { Editor } from "@tiptap/core";
import type { AiTextOperation } from "../../domain/completion";
import { ReplaceError } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

import {
  documentToPlainText,
  normalizeLineEndings,
  plainTextToSlice,
} from "./plain-text";
import {
  plainTextOffsetToProseMirrorPosition,
  validateSelectionSnapshot,
  type SelectionCaptureContext,
  type SelectionGuardResult,
  type SelectionSnapshot,
} from "./selection";

const MAX_REPLACEMENT_CODE_POINTS = 3_000;
const REPLACEMENT_LENGTH_ALLOWANCE = 128;

export const AI_REPLACEMENT_META_KEY = "aiEditReplacement";

export type AiReplacementIdentity = Readonly<{
  candidateId: string;
  requestId: string;
  sessionId: string;
}>;

export type InvalidReplacementReason =
  | "empty"
  | "invalid-unicode"
  | "too-long"
  | "whitespace-only";

type RejectedSelectionGuardResult = Exclude<
  SelectionGuardResult,
  Readonly<{ status: "valid" }>
>;

export type SelectionReplacementResult =
  | RejectedSelectionGuardResult
  | Readonly<{
      from: number;
      status: "applied";
      to: number;
    }>
  | Readonly<{ status: "no-change" }>
  | Readonly<{
      reason: InvalidReplacementReason;
      status: "invalid-replacement";
    }>
  | Readonly<{ status: "unsafe-replacement" }>;

function containsInvalidSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= text.length) {
        return true;
      }

      const nextCodeUnit = text.charCodeAt(index + 1);

      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true;
      }

      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function invalidReplacementReason(
  replacementText: string,
  originalText: string,
  operation?: AiTextOperation,
): InvalidReplacementReason | null {
  if (replacementText.length === 0) {
    return "empty";
  }

  if (containsInvalidSurrogate(replacementText)) {
    return "invalid-unicode";
  }

  if (/^\s*$/u.test(replacementText)) {
    return "whitespace-only";
  }

  if (replacementText === originalText) {
    return null;
  }

  const maximumLength = operation !== undefined ? MAX_REPLACEMENT_CODE_POINTS : Math.min(
    MAX_REPLACEMENT_CODE_POINTS,
    codePointLength(originalText) * 2 + REPLACEMENT_LENGTH_ALLOWANCE,
  );

  return codePointLength(replacementText) > maximumLength
    ? "too-long"
    : null;
}

export function validateExactReplacementTransaction(
  transaction: Transaction,
  snapshot: SelectionSnapshot,
  normalizedReplacement: string,
): number | null {
  try {
    transaction.doc.check();
  } catch {
    return null;
  }

  const expectedText =
    snapshot.beforeText + normalizedReplacement + snapshot.afterText;

  if (
    !transaction.docChanged ||
    transaction.steps.length !== 1 ||
    documentToPlainText(transaction.doc) !== expectedText
  ) {
    return null;
  }

  const insertionEnd = transaction.mapping.map(snapshot.to, snapshot.from === snapshot.to ? 1 : -1);
  const expectedInsertionEnd = plainTextOffsetToProseMirrorPosition(
    transaction.doc,
    snapshot.plainTextFrom + normalizedReplacement.length,
  );

  return expectedInsertionEnd !== null && insertionEnd === expectedInsertionEnd
    ? insertionEnd
    : null;
}

export function replaceCapturedSelection(
  editor: Editor | null,
  snapshot: SelectionSnapshot,
  replacementText: string,
  context: SelectionCaptureContext,
  identity?: AiReplacementIdentity,
): SelectionReplacementResult {
  const guardResult = validateSelectionSnapshot(editor, snapshot, context);

  if (guardResult.status !== "valid") {
    return guardResult;
  }

  if (editor === null) {
    return { reason: "editor-not-ready", status: "unavailable" };
  }

  if (hasAnnotationsInRange(editor.state.doc, snapshot.from, snapshot.to)) return { status: "unsafe-replacement" };

  const normalizedReplacement = normalizeLineEndings(replacementText);
  const invalidReason = invalidReplacementReason(
    normalizedReplacement,
    snapshot.originalText,
    snapshot.operation,
  );

  if (invalidReason !== null) {
    return { reason: invalidReason, status: "invalid-replacement" };
  }

  if (normalizedReplacement === snapshot.originalText) {
    return { status: "no-change" };
  }

  const replacementSlice = plainTextToSlice(
    editor.state.schema,
    normalizedReplacement,
  );
  const transaction = closeHistory(editor.state.tr);

  try {
    transaction.replace(snapshot.from, snapshot.to, replacementSlice);
  } catch (error: unknown) {
    if (error instanceof ReplaceError) {
      return { status: "unsafe-replacement" };
    }

    throw error;
  }

  const insertionEnd = validateExactReplacementTransaction(
    transaction,
    snapshot,
    normalizedReplacement,
  );

  if (insertionEnd === null) {
    return { status: "unsafe-replacement" };
  }

  transaction.setSelection(
    TextSelection.create(transaction.doc, insertionEnd),
  );

  if (identity !== undefined) {
    transaction.setMeta(AI_REPLACEMENT_META_KEY, Object.freeze({ ...identity }));
  }

  editor.view.dispatch(transaction);
  editor.view.dispatch(
    closeHistory(editor.state.tr).setMeta("addToHistory", false),
  );

  return {
    from: snapshot.from,
    status: "applied",
    to: insertionEnd,
  };
}
