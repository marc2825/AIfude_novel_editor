import { describe, expect, it, vi } from "vitest";
import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { CHATGPT_MODEL_DEFINITION } from "../../src/domain/ai-models";
import { AI_EDIT_LIMITS } from "../../src/domain/limits";
import { createChatGptEditingProvider } from "../../src/server/ai/chatgpt/provider";
import type { EditingProviderInput } from "../../src/server/ai/provider";
import { createCandidateWireResponse } from "../fixtures/candidates";
import { CHATGPT_CONNECTION_ID, CHATGPT_MODEL, chatGptAuthStub, chatGptCompleted, chatGptStream } from "../fixtures/chatgpt";
import { createDeferred } from "../helpers/deferred";

function input(signal = new AbortController().signal): EditingProviderInput {
  return {
    connectionId: CHATGPT_CONNECTION_ID, model: CHATGPT_MODEL_DEFINITION, outputTokenLimit: 8192,
    prompt: { systemInstruction: "固定制約", inputDataJson: '{"selectionText":"原文"}' }, responseSchema: LLM_CANDIDATES_SCHEMA, signal,
  };
}
function transport(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [{ slug: CHATGPT_MODEL, visibility: "list" }] })).mockResolvedValueOnce(response);
}

describe("ChatGPT subscription provider", () => {
  it("uses the account catalog and consumes a complete SSE result with no API output-token cap or fallback", async () => {
    const fetch = transport(chatGptStream([
      { type: "response.output_text.delta", delta: "日本語😀" }, chatGptCompleted(),
    ], 3));
    const result = await createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input());
    expect(result).toEqual({ status: "completed", output: createCandidateWireResponse(), modelId: CHATGPT_MODEL, usage: { inputTokens: 100, outputTokens: 50 } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://api.openai.com/v1/models", "https://api.openai.com/v1/responses"]);
    const request = fetch.mock.calls[1]?.[1];
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test-access-token" });
    if (typeof request?.body !== "string") throw new Error("Expected JSON body");
    const body: unknown = JSON.parse(request.body);
    expect(body).toEqual({
      input: [{ role: "user", content: input().prompt.inputDataJson }], instructions: input().prompt.systemInstruction,
      model: CHATGPT_MODEL, store: false, stream: true,
      text: { format: { type: "json_schema", name: "llm_candidates", schema: LLM_CANDIDATES_SCHEMA, strict: true } },
    });
    expect(request.body).not.toContain("test-access-token");
  });

  it("does not generate when the account model is unavailable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ models: [{ slug: "other-model", visibility: "list" }] }));
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input())).resolves.toMatchObject({ status: "failed" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a missing connection before contacting the provider", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates({ ...input(), connectionId: undefined })).resolves.toEqual({ status: "failed", reason: "auth-required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [[{ type: "response.output_text.delta", delta: "partial" }], "incomplete"],
    [[{ type: "response.incomplete", response: {} }], "incomplete"],
    [[{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }], "subscription-limit"],
    [[{ type: "error", code: "subscription_sharing_usage_unavailable" }], "subscription-limit"],
    [[{ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "private refusal" }] }] } }], "refusal"],
  ] as const)("rejects unusable or failed streams without exposing partial output", async (events, reason) => {
    const fetch = transport(chatGptStream(events));
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input())).resolves.toEqual({ status: "failed", reason });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([[401, "auth-required"], [429, "subscription-limit"], [500, "failure"]] as const)("maps HTTP %i without retrying", async (status, reason) => {
    const fetch = transport(new Response("private error", { status }));
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input())).resolves.toEqual({ status: "failed", reason });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("aborts oversized deltas and discards all candidates", async () => {
    const fetch = transport(chatGptStream([{ type: "response.output_text.delta", delta: "x".repeat(AI_EDIT_LIMITS.responseBodyBytes + 1) }]));
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input())).resolves.toMatchObject({ status: "failed" });
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  });

  it("aborts a stream over 1 MiB even when it contains no text deltas", async () => {
    const fetch = transport(new Response(`: ${"x".repeat(1_048_576)}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    }));
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input())).resolves.toMatchObject({ status: "failed" });
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  });

  it("discards a completed response if the connection changes while generating", async () => {
    const auth = chatGptAuthStub();
    const isCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const fetch = transport(chatGptStream([chatGptCompleted()]));
    await expect(createChatGptEditingProvider({ model: CHATGPT_MODEL }, { ...auth, isCurrent }, fetch).generateCandidates(input())).resolves.toEqual({ status: "failed", reason: "auth-required" });
  });

  it("discards a delayed response from fetch that ignores abort", async () => {
    const pending = createDeferred<Response>();
    const fetch = transport(chatGptStream([]));
    fetch.mockReset().mockResolvedValueOnce(Response.json({ models: [{ slug: CHATGPT_MODEL, visibility: "list" }] })).mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const result = createChatGptEditingProvider({ model: CHATGPT_MODEL }, chatGptAuthStub(), fetch).generateCandidates(input(controller.signal));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort(); pending.resolve(chatGptStream([chatGptCompleted()]));
    await expect(result).resolves.toMatchObject({ status: "failed" });
  });
});
