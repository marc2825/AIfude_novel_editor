import "server-only";

import OpenAI, { APIConnectionTimeoutError } from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import {
  isAiEditCompatibleModel,
  OPENAI_PROVIDER_ID,
  type SelectableAiModelId,
} from "../../domain/ai-models";
import { AI_EDIT_LIMITS } from "../../domain/limits";
import type {
  EditingProvider,
  EditingProviderInput,
  EditingProviderResult,
  EditingProviderUsage,
} from "./provider";

const OPENAI_RESPONSE_FORMAT_NAME = "llm_candidates";
const textEncoder = new TextEncoder();

export type OpenAiClientOptions = Readonly<{
  apiKey: string;
  baseURL: "https://api.openai.com/v1";
  logLevel: "off";
  maxRetries: 0;
}>;

export type OpenAiResponseClient = Readonly<{
  createResponse: (
    body: ResponseCreateParamsNonStreaming,
    options: Readonly<{ signal: AbortSignal }>,
  ) => Promise<unknown>;
}>;

export type CreateOpenAiResponseClient = (
  options: OpenAiClientOptions,
) => OpenAiResponseClient;

export type OpenAiEditingProviderConfig = Readonly<{
  apiKey: string;
  defaultModelId: SelectableAiModelId;
}>;

function createSdkClient(options: OpenAiClientOptions): OpenAiResponseClient {
  const client = new OpenAI(options);

  return Object.freeze({
    async createResponse(body, requestOptions) {
      return client.responses.create(body, requestOptions);
    },
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function responseHasRefusal(value: Readonly<Record<string, unknown>>): boolean {
  if (!Array.isArray(value.output)) {
    return false;
  }

  return value.output.some((item: unknown) => {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
      return false;
    }

    return item.content.some(
      (content: unknown) => isRecord(content) && content.type === "refusal",
    );
  });
}

function hasOutputText(value: Readonly<Record<string, unknown>>): boolean {
  if (!Array.isArray(value.output)) {
    return false;
  }

  return value.output.some((item: unknown) => {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
      return false;
    }

    return item.content.some(
      (content: unknown) =>
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string",
    );
  });
}

function hasUnexpectedOutput(value: Readonly<Record<string, unknown>>): boolean {
  if (!Array.isArray(value.output)) {
    return true;
  }

  return value.output.some((item: unknown) => {
    if (!isRecord(item)) {
      return true;
    }

    if (item.type === "reasoning") {
      return false;
    }

    if (item.type !== "message" || !Array.isArray(item.content)) {
      return true;
    }

    return item.content.some(
      (content: unknown) =>
        !isRecord(content) ||
        (content.type !== "output_text" && content.type !== "refusal"),
    );
  });
}

function readUsage(
  value: Readonly<Record<string, unknown>>,
): EditingProviderUsage | null {
  if (!isRecord(value.usage)) {
    return null;
  }

  const inputTokens = value.usage.input_tokens;
  const outputTokens = value.usage.output_tokens;

  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  ) {
    return null;
  }

  return Object.freeze({ inputTokens, outputTokens });
}

function completedInvalidOutput(
  usage: EditingProviderUsage | null,
): EditingProviderResult {
  return { output: null, status: "completed", usage };
}

function normalizeResponse(value: unknown): EditingProviderResult {
  if (!isRecord(value)) {
    return { reason: "failure", status: "failed" };
  }

  if (value.status === "incomplete") {
    return { reason: "incomplete", status: "failed" };
  }

  if (value.status !== "completed") {
    return { reason: "failure", status: "failed" };
  }

  if (responseHasRefusal(value)) {
    return { reason: "refusal", status: "failed" };
  }

  const usage = readUsage(value);

  if (
    hasUnexpectedOutput(value) ||
    !hasOutputText(value) ||
    typeof value.output_text !== "string"
  ) {
    return completedInvalidOutput(usage);
  }

  if (
    textEncoder.encode(value.output_text).byteLength >
    AI_EDIT_LIMITS.responseBodyBytes
  ) {
    return completedInvalidOutput(usage);
  }

  try {
    return {
      output: JSON.parse(value.output_text) as unknown,
      status: "completed",
      usage,
    };
  } catch {
    return completedInvalidOutput(usage);
  }
}

export function createOpenAiEditingProvider(
  config: OpenAiEditingProviderConfig,
  createClient: CreateOpenAiResponseClient = createSdkClient,
): EditingProvider {
  let client: OpenAiResponseClient | null = null;

  function getClient(): OpenAiResponseClient {
    client ??= createClient({
      apiKey: config.apiKey,
      baseURL: "https://api.openai.com/v1",
      logLevel: "off",
      maxRetries: 0,
    });

    return client;
  }

  return Object.freeze({
    defaultModelId: config.defaultModelId,
    externalDataTransfer: true,
    providerId: OPENAI_PROVIDER_ID,
    async generateCandidates(
      input: EditingProviderInput,
    ): Promise<EditingProviderResult> {
      if (
        input.signal.aborted ||
        input.model.providerId !== OPENAI_PROVIDER_ID ||
        !isAiEditCompatibleModel(input.model)
      ) {
        return { reason: "failure", status: "failed" };
      }

      const request: ResponseCreateParamsNonStreaming = {
        input: input.prompt.inputDataJson,
        instructions: input.prompt.systemInstruction,
        max_output_tokens: input.outputTokenLimit,
        model: input.model.id,
        store: false,
        stream: false,
        text: {
          format: {
            name: OPENAI_RESPONSE_FORMAT_NAME,
            schema: input.responseSchema,
            strict: true,
            type: "json_schema",
          },
        },
      };

      try {
        const response = await getClient().createResponse(request, {
          signal: input.signal,
        });

        if (input.signal.aborted) {
          return { reason: "failure", status: "failed" };
        }

        return normalizeResponse(response);
      } catch (error: unknown) {
        if (error instanceof APIConnectionTimeoutError) {
          return { reason: "timeout", status: "failed" };
        }

        return { reason: "failure", status: "failed" };
      }
    },
  });
}
