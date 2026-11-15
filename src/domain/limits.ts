export const AI_EDIT_SCHEMA_VERSION = 1 as const;
export const AI_EXTERNAL_CONSENT_POLICY_VERSION = 1 as const;

export const AI_EDIT_LIMITS = Object.freeze({
  afterTextCodePoints: 1_000,
  beforeTextCodePoints: 1_000,
  commonPromptCodePoints: 2_000,
  explanationCodePoints: 160,
  instructionCodePoints: 500,
  intentNoteCodePoints: 160,
  manualStyleCodePoints: 1_000,
  replacementAllowanceCodePoints: 128,
  replacementCodePoints: 3_000,
  requestBodyBytes: 64 * 1_024,
  responseBodyBytes: 128 * 1_024,
  riskNoteCodePoints: 120,
  riskNotes: 3,
  selectionTextCodePoints: 2_000,
});

export const AI_EDIT_CANDIDATE_COUNTS = Object.freeze([2, 3] as const);
export const AI_INSERT_CANDIDATE_COUNTS = Object.freeze([1, 2, 3] as const);

export type AiEditCandidateCount =
  (typeof AI_INSERT_CANDIDATE_COUNTS)[number];

export const AI_EDIT_OMITTABLE_CONTEXT_FIELDS = Object.freeze([
  "commonPrompt",
  "manualStyle",
  "beforeText",
  "afterText",
] as const);

export type AiEditOmittableContextField =
  (typeof AI_EDIT_OMITTABLE_CONTEXT_FIELDS)[number];

export const AI_EDIT_TOKEN_LIMITS = Object.freeze({
  estimatedInputTokens: 24_000,
  framingTokens: 1_024,
  outputTokensByCandidateCount: Object.freeze({
    1: 4_096,
    2: 8_192,
    3: 12_288,
  } as const satisfies Readonly<Record<AiEditCandidateCount, number>>),
});

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function hasInvalidUnicodeSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return true;
      }

      const nextCodeUnit = value.charCodeAt(index + 1);

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

export function normalizeContractLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
