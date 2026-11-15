import {
  getAiModelsForProvider,
  LOCAL_DEMO_MODEL_ID,
  LOCAL_LLM_MODEL_ID,
  LOCAL_LLM_PROVIDER_ID,
  MOCK_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
} from "../../src/domain/ai-models";
import type { PublicAiRuntime } from "../../src/features/ai-edit/consent";

export const LOCAL_AI_RUNTIME: PublicAiRuntime = Object.freeze({
  available: true,
  defaultModelId: LOCAL_LLM_MODEL_ID,
  externalDataTransfer: false,
  models: getAiModelsForProvider(LOCAL_LLM_PROVIDER_ID),
  providerId: LOCAL_LLM_PROVIDER_ID,
});

export const MOCK_AI_RUNTIME: PublicAiRuntime = Object.freeze({
  available: true,
  defaultModelId: LOCAL_DEMO_MODEL_ID,
  externalDataTransfer: false,
  models: getAiModelsForProvider(MOCK_PROVIDER_ID),
  providerId: MOCK_PROVIDER_ID,
});

export const OPENAI_AI_RUNTIME: PublicAiRuntime = Object.freeze({
  available: true,
  defaultModelId: "gpt-5.6-terra",
  externalDataTransfer: true,
  models: getAiModelsForProvider(OPENAI_PROVIDER_ID),
  providerId: OPENAI_PROVIDER_ID,
  paidApiEnabled: true,
});
