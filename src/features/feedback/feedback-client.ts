import { browserIsOffline } from "../offline/connection-state";
import { feedbackRequestSchema, feedbackResponseSchema, type FeedbackRequest, type FeedbackResponse } from "../../domain/feedback";

export async function requestFeedback(request: FeedbackRequest, signal: AbortSignal, settingsRevision?: string): Promise<FeedbackResponse> {
  if (signal.aborted || browserIsOffline()) throw new Error("接続してから明示的に再実行してください。自動再送信は行いません。");
  const parsed = feedbackRequestSchema.safeParse(request);
  if (!parsed.success) throw new Error("送信する本文と文字数を確認してください。");
  const response = await fetch("/api/ai/feedback", {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { "Content-Type": "application/json", ...(settingsRevision ? { "x-novel-ai-settings-revision": settingsRevision } : {}) }, body: JSON.stringify(parsed.data),
  });
  if (!response.ok || !response.body) throw new Error("Feedbackを取得できません。接続・同意・利用枠を確認してください。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 64 * 1_024) { await reader.cancel(); throw new Error("Feedbackの応答が大きすぎます。"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const result = feedbackResponseSchema.safeParse(value);
  if (!result.success || result.data.requestId !== request.requestId || signal.aborted) throw new Error("Feedbackの応答を検証できませんでした。");
  return result.data;
}
