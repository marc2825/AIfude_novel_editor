import { dictionaryGenerationRequest, dictionaryRequestSchema, type DictionaryRequest } from "../../domain/dictionary";
import { AI_EDIT_CLIENT_DEADLINE_MILLISECONDS, AI_EDIT_LOCAL_CLIENT_DEADLINE_MILLISECONDS, postAiEditRequest, type AiEditClientResult } from "./client";
import type { PublicAiRuntime } from "./consent";

export async function postDictionaryRequest(request: DictionaryRequest, signal: AbortSignal, runtime: PublicAiRuntime): Promise<AiEditClientResult> {
  const parsed = dictionaryRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "error", error: { kind: "invalid-input", retryable: false } };
  return postAiEditRequest(
    dictionaryGenerationRequest(parsed.data), signal,
    (_url, init) => globalThis.fetch("/api/ai/dictionary", { ...init, body: JSON.stringify(parsed.data) }),
    ["local", "chatgpt", "claude"].includes(runtime.providerId ?? "") ? AI_EDIT_LOCAL_CLIENT_DEADLINE_MILLISECONDS : AI_EDIT_CLIENT_DEADLINE_MILLISECONDS,
    runtime.settingsRevision,
  );
}
