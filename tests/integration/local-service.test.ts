import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_EDIT_LOCAL_PROVIDER_DEADLINE_MILLISECONDS,
  createAiEditService,
} from "../../src/server/ai/edit-service";
import { createLocalEditingProvider } from "../../src/server/ai/local-provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import { createAiEditRequestFixture, createCandidateWireResponse } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

const config = { apiKey: null, baseUrl: "http://127.0.0.1:1234/v1", model: "test-local-model" };

function completion(output: unknown = createCandidateWireResponse()) {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output), role: "assistant" } }],
  });
}

function serviceWith(fetch: typeof globalThis.fetch) {
  return createAiEditService({
    provider: createLocalEditingProvider(config, fetch),
    rateLimiter: createAiRateLimiter(() => 0),
  });
}

afterEach(() => vi.useRealTimers());

describe("local LLM through the AI service", () => {
  it.each([2, 3] as const)("validates %i local candidates without external consent and reports the actual configured model", async (candidateCount) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(completion(createCandidateWireResponse(candidateCount)));
    const result = await serviceWith(fetch).generate(
      createAiEditRequestFixture({ candidateCount }), new AbortController().signal,
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.provider).toEqual({ model: config.model, providerId: "local" });
    expect(result.data.candidates).toHaveLength(candidateCount);
    for (const candidate of result.data.candidates) {
      expect(candidate).toMatchObject({ model: config.model, providerId: "local" });
      expect(candidate.id).toMatch(/^[0-9a-f-]{36}$/u);
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { candidates: [createCandidateWireResponse().candidates[0]] },
    { candidates: [{ explanation: "変更なし", replacementText: createAiEditRequestFixture().selectionText, riskNotes: [] }, createCandidateWireResponse().candidates[1]] },
    { candidates: [{ replacementText: "必須項目不足" }] },
  ])("runs normal business validation on structured local output", async (output) => {
    await expect(serviceWith(async () => completion(output)).generate(
      createAiEditRequestFixture(), new AbortController().signal,
    )).resolves.toMatchObject({ code: "INVALID_OUTPUT", success: false });
  });

  it("rejects invalid inputs and incompatible explicit cloud model IDs before connecting", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const service = serviceWith(fetch);
    for (const request of [
      { ...createAiEditRequestFixture(), selectionText: "" },
      createAiEditRequestFixture({ modelId: "gpt-6-astra" }),
      { ...createAiEditRequestFixture(), modelId: "arbitrary-local-model" },
    ]) {
      await expect(service.generate(request, new AbortController().signal))
        .resolves.toMatchObject({ code: "INVALID_REQUEST", success: false });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a local generation past 30 seconds and stops at the local deadline even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(deferred.promise);
    const request = createAiEditRequestFixture();
    const result = serviceWith(fetch).generate(request, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(AI_EDIT_LOCAL_PROVIDER_DEADLINE_MILLISECONDS - 35_000);
    await expect(result).resolves.toEqual({ code: "PROVIDER_TIMEOUT", requestId: request.requestId, success: false });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    deferred.resolve(completion());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels immediately and discards a delayed local response", async () => {
    const deferred = createDeferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(deferred.promise);
    const controller = new AbortController();
    const result = serviceWith(fetch).generate(createAiEditRequestFixture(), controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).resolves.toMatchObject({ code: "PROVIDER_FAILURE", success: false });
    deferred.resolve(completion());
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
