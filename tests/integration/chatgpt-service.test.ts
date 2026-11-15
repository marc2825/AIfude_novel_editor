import { describe, expect, it, vi } from "vitest";
import { createAiEditService } from "../../src/server/ai/edit-service";
import { createChatGptEditingProvider } from "../../src/server/ai/chatgpt/provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import { createAiEditRequestFixture, createCandidateWireResponse } from "../fixtures/candidates";
import { CHATGPT_CONNECTION_ID, CHATGPT_MODEL, chatGptAuthStub, chatGptCompleted, chatGptStream } from "../fixtures/chatgpt";
import { createDeferred } from "../helpers/deferred";

function setup(output: unknown = createCandidateWireResponse()) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => String(url).endsWith("/models")
    ? Response.json({ models: [{ slug: CHATGPT_MODEL, visibility: "list" }] }) : chatGptStream([chatGptCompleted(output)]));
  const service = createAiEditService({ provider: createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch), rateLimiter: createAiRateLimiter(() => 0) });
  const request = { ...createAiEditRequestFixture({ consent: { providerId: "chatgpt", policyVersion: 1 } }), connectionId: CHATGPT_CONNECTION_ID };
  return { fetch, service, request };
}
describe("ChatGPT through the edit service", () => {
  it("returns canonical validated candidates and actual subscription model metadata", async () => {
    const { service, request } = setup();
    const result = await service.generate(request, new AbortController().signal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.provider).toEqual({ model: CHATGPT_MODEL, providerId: "chatgpt" });
    expect(result.data.candidates).toHaveLength(2);
    expect(result.data.candidates.every((candidate) => candidate.model === CHATGPT_MODEL && candidate.providerId === "chatgpt")).toBe(true);
  });
  it("makes no upstream calls without consent or with an incompatible model", async () => {
    const { service, request, fetch } = setup();
    await expect(service.generate({ ...request, consent: null }, new AbortController().signal)).resolves.toMatchObject({ success: false, code: "CONSENT_REQUIRED" });
    await expect(service.generate({ ...request, modelId: "gpt-6-astra" }, new AbortController().signal)).resolves.toMatchObject({ success: false, code: "INVALID_REQUEST" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains business validation after a structurally valid streamed completion", async () => {
    const { service, request } = setup({ candidates: [createCandidateWireResponse().candidates[0]] });
    await expect(service.generate(request, new AbortController().signal)).resolves.toMatchObject({ success: false, code: "INVALID_OUTPUT" });
  });
  it("normalizes subscription usage errors without calling another provider", async () => {
    const { request } = setup();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ models: [{ slug: CHATGPT_MODEL, visibility: "list" }] }))
      .mockResolvedValueOnce(chatGptStream([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]));
    const service = createAiEditService({ provider: createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch), rateLimiter: createAiRateLimiter(() => 0) });
    await expect(service.generate(request, new AbortController().signal)).resolves.toMatchObject({ success: false, code: "SUBSCRIPTION_LIMIT" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("waits beyond 35 seconds and times out at 180 seconds even if the subscription transport ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const { request } = setup();
      const pending = createDeferred<Response>();
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ models: [{ slug: CHATGPT_MODEL, visibility: "list" }] })).mockReturnValueOnce(pending.promise);
      const service = createAiEditService({ provider: createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch), rateLimiter: createAiRateLimiter(() => 0) });
      const result = service.generate(request, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(35_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(145_000);
      await expect(result).resolves.toMatchObject({ code: "PROVIDER_TIMEOUT", success: false });
      expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
      pending.resolve(chatGptStream([chatGptCompleted()]));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
