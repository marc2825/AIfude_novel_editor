import { describe, expect, it, vi } from "vitest";
import { feedbackResponseSchema } from "../../src/domain/feedback";
import { handleFeedbackPost } from "../../src/server/http/feedback-handler";
import { readAiServerConfig } from "../../src/server/ai/config";
import { LOCAL_DEMO_MODEL_ID } from "../../src/domain/ai-models";
import type { EditingProvider, EditingProviderInput, EditingProviderResult } from "../../src/server/ai/provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import { createDeferred } from "../helpers/deferred";

const origin = "http://127.0.0.1:3000";
const input = { schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", text: "一番最初に会った。", consent: null, modelId: null };
const output = { candidates: [{ replacementText: "「一番最初」の強調が必要か確認してください。", explanation: "一番最初", riskNotes: ["意図した強調かもしれません。"] }] };
function request(value: unknown = input, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(`${origin}/api/ai/feedback`, { method: "POST", body: JSON.stringify(value), signal, headers: {
    host: "127.0.0.1:3000", origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers,
  } });
}
function dependencies(generateCandidates: EditingProvider["generateCandidates"], external = false) {
  const provider: EditingProvider = { generateCandidates, externalDataTransfer: external, providerId: external ? "openai" : "mock", defaultModelId: external ? "gpt-5.6-terra" : LOCAL_DEMO_MODEL_ID };
  return { provider, rateLimiter: createAiRateLimiter(() => 0), config: readAiServerConfig({ APP_ORIGIN: origin, AI_PROVIDER: provider.providerId, AI_ENABLE_PAID_API: "true", OPENAI_API_KEY: "fixture-key", OPENAI_MODEL: "gpt-5.6-terra" }) };
}
describe("read-only Feedback boundary", () => {
  it("sends only the reviewed manuscript as untrusted data and returns bounded comments", async () => {
    const generate = vi.fn(async (value: EditingProviderInput): Promise<EditingProviderResult> => {
      expect(JSON.parse(value.prompt.inputDataJson)).toEqual({ purpose: "feedback", manuscript: input.text, candidateCount: 2 });
      expect(value.prompt.systemInstruction).toContain("読み取り専用");
      expect(value.prompt.systemInstruction).toContain("未信頼");
      return { status: "completed", output, usage: null };
    });
    const response = await handleFeedbackPost(request(), dependencies(generate));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const parsed = feedbackResponseSchema.parse(await response.json());
    expect(parsed.comments[0]).toMatchObject({ quote: "一番最初", comment: output.candidates[0].replacementText });
    expect(parsed).not.toHaveProperty("replacementText"); expect(generate).toHaveBeenCalledOnce();
  });
  it.each([{ text: "あ".repeat(6_001) }, { text: "" }, { text: "\ud800" }, { storyMemory: {} }, { instruction: "書き換えて" }])("rejects invalid input before generation", async (extra) => {
    const generate = vi.fn(); const response = await handleFeedbackPost(request({ ...input, ...extra }), dependencies(generate));
    expect(response.status).toBe(400); expect(generate).not.toHaveBeenCalled();
  });
  it.each([[{ origin: "https://evil.example" }, 403], [{ "sec-fetch-site": "cross-site" }, 403], [{ "content-type": "text/plain" }, 415], [{ "content-length": "65537" }, 413]] as const)("applies HTTP origin and body guards", async (headers, status) => {
    const generate = vi.fn(); expect((await handleFeedbackPost(request(input, headers), dependencies(generate))).status).toBe(status);
    expect(generate).not.toHaveBeenCalled();
  });
  it("requires matching consent and explicit paid permission", async () => {
    const generate = vi.fn(); const deps = dependencies(generate, true);
    for (const extra of [{}, { allowPaidApi: true }, { allowPaidApi: true, consent: { providerId: "chatgpt", policyVersion: 1 } }]) {
      expect((await handleFeedbackPost(request({ ...input, ...extra }), deps)).status).toBe(403);
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(["refusal", "incomplete", "timeout"] as const)("reports %s without repair or retry", async (reason) => {
    const generate = vi.fn(async (): Promise<EditingProviderResult> => ({ status: "failed", reason }));
    expect((await handleFeedbackPost(request(), dependencies(generate))).status).toBeGreaterThanOrEqual(400);
    expect(generate).toHaveBeenCalledOnce();
  });
  it.each([{ candidates: [] }, { candidates: [{ ...output.candidates[0], replacementText: "あ".repeat(1_201) }] }, { html: "<script>" }])("rejects malformed output", async (invalid) => {
    const generate = vi.fn(async (): Promise<EditingProviderResult> => ({ status: "completed", output: invalid, usage: null }));
    expect((await handleFeedbackPost(request(), dependencies(generate))).status).toBe(502); expect(generate).toHaveBeenCalledOnce();
  });
  it("settles cancellation even when the provider ignores abort and replies late", async () => {
    const pending = createDeferred<EditingProviderResult>(); const controller = new AbortController();
    const generate = vi.fn(() => pending.promise);
    const response = handleFeedbackPost(request(input, {}, controller.signal), dependencies(generate));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce()); controller.abort();
    expect((await response).status).toBeGreaterThanOrEqual(400);
    pending.resolve({ status: "completed", output, usage: null });
  });
});
