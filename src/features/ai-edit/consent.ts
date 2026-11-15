import type { AiEditRequest } from "../../domain/ai-edit";
import {
  AI_MODEL_PREFERENCE_AUTOMATIC,
  isSelectableAiModelId,
  type AiModelDefinition,
  type PublicAiRuntime,
  isPaidApiProvider,
} from "../../domain/ai-models";
import { AI_EXTERNAL_CONSENT_POLICY_VERSION } from "../../domain/limits";
import type {
  AiConsent,
  AiModelPreference,
} from "../../domain/workspace";

export type { PublicAiRuntime } from "../../domain/ai-models";

export function resolveRuntimeModel(
  runtime: PublicAiRuntime,
  preference: AiModelPreference,
): AiModelDefinition | null {
  if (!runtime.available || runtime.providerId === null) {
    return null;
  }

  const modelId =
    preference === AI_MODEL_PREFERENCE_AUTOMATIC
      ? runtime.defaultModelId
      : preference;

  if (modelId === null) {
    return null;
  }

  const model = runtime.models.find((candidate) => candidate.id === modelId);

  if (
    model === undefined ||
    model.providerId !== runtime.providerId ||
    (preference !== AI_MODEL_PREFERENCE_AUTOMATIC && !model.selectable)
  ) {
    return null;
  }

  return model;
}

export function requestModelIdForRuntime(
  runtime: PublicAiRuntime,
  preference: AiModelPreference,
): AiEditRequest["modelId"] | undefined {
  const model = resolveRuntimeModel(runtime, preference);

  if (model === null) {
    return undefined;
  }

  if (preference === AI_MODEL_PREFERENCE_AUTOMATIC) {
    return null;
  }

  return isSelectableAiModelId(model.id) ? model.id : undefined;
}

export function hasMatchingAiConsent(
  runtime: PublicAiRuntime,
  consent: AiConsent | null,
): boolean {
  return (
    runtime.available &&
    runtime.externalDataTransfer &&
    runtime.providerId !== null &&
    consent !== null &&
    consent.providerId === runtime.providerId &&
    consent.policyVersion === AI_EXTERNAL_CONSENT_POLICY_VERSION
  );
}

export function canUseAiRuntime(
  runtime: PublicAiRuntime,
  consent: AiConsent | null,
  modelPreference: AiModelPreference,
): boolean {
  return (
    runtime.available &&
    (!isPaidApiProvider(runtime.providerId) || runtime.paidApiEnabled === true) &&
    (runtime.providerId !== "chatgpt" || runtime.connectionId !== undefined) &&
    resolveRuntimeModel(runtime, modelPreference) !== null &&
    (!runtime.externalDataTransfer || hasMatchingAiConsent(runtime, consent))
  );
}

export function requestConsentForRuntime(
  runtime: PublicAiRuntime,
  consent: AiConsent | null,
): AiEditRequest["consent"] {
  if (!hasMatchingAiConsent(runtime, consent) || runtime.providerId === null) {
    return null;
  }

  return Object.freeze({
    policyVersion: AI_EXTERNAL_CONSENT_POLICY_VERSION,
    providerId: runtime.providerId,
  });
}
