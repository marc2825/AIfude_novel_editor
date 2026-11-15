import { browserIsOffline } from "../offline/connection-state";
import { aiComparisonResponseSchema, type AiComparisonRequest, type AiComparisonResponse, type AiComparisonResult } from "../../domain/ai-comparison";
import { AI_EDIT_LIMITS } from "../../domain/limits";
import { validateAiEditClientSuccess, type AiEditClientResult } from "./client";

export type AiComparisonClientResult =
  | Readonly<{ status: "comparison-success"; data: AiComparisonResponse }>
  | Exclude<AiEditClientResult, Readonly<{ status: "success" }>>;
export type SendAiComparisonRequest = (request: AiComparisonRequest, signal: AbortSignal) => Promise<AiComparisonClientResult>;

export async function postAiComparisonRequest(request: AiComparisonRequest, requestSignal: AbortSignal, settingsRevision?: string): Promise<AiComparisonClientResult> {
  if (requestSignal.aborted) return { status: "cancelled" };
  if (browserIsOffline()) return { status: "error", error: { kind: "transport", retryable: true } };
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 185_000);
  const signal = AbortSignal.any([requestSignal, controller.signal]);
  let remove = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new DOMException("Comparison cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true }); remove = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
  });
  const receive = (async () => {
    const response = await fetch("/api/ai/comparisons", { method: "POST", headers: { "Content-Type": "application/json", ...(settingsRevision === undefined ? {} : { "x-novel-ai-settings-revision": settingsRevision }) }, body: JSON.stringify(request), signal });
    if (signal.aborted) { await response.body?.cancel(); throw new Error("Cancelled response"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response");
    const cancelReader = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancelReader, { once: true });
    let bytes = 0; let text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        if (signal.aborted) throw new Error("Cancelled body");
        bytes += next.value.byteLength;
        if (bytes > AI_EDIT_LIMITS.responseBodyBytes) { await reader.cancel(); throw new Error("Response limit"); }
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
      const value: unknown = JSON.parse(text);
      return { ok: response.ok, value };
    } finally { signal.removeEventListener("abort", cancelReader); reader.releaseLock(); }
  })();
  try {
    const response = await Promise.race([receive, aborted]);
    const parsed = aiComparisonResponseSchema.safeParse(response.value);
    if (!response.ok || !parsed.success || parsed.data.requestId !== request.request.requestId ||
      parsed.data.results.length !== request.targets.length || parsed.data.results.some((result, index) => result.providerId !== request.targets[index]?.providerId)) {
      return { status: "error", error: { kind: "invalid-response", retryable: true } };
    }
    const results: AiComparisonResult[] = [];
    for (const result of parsed.data.results) {
      if (result.success) {
        const validated = validateAiEditClientSuccess(result.data, request.request);
        if (validated?.status !== "success") return { status: "error", error: { kind: "invalid-response", retryable: true } };
        results.push(Object.freeze({ ...result, data: validated.data }));
      } else {
        results.push(Object.freeze(result));
      }
    }
    return { status: "comparison-success", data: Object.freeze({ requestId: parsed.data.requestId, results: Object.freeze(results) }) };
  } catch {
    return requestSignal.aborted ? { status: "cancelled" } : { status: "error", error: { kind: timedOut ? "client-timeout" : "transport", retryable: true } };
  } finally { clearTimeout(timeout); remove(); }
}
