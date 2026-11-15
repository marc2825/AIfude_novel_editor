import { describe, expect, it } from "vitest";

import {
  AI_MODEL_PREFERENCE_AUTOMATIC,
  getAiModelsForProvider,
  LOCAL_DEMO_MODEL_ID,
  MOCK_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
} from "../../src/domain/ai-models";
import {
  canUseAiRuntime,
  hasMatchingAiConsent,
  requestModelIdForRuntime,
  requestConsentForRuntime,
  resolveRuntimeModel,
  type PublicAiRuntime,
} from "../../src/features/ai-edit/consent";

const openAiRuntime = Object.freeze({
  available: true,
  defaultModelId: "gpt-5.6-terra",
  externalDataTransfer: true,
  models: getAiModelsForProvider(OPENAI_PROVIDER_ID),
  providerId: OPENAI_PROVIDER_ID,
  paidApiEnabled: true,
} satisfies PublicAiRuntime);

const consent = Object.freeze({
  grantedAt: "2026-09-20T00:00:00.000Z",
  policyVersion: 1 as const,
  providerId: "openai",
});

describe("external AI consent", () => {
  it("requires API opt-in even when external transfer consent was previously saved", () => {
    expect(canUseAiRuntime({ ...openAiRuntime, paidApiEnabled: false }, consent, "automatic")).toBe(false);
    expect(canUseAiRuntime({ ...openAiRuntime, paidApiEnabled: undefined }, consent, "automatic")).toBe(false);
  });
  it("authorizes only matching provider and current policy consent", () => {
    expect(hasMatchingAiConsent(openAiRuntime, consent)).toBe(true);
    expect(
      canUseAiRuntime(openAiRuntime, consent, AI_MODEL_PREFERENCE_AUTOMATIC),
    ).toBe(true);
    expect(requestConsentForRuntime(openAiRuntime, consent)).toEqual({
      policyVersion: 1,
      providerId: "openai",
    });

    expect(
      hasMatchingAiConsent(openAiRuntime, {
        ...consent,
        providerId: "another-provider",
      }),
    ).toBe(false);
    expect(
      canUseAiRuntime(openAiRuntime, null, AI_MODEL_PREFERENCE_AUTOMATIC),
    ).toBe(false);
    expect(requestConsentForRuntime(openAiRuntime, null)).toBeNull();
  });

  it("never attaches stored external consent to mock or disabled requests", () => {
    const mockRuntime = {
      available: true,
      defaultModelId: LOCAL_DEMO_MODEL_ID,
      externalDataTransfer: false,
      models: getAiModelsForProvider(MOCK_PROVIDER_ID),
      providerId: MOCK_PROVIDER_ID,
    } satisfies PublicAiRuntime;
    const disabledRuntime = {
      available: false,
      defaultModelId: null,
      externalDataTransfer: false,
      models: [],
      providerId: null,
    } satisfies PublicAiRuntime;

    expect(
      canUseAiRuntime(mockRuntime, null, AI_MODEL_PREFERENCE_AUTOMATIC),
    ).toBe(true);
    expect(requestConsentForRuntime(mockRuntime, consent)).toBeNull();
    expect(
      canUseAiRuntime(disabledRuntime, consent, AI_MODEL_PREFERENCE_AUTOMATIC),
    ).toBe(false);
  });

  it("preserves provider-scoped consent across valid OpenAI model choices", () => {
    for (const preference of [
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]) {
      expect(canUseAiRuntime(openAiRuntime, consent, preference)).toBe(true);
      expect(resolveRuntimeModel(openAiRuntime, preference)?.id).toBe(
        preference,
      );
      expect(requestModelIdForRuntime(openAiRuntime, preference)).toBe(
        preference,
      );
    }
    expect(
      requestModelIdForRuntime(
        openAiRuntime,
        AI_MODEL_PREFERENCE_AUTOMATIC,
      ),
    ).toBeNull();
  });

  it("does not silently resolve an unavailable explicit preference", () => {
    expect(resolveRuntimeModel(openAiRuntime, "gpt-retired-model")).toBeNull();
    expect(
      requestModelIdForRuntime(openAiRuntime, "gpt-retired-model"),
    ).toBeUndefined();
    expect(
      canUseAiRuntime(openAiRuntime, consent, "gpt-retired-model"),
    ).toBe(false);
  });
});
