import {
  APIConnectionTimeoutError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { describe, expect, it, vi } from "vitest";

import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { AI_EDIT_LIMITS } from "../../src/domain/limits";
import {
  findAiModelDefinition,
  type SelectableAiModelId,
} from "../../src/domain/ai-models";
import {
  createOpenAiEditingProvider,
  type CreateOpenAiResponseClient,
  type OpenAiClientOptions,
  type OpenAiResponseClient,
} from "../../src/server/ai/openai-provider";
import type { EditingProviderInput } from "../../src/server/ai/provider";
import { createCandidateWireResponse } from "../fixtures/candidates";

function providerInput(
  modelId: SelectableAiModelId = "gpt-5.6-terra",
  signal = new AbortController().signal,
): EditingProviderInput {
  const model = findAiModelDefinition(modelId);

  if (model === null) {
    throw new Error("selectable model must exist");
  }

  return {
    model,
    outputTokenLimit: 8_192,
    prompt: {
      inputDataJson: JSON.stringify({
        candidateCount: 2,
        selectionText: "彼は小さく息を吐いた。",
        taskInstruction: "自然に",
      }),
      systemInstruction: "固定された製品制約",
    },
    responseSchema: LLM_CANDIDATES_SCHEMA,
    signal,
  };
}

function responseWith(
  output: unknown,
  overrides: Readonly<Record<string, unknown>> = {},
): unknown {
  const outputText = JSON.stringify(output);

  return {
    output: [
      {
        content: [{ annotations: [], text: outputText, type: "output_text" }],
        id: "message-1",
        role: "assistant",
        status: "completed",
        type: "message",
      },
    ],
    output_text: outputText,
    status: "completed",
    usage: { input_tokens: 123, output_tokens: 45 },
    ...overrides,
  };
}

function fakeClient(response: unknown): OpenAiResponseClient {
  return {
    async createResponse() {
      return response;
    },
  };
}

describe("OpenAI editing provider", () => {
  it.each([
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ] as const)(
    "maps the canonical provider input to a stateless Responses request for %s",
    async (model) => {
      let clientOptions: OpenAiClientOptions | null = null;
      let requestBody: Parameters<OpenAiResponseClient["createResponse"]>[0] | null = null;
      let requestOptions: Parameters<OpenAiResponseClient["createResponse"]>[1] | null = null;
      const createClient: CreateOpenAiResponseClient = (options) => {
        clientOptions = options;

        return {
          async createResponse(body, optionsForRequest) {
            requestBody = body;
            requestOptions = optionsForRequest;
            return responseWith(createCandidateWireResponse());
          },
        };
      };
      const input = providerInput(model);
      const provider = createOpenAiEditingProvider(
        { apiKey: "server-test-key", defaultModelId: "gpt-5.6-terra" },
        createClient,
      );

      await expect(provider.generateCandidates(input)).resolves.toEqual({
        output: createCandidateWireResponse(),
        status: "completed",
        usage: { inputTokens: 123, outputTokens: 45 },
      });
      expect(provider).toMatchObject({
        externalDataTransfer: true,
        defaultModelId: "gpt-5.6-terra",
        providerId: "openai",
      });
      expect(clientOptions).toEqual({
        apiKey: "server-test-key",
        baseURL: "https://api.openai.com/v1",
        logLevel: "off",
        maxRetries: 0,
      });
      expect(requestBody).toEqual({
        input: input.prompt.inputDataJson,
        instructions: input.prompt.systemInstruction,
        max_output_tokens: input.outputTokenLimit,
        model,
        store: false,
        stream: false,
        text: {
          format: {
            name: "llm_candidates",
            schema: LLM_CANDIDATES_SCHEMA,
            strict: true,
            type: "json_schema",
          },
        },
      });
      expect(requestOptions).toEqual({ signal: input.signal });
      expect(requestBody).not.toHaveProperty("tools");
      expect(requestBody).not.toHaveProperty("conversation");
      expect(requestBody).not.toHaveProperty("previous_response_id");
      expect(requestBody).not.toHaveProperty("background");
      expect(requestBody).not.toHaveProperty("reasoning");
      expect(requestBody).not.toHaveProperty("temperature");
      expect(JSON.stringify(requestBody)).not.toContain("server-test-key");
    },
  );

  it("maps a structured refusal without parsing its prose", async () => {
    const provider = createOpenAiEditingProvider(
      { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
      () =>
        fakeClient({
          output: [
            {
              content: [{ refusal: "raw refusal detail", type: "refusal" }],
              type: "message",
            },
          ],
          output_text: "",
          status: "completed",
        }),
    );

    await expect(provider.generateCandidates(providerInput())).resolves.toEqual({
      reason: "refusal",
      status: "failed",
    });
  });

  it("rejects incomplete output without salvaging partial candidates", async () => {
    const partial = createCandidateWireResponse();
    const provider = createOpenAiEditingProvider(
      { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
      () =>
        fakeClient(
          responseWith(partial, {
            incomplete_details: { reason: "max_output_tokens" },
            status: "incomplete",
          }),
        ),
    );

    await expect(provider.generateCandidates(providerInput())).resolves.toEqual({
      reason: "incomplete",
      status: "failed",
    });
  });

  it.each(["failed", "cancelled", "in_progress", "queued", undefined])(
    "maps a non-completed response status %s to provider failure",
    async (status) => {
      const provider = createOpenAiEditingProvider(
        { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
        () => fakeClient(responseWith({}, { status })),
      );

      await expect(provider.generateCandidates(providerInput())).resolves.toEqual({
        reason: "failure",
        status: "failed",
      });
    },
  );

  it.each([
    ["invalid JSON", "not JSON", responseWith({}, { output_text: "not JSON" })],
    ["missing output content", null, { output: [], output_text: "{}", status: "completed" }],
    [
      "oversized generated JSON",
      null,
      responseWith({}, { output_text: "x".repeat(AI_EDIT_LIMITS.responseBodyBytes + 1) }),
    ],
  ])("returns a validation sentinel for %s", async (_label, _expected, response) => {
    const provider = createOpenAiEditingProvider(
      { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
      () => fakeClient(response),
    );

    await expect(provider.generateCandidates(providerInput())).resolves.toMatchObject({
      output: null,
      status: "completed",
    });
  });

  it("does not construct or call the SDK client when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const createClient = vi.fn<CreateOpenAiResponseClient>();
    const provider = createOpenAiEditingProvider(
      { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
      createClient,
    );

    await expect(
      provider.generateCandidates(providerInput("gpt-5.6-terra", controller.signal)),
    ).resolves.toEqual({
      reason: "failure",
      status: "failed",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does not accept a response after the supplied signal aborts", async () => {
    const controller = new AbortController();
    const response = Promise.withResolvers<unknown>();
    const provider = createOpenAiEditingProvider(
      { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
      () => ({
        async createResponse(_body, options) {
          expect(options.signal).toBe(controller.signal);
          return response.promise;
        },
      }),
    );
    const resultPromise = provider.generateCandidates(
      providerInput("gpt-5.6-terra", controller.signal),
    );

    controller.abort();
    response.resolve(responseWith(createCandidateWireResponse()));

    await expect(resultPromise).resolves.toEqual({
      reason: "failure",
      status: "failed",
    });
  });

  it("normalizes SDK timeout and other SDK exceptions without leaking details", async () => {
    const timeoutProvider = createOpenAiEditingProvider(
      { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
      () => ({
        async createResponse() {
          throw new APIConnectionTimeoutError();
        },
      }),
    );
    await expect(timeoutProvider.generateCandidates(providerInput())).resolves.toEqual({
      reason: "timeout",
      status: "failed",
    });

    for (const error of [
      new AuthenticationError(
        401,
        { error: { message: "raw auth detail" } },
        "raw auth detail",
        new Headers(),
      ),
      new RateLimitError(
        429,
        { error: { message: "raw quota detail" } },
        "raw quota detail",
        new Headers(),
      ),
      new Error("raw network detail"),
    ]) {
      const failureProvider = createOpenAiEditingProvider(
        { apiKey: "test-key", defaultModelId: "gpt-5.6-terra" },
        () => ({
          async createResponse() {
            throw error;
          },
        }),
      );

      await expect(failureProvider.generateCandidates(providerInput())).resolves.toEqual({
        reason: "failure",
        status: "failed",
      });
    }
  });
});
