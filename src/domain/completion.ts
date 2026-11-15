import { z } from "zod";
import { AI_EDIT_LIMITS } from "./limits";

export type CompletionOperation = "infill" | "continue" | "context-insert";
export type AiTextOperation = "insert" | CompletionOperation;
export const DEFAULT_COMPLETION_CHARACTERS = 400;
export const completionCharactersSchema = z.int().min(1).max(AI_EDIT_LIMITS.replacementCodePoints);

export function isCompletionOperation(value: unknown): value is CompletionOperation {
  return value === "infill" || value === "continue" || value === "context-insert";
}

// The editor additionally validates the selection type, exact position and revisions.
export function isCompletionTextTarget(operation: CompletionOperation, selectionText: string, beforeText: string, afterText: string): boolean {
  if (operation === "context-insert") return selectionText === "";
  return beforeText.trim().length > 0 && (operation === "infill"
    ? /^\s*$/u.test(selectionText) && afterText.trim().length > 0
    : selectionText === "" && afterText === "");
}
