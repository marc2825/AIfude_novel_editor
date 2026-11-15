import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { LLM_CANDIDATES_SCHEMA as FROZEN_LLM_CANDIDATES_SCHEMA } from "../fixtures/contracts/llm-candidates.schema";
import {
  AI_EDIT_ERROR_CODES,
  aiEditErrorResponseSchema,
  aiEditRequestSchema,
  aiEditSuccessResponseSchema,
  llmCandidatesWireSchema,
  validateAiEditRequest,
  validateLlmCandidateResponse,
} from "../../src/domain/ai-edit";
import {
  AI_EDIT_LIMITS,
  codePointLength,
} from "../../src/domain/limits";
import {
  createAiEditRequestContract,
  createEditIntent,
} from "../../src/features/ai-edit/intent";

const requestId = "10000000-0000-4000-8000-000000000001";
const candidateIds = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
] as const;
const generatedAt = "2026-09-19T00:00:00.000Z";
const frozenContractHash =
  "281aa864db45d53dc7d9373ac1bf8f683c8f749687f95f1daba604657a7aa047";

function validRequest() {
  return {
    schemaVersion: 1,
    requestId,
    selectionText: "選択本文🙂",
    beforeText: "直前の文脈",
    afterText: "直後の文脈",
    instruction: "  自然な余韻にして🙂  ",
    presetId: null,
    candidateCount: 2,
    globalContext: {
      commonPrompt: "設定を増やさない",
      manualStyle: "静かな文体",
    },
    consent: {
      providerId: "mock",
      policyVersion: 1,
    },
  };
}

function wireCandidate(
  replacementText: string,
  explanation = "表現を調整しました。",
  riskNotes: readonly string[] = [],
) {
  return { explanation, replacementText, riskNotes: [...riskNotes] };
}

function validWireResponse() {
  return {
    candidates: [wireCandidate("候補一"), wireCandidate("候補二")],
  };
}

function validSuccessResponse() {
  const intent = createEditIntent({
    instruction: "自然に",
    presetId: "polish",
  });

  return {
    schemaVersion: 1,
    requestId,
    intent,
    candidates: candidateIds.map((id, index) => ({
      id,
      requestId,
      index,
      replacementText: `候補${index + 1}`,
      explanation: "表現を調整しました。",
      riskNotes: [],
      providerId: "mock",
      model: "Mock Model",
      generatedAt,
    })),
    contextUsage: {
      sentCodePoints: {
        selectionText: 5,
        beforeText: 5,
        afterText: 5,
        instruction: 3,
        commonPrompt: 0,
        manualStyle: 0,
      },
      estimatedInputTokens: 1_024,
      omittedFields: [],
    },
    usage: null,
    provider: {
      providerId: "mock",
      model: "Mock Model",
    },
  };
}

type RequestFixture = ReturnType<typeof validRequest>;
type RequestMutation = (value: RequestFixture) => unknown;

const invalidRequests: ReadonlyArray<
  readonly [label: string, mutate: RequestMutation]
> = [
  ["missing required field", (value) => {
    const missingInstruction = { ...value };
    Reflect.deleteProperty(missingInstruction, "instruction");
    return missingInstruction;
  }],
  ["unknown root field", (value) => ({ ...value, storageVersion: 1 })],
  ["unknown nested field", (value) => ({
    ...value,
    globalContext: { ...value.globalContext, dirtySequence: 1 },
  })],
  ["invalid schema version", (value) => ({ ...value, schemaVersion: 2 })],
  ["invalid request UUID", (value) => ({ ...value, requestId: "request" })],
  ["invalid preset", (value) => ({ ...value, presetId: "rewrite-all" })],
  ["invalid candidate count", (value) => ({ ...value, candidateCount: 4 })],
  ["blank selection", (value) => ({ ...value, selectionText: "　\n " })],
  ["blank instruction", (value) => ({ ...value, instruction: " \t　" })],
  ["invalid Unicode", (value) => ({ ...value, instruction: "指示\ud83d" })],
  ["oversized selection", (value) => ({
    ...value,
    selectionText: "選".repeat(2_001),
  })],
  ["oversized before context", (value) => ({
    ...value,
    beforeText: "前".repeat(1_001),
  })],
  ["oversized after context", (value) => ({
    ...value,
    afterText: "後".repeat(1_001),
  })],
  ["oversized instruction", (value) => ({
    ...value,
    instruction: "指".repeat(501),
  })],
  ["oversized common prompt", (value) => ({
    ...value,
    globalContext: {
      ...value.globalContext,
      commonPrompt: "共".repeat(2_001),
    },
  })],
  ["oversized manual style", (value) => ({
    ...value,
    globalContext: {
      ...value.globalContext,
      manualStyle: "文".repeat(1_001),
    },
  })],
];

const requestBoundaryCases: ReadonlyArray<
  readonly [label: string, mutate: RequestMutation]
> = [
  ["selectionText", (value) => ({
    ...value,
    selectionText: "🙂".repeat(AI_EDIT_LIMITS.selectionTextCodePoints),
  })],
  ["beforeText", (value) => ({
    ...value,
    beforeText: "前".repeat(AI_EDIT_LIMITS.beforeTextCodePoints),
  })],
  ["afterText", (value) => ({
    ...value,
    afterText: "後".repeat(AI_EDIT_LIMITS.afterTextCodePoints),
  })],
  ["instruction", (value) => ({
    ...value,
    instruction: "🙂".repeat(AI_EDIT_LIMITS.instructionCodePoints),
  })],
  ["globalContext.commonPrompt", (value) => ({
    ...value,
    globalContext: {
      ...value.globalContext,
      commonPrompt: "共".repeat(AI_EDIT_LIMITS.commonPromptCodePoints),
    },
  })],
  ["globalContext.manualStyle", (value) => ({
    ...value,
    globalContext: {
      ...value.globalContext,
      manualStyle: "文".repeat(AI_EDIT_LIMITS.manualStyleCodePoints),
    },
  })],
];

describe("AI edit request contract", () => {
  it.each([
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ] as const)("accepts allowlisted model ID %s", (modelId) => {
    expect(
      validateAiEditRequest({ ...validRequest(), modelId }),
    ).toMatchObject({ success: true });
  });

  it("rejects an unregistered explicit model ID", () => {
    expect(
      validateAiEditRequest({
        ...validRequest(),
        modelId: "some-unregistered-model",
      }),
    ).toMatchObject({ success: false });
  });

  it("accepts a complete strict request and preserves non-canonical user fields", () => {
    const input = {
      ...validRequest(),
      selectionText: "第一\r\n第二🙂",
      beforeText: "前\r文",
      afterText: "後\r\n文",
    };
    const parsed = aiEditRequestSchema.parse(input);

    expect(parsed).toEqual({
      ...input,
      modelId: null,
      selectionText: "第一\n第二🙂",
      beforeText: "前\n文",
      afterText: "後\n文",
    });
    expect(parsed.instruction).toBe("  自然な余韻にして🙂  ");
  });

  it("accepts empty optional context values and null consent", () => {
    const input = {
      ...validRequest(),
      beforeText: "",
      afterText: "",
      globalContext: { commonPrompt: "", manualStyle: "" },
      consent: null,
    };

    expect(validateAiEditRequest(input)).toEqual({
      data: { ...input, modelId: null },
      success: true,
    });
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    const atLimit = {
      ...validRequest(),
      selectionText: "🙂".repeat(AI_EDIT_LIMITS.selectionTextCodePoints),
    };
    const overLimit = {
      ...atLimit,
      selectionText: `${atLimit.selectionText}🙂`,
    };

    expect(codePointLength(atLimit.selectionText)).toBe(2_000);
    expect(validateAiEditRequest(atLimit).success).toBe(true);
    expect(validateAiEditRequest(overLimit)).toEqual({
      reason: "invalid-request",
      success: false,
    });
  });

  it.each(requestBoundaryCases)("accepts %s at its exact limit", (_label, mutate) => {
    expect(validateAiEditRequest(mutate(validRequest())).success).toBe(true);
  });

  it.each(invalidRequests)("rejects %s", (_label, mutate) => {
    expect(validateAiEditRequest(mutate(validRequest()))).toEqual({
      reason: "invalid-request",
      success: false,
    });
  });

  it("separates local control metadata from model-visible content", () => {
    const input = validRequest();
    const originalInput = structuredClone(input);
    const result = createAiEditRequestContract(input);

    expect(input).toEqual(originalInput);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.control).toEqual({
        consent: { providerId: "mock", policyVersion: 1 },
        presetId: null,
        requestId,
      });
      expect(Object.keys(result.data.modelInput).sort()).toEqual([
        "afterText",
        "beforeText",
        "candidateCount",
        "editIntent",
        "globalContext",
        "selectionText",
        "taskInstruction",
      ]);
      expect(JSON.stringify(result.data.modelInput)).not.toMatch(
        /requestId|sessionId|storageVersion|dirtySequence|contentRevision|selectionRevision|contextRevision|originalSlice|providerId|model/u,
      );
      expect(structuredClone(result.data)).toEqual(result.data);
      expect(Object.isFrozen(result.data)).toBe(true);
      expect(Object.isFrozen(result.data.control)).toBe(true);
      expect(Object.isFrozen(result.data.control.consent)).toBe(true);
      expect(Object.isFrozen(result.data.modelInput)).toBe(true);
      expect(Object.isFrozen(result.data.modelInput.globalContext)).toBe(true);
    }
  });
});

describe("frozen provider candidate contract", () => {
  it("keeps both authoritative copies byte-identical at the frozen hash", () => {
    const rootContract = readFileSync(
      resolve(process.cwd(), "contracts/llm-candidates.schema.ts"),
    );
    const frozenContract = readFileSync(
      resolve(
        process.cwd(),
        "tests/fixtures/contracts/llm-candidates.schema.ts",
      ),
    );

    expect(createHash("sha256").update(rootContract).digest("hex")).toBe(
      frozenContractHash,
    );
    expect(createHash("sha256").update(frozenContract).digest("hex")).toBe(
      frozenContractHash,
    );
    expect(LLM_CANDIDATES_SCHEMA).toEqual(FROZEN_LLM_CANDIDATES_SCHEMA);
  });

  it("validates the frozen schema at runtime and rejects contract drift", () => {
    expect(llmCandidatesWireSchema.safeParse(validWireResponse()).success).toBe(
      true,
    );
    expect(
      llmCandidatesWireSchema.safeParse({
        ...validWireResponse(),
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      llmCandidatesWireSchema.safeParse({
        candidates: [
          { ...wireCandidate("候補"), candidateId: "model-generated" },
        ],
      }).success,
    ).toBe(false);
    expect(
      llmCandidatesWireSchema.safeParse({
        candidates: [{ replacementText: "候補", explanation: "説明" }],
      }).success,
    ).toBe(false);
  });
});

describe("candidate business validation", () => {
  it("normalizes only replacement line endings and returns immutable data", () => {
    const result = validateLlmCandidateResponse(
      {
        candidates: [
          wireCandidate("候補\r\n一", "説明🙂", ["注意"]),
          wireCandidate("候補\r二"),
        ],
      },
      "原文",
      2,
    );

    expect(result).toEqual({
      data: {
        candidates: [
          wireCandidate("候補\n一", "説明🙂", ["注意"]),
          wireCandidate("候補\n二"),
        ],
      },
      success: true,
    });

    if (result.success) {
      expect(Object.isFrozen(result.data)).toBe(true);
      expect(Object.isFrozen(result.data.candidates)).toBe(true);
      expect(Object.isFrozen(result.data.candidates[0]?.riskNotes)).toBe(true);
    }
  });

  it.each([
    {
      label: "invalid wire schema",
      value: { candidates: [{ ...wireCandidate("候補"), extra: true }] },
      expectedCount: 2,
      reason: "invalid-schema",
    },
    {
      label: "candidate count",
      value: validWireResponse(),
      expectedCount: 3,
      reason: "candidate-count",
    },
    {
      label: "empty replacement",
      value: { candidates: [wireCandidate(" \n　"), wireCandidate("別候補")] },
      expectedCount: 2,
      reason: "empty-replacement",
    },
    {
      label: "unchanged replacement",
      value: { candidates: [wireCandidate("原文"), wireCandidate("別候補")] },
      expectedCount: 2,
      reason: "unchanged-replacement",
    },
    {
      label: "duplicate replacement after LF normalization",
      value: {
        candidates: [wireCandidate("同じ\r\n候補"), wireCandidate("同じ\n候補")],
      },
      expectedCount: 2,
      reason: "duplicate-replacement",
    },
    {
      label: "invalid Unicode in metadata",
      value: {
        candidates: [wireCandidate("候補一", "説明\ud83d"), wireCandidate("候補二")],
      },
      expectedCount: 2,
      reason: "invalid-unicode",
    },
    {
      label: "replacement length",
      value: {
        candidates: [wireCandidate("長".repeat(133)), wireCandidate("候補二")],
      },
      expectedCount: 2,
      reason: "replacement-too-long",
    },
    {
      label: "explanation length",
      value: {
        candidates: [wireCandidate("候補一", "説".repeat(161)), wireCandidate("候補二")],
      },
      expectedCount: 2,
      reason: "explanation-too-long",
    },
    {
      label: "risk note count",
      value: {
        candidates: [
          wireCandidate("候補一", "説明", ["一", "二", "三", "四"]),
          wireCandidate("候補二"),
        ],
      },
      expectedCount: 2,
      reason: "too-many-risk-notes",
    },
    {
      label: "risk note length",
      value: {
        candidates: [
          wireCandidate("候補一", "説明", ["注".repeat(121)]),
          wireCandidate("候補二"),
        ],
      },
      expectedCount: 2,
      reason: "risk-note-too-long",
    },
  ] as const)("rejects $label", ({ value, expectedCount, reason }) => {
    expect(
      validateLlmCandidateResponse(value, "原文", expectedCount),
    ).toMatchObject({ reason, success: false });
  });

  it("accepts the documented replacement maximum by code point", () => {
    const original = "原";
    const maximum =
      codePointLength(original) * 2 +
      AI_EDIT_LIMITS.replacementAllowanceCodePoints;
    const result = validateLlmCandidateResponse(
      {
        candidates: [
          wireCandidate("🙂".repeat(maximum)),
          wireCandidate("別候補"),
        ],
      },
      original,
      2,
    );

    expect(result.success).toBe(true);
  });

  it("accepts all candidate business fields at their exact maxima", () => {
    const result = validateLlmCandidateResponse(
      {
        candidates: [
          wireCandidate(
            "🙂".repeat(AI_EDIT_LIMITS.replacementCodePoints),
            "説".repeat(AI_EDIT_LIMITS.explanationCodePoints),
            Array.from(
              { length: AI_EDIT_LIMITS.riskNotes },
              (_, index) =>
                `${index}`.padEnd(AI_EDIT_LIMITS.riskNoteCodePoints, "注"),
            ),
          ),
          wireCandidate("別候補"),
        ],
      },
      "原".repeat(AI_EDIT_LIMITS.selectionTextCodePoints),
      2,
    );

    expect(result.success).toBe(true);
  });
});

describe("API success and error envelopes", () => {
  it("accepts a strict success envelope and checks candidate metadata", () => {
    const response = validSuccessResponse();

    expect(aiEditSuccessResponseSchema.safeParse(response).success).toBe(true);
    expect(
      aiEditSuccessResponseSchema.safeParse({
        ...response,
        candidates: response.candidates.map((candidate, index) =>
          index === 0 ? { ...candidate, requestId: candidateIds[0] } : candidate,
        ),
      }).success,
    ).toBe(false);
    expect(
      aiEditSuccessResponseSchema.safeParse({
        ...response,
        storageVersion: 1,
      }).success,
    ).toBe(false);
  });

  it.each(AI_EDIT_ERROR_CODES)("accepts the %s error code", (code) => {
    expect(
      aiEditErrorResponseSchema.safeParse({
        error: {
          code,
          message: "安全なエラーメッセージ",
          retryable: false,
          requestId: code === "INVALID_REQUEST" ? null : requestId,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown error codes and fields", () => {
    expect(
      aiEditErrorResponseSchema.safeParse({
        error: {
          code: "RAW_PROVIDER_ERROR",
          message: "raw body",
          retryable: true,
          requestId,
        },
      }).success,
    ).toBe(false);
    expect(
      aiEditErrorResponseSchema.safeParse({
        error: {
          code: "INVALID_REQUEST",
          message: "invalid",
          retryable: false,
          requestId: null,
          stack: "secret",
        },
      }).success,
    ).toBe(false);
  });

  it("exposes the documented byte limits without performing network I/O", () => {
    expect(AI_EDIT_LIMITS.requestBodyBytes).toBe(65_536);
    expect(AI_EDIT_LIMITS.responseBodyBytes).toBe(131_072);
  });
});
