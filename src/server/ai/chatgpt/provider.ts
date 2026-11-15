import "server-only";

import { z } from "zod";
import { CHATGPT_MODEL_ID, CHATGPT_PROVIDER_ID } from "../../../domain/ai-models";
import { AI_EDIT_LIMITS } from "../../../domain/limits";
import type { EditingProvider, EditingProviderInput, EditingProviderResult } from "../provider";
import { ChatGptAuthError, type ChatGptAuthService } from "./auth";
import { readBoundedJson, type ChatGptFetch } from "./http";

const catalogSchema = z.object({ models: z.array(z.object({ slug: z.string(), visibility: z.string() })).max(1000) });
const usageSchema = z.object({ input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), output_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const completedSchema = z.object({ status: z.literal("completed"), output: z.array(z.unknown()).max(100), usage: z.unknown().optional() });
const messageSchema = z.object({ type: z.literal("message"), role: z.literal("assistant"), content: z.array(z.unknown()).max(100) });
const textSchema = z.object({ type: z.literal("output_text"), text: z.string() });
const eventSchema = z.object({ type: z.string(), response: z.unknown().optional(), error: z.unknown().optional(), delta: z.unknown().optional() });
const errorSchema = z.object({ code: z.string().optional() });
const maxStreamBytes = 8 * AI_EDIT_LIMITS.responseBodyBytes;

function failed(reason: Extract<EditingProviderResult, { status: "failed" }>["reason"] = "failure"): EditingProviderResult {
  return { reason, status: "failed" };
}
function providerError(value: unknown): EditingProviderResult {
  const parsed = errorSchema.safeParse(value);
  return parsed.success && parsed.data.code?.startsWith("subscription_sharing_")
    ? failed("subscription-limit") : failed();
}
function normalizeCompleted(value: unknown, model: string): EditingProviderResult {
  const parsed = completedSchema.safeParse(value);
  if (!parsed.success) return failed("incomplete");
  let text = "";
  let messages = 0;
  for (const item of parsed.data.output) {
    if (typeof item === "object" && item !== null && "type" in item && item.type === "reasoning") continue;
    const message = messageSchema.safeParse(item);
    if (!message.success) return failed();
    messages += 1;
    for (const part of message.data.content) {
      if (typeof part === "object" && part !== null && "type" in part && part.type === "refusal") return failed("refusal");
      const output = textSchema.safeParse(part);
      if (!output.success) return failed();
      text += output.data.text;
    }
  }
  if (messages !== 1 || new TextEncoder().encode(text).byteLength > AI_EDIT_LIMITS.responseBodyBytes) return failed();
  const usage = usageSchema.safeParse(parsed.data.usage);
  try {
    const output: unknown = JSON.parse(text);
    return {
      status: "completed", output, modelId: model,
      usage: usage.success ? { inputTokens: usage.data.input_tokens, outputTokens: usage.data.output_tokens } : null,
    };
  } catch { return { status: "completed", output: null, usage: null }; }
}

// HTTP/SSE stays inside the server. Only a terminal, validated result can leave it.
async function receive(response: Response, model: string, controller: AbortController): Promise<EditingProviderResult> {
  if (response.body === null || !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) return failed();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  let outputBytes = 0;
  let terminal: EditingProviderResult | null = null;
  function event(block: string) {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const value: unknown = JSON.parse(data);
    const parsed = eventSchema.parse(value);
    if (terminal !== null) throw new Error("Unexpected event after terminal");
    if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
      outputBytes += new TextEncoder().encode(parsed.delta).byteLength;
      if (outputBytes > AI_EDIT_LIMITS.responseBodyBytes) throw new Error("Output limit");
    }
    if (parsed.type === "response.completed") terminal = normalizeCompleted(parsed.response, model);
    else if (parsed.type === "response.incomplete") terminal = failed("incomplete");
    else if (parsed.type === "response.failed") {
      const error = z.object({ error: z.unknown().optional() }).safeParse(parsed.response);
      terminal = providerError(error.success ? error.data.error : null);
    } else if (parsed.type === "error") terminal = providerError(parsed.error ?? value);
  }
  try {
    while (true) {
      controller.signal.throwIfAborted();
      const chunk = await reader.read();
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxStreamBytes) throw new Error("Stream limit");
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize complete CRLF sequences without corrupting a split CR/LF pair.
      buffer = buffer.replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        event(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
    return terminal ?? failed("incomplete");
  } catch {
    controller.abort();
    await reader.cancel().catch(() => undefined);
    return failed();
  } finally { reader.releaseLock(); }
}

export function createChatGptEditingProvider(config: Readonly<{ model: string }>, auth: ChatGptAuthService, fetch: ChatGptFetch = globalThis.fetch): EditingProvider {
  return Object.freeze({
    providerId: CHATGPT_PROVIDER_ID, defaultModelId: CHATGPT_MODEL_ID, externalDataTransfer: true,
    async generateCandidates(input: EditingProviderInput): Promise<EditingProviderResult> {
      const connectionId = input.connectionId;
      if (!connectionId || input.signal.aborted || input.model.id !== CHATGPT_MODEL_ID || input.model.providerId !== CHATGPT_PROVIDER_ID) return failed("auth-required");
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, input.signal]);
      const onAbort = () => controller.abort();
      input.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const token = await auth.access(connectionId, signal);
        signal.throwIfAborted();
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const catalogResponse = await fetch("https://api.openai.com/v1/models", { headers, signal, cache: "no-store", redirect: "error" });
        if (!catalogResponse.ok) { await catalogResponse.body?.cancel(); return failed(catalogResponse.status === 401 ? "auth-required" : "failure"); }
        const catalog = catalogSchema.parse(await readBoundedJson(catalogResponse, 262_144));
        if (!catalog.models.some((model) => model.slug === config.model && model.visibility === "list")) return failed();
        if (!await auth.isCurrent(connectionId) || signal.aborted) return failed("auth-required");
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", headers, signal, cache: "no-store", redirect: "error",
          body: JSON.stringify({
            model: config.model, instructions: input.prompt.systemInstruction,
            input: [{ role: "user", content: input.prompt.inputDataJson }],
            store: false, stream: true,
            text: { format: { type: "json_schema", name: "llm_candidates", schema: input.responseSchema, strict: true } },
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return failed(response.status === 401 || response.status === 403 ? "auth-required" : response.status === 429 ? "subscription-limit" : "failure");
        }
        const result = await receive(response, config.model, controller);
        if (input.signal.aborted) return failed();
        return !await auth.isCurrent(connectionId) ? failed("auth-required") : result;
      } catch (error: unknown) {
        controller.abort();
        return failed(error instanceof ChatGptAuthError ? "auth-required" : "failure");
      } finally { input.signal.removeEventListener("abort", onAbort); }
    },
  });
}
