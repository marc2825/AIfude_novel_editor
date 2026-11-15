import { describe, expect, it } from "vitest";

import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import {
  findAiModelDefinition,
  LOCAL_DEMO_MODEL_ID,
  MOCK_PROVIDER_ID,
} from "../../src/domain/ai-models";
import {
  EDITING_PROVIDER_FAILURE_REASONS,
  type EditingProvider,
  type EditingProviderInput,
} from "../../src/server/ai/provider";

describe("EditingProvider port", () => {
  it("carries only the rendered prompt, frozen schema, output limit, and signal", async () => {
    let received: EditingProviderInput | null = null;
    const model = findAiModelDefinition(LOCAL_DEMO_MODEL_ID);

    if (model === null) {
      throw new Error("local demo model must exist");
    }

    const provider: EditingProvider = {
      defaultModelId: LOCAL_DEMO_MODEL_ID,
      externalDataTransfer: false,
      providerId: MOCK_PROVIDER_ID,
      async generateCandidates(input) {
        received = input;
        return {
          output: { candidates: [] },
          status: "completed",
          usage: null,
        };
      },
    };
    const controller = new AbortController();
    const input: EditingProviderInput = {
      model,
      outputTokenLimit: 8_192,
      prompt: {
        inputDataJson: "{}",
        systemInstruction: "固定制約",
      },
      responseSchema: LLM_CANDIDATES_SCHEMA,
      signal: controller.signal,
    };

    const result = await provider.generateCandidates(input);

    expect(received).toBe(input);
    expect(result).toEqual({
      output: { candidates: [] },
      status: "completed",
      usage: null,
    });
  });

  it("exposes only normalized provider failure categories", () => {
    expect(EDITING_PROVIDER_FAILURE_REASONS).toEqual([
      "timeout",
      "refusal",
      "incomplete",
      "failure",
      "auth-required",
      "subscription-limit",
    ]);
  });
});
