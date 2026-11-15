import { describe, expect, it } from "vitest";

import {
  AI_EDIT_REQUIRED_MODEL_LIMITS,
  AI_MODEL_DEFINITIONS,
  AI_PROVIDER_DEFINITIONS,
  findAiModelDefinition,
  getAiModelsForProvider,
  getSelectableAiModelsForProvider,
  isAiEditCompatibleModel,
  OPENAI_PROVIDER_ID,
  validateAiModelRegistry,
} from "../../src/domain/ai-models";

describe("canonical AI provider/model registry", () => {
  it("has unique IDs and valid provider associations", () => {
    expect(validateAiModelRegistry()).toEqual([]);
    expect(new Set(AI_PROVIDER_DEFINITIONS.map(({ id }) => id)).size).toBe(
      AI_PROVIDER_DEFINITIONS.length,
    );
    expect(new Set(AI_MODEL_DEFINITIONS.map(({ id }) => id)).size).toBe(
      AI_MODEL_DEFINITIONS.length,
    );

    for (const model of AI_MODEL_DEFINITIONS) {
      expect(
        getAiModelsForProvider(model.providerId).some(
          (candidate) => candidate.id === model.id,
        ),
      ).toBe(true);
      expect(findAiModelDefinition(model.id)).toBe(model);
    }
  });

  it("allows exactly the four compatible OpenAI editing models", () => {
    const models = getSelectableAiModelsForProvider(OPENAI_PROVIDER_ID);

    expect(models.map(({ id }) => id)).toEqual([
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);

    for (const model of models) {
      expect(isAiEditCompatibleModel(model)).toBe(true);
      expect(model.capabilities).toEqual({
        responsesApi: true,
        structuredOutputs: true,
        textInput: true,
        textOutput: true,
      });
      expect(model.limits.contextWindowTokens).toBeGreaterThanOrEqual(
        AI_EDIT_REQUIRED_MODEL_LIMITS.contextWindowTokens,
      );
      expect(model.limits.maxOutputTokens).toBeGreaterThanOrEqual(
        AI_EDIT_REQUIRED_MODEL_LIMITS.maxOutputTokens,
      );
    }
  });

  it("keeps the UI-safe registry free of server credentials and SDK options", () => {
    const serialized = JSON.stringify({
      models: AI_MODEL_DEFINITIONS,
      providers: AI_PROVIDER_DEFINITIONS,
    });

    expect(serialized).not.toMatch(
      /apiKey|OPENAI_API_KEY|organization|projectId|baseURL|maxRetries/u,
    );
  });
});
