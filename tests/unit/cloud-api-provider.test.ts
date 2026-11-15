import { describe, expect, it, vi } from "vitest";
import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { CONFIGURED_CLOUD_MODELS } from "../../src/domain/ai-models";
import { createCloudApiEditingProvider } from "../../src/server/ai/cloud-api-provider";
import type { EditingProviderInput } from "../../src/server/ai/provider";
import { createCandidateWireResponse } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

const modes = ["anthropic", "gemini", "xai", "deepseek"] as const;
function input(mode: typeof modes[number], signal = new AbortController().signal): EditingProviderInput {
  const model = CONFIGURED_CLOUD_MODELS.find((model) => model.providerId === mode);
  if (!model) throw new Error("Missing model");
  return { model, signal, outputTokenLimit: 8192, responseSchema: LLM_CANDIDATES_SCHEMA,
    prompt: { systemInstruction: "固定制約", inputDataJson: '{"selectionText":"本文"}' } };
}
function envelope(mode: typeof modes[number], text = JSON.stringify(createCandidateWireResponse()), reason = mode === "anthropic" ? "end_turn" : "stop") {
  return mode === "anthropic" ? { stop_reason: reason, content: [{ type: "text", text }] } : { choices: [{ finish_reason: reason, message: { role: "assistant", content: text } }] };
}

describe("explicit cloud API adapters", () => {
  it.each(modes)("uses one bounded, non-streaming %s request to its official endpoint", async (mode) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(envelope(mode)));
    const result = await createCloudApiEditingProvider({ mode, apiKey: "test-secret", model: "configured-model" }, fetch).generateCandidates(input(mode));
    expect(result).toEqual({ status: "completed", output: createCandidateWireResponse(), modelId: "configured-model", usage: null });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/^https:\/\/(api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.x\.ai|api\.deepseek\.com)\//u);
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", signal: input(mode).signal });
    const body: unknown = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ model: "configured-model", max_tokens: 8192 });
    expect(options?.body).not.toContain("test-secret");
    if (mode === "anthropic") expect(body).toMatchObject({ output_config: { format: { type: "json_schema", schema: LLM_CANDIDATES_SCHEMA } } });
    else expect(body).toMatchObject({ stream: false, response_format: { type: mode === "deepseek" ? "json_object" : "json_schema" } });
  });
  it.each(modes)("treats %s refusal, incomplete and invalid JSON as failures without a repair call", async (mode) => {
    for (const [reason, expected] of [[mode === "anthropic" ? "max_tokens" : "length", "incomplete"], [mode === "anthropic" ? "refusal" : "content_filter", "refusal"]] as const) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(envelope(mode, "{}", reason)));
      expect(await createCloudApiEditingProvider({ mode, apiKey: "test", model: "model" }, fetch).generateCandidates(input(mode))).toEqual({ status: "failed", reason: expected });
      expect(fetch).toHaveBeenCalledOnce();
    }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(envelope(mode, "```json\n{}\n```")));
    expect(await createCloudApiEditingProvider({ mode, apiKey: "test", model: "model" }, fetch).generateCandidates(input(mode))).toMatchObject({ status: "completed", output: null });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([401, 429, 503, 504])("does not retry HTTP %i or expose its error body", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("private error", { status }));
    const result = await createCloudApiEditingProvider({ mode: "gemini", apiKey: "test", model: "model" }, fetch).generateCandidates(input("gemini"));
    expect(result).toMatchObject({ status: "failed" }); expect(JSON.stringify(result)).not.toContain("private"); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(modes)("reports the model returned by %s when its configured name is an alias", async (mode) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ...envelope(mode), model: "actual-model-version" }));
    expect(await createCloudApiEditingProvider({ mode, apiKey: "test", model: "alias" }, fetch).generateCandidates(input(mode))).toMatchObject({ status: "completed", modelId: "actual-model-version" });
  });
  it("rejects oversized output and discards a fetch that ignores abort", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(envelope("xai", "x".repeat(150_000))));
    expect(await createCloudApiEditingProvider({ mode: "xai", apiKey: "test", model: "model" }, fetch).generateCandidates(input("xai"))).toMatchObject({ status: "completed", output: null });
    const pending = createDeferred<Response>(); fetch.mockReturnValue(pending.promise);
    const abort = new AbortController();
    const result = createCloudApiEditingProvider({ mode: "xai", apiKey: "test", model: "model" }, fetch).generateCandidates(input("xai", abort.signal));
    abort.abort(); pending.resolve(Response.json(envelope("xai")));
    expect(await result).toEqual({ status: "failed", reason: "failure" });
  });
});
