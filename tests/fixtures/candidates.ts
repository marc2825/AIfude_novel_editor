import type {
  AiEditRequest,
  AiEditSuccessResponse,
  LlmCandidatesWireResponse,
} from "../../src/domain/ai-edit";
import { LOCAL_DEMO_MODEL_ID } from "../../src/domain/ai-models";
import {
  codePointLength,
  type AiEditCandidateCount,
} from "../../src/domain/limits";
import { createEditIntent } from "../../src/features/ai-edit/intent";
import { storyMemoryCodePoints } from "../../src/domain/story-memory";

export const AI_EDIT_FIXTURE_REQUEST_ID =
  "10000000-0000-4000-8000-000000000001";

type RequestFixtureOptions = Readonly<{
  candidateCount?: AiEditCandidateCount;
  allowPaidApi?: true;
  consent?: AiEditRequest["consent"];
  modelId?: AiEditRequest["modelId"];
  requestId?: string;
}>;

export function createAiEditRequestFixture(
  options: RequestFixtureOptions = {},
): AiEditRequest {
  return {
    ...(options.allowPaidApi ? { allowPaidApi: true } : {}),
    afterText: "彼女は窓の外を見た。",
    beforeText: "雨音だけが部屋に響いていた。",
    candidateCount: options.candidateCount ?? 2,
    consent: options.consent ?? null,
    globalContext: {
      commonPrompt: "設定を増やさない",
      manualStyle: "静かな文体",
    },
    instruction: "自然に",
    modelId: options.modelId ?? null,
    presetId: null,
    requestId: options.requestId ?? AI_EDIT_FIXTURE_REQUEST_ID,
    schemaVersion: 1,
    selectionText: "彼は小さく息を吐いた。",
  };
}

export function createCandidateWireResponse(
  candidateCount: AiEditCandidateCount = 2,
): LlmCandidatesWireResponse {
  return {
    candidates: Array.from({ length: candidateCount }, (_, index) => ({
      explanation: `表現を整えた候補${index + 1}です。`,
      replacementText: `彼は静かに息を吐いた。${index + 1}`,
      riskNotes: [],
    })),
  };
}

export function createAiEditSuccessResponseFixture(
  request: AiEditRequest,
): AiEditSuccessResponse {
  const generatedAt = "2026-09-20T00:00:00.000Z";

  return {
    candidates: Array.from(
      { length: request.candidateCount },
      (_, index) => ({
        explanation: `ローカルモック候補${index + 1}です。`,
        generatedAt,
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        index,
        model: LOCAL_DEMO_MODEL_ID,
        providerId: "mock",
        replacementText: `${request.selectionText}【デモ候補${index + 1}】`,
        requestId: request.requestId,
        riskNotes: ["デモ候補です。意味の保持は保証されません。"],
      }),
    ),
    contextUsage: {
      ...(request.storyMemory === undefined ? {} : { storyMemoryCodePoints: storyMemoryCodePoints(request.storyMemory) }),
      estimatedInputTokens: 1_024,
      omittedFields: [],
      sentCodePoints: {
        afterText: codePointLength(request.afterText),
        beforeText: codePointLength(request.beforeText),
        commonPrompt: codePointLength(request.globalContext.commonPrompt),
        instruction: codePointLength(request.instruction),
        manualStyle: codePointLength(request.globalContext.manualStyle),
        selectionText: codePointLength(request.selectionText),
      },
    },
    intent: createEditIntent({
      instruction: request.instruction,
      presetId: request.presetId,
    }),
    provider: {
      model: LOCAL_DEMO_MODEL_ID,
      providerId: "mock",
    },
    requestId: request.requestId,
    schemaVersion: 1,
    usage: null,
  };
}
