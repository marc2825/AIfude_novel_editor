import "server-only";

import type { LLM_CANDIDATES_SCHEMA } from "../../../contracts/llm-candidates.schema";
import type {
  AiModelDefinition,
  AiModelId,
  AiProviderId,
} from "../../domain/ai-models";
import type { RenderedPromptPlan } from "./prompt";

export const EDITING_PROVIDER_FAILURE_REASONS = Object.freeze([
  "timeout",
  "refusal",
  "incomplete",
  "failure",
  "auth-required",
  "subscription-limit",
] as const);

export type EditingProviderFailureReason =
  (typeof EDITING_PROVIDER_FAILURE_REASONS)[number];

export type EditingProviderUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
}>;

export type EditingProviderInput = Readonly<{
  connectionId?: string;
  model: AiModelDefinition;
  outputTokenLimit: number;
  prompt: RenderedPromptPlan;
  responseSchema: typeof LLM_CANDIDATES_SCHEMA;
  signal: AbortSignal;
}>;

export type EditingProviderResult =
  | Readonly<{
      output: unknown;
      modelId?: string;
      status: "completed";
      usage: EditingProviderUsage | null;
    }>
  | Readonly<{
      reason: EditingProviderFailureReason;
      status: "failed";
    }>;

export interface EditingProvider {
  readonly defaultModelId: AiModelId;
  readonly externalDataTransfer: boolean;
  readonly providerId: AiProviderId;

  generateCandidates(
    input: EditingProviderInput,
  ): Promise<EditingProviderResult>;
}
