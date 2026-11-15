import { z } from "zod";
import { completionCharactersSchema, isCompletionOperation, isCompletionTextTarget, type AiTextOperation } from "./completion";
import { STORY_MEMORY_FIELD_LIMIT, storyMemorySchema } from "./story-memory";

import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import {
  isSelectableAiModelId,
  type SelectableAiModelId,
} from "./ai-models";
import {
  AI_EDIT_CANDIDATE_COUNTS,
  AI_INSERT_CANDIDATE_COUNTS,
  AI_EDIT_LIMITS,
  AI_EDIT_OMITTABLE_CONTEXT_FIELDS,
  AI_EDIT_SCHEMA_VERSION,
  AI_EDIT_TOKEN_LIMITS,
  AI_EXTERNAL_CONSENT_POLICY_VERSION,
  codePointLength,
  hasInvalidUnicodeSurrogate,
  normalizeContractLineEndings,
  type AiEditCandidateCount,
} from "./limits";

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

type JsonSchemaOutput<Schema> = Schema extends {
  readonly type: "string";
}
  ? string
  : Schema extends { readonly type: "integer" | "number" }
    ? number
    : Schema extends { readonly type: "boolean" }
      ? boolean
      : Schema extends {
            readonly type: "array";
            readonly items: infer Item;
          }
        ? readonly JsonSchemaOutput<Item>[]
        : Schema extends {
              readonly type: "object";
              readonly properties: infer Properties;
            }
          ? {
              readonly [Key in keyof Properties]: JsonSchemaOutput<
                Properties[Key]
              >;
            }
          : unknown;

function schemaFromJsonSchema<const Schema extends object>(
  jsonSchema: Schema,
) {
  // Zod's JSON Schema input type uses mutable arrays, while the frozen
  // provider contract is intentionally `as const`. Runtime JSON is identical.
  const runtimeSchema = z.fromJSONSchema(
    jsonSchema as unknown as z.core.JSONSchema.JSONSchema,
  );

  return z.custom<JsonSchemaOutput<Schema>>(
    (value) => runtimeSchema.safeParse(value).success,
    { message: "JSON Schemaに適合しません" },
  );
}

function boundedString(minimum: number, maximum: number) {
  return z
    .string()
    .refine((value) => !hasInvalidUnicodeSurrogate(value), {
      message: "不正なUnicode surrogateを含めないでください",
    })
    .refine(
      (value) => {
        const length = codePointLength(value);
        return length >= minimum && length <= maximum;
      },
      { message: `${minimum}〜${maximum}コードポイントで入力してください` },
    );
}

function canonicalManuscriptString(
  minimum: number,
  maximum: number,
) {
  return z
    .string()
    .transform(normalizeContractLineEndings)
    .pipe(boundedString(minimum, maximum));
}

function nonBlank<Schema extends z.ZodType<string>>(schema: Schema) {
  return schema.refine((value) => !/^\s*$/u.test(value), {
    message: "空白だけの文字列は指定できません",
  });
}

export const AI_EDIT_PRESET_IDS = Object.freeze([
  "polish",
  "shorten",
  "dialogue",
  "connection",
  "transform",
  "expand",
  "freeform",
] as const);

export const EDIT_INTENT_KINDS = Object.freeze([
  ...AI_EDIT_PRESET_IDS,
  "custom",
] as const);

export const EDIT_INTENT_INFERENCE_SOURCES = Object.freeze([
  "preset",
  "exact-rule",
  "conservative-default",
] as const);

export const EDIT_INTENT_PRESERVE = Object.freeze([
  "events",
  "participants",
  "pov",
  "timeline",
  "dialogueMeaning",
  "facts",
  "properNames",
] as const);

export const EDIT_INTENT_ALLOWED_CHANGES = Object.freeze([
  "diction",
  "syntax",
  "sentenceSplitMerge",
  "connectives",
  "redundancy",
  "dialogueRegister",
  "localExpression",
  "styleVariation",
  "elaboration",
] as const);

const polishAllowedChanges = Object.freeze([
  "diction",
  "syntax",
  "sentenceSplitMerge",
  "connectives",
  "localExpression",
] as const);

export const EDIT_INTENT_ALLOWED_BY_KIND = Object.freeze({
  polish: polishAllowedChanges,
  shorten: Object.freeze([...polishAllowedChanges, "redundancy"] as const),
  dialogue: Object.freeze([
    "diction",
    "syntax",
    "dialogueRegister",
  ] as const),
  connection: Object.freeze([
    "syntax",
    "connectives",
    "localExpression",
  ] as const),
  custom: polishAllowedChanges,
  transform: Object.freeze([...polishAllowedChanges, "styleVariation"] as const),
  expand: Object.freeze([...polishAllowedChanges, "elaboration"] as const),
  freeform: Object.freeze([...polishAllowedChanges, "redundancy", "dialogueRegister", "styleVariation", "elaboration"] as const),
});

export const EDIT_INTENT_LENGTH_BY_KIND = Object.freeze({
  polish: "similar",
  shorten: "shorter",
  dialogue: "similar",
  connection: "similar",
  custom: "similar",
  transform: "similar",
  expand: "longer",
  freeform: "instruction",
} as const);

export const aiEditPresetIdSchema = z.enum(AI_EDIT_PRESET_IDS);
export const aiEditRequestIdSchema = z.uuid();
export const editIntentKindSchema = z.enum(EDIT_INTENT_KINDS);
const editIntentInferenceSchema = z.enum(EDIT_INTENT_INFERENCE_SOURCES);
const allowedChangeSchema = z.enum(EDIT_INTENT_ALLOWED_CHANGES);
const candidateCountSchema = z.custom<AiEditCandidateCount>(
  (value) => AI_INSERT_CANDIDATE_COUNTS.some((count) => count === value),
  { message: "候補数は1、2または3を指定してください" },
);

function arraysEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

export const editIntentSchema = z
  .object({
    kind: editIntentKindSchema,
    inferredFrom: editIntentInferenceSchema,
    preserve: z.tuple([
      z.literal("events"),
      z.literal("participants"),
      z.literal("pov"),
      z.literal("timeline"),
      z.literal("dialogueMeaning"),
      z.literal("facts"),
      z.literal("properNames"),
    ]),
    allowedChanges: z.array(allowedChangeSchema),
    lengthTarget: z.enum(["similar", "shorter", "longer", "instruction"]),
    note: boundedString(1, AI_EDIT_LIMITS.intentNoteCodePoints),
  })
  .strict()
  .superRefine((intent, context) => {
    const expectedAllowed = EDIT_INTENT_ALLOWED_BY_KIND[intent.kind];

    if (!arraysEqual(intent.allowedChanges, expectedAllowed)) {
      context.addIssue({
        code: "custom",
        message: "kindに対応するAllowed Changesではありません",
        path: ["allowedChanges"],
      });
    }

    if (intent.lengthTarget !== EDIT_INTENT_LENGTH_BY_KIND[intent.kind]) {
      context.addIssue({
        code: "custom",
        message: "kindに対応するlengthTargetではありません",
        path: ["lengthTarget"],
      });
    }

    if (
      (intent.kind === "custom") !==
      (intent.inferredFrom === "conservative-default")
    ) {
      context.addIssue({
        code: "custom",
        message: "customは保守的defaultからだけ生成できます",
        path: ["inferredFrom"],
      });
    }
  });

const aiConsentRequestSchema = z
  .object({
    providerId: nonBlank(z.string()),
    policyVersion: z.literal(AI_EXTERNAL_CONSENT_POLICY_VERSION),
  })
  .strict();

const aiEditModelIdSchema = z.custom<SelectableAiModelId>(
  isSelectableAiModelId,
  { message: "対応しているmodel IDを指定してください" },
);

const globalContextSchema = z
  .object({
    commonPrompt: boundedString(0, AI_EDIT_LIMITS.commonPromptCodePoints),
    manualStyle: boundedString(0, AI_EDIT_LIMITS.manualStyleCodePoints),
  })
  .strict();

const aiEditRequestDraftBaseSchema = z
  .object({
    operation: z.enum(["insert", "infill", "continue", "context-insert"]).optional(),
    targetCharacters: completionCharactersSchema.optional(),
    storyMemory: storyMemorySchema.optional(),
    allowPaidApi: z.literal(true).optional(),
    connectionId: z.uuid().optional(),
    schemaVersion: z.literal(AI_EDIT_SCHEMA_VERSION),
    selectionText: canonicalManuscriptString(
      0,
      AI_EDIT_LIMITS.selectionTextCodePoints,
    ),
    beforeText: canonicalManuscriptString(
      0,
      AI_EDIT_LIMITS.beforeTextCodePoints,
    ),
    afterText: canonicalManuscriptString(
      0,
      AI_EDIT_LIMITS.afterTextCodePoints,
    ),
    instruction: nonBlank(
      boundedString(1, AI_EDIT_LIMITS.instructionCodePoints),
    ),
    presetId: aiEditPresetIdSchema.nullable(),
    candidateCount: candidateCountSchema,
    globalContext: globalContextSchema,
    consent: aiConsentRequestSchema.nullable(),
    modelId: aiEditModelIdSchema.nullable().optional().default(null),
  })
  .strict();

function validateOperation(request: z.infer<typeof aiEditRequestDraftBaseSchema>, context: z.RefinementCtx) {
  if (isCompletionOperation(request.operation)) {
    if (request.targetCharacters === undefined || request.presetId !== null ||
      !isCompletionTextTarget(request.operation, request.selectionText, request.beforeText, request.afterText)) {
      context.addIssue({ code: "custom", message: "補完対象・文脈・目標文字数が不正です" });
    }
    return;
  }
  if (request.targetCharacters !== undefined) context.addIssue({ code: "custom", message: "目標文字数は補完モード専用です" });
  const invalid = request.operation === "insert"
    ? request.selectionText !== "" || request.beforeText !== "" || request.afterText !== "" ||
      request.globalContext.commonPrompt !== "" || request.globalContext.manualStyle !== "" || request.presetId !== null
    : /^\s*$/u.test(request.selectionText) || !AI_EDIT_CANDIDATE_COUNTS.some((count) => count === request.candidateCount);
  if (invalid) context.addIssue({ code: "custom", message: "操作に対する本文・候補数・文脈が不正です" });
}

export const aiEditRequestDraftSchema = aiEditRequestDraftBaseSchema.superRefine(validateOperation);
export const aiEditRequestSchema = aiEditRequestDraftBaseSchema
  .extend({ requestId: aiEditRequestIdSchema })
  .strict().superRefine(validateOperation);

export type AiEditPresetId = z.infer<typeof aiEditPresetIdSchema>;
export type EditIntentKind = z.infer<typeof editIntentKindSchema>;
export type EditIntent = DeepReadonly<z.infer<typeof editIntentSchema>>;
export type AiEditRequestDraft = DeepReadonly<
  z.infer<typeof aiEditRequestDraftSchema>
>;
export type AiEditRequest = DeepReadonly<z.infer<typeof aiEditRequestSchema>>;

export type AiEditRequestDraftValidationResult =
  | Readonly<{ data: AiEditRequestDraft; success: true }>
  | Readonly<{ reason: "invalid-request"; success: false }>;

export function validateAiEditRequestDraft(
  value: unknown,
): AiEditRequestDraftValidationResult {
  const result = aiEditRequestDraftSchema.safeParse(value);

  return result.success
    ? { data: result.data, success: true }
    : { reason: "invalid-request", success: false };
}

export type AiEditRequestValidationResult =
  | Readonly<{ data: AiEditRequest; success: true }>
  | Readonly<{ reason: "invalid-request"; success: false }>;

export function validateAiEditRequest(
  value: unknown,
): AiEditRequestValidationResult {
  const result = aiEditRequestSchema.safeParse(value);

  return result.success
    ? { data: result.data, success: true }
    : { reason: "invalid-request", success: false };
}

const llmCandidateJsonSchema =
  LLM_CANDIDATES_SCHEMA.properties.candidates.items;

export const llmCandidateWireSchema = schemaFromJsonSchema(
  llmCandidateJsonSchema,
);
export const llmCandidatesWireSchema = schemaFromJsonSchema(
  LLM_CANDIDATES_SCHEMA,
);

export type LlmCandidateWire = JsonSchemaOutput<
  typeof llmCandidateJsonSchema
>;
export type LlmCandidatesWireResponse = JsonSchemaOutput<
  typeof LLM_CANDIDATES_SCHEMA
>;

export type CandidateValidationFailureReason =
  | "candidate-count"
  | "duplicate-replacement"
  | "empty-replacement"
  | "explanation-too-long"
  | "invalid-schema"
  | "invalid-unicode"
  | "replacement-too-long"
  | "risk-note-too-long"
  | "too-many-risk-notes"
  | "unchanged-replacement";

export type CandidateValidationResult =
  | Readonly<{
      data: LlmCandidatesWireResponse;
      success: true;
    }>
  | Readonly<{
      candidateIndex?: number;
      reason: CandidateValidationFailureReason;
      success: false;
    }>;

function invalidCandidate(
  reason: CandidateValidationFailureReason,
  candidateIndex?: number,
): CandidateValidationResult {
  return candidateIndex === undefined
    ? { reason, success: false }
    : { candidateIndex, reason, success: false };
}

export function validateLlmCandidateResponse(
  value: unknown,
  originalText: string,
  expectedCandidateCount: AiEditCandidateCount,
  operation?: AiTextOperation,
): CandidateValidationResult {
  const parsed = llmCandidatesWireSchema.safeParse(value);

  if (!parsed.success) {
    return invalidCandidate("invalid-schema");
  }

  if (parsed.data.candidates.length !== expectedCandidateCount) {
    return invalidCandidate("candidate-count");
  }

  const normalizedOriginal = normalizeContractLineEndings(originalText);
  const maximumReplacementLength = operation !== undefined ? AI_EDIT_LIMITS.replacementCodePoints : Math.min(
    AI_EDIT_LIMITS.replacementCodePoints,
    codePointLength(normalizedOriginal) * 2 +
      AI_EDIT_LIMITS.replacementAllowanceCodePoints,
  );
  const replacements = new Set<string>();
  const candidates: LlmCandidateWire[] = [];

  for (const [candidateIndex, candidate] of parsed.data.candidates.entries()) {
    const candidateStrings = [
      candidate.replacementText,
      candidate.explanation,
      ...candidate.riskNotes,
    ];

    if (candidateStrings.some(hasInvalidUnicodeSurrogate)) {
      return invalidCandidate("invalid-unicode", candidateIndex);
    }

    const replacementText = normalizeContractLineEndings(
      candidate.replacementText,
    );

    if (/^\s*$/u.test(replacementText)) {
      return invalidCandidate("empty-replacement", candidateIndex);
    }

    if (codePointLength(replacementText) > maximumReplacementLength) {
      return invalidCandidate("replacement-too-long", candidateIndex);
    }

    if (replacementText === normalizedOriginal) {
      return invalidCandidate("unchanged-replacement", candidateIndex);
    }

    if (replacements.has(replacementText)) {
      return invalidCandidate("duplicate-replacement", candidateIndex);
    }

    if (
      codePointLength(candidate.explanation) >
      AI_EDIT_LIMITS.explanationCodePoints
    ) {
      return invalidCandidate("explanation-too-long", candidateIndex);
    }

    if (candidate.riskNotes.length > AI_EDIT_LIMITS.riskNotes) {
      return invalidCandidate("too-many-risk-notes", candidateIndex);
    }

    if (
      candidate.riskNotes.some(
        (riskNote) =>
          codePointLength(riskNote) > AI_EDIT_LIMITS.riskNoteCodePoints,
      )
    ) {
      return invalidCandidate("risk-note-too-long", candidateIndex);
    }

    replacements.add(replacementText);
    candidates.push(
      Object.freeze({
        explanation: candidate.explanation,
        replacementText,
        riskNotes: Object.freeze([...candidate.riskNotes]),
      }),
    );
  }

  return {
    data: Object.freeze({ candidates: Object.freeze(candidates) }),
    success: true,
  };
}

const editCandidateResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...llmCandidateJsonSchema.properties,
    id: { type: "string", format: "uuid" },
    requestId: { type: "string", format: "uuid" },
    index: { type: "integer", minimum: 0 },
    providerId: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    generatedAt: { type: "string", format: "date-time" },
  },
  required: [
    ...llmCandidateJsonSchema.required,
    "id",
    "requestId",
    "index",
    "providerId",
    "model",
    "generatedAt",
  ],
} as const;

export const editCandidateResponseSchema = schemaFromJsonSchema(
  editCandidateResponseJsonSchema,
);

const sentCodePointsSchema = z
  .object({
    selectionText: z
      .int()
      .nonnegative()
      .max(AI_EDIT_LIMITS.selectionTextCodePoints),
    beforeText: z
      .int()
      .nonnegative()
      .max(AI_EDIT_LIMITS.beforeTextCodePoints),
    afterText: z
      .int()
      .nonnegative()
      .max(AI_EDIT_LIMITS.afterTextCodePoints),
    instruction: z
      .int()
      .nonnegative()
      .max(AI_EDIT_LIMITS.instructionCodePoints),
    commonPrompt: z
      .int()
      .nonnegative()
      .max(AI_EDIT_LIMITS.commonPromptCodePoints),
    manualStyle: z
      .int()
      .nonnegative()
      .max(AI_EDIT_LIMITS.manualStyleCodePoints),
  })
  .strict();

export const aiEditContextUsageSchema = z
  .object({
    storyMemoryCodePoints: z.object({
      settingNotes: z.int().nonnegative().max(STORY_MEMORY_FIELD_LIMIT),
      backgroundNotes: z.int().nonnegative().max(STORY_MEMORY_FIELD_LIMIT),
      characterNotes: z.int().nonnegative().max(STORY_MEMORY_FIELD_LIMIT),
    }).strict().optional(),
    sentCodePoints: sentCodePointsSchema,
    estimatedInputTokens: z
      .int()
      .nonnegative()
      .max(AI_EDIT_TOKEN_LIMITS.estimatedInputTokens),
    omittedFields: z.array(z.enum(AI_EDIT_OMITTABLE_CONTEXT_FIELDS)),
  })
  .strict();

const usageSchema = z
  .object({
    inputTokens: z.int().nonnegative(),
    outputTokens: z.int().nonnegative(),
  })
  .strict();

const providerSchema = z
  .object({
    providerId: nonBlank(z.string()),
    model: nonBlank(z.string()),
  })
  .strict();

export const aiEditSuccessResponseSchema = z
  .object({
    schemaVersion: z.literal(AI_EDIT_SCHEMA_VERSION),
    requestId: aiEditRequestIdSchema,
    intent: editIntentSchema,
    candidates: z
      .array(editCandidateResponseSchema)
      .min(AI_INSERT_CANDIDATE_COUNTS[0])
      .max(AI_EDIT_CANDIDATE_COUNTS[1]),
    contextUsage: aiEditContextUsageSchema,
    usage: usageSchema.nullable(),
    provider: providerSchema,
  })
  .strict()
  .superRefine((response, context) => {
    response.candidates.forEach((candidate, index) => {
      if (
        candidate.requestId !== response.requestId ||
        candidate.index !== index ||
        candidate.providerId !== response.provider.providerId ||
        candidate.model !== response.provider.model
      ) {
        context.addIssue({
          code: "custom",
          message: "candidate metadataがresponseと一致しません",
          path: ["candidates", index],
        });
      }
    });
  });

export const AI_EDIT_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST",
  "CONSENT_REQUIRED",
  "FORBIDDEN_ORIGIN",
  "BODY_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "AI_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_REFUSAL",
  "INVALID_OUTPUT",
  "INCOMPLETE_OUTPUT",
  "PROVIDER_FAILURE",
  "AUTH_REQUIRED",
  "SUBSCRIPTION_LIMIT",
] as const);

export type AiEditErrorCode = (typeof AI_EDIT_ERROR_CODES)[number];

export const aiEditErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(AI_EDIT_ERROR_CODES),
        message: nonBlank(z.string()),
        retryable: z.boolean(),
        requestId: aiEditRequestIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type AiEditSuccessResponse = DeepReadonly<
  z.infer<typeof aiEditSuccessResponseSchema>
>;
export type AiEditContextUsage = DeepReadonly<
  z.infer<typeof aiEditContextUsageSchema>
>;
export type AiEditErrorResponse = DeepReadonly<
  z.infer<typeof aiEditErrorResponseSchema>
>;
