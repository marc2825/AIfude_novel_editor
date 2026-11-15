import "server-only";

import { LLM_CANDIDATES_SCHEMA } from "../../../contracts/llm-candidates.schema";
import {
  findAiModelDefinition,
  isAiEditCompatibleModel,
  LOCAL_LLM_PROVIDER_ID,
  CHATGPT_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  isPaidApiProvider,
  type AiModelDefinition,
  type SelectableAiModelId,
} from "../../domain/ai-models";
import {
  aiEditRequestIdSchema,
  aiEditSuccessResponseSchema,
  validateAiEditRequest,
  validateLlmCandidateResponse,
  type AiEditSuccessResponse,
} from "../../domain/ai-edit";
import {
  AI_EXTERNAL_CONSENT_POLICY_VERSION,
  AI_EDIT_LIMITS,
  AI_EDIT_SCHEMA_VERSION,
} from "../../domain/limits";
import { createAiEditRequestContract } from "../../features/ai-edit/intent";
import type { AiEditErrorCode } from "../http/errors";
import type { AiRateLimiter } from "../http/rate-limit";
import {
  createPromptPlan,
  renderPromptPlan,
} from "./prompt";
import type {
  EditingProvider,
  EditingProviderInput,
  EditingProviderResult,
} from "./provider";

export const AI_EDIT_PROVIDER_DEADLINE_MILLISECONDS = 30_000;
export const AI_EDIT_LOCAL_PROVIDER_DEADLINE_MILLISECONDS = 180_000;

export type AiEditServiceResult =
  | Readonly<{
      data: AiEditSuccessResponse;
      success: true;
    }>
  | Readonly<{
      code: AiEditErrorCode;
      requestId: string | null;
      success: false;
    }>;

export type AiEditService = Readonly<{
  generate: (
    value: unknown,
    requestSignal: AbortSignal,
  ) => Promise<AiEditServiceResult>;
}>;

type ServiceDependencies = Readonly<{
  provider: EditingProvider | null;
  rateLimiter: AiRateLimiter;
}>;

type ProviderInvocation =
  | Readonly<{
      result: EditingProviderResult;
      status: "completed";
    }>
  | Readonly<{
      source: "deadline" | "request";
      status: "aborted";
    }>
  | Readonly<{ status: "failed" }>;

const textEncoder = new TextEncoder();

function failed(
  code: AiEditErrorCode,
  requestId: string | null,
): AiEditServiceResult {
  return { code, requestId, success: false };
}

function recoverRequestId(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("requestId" in value)
  ) {
    return null;
  }

  const result = aiEditRequestIdSchema.safeParse(value.requestId);

  return result.success ? result.data : null;
}

export function providerFailureCode(
  reason: Extract<EditingProviderResult, { status: "failed" }>["reason"],
): AiEditErrorCode {
  switch (reason) {
    case "timeout":
      return "PROVIDER_TIMEOUT";
    case "refusal":
      return "PROVIDER_REFUSAL";
    case "incomplete":
      return "INCOMPLETE_OUTPUT";
    case "failure":
      return "PROVIDER_FAILURE";
    case "auth-required":
      return "AUTH_REQUIRED";
    case "subscription-limit":
      return "SUBSCRIPTION_LIMIT";
  }
}

export function isProviderOutputWithinLimit(output: unknown): boolean {
  try {
    const serialized = JSON.stringify(output);

    return (
      serialized !== undefined &&
      textEncoder.encode(serialized).byteLength <=
        AI_EDIT_LIMITS.responseBodyBytes
    );
  } catch {
    return false;
  }
}

export function resolveProviderModel(
  provider: EditingProvider,
  requestedModelId: SelectableAiModelId | null,
): AiModelDefinition | null {
  const model = findAiModelDefinition(
    requestedModelId ?? provider.defaultModelId,
  );

  if (
    model === null ||
    model.providerId !== provider.providerId ||
    (requestedModelId !== null && !model.selectable) ||
    (provider.providerId === OPENAI_PROVIDER_ID && !isAiEditCompatibleModel(model))
  ) {
    return null;
  }

  return model;
}

export async function invokeProvider(
  provider: EditingProvider,
  input: Omit<EditingProviderInput, "signal">,
  requestSignal: AbortSignal,
): Promise<ProviderInvocation> {
  if (requestSignal.aborted) {
    return { source: "request", status: "aborted" };
  }

  const deadlineController = new AbortController();
  let deadlineExpired = false;
  const deadline = setTimeout(() => {
    deadlineExpired = true;
    deadlineController.abort();
  }, provider.providerId === LOCAL_LLM_PROVIDER_ID || provider.providerId === CHATGPT_PROVIDER_ID || provider.providerId === "claude"
    ? AI_EDIT_LOCAL_PROVIDER_DEADLINE_MILLISECONDS
    : AI_EDIT_PROVIDER_DEADLINE_MILLISECONDS);
  const signal = AbortSignal.any([
    requestSignal,
    deadlineController.signal,
  ]);
  let removeAbortListener = () => {};
  const aborted = new Promise<ProviderInvocation>((resolve) => {
    const onAbort = () => {
      resolve({
        source: deadlineExpired ? "deadline" : "request",
        status: "aborted",
      });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);

    if (signal.aborted) {
      onAbort();
    }
  });
  const providerResult: Promise<ProviderInvocation> = Promise.resolve().then(
    async () => {
      try {
        const result = await provider.generateCandidates({ ...input, signal });

        return { result, status: "completed" };
      } catch {
        return { status: "failed" };
      }
    },
  );

  try {
    const result = await Promise.race([providerResult, aborted]);

    if (deadlineExpired) {
      return { source: "deadline", status: "aborted" };
    }

    return result;
  } finally {
    clearTimeout(deadline);
    removeAbortListener();
  }
}

export function createAiEditService(
  dependencies: ServiceDependencies,
): AiEditService {
  return Object.freeze({
    async generate(
      value: unknown,
      requestSignal: AbortSignal,
    ): Promise<AiEditServiceResult> {
      const recoveredRequestId = recoverRequestId(value);

      try {
        const requestValidation = validateAiEditRequest(value);

        if (!requestValidation.success) {
          return failed("INVALID_REQUEST", recoveredRequestId);
        }

        const request = requestValidation.data;
        const requestId = request.requestId;
        const provider = dependencies.provider;

        if (provider === null) {
          return failed("AI_UNAVAILABLE", requestId);
        }

        if (isPaidApiProvider(provider.providerId) && request.allowPaidApi !== true) {
          return failed("CONSENT_REQUIRED", requestId);
        }

        const model = resolveProviderModel(provider, request.modelId);

        if (model === null) {
          return failed("INVALID_REQUEST", requestId);
        }

        if (
          provider.externalDataTransfer &&
          (request.consent === null ||
            request.consent.providerId !== provider.providerId ||
            request.consent.policyVersion !==
              AI_EXTERNAL_CONSENT_POLICY_VERSION)
        ) {
          return failed("CONSENT_REQUIRED", requestId);
        }

        if (requestSignal.aborted) {
          return failed("PROVIDER_FAILURE", requestId);
        }

        const rateLimit = dependencies.rateLimiter.acquire(
          provider.providerId === "mock" ? "mock" : "external",
        );

        if (!rateLimit.success) {
          return failed("RATE_LIMITED", requestId);
        }

        try {
          const contract = createAiEditRequestContract(request);

          if (!contract.success) {
            return failed("INVALID_REQUEST", requestId);
          }

          const prompt = createPromptPlan(contract.data.modelInput);

          if (!prompt.success) {
            return failed("INVALID_REQUEST", requestId);
          }

          const providerInvocation = await invokeProvider(
            provider,
            {
              ...(request.connectionId === undefined ? {} : { connectionId: request.connectionId }),
              model,
              outputTokenLimit:
                prompt.data.promptPlan.outputRequirements.outputTokenLimit,
              prompt: renderPromptPlan(prompt.data.promptPlan),
              responseSchema: LLM_CANDIDATES_SCHEMA,
            },
            requestSignal,
          );

          if (providerInvocation.status === "aborted") {
            return failed(
              providerInvocation.source === "deadline"
                ? "PROVIDER_TIMEOUT"
                : "PROVIDER_FAILURE",
              requestId,
            );
          }

          if (providerInvocation.status === "failed") {
            return failed("PROVIDER_FAILURE", requestId);
          }

          const providerResult = providerInvocation.result;

          if (providerResult.status === "failed") {
            return failed(providerFailureCode(providerResult.reason), requestId);
          }

          if (!isProviderOutputWithinLimit(providerResult.output)) {
            return failed("INVALID_OUTPUT", requestId);
          }

          const candidates = validateLlmCandidateResponse(
            providerResult.output,
            contract.data.modelInput.selectionText,
            contract.data.modelInput.candidateCount,
            request.operation,
          );

          if (!candidates.success) {
            return failed("INVALID_OUTPUT", requestId);
          }

          const generatedAt = new Date().toISOString();
          const responseModelId = providerResult.modelId ?? model.id;
          const responseValidation = aiEditSuccessResponseSchema.safeParse({
            schemaVersion: AI_EDIT_SCHEMA_VERSION,
            requestId,
            intent: contract.data.modelInput.editIntent,
            candidates: candidates.data.candidates.map((candidate, index) => ({
              ...candidate,
              generatedAt,
              id: crypto.randomUUID(),
              index,
              model: responseModelId,
              providerId: provider.providerId,
              requestId,
            })),
            contextUsage: prompt.data.contextUsage,
            usage: providerResult.usage,
            provider: {
              model: responseModelId,
              providerId: provider.providerId,
            },
          });

          if (!responseValidation.success) {
            return failed("INVALID_OUTPUT", requestId);
          }

          return { data: responseValidation.data, success: true };
        } finally {
          rateLimit.permit.release();
        }
      } catch {
        return failed("PROVIDER_FAILURE", recoveredRequestId);
      }
    },
  });
}
