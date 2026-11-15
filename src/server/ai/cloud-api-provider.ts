import "server-only";
import { z } from "zod";
import { AI_EDIT_LIMITS } from "../../domain/limits";
import type { EditingProvider, EditingProviderInput, EditingProviderResult } from "./provider";

type CloudConfig = Readonly<{ apiKey: string; model: string; mode: "anthropic" | "gemini" | "xai" | "deepseek" }>;
const endpoints = Object.freeze({
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
});
const chatResponse = z.object({ model: z.string().min(1).max(128).optional(), choices: z.array(z.object({ finish_reason: z.string(), message: z.object({
  role: z.literal("assistant"), content: z.string().nullable().optional(), refusal: z.string().nullable().optional(), tool_calls: z.array(z.unknown()).optional(),
}) })).length(1) });
const anthropicResponse = z.object({ model: z.string().min(1).max(128).optional(), stop_reason: z.string().nullable(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })) });
const invalid = (): EditingProviderResult => ({ output: null, status: "completed", usage: null });

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0; let text = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > AI_EDIT_LIMITS.responseBodyBytes) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}

function normalize(value: unknown, config: CloudConfig): EditingProviderResult {
  let text: string;
  let modelId = config.model;
  if (config.mode === "anthropic") {
    const parsed = anthropicResponse.safeParse(value); if (!parsed.success) return invalid();
    modelId = parsed.data.model ?? config.model;
    if (parsed.data.stop_reason === "refusal") return { status: "failed", reason: "refusal" };
    if (parsed.data.stop_reason === "max_tokens") return { status: "failed", reason: "incomplete" };
    if (parsed.data.stop_reason !== "end_turn" || parsed.data.content.length === 0 || parsed.data.content.some((part) => part.type !== "text" || part.text === undefined)) return invalid();
    text = parsed.data.content.map((part) => part.text).join("");
  } else {
    const parsed = chatResponse.safeParse(value); const choice = parsed.success ? parsed.data.choices[0] : undefined;
    if (!choice) return invalid();
    if (parsed.success) modelId = parsed.data.model ?? config.model;
    if (choice.message.refusal || choice.finish_reason === "content_filter") return { status: "failed", reason: "refusal" };
    if (choice.finish_reason === "length") return { status: "failed", reason: "incomplete" };
    if (choice.finish_reason !== "stop" || choice.message.tool_calls?.length || typeof choice.message.content !== "string") return invalid();
    text = choice.message.content;
  }
  try { const output: unknown = JSON.parse(text); return { status: "completed", output, modelId, usage: null }; }
  catch { return invalid(); }
}

export function createCloudApiEditingProvider(config: CloudConfig, fetchImplementation: typeof fetch = globalThis.fetch): EditingProvider {
  return Object.freeze({
    defaultModelId: `${config.mode}-default`, providerId: config.mode, externalDataTransfer: true,
    async generateCandidates(input: EditingProviderInput): Promise<EditingProviderResult> {
      if (input.signal.aborted || input.model.providerId !== config.mode) return { status: "failed", reason: "failure" };
      const system = config.mode === "deepseek" ? `${input.prompt.systemInstruction}\nJSON schema: ${JSON.stringify(input.responseSchema)}` : input.prompt.systemInstruction;
      const body = config.mode === "anthropic" ? {
        model: config.model, max_tokens: input.outputTokenLimit, system,
        messages: [{ role: "user", content: input.prompt.inputDataJson }],
        output_config: { format: { type: "json_schema", schema: input.responseSchema } },
      } : {
        model: config.model, max_tokens: input.outputTokenLimit, stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: input.prompt.inputDataJson }],
        response_format: config.mode === "deepseek" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "llm_candidates", schema: input.responseSchema, strict: true } },
      };
      try {
        const response = await fetchImplementation(endpoints[config.mode], {
          method: "POST", redirect: "error", cache: "no-store", signal: input.signal, body: JSON.stringify(body),
          headers: { "Content-Type": "application/json", ...(config.mode === "anthropic" ? { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${config.apiKey}` }) },
        });
        if (input.signal.aborted || !response.ok) {
          await response.body?.cancel();
          return { status: "failed", reason: response.status === 401 || response.status === 403 ? "auth-required" : response.status === 408 || response.status === 504 ? "timeout" : "failure" };
        }
        const output = await boundedJson(response);
        return input.signal.aborted ? { status: "failed", reason: "failure" } : normalize(output, config);
      } catch { return { status: "failed", reason: "failure" }; }
    },
  });
}
