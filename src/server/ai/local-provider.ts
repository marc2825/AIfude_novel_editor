import "server-only";

import { z } from "zod";

import {
  LOCAL_LLM_MODEL_ID,
  LOCAL_LLM_PROVIDER_ID,
} from "../../domain/ai-models";
import { AI_EDIT_LIMITS } from "../../domain/limits";
import { parseLocalLlmBaseUrl } from "./config";
import type {
  EditingProvider,
  EditingProviderInput,
  EditingProviderResult,
} from "./provider";

type LocalProviderConfig = Readonly<{
  apiKey: string | null;
  baseUrl: string;
  model: string;
}>;

type LocalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const responseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({
      content: z.string().nullable().optional(),
      refusal: z.string().nullable().optional(),
      role: z.literal("assistant"),
      tool_calls: z.array(z.unknown()).optional(),
    }),
  })).length(1),
  usage: z.unknown().optional(),
});

const usageSchema = z.object({
  completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

function invalidOutput(): EditingProviderResult {
  return { output: null, status: "completed", usage: null };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.body === null) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      bytes += chunk.value.byteLength;

      if (bytes > AI_EDIT_LIMITS.responseBodyBytes) {
        await reader.cancel();
        return null;
      }

      text += decoder.decode(chunk.value, { stream: true });
    }

    text += decoder.decode();

    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      return null;
    }
  } finally {
    reader.releaseLock();
  }
}

function normalizeResponse(value: unknown, modelId: string): EditingProviderResult {
  const parsed = responseSchema.safeParse(value);

  if (!parsed.success) {
    return invalidOutput();
  }

  const choice = parsed.data.choices[0];

  if (choice === undefined) {
    return invalidOutput();
  }

  if (choice.message.refusal || choice.finish_reason === "content_filter") {
    return { reason: "refusal", status: "failed" };
  }

  if (choice.finish_reason === "length") {
    return { reason: "incomplete", status: "failed" };
  }

  if (
    choice.finish_reason !== "stop" ||
    (choice.message.tool_calls?.length ?? 0) > 0 ||
    typeof choice.message.content !== "string"
  ) {
    return invalidOutput();
  }

  try {
    const output: unknown = JSON.parse(choice.message.content);
    const usage = usageSchema.safeParse(parsed.data.usage);

    return {
      modelId,
      output,
      status: "completed",
      usage: usage.success
        ? {
            inputTokens: usage.data.prompt_tokens,
            outputTokens: usage.data.completion_tokens,
          }
        : null,
    };
  } catch {
    return invalidOutput();
  }
}

export function createLocalEditingProvider(
  config: LocalProviderConfig,
  fetchImplementation: LocalFetch = globalThis.fetch,
): EditingProvider {
  const baseUrl = parseLocalLlmBaseUrl(config.baseUrl);

  return Object.freeze({
    defaultModelId: LOCAL_LLM_MODEL_ID,
    externalDataTransfer: false,
    providerId: LOCAL_LLM_PROVIDER_ID,
    async generateCandidates(input: EditingProviderInput): Promise<EditingProviderResult> {
      if (
        baseUrl === null ||
        input.signal.aborted ||
        input.model.id !== LOCAL_LLM_MODEL_ID ||
        input.model.providerId !== LOCAL_LLM_PROVIDER_ID
      ) {
        return { reason: "failure", status: "failed" };
      }

      try {
        const response = await fetchImplementation(`${baseUrl}/chat/completions`, {
          body: JSON.stringify({
            max_tokens: input.outputTokenLimit,
            messages: [
              { content: input.prompt.systemInstruction, role: "system" },
              { content: input.prompt.inputDataJson, role: "user" },
            ],
            model: config.model,
            response_format: {
              json_schema: {
                name: "llm_candidates",
                schema: input.responseSchema,
                strict: true,
              },
              type: "json_schema",
            },
            stream: false,
          }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey === null
              ? {}
              : { Authorization: `Bearer ${config.apiKey}` }),
          },
          method: "POST",
          redirect: "error",
          signal: input.signal,
        });

        if (input.signal.aborted) {
          await response.body?.cancel();
          return { reason: "failure", status: "failed" };
        }

        if (!response.ok) {
          await response.body?.cancel();
          return {
            reason: response.status === 408 || response.status === 504
              ? "timeout"
              : "failure",
            status: "failed",
          };
        }

        const value = await readBoundedJson(response);

        return input.signal.aborted
          ? { reason: "failure", status: "failed" }
          : normalizeResponse(value, config.model);
      } catch {
        return { reason: "failure", status: "failed" };
      }
    },
  });
}
