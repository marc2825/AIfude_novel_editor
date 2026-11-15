import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_EDIT_LIMITS } from "../../src/domain/limits";
import {
  LOCAL_DEMO_MODEL_ID,
  MOCK_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
} from "../../src/domain/ai-models";
import {
  AI_EDIT_PROVIDER_DEADLINE_MILLISECONDS,
  createAiEditService,
} from "../../src/server/ai/edit-service";
import type {
  EditingProvider,
  EditingProviderInput,
  EditingProviderResult,
} from "../../src/server/ai/provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import {
  createAiEditRequestFixture,
  createCandidateWireResponse,
} from "../fixtures/candidates";

function testProvider(
  generateCandidates: (
    input: EditingProviderInput,
  ) => Promise<EditingProviderResult>,
  externalDataTransfer = false,
): EditingProvider {
  return {
    defaultModelId: externalDataTransfer
      ? "gpt-5.6-terra"
      : LOCAL_DEMO_MODEL_ID,
    externalDataTransfer,
    generateCandidates,
    providerId: externalDataTransfer ? OPENAI_PROVIDER_ID : MOCK_PROVIDER_ID,
  };
}

function serviceWith(provider: EditingProvider) {
  return createAiEditService({
    provider,
    rateLimiter: createAiRateLimiter(() => 0),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AI edit service", () => {
  it.each([
    ["transform", "similar", "文体・比喩・語調を変換"],
    ["expand", "longer", "原文より詳しく長く"],
    ["freeform", "instruction", "taskInstructionが指定した長さ"],
  ] as const)("passes %s constraints to the provider and validates the result", async (presetId, lengthTarget, promptText) => {
    const generateCandidates = vi.fn(async (input: EditingProviderInput): Promise<EditingProviderResult> => {
      expect(input.prompt.systemInstruction).toContain(promptText);
      expect(input.prompt.systemInstruction).toContain("新しい事実を追加しないでください");
      return { output: createCandidateWireResponse(), status: "completed", usage: null };
    });
    const result = await serviceWith(testProvider(generateCandidates)).generate(
      { ...createAiEditRequestFixture(), presetId, instruction: "静かな余韻を残してください。" },
      new AbortController().signal,
    );
    expect(generateCandidates).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.intent).toMatchObject({ kind: presetId, lengthTarget });
  });

  it("derives the prompt on the server and returns canonical server metadata", async () => {
    const generateCandidates = vi.fn(
      async (input: EditingProviderInput): Promise<EditingProviderResult> => {
        expect(input.prompt.inputDataJson).not.toContain(
          createAiEditRequestFixture().requestId,
        );
        expect(input.prompt.inputDataJson).toContain('"candidateCount":2');

        return {
          output: createCandidateWireResponse(),
          status: "completed",
          usage: { inputTokens: 120, outputTokens: 40 },
        };
      },
    );

    const result = await serviceWith(testProvider(generateCandidates)).generate(
      createAiEditRequestFixture(),
      new AbortController().signal,
    );

    expect(generateCandidates).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.candidates).toHaveLength(2);
      expect(result.data.candidates.map(({ index }) => index)).toEqual([0, 1]);
      expect(result.data.candidates.every(({ id }) => id.length > 0)).toBe(true);
      expect(result.data.candidates.every(({ requestId }) => requestId === result.data.requestId)).toBe(
        true,
      );
      expect(result.data.provider).toEqual({
        model: LOCAL_DEMO_MODEL_ID,
        providerId: MOCK_PROVIDER_ID,
      });
      expect(result.data.usage).toEqual({
        inputTokens: 120,
        outputTokens: 40,
      });
    }
  });

  it("requires matching consent before rate accounting for an external provider", async () => {
    const generateCandidates = vi.fn(async (): Promise<EditingProviderResult> => ({
      output: createCandidateWireResponse(),
      status: "completed",
      usage: null,
    }));
    const acquire = vi.fn(() => ({
      permit: { release() {} },
      success: true as const,
    }));
    const service = createAiEditService({
      provider: testProvider(generateCandidates, true),
      rateLimiter: { acquire },
    });

    await expect(
      service.generate(
        createAiEditRequestFixture(),
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      code: "CONSENT_REQUIRED",
      requestId: createAiEditRequestFixture().requestId,
      success: false,
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("marks local mock capacity as exempt and does not require consent", async () => {
    const generateCandidates = vi.fn(async (): Promise<EditingProviderResult> => ({
      output: createCandidateWireResponse(),
      status: "completed",
      usage: null,
    }));
    const release = vi.fn();
    const acquire = vi.fn(() => ({
      permit: { release },
      success: true as const,
    }));
    const service = createAiEditService({
      provider: testProvider(generateCandidates),
      rateLimiter: { acquire },
    });

    const result = await service.generate(
      createAiEditRequestFixture(),
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(acquire).toHaveBeenCalledWith("mock");
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "unchanged candidate",
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
    [
      "duplicate candidates",
      {
        candidates: [
          createCandidateWireResponse().candidates[0],
          createCandidateWireResponse().candidates[0],
        ],
      },
    ],
    [
      "blank candidate",
      {
        candidates: [
          {
            explanation: "空白",
            replacementText: "   ",
            riskNotes: [],
          },
          createCandidateWireResponse().candidates[1],
        ],
      },
    ],
    [
      "oversized candidate",
      {
        candidates: [
          {
            explanation: "長すぎる",
            replacementText: "長".repeat(AI_EDIT_LIMITS.replacementCodePoints + 1),
            riskNotes: [],
          },
          createCandidateWireResponse().candidates[1],
        ],
      },
    ],
    [
      "malformed Unicode",
      {
        candidates: [
          {
            explanation: "不正Unicode",
            replacementText: "\ud800",
            riskNotes: [],
          },
          createCandidateWireResponse().candidates[1],
        ],
      },
    ],
    ["malformed schema", { candidates: [{ replacementText: "不足" }] }],
  ])("rejects the whole output for %s", async (_label, output) => {
    const provider = testProvider(async () => ({
      output,
      status: "completed",
      usage: null,
    }));

    await expect(
      serviceWith(provider).generate(
        createAiEditRequestFixture(),
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      code: "INVALID_OUTPUT",
      requestId: createAiEditRequestFixture().requestId,
      success: false,
    });
  });

  it("maps the 30 second deadline to timeout and aborts provider work", async () => {
    vi.useFakeTimers();
    const received: { signal?: AbortSignal } = {};
    const provider = testProvider((input) => {
      received.signal = input.signal;
      return new Promise<EditingProviderResult>(() => {});
    });
    const resultPromise = serviceWith(provider).generate(
      createAiEditRequestFixture(),
      new AbortController().signal,
    );

    await vi.advanceTimersByTimeAsync(AI_EDIT_PROVIDER_DEADLINE_MILLISECONDS);

    await expect(resultPromise).resolves.toEqual({
      code: "PROVIDER_TIMEOUT",
      requestId: createAiEditRequestFixture().requestId,
      success: false,
    });
    expect(received.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards request cancellation and ignores a provider that never settles", async () => {
    vi.useFakeTimers();
    const received: { signal?: AbortSignal } = {};
    const provider = testProvider((input) => {
      received.signal = input.signal;
      return new Promise<EditingProviderResult>(() => {});
    });
    const requestController = new AbortController();
    const resultPromise = serviceWith(provider).generate(
      createAiEditRequestFixture(),
      requestController.signal,
    );

    await Promise.resolve();
    await Promise.resolve();
    requestController.abort();

    await expect(resultPromise).resolves.toEqual({
      code: "PROVIDER_FAILURE",
      requestId: createAiEditRequestFixture().requestId,
      success: false,
    });
    expect(received.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the deadline after a fast provider result", async () => {
    vi.useFakeTimers();
    const provider = testProvider(async () => ({
      output: createCandidateWireResponse(),
      status: "completed",
      usage: null,
    }));

    const result = await serviceWith(provider).generate(
      createAiEditRequestFixture(),
      new AbortController().signal,
    );

    expect(result.success).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
