import "server-only";

import {
  LOCAL_DEMO_MODEL_ID,
  MOCK_PROVIDER_ID,
} from "../../domain/ai-models";
import {
  AI_INSERT_CANDIDATE_COUNTS,
  type AiEditCandidateCount,
} from "../../domain/limits";
import type {
  EditingProvider,
  EditingProviderInput,
  EditingProviderResult,
} from "./provider";

type MockPromptInput = Readonly<{
  candidateCount: AiEditCandidateCount;
  selectionText: string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isCandidateCount(value: unknown): value is AiEditCandidateCount {
  return AI_INSERT_CANDIDATE_COUNTS.some(
    (candidateCount) => candidateCount === value,
  );
}

function parseMockPromptInput(inputDataJson: string): MockPromptInput | null {
  let value: unknown;

  try {
    value = JSON.parse(inputDataJson) as unknown;
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    (typeof value.selectionText !== "string" && typeof value.taskInstruction !== "string") ||
    !isCandidateCount(value.candidateCount)
  ) {
    return null;
  }

  return {
    candidateCount: value.candidateCount,
    selectionText: typeof value.selectionText === "string" ? value.selectionText : "",
  };
}

function createMockCandidates(promptInput: MockPromptInput) {
  return Object.freeze(
    Array.from({ length: promptInput.candidateCount }, (_, index) =>
      Object.freeze({
        explanation: `ローカルモック候補${index + 1}です。`,
        replacementText: `${promptInput.selectionText}【デモ候補${index + 1}】`,
        riskNotes: Object.freeze([
          "デモ候補です。意味の保持は保証されません。",
        ]),
      }),
    ),
  );
}

export function createMockEditingProvider(): EditingProvider {
  return Object.freeze({
    defaultModelId: LOCAL_DEMO_MODEL_ID,
    externalDataTransfer: false,
    providerId: MOCK_PROVIDER_ID,
    async generateCandidates(
      input: EditingProviderInput,
    ): Promise<EditingProviderResult> {
      if (
        input.signal.aborted ||
        input.model.id !== LOCAL_DEMO_MODEL_ID ||
        input.model.providerId !== MOCK_PROVIDER_ID
      ) {
        return { reason: "failure", status: "failed" };
      }

      await Promise.resolve();

      if (input.signal.aborted) {
        return { reason: "failure", status: "failed" };
      }

      let feedback: unknown;
      try { feedback = JSON.parse(input.prompt.inputDataJson); } catch { return { reason: "failure", status: "failed" }; }
      if (isRecord(feedback) && feedback.purpose === "feedback" && typeof feedback.manuscript === "string") {
        return { status: "completed", usage: null, output: { candidates: [{
          explanation: Array.from(feedback.manuscript).slice(0, 40).join(""),
          replacementText: "デモのFeedbackです。文の長短や視点の伝わり方を確認してください。実際の作品評価ではありません。",
          riskNotes: ["実LLMによる評価ではありません。"],
        }] } };
      }
      const promptInput = parseMockPromptInput(input.prompt.inputDataJson);

      if (promptInput === null) {
        return { reason: "failure", status: "failed" };
      }

      return {
        output: Object.freeze({
          candidates: createMockCandidates(promptInput),
        }),
        status: "completed",
        usage: null,
      };
    },
  });
}
