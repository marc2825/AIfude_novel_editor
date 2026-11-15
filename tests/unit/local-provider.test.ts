import { describe, expect, it, vi } from "vitest";

import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { LOCAL_LLM_MODEL_DEFINITION } from "../../src/domain/ai-models";
import { AI_EDIT_LIMITS } from "../../src/domain/limits";
import { createLocalEditingProvider } from "../../src/server/ai/local-provider";
import type { EditingProviderInput } from "../../src/server/ai/provider";
import { createCandidateWireResponse } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

const config = {
  apiKey: null,
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "local/model:tag",
};

function input(signal = new AbortController().signal): EditingProviderInput {
  return {
    model: LOCAL_LLM_MODEL_DEFINITION,
    outputTokenLimit: 8_192,
    prompt: { inputDataJson: '{"selectionText":"本文"}', systemInstruction: "固定指示" },
    responseSchema: LLM_CANDIDATES_SCHEMA,
    signal,
  };
}

function completion(content: string = JSON.stringify(createCandidateWireResponse()), finishReason = "stop") {
  return {
    choices: [{ finish_reason: finishReason, message: { content, role: "assistant" } }],
    usage: { completion_tokens: 45, prompt_tokens: 123 },
  };
}

describe("local LLM editing provider", () => {
  it("uses one non-streaming JSON Schema request to the configured loopback model", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(completion()));
    const provider = createLocalEditingProvider(config, fetch);
    const request = input();

    await expect(provider.generateCandidates(request)).resolves.toEqual({
      modelId: config.model,
      output: createCandidateWireResponse(),
      status: "completed",
      usage: { inputTokens: 123, outputTokens: 45 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${config.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        max_tokens: 8_192,
        messages: [
          { content: request.prompt.systemInstruction, role: "system" },
          { content: request.prompt.inputDataJson, role: "user" },
        ],
        model: config.model,
        response_format: {
          json_schema: { name: "llm_candidates", schema: LLM_CANDIDATES_SCHEMA, strict: true },
          type: "json_schema",
        },
        stream: false,
      }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: request.signal,
    });
  });

  it("sends an optional local token only as an authorization header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(completion()));
    await createLocalEditingProvider({ ...config, apiKey: "test-local-token" }, fetch)
      .generateCandidates(input());
    const request = fetch.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test-local-token" });
    expect(request?.body).not.toContain("test-local-token");
  });

  it.each([
    ["length", "incomplete"], ["content_filter", "refusal"],
  ])("maps finish reason %s to %s", async (finishReason, reason) => {
    const provider = createLocalEditingProvider(config, async () => Response.json(completion("{}", finishReason)));
    await expect(provider.generateCandidates(input())).resolves.toEqual({ reason, status: "failed" });
  });

  it("handles a refusal without exposing its text", async () => {
    const provider = createLocalEditingProvider(config, async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: null, refusal: "private refusal", role: "assistant" } }],
    }));
    await expect(provider.generateCandidates(input())).resolves.toEqual({ reason: "refusal", status: "failed" });
  });

  it.each([
    completion("not JSON"), completion("```json\n{}\n```"), {},
    { choices: [] }, { choices: [...completion().choices, ...completion().choices] },
    completion("{}", "tool_calls"),
    { choices: [{ finish_reason: "stop", message: { content: "{}", role: "assistant", tool_calls: [{}] } }] },
  ])("returns an invalid output sentinel for an unusable response", async (response) => {
    const provider = createLocalEditingProvider(config, async () => Response.json(response));
    await expect(provider.generateCandidates(input())).resolves.toMatchObject({ output: null, status: "completed" });
  });

  it("bounds the streamed response without trusting Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(AI_EDIT_LIMITS.responseBodyBytes + 1));
      },
      cancel,
    });
    const provider = createLocalEditingProvider(config, async () => new Response(body, { headers: { "Content-Length": "1" } }));
    await expect(provider.generateCandidates(input())).resolves.toMatchObject({ output: null, status: "completed" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([[408, "timeout"], [504, "timeout"], [401, "failure"], [500, "failure"]])(
    "normalizes HTTP %i without retries or exposing its body", async (status, reason) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("private error", { status }));
      await expect(createLocalEditingProvider(config, fetch).generateCandidates(input()))
        .resolves.toEqual({ reason, status: "failed" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not connect for unsafe endpoints or already cancelled work", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    controller.abort();
    await createLocalEditingProvider(config, fetch).generateCandidates(input(controller.signal));
    await createLocalEditingProvider({ ...config, baseUrl: "https://example.com/v1" }, fetch).generateCandidates(input());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores a delayed response from a fetch that disregards abort", async () => {
    const deferred = createDeferred<Response>();
    const controller = new AbortController();
    const provider = createLocalEditingProvider(config, async () => deferred.promise);
    const result = provider.generateCandidates(input(controller.signal));
    controller.abort();
    deferred.resolve(Response.json(completion()));
    await expect(result).resolves.toEqual({ reason: "failure", status: "failed" });
  });

  it("normalizes connection failures without fallback", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("private details"));
    await expect(createLocalEditingProvider(config, fetch).generateCandidates(input()))
      .resolves.toEqual({ reason: "failure", status: "failed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
