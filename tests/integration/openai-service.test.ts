import { describe, expect, it, vi } from "vitest";

import { createAiEditService } from "../../src/server/ai/edit-service";
import {
  createOpenAiEditingProvider,
  type CreateOpenAiResponseClient,
} from "../../src/server/ai/openai-provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import {
  createAiEditRequestFixture,
  createCandidateWireResponse,
} from "../fixtures/candidates";

function openAiResponse(output: unknown): unknown {
  const outputText = JSON.stringify(output);

  return {
    output: [
      {
        content: [{ annotations: [], text: outputText, type: "output_text" }],
        type: "message",
      },
    ],
    output_text: outputText,
    status: "completed",
    usage: { input_tokens: 321, output_tokens: 87 },
  };
}

function serviceWith(
  output: unknown,
  createClientSpy?: CreateOpenAiResponseClient,
) {
  const createClient: CreateOpenAiResponseClient =
    createClientSpy ??
    (() => ({
      async createResponse() {
        return openAiResponse(output);
      },
    }));
  const provider = createOpenAiEditingProvider(
    { apiKey: "server-test-key", defaultModelId: "gpt-5.6-terra" },
    createClient,
  );

  return createAiEditService({
    provider,
    rateLimiter: createAiRateLimiter(() => 0),
  });
}

describe("OpenAI provider through the AI edit service", () => {
  it("never calls an API with matching transfer consent but no API opt-in", async () => {
    const createClient = vi.fn<CreateOpenAiResponseClient>();
    const request = createAiEditRequestFixture({ consent: { providerId: "openai", policyVersion: 1 } });
    expect(await serviceWith(createCandidateWireResponse(), createClient).generate(request, new AbortController().signal)).toMatchObject({ success: false, code: "CONSENT_REQUIRED" });
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([
    [null, "gpt-5.6-terra", "gpt-5.6-terra"],
    [null, "gpt-5.6-sol", "gpt-5.6-sol"],
    ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-luna"],
  ] as const)(
    "resolves preference %s against default %s to actual model %s",
    async (modelId, defaultModelId, expectedModel) => {
      let requestBody: unknown = null;
      const createClient: CreateOpenAiResponseClient = () => ({
        async createResponse(body) {
          requestBody = body;
          return openAiResponse(createCandidateWireResponse());
        },
      });
      const service = createAiEditService({
        provider: createOpenAiEditingProvider(
          { apiKey: "server-test-key", defaultModelId },
          createClient,
        ),
        rateLimiter: createAiRateLimiter(() => 0),
      });
      const request = createAiEditRequestFixture({
        allowPaidApi: true,
        consent: { policyVersion: 1, providerId: "openai" },
        modelId,
      });
      const result = await service.generate(
        request,
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider.model).toBe(expectedModel);
        expect(
          result.data.candidates.every(
            (candidate) => candidate.model === expectedModel,
          ),
        ).toBe(true);
      }
      expect(requestBody).toMatchObject({ model: expectedModel });
    },
  );

  it.each([
    [2, 8_192],
    [3, 12_288],
  ] as const)(
    "runs the complete server pipeline for %i candidates with a %i-token output budget",
    async (candidateCount, outputTokenLimit) => {
      let requestBody: unknown = null;
      const createClient: CreateOpenAiResponseClient = () => ({
        async createResponse(body) {
          requestBody = body;
          return openAiResponse(createCandidateWireResponse(candidateCount));
        },
      });
      const provider = createOpenAiEditingProvider(
        { apiKey: "server-test-key", defaultModelId: "gpt-5.6-terra" },
        createClient,
      );
      const service = createAiEditService({
        provider,
        rateLimiter: createAiRateLimiter(() => 0),
      });
      const request = createAiEditRequestFixture({
        candidateCount,
        allowPaidApi: true,
        consent: { policyVersion: 1, providerId: "openai" },
      });
      const result = await service.generate(
        request,
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data.provider).toEqual({
        model: "gpt-5.6-terra",
        providerId: "openai",
      });
      expect(result.data.usage).toEqual({ inputTokens: 321, outputTokens: 87 });
      expect(result.data.candidates).toHaveLength(candidateCount);
      expect(requestBody).not.toBeNull();
      expect(requestBody).toMatchObject({
        max_output_tokens: outputTokenLimit,
        model: "gpt-5.6-terra",
        store: false,
        stream: false,
      });
      expect(JSON.stringify(requestBody)).not.toContain(request.requestId);
      expect(JSON.stringify(requestBody)).not.toContain("server-test-key");
    },
  );

  it("does not construct or invoke the adapter client without matching consent", async () => {
    const createClient = vi.fn<CreateOpenAiResponseClient>();
    const service = serviceWith(createCandidateWireResponse(), createClient);
    const request = createAiEditRequestFixture();

    await expect(
      service.generate(request, new AbortController().signal),
    ).resolves.toEqual({
      code: "CONSENT_REQUIRED",
      requestId: request.requestId,
      success: false,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      "wrong candidate count",
      { candidates: [createCandidateWireResponse().candidates[0]] },
    ],
    [
      "business-invalid unchanged candidate",
      {
        candidates: [
          {
            explanation: "変更なし",
            replacementText: "彼は小さく息を吐いた。",
            riskNotes: [],
          },
          createCandidateWireResponse().candidates[1],
        ],
      },
    ],
  ])("keeps canonical business validation for %s", async (_label, output) => {
    const request = createAiEditRequestFixture({
      allowPaidApi: true,
      consent: { policyVersion: 1, providerId: "openai" },
    });

    await expect(
      serviceWith(output).generate(request, new AbortController().signal),
    ).resolves.toEqual({
      code: "INVALID_OUTPUT",
      requestId: request.requestId,
      success: false,
    });
  });
});
