import { afterEach, describe, expect, it, vi } from "vitest";

import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { llmCandidatesWireSchema } from "../../src/domain/ai-edit";
import {
  findAiModelDefinition,
  LOCAL_DEMO_MODEL_ID,
} from "../../src/domain/ai-models";
import { createAiEditRequestContract } from "../../src/features/ai-edit/intent";
import { createMockEditingProvider } from "../../src/server/ai/mock-provider";
import {
  createPromptPlan,
  renderPromptPlan,
} from "../../src/server/ai/prompt";
import type { EditingProviderInput } from "../../src/server/ai/provider";
import { createAiEditRequestFixture } from "../fixtures/candidates";

function providerInput(candidateCount: 2 | 3): EditingProviderInput {
  const model = findAiModelDefinition(LOCAL_DEMO_MODEL_ID);

  if (model === null) {
    throw new Error("local demo model must exist");
  }
  const contract = createAiEditRequestContract(
    createAiEditRequestFixture({ candidateCount }),
  );

  if (!contract.success) {
    throw new Error("fixture request must be valid");
  }

  const prompt = createPromptPlan(contract.data.modelInput);

  if (!prompt.success) {
    throw new Error("fixture prompt must be valid");
  }

  return {
    model,
    outputTokenLimit: prompt.data.promptPlan.outputRequirements.outputTokenLimit,
    prompt: renderPromptPlan(prompt.data.promptPlan),
    responseSchema: LLM_CANDIDATES_SCHEMA,
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local mock editing provider", () => {
  it.each([2, 3] as const)(
    "returns exactly %i deterministic, distinct candidates",
    async (candidateCount) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const provider = createMockEditingProvider();
      const input = providerInput(candidateCount);

      const first = await provider.generateCandidates(input);
      const second = await provider.generateCandidates(input);

      expect(second).toEqual(first);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(first.status).toBe("completed");
      if (first.status === "completed") {
        const output = llmCandidatesWireSchema.safeParse(first.output);

        expect(output.success).toBe(true);
        if (!output.success) {
          return;
        }
        expect(output.data.candidates).toHaveLength(candidateCount);
        expect(new Set(output.data.candidates.map(({ replacementText }) => replacementText)).size).toBe(
          candidateCount,
        );
        expect(
          output.data.candidates.every(
            ({ replacementText }) =>
              replacementText !== "彼は小さく息を吐いた。",
          ),
        ).toBe(true);
      }
    },
  );

  it("fails without generation when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createMockEditingProvider().generateCandidates({
        ...providerInput(2),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ reason: "failure", status: "failed" });
  });
});
