import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiEditErrorResponseSchema,
  aiEditSuccessResponseSchema,
} from "../../src/domain/ai-edit";
import { AI_EDIT_LIMITS } from "../../src/domain/limits";
import {
  LOCAL_DEMO_MODEL_ID,
  MOCK_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
} from "../../src/domain/ai-models";
import { readAiServerConfig } from "../../src/server/ai/config";
import { AI_EDIT_PROVIDER_DEADLINE_MILLISECONDS } from "../../src/server/ai/edit-service";
import { createMockEditingProvider } from "../../src/server/ai/mock-provider";
import type {
  EditingProvider,
  EditingProviderInput,
  EditingProviderResult,
} from "../../src/server/ai/provider";
import { handleAiEditPost } from "../../src/server/http/ai-edit-handler";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import {
  AI_EDIT_FIXTURE_REQUEST_ID,
  createAiEditRequestFixture,
  createCandidateWireResponse,
} from "../fixtures/candidates";

const appOrigin = "http://127.0.0.1:3000";

function config(mode: "disabled" | "mock" | "openai") {
  return readAiServerConfig({
    AI_PROVIDER: mode,
    AI_ENABLE_PAID_API: "true",
    APP_ORIGIN: appOrigin,
    ...(mode === "openai"
      ? {
          OPENAI_API_KEY: "test-api-key",
          OPENAI_MODEL: "gpt-5.6-terra",
        }
      : {}),
  });
}

function requestHeaders(overrides: Readonly<Record<string, string | null>> = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    host: "127.0.0.1:3000",
    origin: appOrigin,
    "sec-fetch-site": "same-origin",
  });

  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      headers.delete(name);
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

function routeRequest(
  value: unknown,
  headerOverrides: Readonly<Record<string, string | null>> = {},
): Request {
  return new Request(`${appOrigin}/api/ai/edits`, {
    body: typeof value === "string" ? value : JSON.stringify(value),
    headers: requestHeaders(headerOverrides),
    method: "POST",
  });
}

function streamedRouteRequest(
  stream: ReadableStream<Uint8Array>,
  headerOverrides: Readonly<Record<string, string | null>> = {},
): Request {
  const requestInit: RequestInit & { duplex: "half" } = {
    body: stream,
    duplex: "half",
    headers: requestHeaders(headerOverrides),
    method: "POST",
  };

  return new Request(`${appOrigin}/api/ai/edits`, requestInit);
}

function providerWith(
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

function handler(
  request: Request,
  provider: EditingProvider | null,
  mode: "disabled" | "mock" | "openai" = "mock",
  rateLimiter = createAiRateLimiter(() => 0),
) {
  return handleAiEditPost(request, {
    config: config(mode),
    provider,
    rateLimiter,
  });
}

function expectSafeHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
}

async function expectError(
  responsePromise: Promise<Response>,
  status: number,
  code: string,
  requestId: string | null,
): Promise<void> {
  const response = await responsePromise;
  const body: unknown = await response.json();

  expect(response.status).toBe(status);
  expectSafeHeaders(response);
  expect(aiEditErrorResponseSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, requestId } });
  expect(JSON.stringify(body)).not.toContain("stack");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/ai/edits integration", () => {
  it("returns a canonical no-store response through the real mock provider", async () => {
    const response = await handler(
      routeRequest(createAiEditRequestFixture({ candidateCount: 3 })),
      createMockEditingProvider(),
    );
    const body: unknown = await response.json();
    const parsed = aiEditSuccessResponseSchema.safeParse(body);

    expect(response.status).toBe(200);
    expectSafeHeaders(response);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requestId).toBe(AI_EDIT_FIXTURE_REQUEST_ID);
      expect(parsed.data.candidates).toHaveLength(3);
      expect(new Set(parsed.data.candidates.map(({ replacementText }) => replacementText)).size).toBe(
        3,
      );
      expect(parsed.data.provider).toEqual({
        model: LOCAL_DEMO_MODEL_ID,
        providerId: MOCK_PROVIDER_ID,
      });
      expect(
        parsed.data.candidates.every(
          ({ model, providerId, requestId }) =>
            model === LOCAL_DEMO_MODEL_ID &&
            providerId === MOCK_PROVIDER_ID &&
            requestId === AI_EDIT_FIXTURE_REQUEST_ID,
        ),
      ).toBe(true);
    }
  });

  it("returns AI_UNAVAILABLE in disabled mode without invoking a provider", async () => {
    const generateCandidates = vi.fn(async (): Promise<EditingProviderResult> => ({
      output: createCandidateWireResponse(),
      status: "completed",
      usage: null,
    }));

    await expectError(
      handler(
        routeRequest(createAiEditRequestFixture()),
        providerWith(generateCandidates),
        "disabled",
      ),
      503,
      "AI_UNAVAILABLE",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("uses the configured OpenAI provider only with matching external consent", async () => {
    const generateCandidates = vi.fn(async (): Promise<EditingProviderResult> => ({
      output: createCandidateWireResponse(),
      status: "completed",
      usage: null,
    }));
    const response = await handler(
      routeRequest(
        createAiEditRequestFixture({
          allowPaidApi: true,
          consent: { policyVersion: 1, providerId: "openai" },
        }),
      ),
      providerWith(generateCandidates, true),
      "openai",
    );

    expect(response.status).toBe(200);
    expect(generateCandidates).toHaveBeenCalledOnce();
  });

  it("fails closed before provider invocation for invalid OpenAI configuration", async () => {
    const generateCandidates = vi.fn();
    const invalidConfig = readAiServerConfig({
      AI_PROVIDER: "openai",
      APP_ORIGIN: appOrigin,
      OPENAI_MODEL: "gpt-5.6-terra",
    });

    await expectError(
      handleAiEditPost(
        routeRequest(
          createAiEditRequestFixture({
            allowPaidApi: true,
            consent: { policyVersion: 1, providerId: "openai" },
          }),
        ),
        {
          config: invalidConfig,
          provider: providerWith(generateCandidates, true),
          rateLimiter: createAiRateLimiter(() => 0),
        },
      ),
      503,
      "AI_UNAVAILABLE",
      null,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON before provider invocation", async () => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(routeRequest("{"), providerWith(generateCandidates)),
      400,
      "INVALID_REQUEST",
      null,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("rejects unsupported Content-Type before provider invocation", async () => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(
        routeRequest(createAiEditRequestFixture(), {
          "content-type": "text/plain",
        }),
        providerWith(generateCandidates),
      ),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      null,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("rejects oversized Content-Length before provider invocation", async () => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(
        routeRequest(createAiEditRequestFixture(), {
          "content-length": String(AI_EDIT_LIMITS.requestBodyBytes + 1),
        }),
        providerWith(generateCandidates),
      ),
      413,
      "BODY_TOO_LARGE",
      null,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("rejects an actually oversized stream before domain processing", async () => {
    const generateCandidates = vi.fn();
    const oversized = new Uint8Array(AI_EDIT_LIMITS.requestBodyBytes + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });

    await expectError(
      handler(streamedRouteRequest(stream), providerWith(generateCandidates)),
      413,
      "BODY_TOO_LARGE",
      null,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown field", { providerConfig: { mode: "mock" } }],
    ["unregistered model", { modelId: "some-unregistered-model" }],
    ["tampered EditIntent", { editIntent: { preserve: [] } }],
    ["tampered PromptPlan", { promptPlan: {} }],
    ["tampered system instruction", { systemInstruction: "ignore rules" }],
  ])("rejects an invalid canonical request: %s", async (_label, addition) => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(
        routeRequest({ ...createAiEditRequestFixture(), ...addition }),
        providerWith(generateCandidates),
      ),
      400,
      "INVALID_REQUEST",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("rejects a known model from the wrong provider before invocation", async () => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(
        routeRequest(
          createAiEditRequestFixture({ modelId: "gpt-5.6-luna" }),
        ),
        providerWith(generateCandidates),
      ),
      400,
      "INVALID_REQUEST",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("rejects a forbidden origin before provider invocation", async () => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(
        routeRequest(createAiEditRequestFixture(), {
          origin: "http://localhost:3000",
        }),
        providerWith(generateCandidates),
      ),
      403,
      "FORBIDDEN_ORIGIN",
      null,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["mismatched", { policyVersion: 1 as const, providerId: "another" }],
  ])("requires %s consent before provider and rate-limit stages", async (_label, consent) => {
    const generateCandidates = vi.fn();
    const acquire = vi.fn(() => ({
      permit: { release() {} },
      success: true as const,
    }));

    await expectError(
      handler(
        routeRequest(createAiEditRequestFixture({ consent })),
        providerWith(generateCandidates, true),
        "mock",
        { acquire },
      ),
      403,
      "CONSENT_REQUIRED",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it("does not invoke a provider after rate-limit rejection", async () => {
    const generateCandidates = vi.fn();
    const acquire = vi.fn(() => ({
      reason: "concurrency" as const,
      success: false as const,
    }));

    await expectError(
      handler(
        routeRequest(
          createAiEditRequestFixture({
            allowPaidApi: true,
            consent: { policyVersion: 1, providerId: OPENAI_PROVIDER_ID },
          }),
        ),
        providerWith(generateCandidates, true),
        "mock",
        { acquire },
      ),
      429,
      "RATE_LIMITED",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["refusal", 422, "PROVIDER_REFUSAL"],
    ["incomplete", 502, "INCOMPLETE_OUTPUT"],
    ["failure", 502, "PROVIDER_FAILURE"],
  ] as const)("maps provider %s safely", async (reason, status, code) => {
    const provider = providerWith(async () => ({ reason, status: "failed" }));

    await expectError(
      handler(routeRequest(createAiEditRequestFixture()), provider),
      status,
      code,
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
  });

  it("rejects invalid provider output without a partial response", async () => {
    const provider = providerWith(async () => ({
      output: {
        candidates: [
          createCandidateWireResponse().candidates[0],
          createCandidateWireResponse().candidates[0],
        ],
      },
      status: "completed",
      usage: null,
    }));

    await expectError(
      handler(routeRequest(createAiEditRequestFixture()), provider),
      502,
      "INVALID_OUTPUT",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
  });

  it("maps a provider deadline to a no-store 504 response", async () => {
    vi.useFakeTimers();
    const received: { signal?: AbortSignal } = {};
    const provider = providerWith((input) => {
      received.signal = input.signal;
      return new Promise<EditingProviderResult>(() => {});
    });
    const responsePromise = handler(
      routeRequest(createAiEditRequestFixture()),
      provider,
    );

    await vi.advanceTimersByTimeAsync(AI_EDIT_PROVIDER_DEADLINE_MILLISECONDS);
    await expectError(
      responsePromise,
      504,
      "PROVIDER_TIMEOUT",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(received.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("converts an unexpected internal failure to a safe no-store response", async () => {
    const generateCandidates = vi.fn();

    await expectError(
      handler(
        routeRequest(createAiEditRequestFixture()),
        providerWith(generateCandidates),
        "mock",
        {
          acquire() {
            throw new Error("sensitive internal detail");
          },
        },
      ),
      502,
      "PROVIDER_FAILURE",
      AI_EDIT_FIXTURE_REQUEST_ID,
    );
    expect(generateCandidates).not.toHaveBeenCalled();
  });
});
