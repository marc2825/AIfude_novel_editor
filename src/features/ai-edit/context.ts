import type { AiTextOperation } from "../../domain/completion";
import {
  type AiEditContextUsage,
  type EditIntent,
} from "../../domain/ai-edit";
import {
  AI_EDIT_LIMITS,
  AI_EDIT_OMITTABLE_CONTEXT_FIELDS,
  AI_EDIT_TOKEN_LIMITS,
  codePointLength,
  normalizeContractLineEndings,
  type AiEditCandidateCount,
  type AiEditOmittableContextField,
} from "../../domain/limits";
import type { AiEditModelInput } from "./intent";
import { storyMemoryCodePoints } from "../../domain/story-memory";

const graphemeSegmenter = new Intl.Segmenter("ja", {
  granularity: "grapheme",
});

type TokenEstimator = (input: AiEditModelInput) => number;

type MutableContext = {
  storyMemory?: AiEditModelInput["storyMemory"];
  operation?: AiTextOperation;
  targetCharacters?: number;
  afterText: string;
  beforeText: string;
  candidateCount: AiEditCandidateCount;
  editIntent: EditIntent;
  globalContext: {
    commonPrompt: string;
    manualStyle: string;
  };
  selectionText: string;
  taskInstruction: string;
};

export type LocalContext = Readonly<{
  afterText: string;
  beforeText: string;
}>;

export type ContextAssembly = Readonly<{
  contextUsage: AiEditContextUsage;
  modelInput: AiEditModelInput;
}>;

export type ContextAssemblyResult =
  | Readonly<{ data: ContextAssembly; success: true }>
  | Readonly<{ reason: "input-too-large"; success: false }>;

function segmentGraphemes(value: string): readonly string[] {
  return Object.freeze(
    Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment),
  );
}

function closestSuffix(value: string, maximumCodePoints: number): string {
  const graphemes = segmentGraphemes(value);
  let codePoints = 0;
  let start = graphemes.length;

  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index];

    if (grapheme === undefined) {
      break;
    }

    const nextLength = codePoints + codePointLength(grapheme);

    if (nextLength > maximumCodePoints) {
      break;
    }

    codePoints = nextLength;
    start = index;
  }

  return graphemes.slice(start).join("");
}

function closestPrefix(value: string, maximumCodePoints: number): string {
  const graphemes = segmentGraphemes(value);
  let codePoints = 0;
  let end = 0;

  for (const grapheme of graphemes) {
    const nextLength = codePoints + codePointLength(grapheme);

    if (nextLength > maximumCodePoints) {
      break;
    }

    codePoints = nextLength;
    end += 1;
  }

  return graphemes.slice(0, end).join("");
}

export function extractLocalContext(input: Readonly<{
  afterText: string;
  beforeText: string;
}>): LocalContext {
  const beforeText = normalizeContractLineEndings(input.beforeText);
  const afterText = normalizeContractLineEndings(input.afterText);

  return Object.freeze({
    afterText: closestPrefix(
      afterText,
      AI_EDIT_LIMITS.afterTextCodePoints,
    ),
    beforeText: closestSuffix(
      beforeText,
      AI_EDIT_LIMITS.beforeTextCodePoints,
    ),
  });
}

function readonlyModelInput(context: MutableContext): AiEditModelInput {
  return {
    ...(context.storyMemory === undefined ? {} : { storyMemory: context.storyMemory }),
    ...(context.operation === undefined ? {} : { operation: context.operation }),
    ...(context.targetCharacters === undefined ? {} : { targetCharacters: context.targetCharacters }),
    afterText: context.afterText,
    beforeText: context.beforeText,
    candidateCount: context.candidateCount,
    editIntent: context.editIntent,
    globalContext: context.globalContext,
    selectionText: context.selectionText,
    taskInstruction: context.taskInstruction,
  };
}

function estimate(
  context: MutableContext,
  estimateTokens: TokenEstimator,
): number {
  return estimateTokens(readonlyModelInput(context));
}

function truncateGlobalField(
  context: MutableContext,
  field: "commonPrompt" | "manualStyle",
  estimateTokens: TokenEstimator,
): boolean {
  const original = context.globalContext[field];
  const graphemes = segmentGraphemes(original);

  if (graphemes.length === 0) {
    return false;
  }

  let lowest = 0;
  let highest = graphemes.length;
  let longestFittingPrefix = -1;

  while (lowest <= highest) {
    const midpoint = Math.floor((lowest + highest) / 2);
    context.globalContext[field] = graphemes.slice(0, midpoint).join("");

    if (
      estimate(context, estimateTokens) <=
      AI_EDIT_TOKEN_LIMITS.estimatedInputTokens
    ) {
      longestFittingPrefix = midpoint;
      lowest = midpoint + 1;
    } else {
      highest = midpoint - 1;
    }
  }

  const retainedGraphemes = Math.max(longestFittingPrefix, 0);
  context.globalContext[field] = graphemes
    .slice(0, retainedGraphemes)
    .join("");

  return retainedGraphemes < graphemes.length;
}

function truncateLocalContext(
  context: MutableContext,
  estimateTokens: TokenEstimator,
  omittedFields: Set<AiEditOmittableContextField>,
): number {
  const beforeGraphemes = segmentGraphemes(context.beforeText);
  const afterGraphemes = segmentGraphemes(context.afterText);
  let beforeStart = 0;
  let afterEnd = afterGraphemes.length;
  let removeBeforeNext = true;
  let estimatedTokens = estimate(context, estimateTokens);

  while (
    estimatedTokens > AI_EDIT_TOKEN_LIMITS.estimatedInputTokens &&
    (beforeStart < beforeGraphemes.length || afterEnd > 0)
  ) {
    if (
      (removeBeforeNext && beforeStart < beforeGraphemes.length) ||
      afterEnd === 0
    ) {
      beforeStart += 1;
      context.beforeText = beforeGraphemes.slice(beforeStart).join("");
      omittedFields.add("beforeText");
      removeBeforeNext = false;
    } else {
      afterEnd -= 1;
      context.afterText = afterGraphemes.slice(0, afterEnd).join("");
      omittedFields.add("afterText");
      removeBeforeNext = true;
    }

    estimatedTokens = estimate(context, estimateTokens);
  }

  return estimatedTokens;
}

function freezeModelInput(context: MutableContext): AiEditModelInput {
  return Object.freeze({
    ...(context.storyMemory === undefined ? {} : { storyMemory: Object.freeze({ ...context.storyMemory }) }),
    ...(context.operation === undefined ? {} : { operation: context.operation }),
    ...(context.targetCharacters === undefined ? {} : { targetCharacters: context.targetCharacters }),
    afterText: context.afterText,
    beforeText: context.beforeText,
    candidateCount: context.candidateCount,
    editIntent: context.editIntent,
    globalContext: Object.freeze({ ...context.globalContext }),
    selectionText: context.selectionText,
    taskInstruction: context.taskInstruction,
  });
}

function contextUsage(
  input: AiEditModelInput,
  estimatedInputTokens: number,
  omittedFields: ReadonlySet<AiEditOmittableContextField>,
): AiEditContextUsage {
  return Object.freeze({
    ...(input.storyMemory === undefined ? {} : { storyMemoryCodePoints: storyMemoryCodePoints(input.storyMemory) }),
    estimatedInputTokens,
    omittedFields: Object.freeze(
      AI_EDIT_OMITTABLE_CONTEXT_FIELDS.filter((field) =>
        omittedFields.has(field),
      ),
    ),
    sentCodePoints: Object.freeze({
      afterText: codePointLength(input.afterText),
      beforeText: codePointLength(input.beforeText),
      commonPrompt: codePointLength(input.globalContext.commonPrompt),
      instruction: codePointLength(input.taskInstruction),
      manualStyle: codePointLength(input.globalContext.manualStyle),
      selectionText: codePointLength(input.selectionText),
    }),
  });
}

export function assembleContext(
  input: AiEditModelInput,
  estimateTokens: TokenEstimator,
): ContextAssemblyResult {
  const normalizedBefore = normalizeContractLineEndings(input.beforeText);
  const normalizedAfter = normalizeContractLineEndings(input.afterText);
  const localContext = extractLocalContext({
    afterText: normalizedAfter,
    beforeText: normalizedBefore,
  });
  const omittedFields = new Set<AiEditOmittableContextField>();

  if (localContext.beforeText !== normalizedBefore) {
    omittedFields.add("beforeText");
  }

  if (localContext.afterText !== normalizedAfter) {
    omittedFields.add("afterText");
  }

  const context: MutableContext = {
    ...(input.storyMemory === undefined ? {} : { storyMemory: {
      settingNotes: normalizeContractLineEndings(input.storyMemory.settingNotes),
      backgroundNotes: normalizeContractLineEndings(input.storyMemory.backgroundNotes),
      characterNotes: normalizeContractLineEndings(input.storyMemory.characterNotes),
    } }),
    ...(input.operation === undefined ? {} : { operation: input.operation }),
    ...(input.targetCharacters === undefined ? {} : { targetCharacters: input.targetCharacters }),
    afterText: localContext.afterText,
    beforeText: localContext.beforeText,
    candidateCount: input.candidateCount,
    editIntent: input.editIntent,
    globalContext: {
      commonPrompt: normalizeContractLineEndings(
        input.globalContext.commonPrompt,
      ),
      manualStyle: normalizeContractLineEndings(
        input.globalContext.manualStyle,
      ),
    },
    selectionText: normalizeContractLineEndings(input.selectionText),
    taskInstruction: normalizeContractLineEndings(input.taskInstruction),
  };
  // Selected memory, the target text and instruction are required. Reject
  // before expensive optional-context trimming when those alone cannot fit.
  if (estimate({ ...context, beforeText: "", afterText: "", globalContext: { commonPrompt: "", manualStyle: "" } }, estimateTokens) > AI_EDIT_TOKEN_LIMITS.estimatedInputTokens) {
    return { reason: "input-too-large", success: false };
  }
  let estimatedInputTokens = estimate(context, estimateTokens);

  if (estimatedInputTokens > AI_EDIT_TOKEN_LIMITS.estimatedInputTokens) {
    if (truncateGlobalField(context, "commonPrompt", estimateTokens)) {
      omittedFields.add("commonPrompt");
    }

    estimatedInputTokens = estimate(context, estimateTokens);
  }

  if (estimatedInputTokens > AI_EDIT_TOKEN_LIMITS.estimatedInputTokens) {
    if (truncateGlobalField(context, "manualStyle", estimateTokens)) {
      omittedFields.add("manualStyle");
    }

    estimatedInputTokens = estimate(context, estimateTokens);
  }

  if (estimatedInputTokens > AI_EDIT_TOKEN_LIMITS.estimatedInputTokens) {
    estimatedInputTokens = truncateLocalContext(
      context,
      estimateTokens,
      omittedFields,
    );
  }

  if (estimatedInputTokens > AI_EDIT_TOKEN_LIMITS.estimatedInputTokens) {
    return { reason: "input-too-large", success: false };
  }

  const modelInput = freezeModelInput(context);

  return {
    data: Object.freeze({
      contextUsage: contextUsage(
        modelInput,
        estimatedInputTokens,
        omittedFields,
      ),
      modelInput,
    }),
    success: true,
  };
}
