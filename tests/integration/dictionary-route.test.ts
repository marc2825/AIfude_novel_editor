import { describe, expect, it, vi } from "vitest";
import { dictionaryRequestSchema } from "../../src/domain/dictionary";
import { aiEditSuccessResponseSchema } from "../../src/domain/ai-edit";
import { readAiServerConfig } from "../../src/server/ai/config";
import type { EditingProvider, EditingProviderInput, EditingProviderResult } from "../../src/server/ai/provider";
import { LOCAL_DEMO_MODEL_ID } from "../../src/domain/ai-models";
import { handleDictionaryPost } from "../../src/server/http/dictionary-handler";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";

const origin = "http://127.0.0.1:3000";
const input = { schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", query: "余韻", consent: null, modelId: null };
function request(value: unknown = input, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/ai/dictionary`, { method: "POST", body: JSON.stringify(value), headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers } });
}
function provider(generateCandidates: (input: EditingProviderInput) => Promise<EditingProviderResult>, external = false): EditingProvider {
  return { generateCandidates, externalDataTransfer: external, providerId: external ? "openai" : "mock", defaultModelId: external ? "gpt-5.6-terra" : LOCAL_DEMO_MODEL_ID };
}
function dependencies(provider: EditingProvider) {
  return { provider, rateLimiter: createAiRateLimiter(() => 0), config: readAiServerConfig({ APP_ORIGIN: origin, AI_PROVIDER: provider.providerId, AI_ENABLE_PAID_API: "true", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5.6-terra" }) };
}
const output = { candidates: [{ replacementText: "読み：よいん。意味：物事が終わった後も残る感じ。", explanation: "語句の説明", riskNotes: [] }] };

describe("dictionary API", () => {
  it("builds a query-only prompt on the server and returns validated metadata", async () => {
    const generate = vi.fn(async (value: EditingProviderInput): Promise<EditingProviderResult> => {
      const data: unknown = JSON.parse(value.prompt.inputDataJson);
      expect(data).toMatchObject({ candidateCount: 1 });
      expect(data).not.toHaveProperty("selectionText");
      expect(data).not.toHaveProperty("beforeText");
      expect(data).not.toHaveProperty("globalContext");
      expect(data).not.toHaveProperty("storyMemory");
      expect(value.prompt.inputDataJson).toContain("余韻");
      expect(value.prompt.inputDataJson).toContain("読み取り専用の辞書照会");
      return { status: "completed", output, usage: null };
    });
    const response = await handleDictionaryPost(request(), dependencies(provider(generate)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = aiEditSuccessResponseSchema.parse(await response.json());
    expect(result.candidates[0]?.replacementText).toBe(output.candidates[0]?.replacementText);
    expect(result.contextUsage.sentCodePoints).toMatchObject({ selectionText: 0, beforeText: 0, afterText: 0, commonPrompt: 0, manualStyle: 0 });
    expect(generate).toHaveBeenCalledOnce();
  });

  it.each([{ query: "語".repeat(101) }, { query: "" }, { query: "\ud800" }, { instruction: "勝手に置換" }, { storyMemory: {} }])("rejects invalid or extra input before provider use", async (override) => {
    const generate = vi.fn();
    const response = await handleDictionaryPost(request({ ...input, ...override }), dependencies(provider(generate)));
    expect(response.status).toBe(400); expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    [{ origin: "https://example.com" }, 403],
    [{ "sec-fetch-site": "cross-site" }, 403],
    [{ "content-type": "text/plain" }, 415],
    [{ "content-length": "65537" }, 413],
  ] as const)("guards the dedicated dictionary endpoint", async (headers, expected) => {
    const generate = vi.fn();
    const response = await handleDictionaryPost(request(input, headers), dependencies(provider(generate)));
    expect(response.status).toBe(expected); expect(generate).not.toHaveBeenCalled();
  });

  it("requires explicit paid API permission and matching consent", async () => {
    const generate = vi.fn(); const deps = dependencies(provider(generate, true));
    for (const value of [input, { ...input, allowPaidApi: true }, { ...input, allowPaidApi: true, consent: { providerId: "chatgpt", policyVersion: 1 } }]) {
      const response = await handleDictionaryPost(request(value), deps);
      expect(response.status).toBe(403); expect(generate).not.toHaveBeenCalled();
    }
    expect(dictionaryRequestSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    ["refusal", "PROVIDER_REFUSAL"], ["incomplete", "INCOMPLETE_OUTPUT"], ["timeout", "PROVIDER_TIMEOUT"],
  ] as const)("normalizes %s without another call", async (reason, code) => {
    const generate = vi.fn(async (): Promise<EditingProviderResult> => ({ status: "failed", reason }));
    const response = await handleDictionaryPost(request(), dependencies(provider(generate)));
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("rejects invalid output instead of repairing it", async () => {
    const generate = vi.fn(async (): Promise<EditingProviderResult> => ({ status: "completed", output: { html: "<script>" }, usage: null }));
    const response = await handleDictionaryPost(request(), dependencies(provider(generate)));
    expect(response.status).toBe(502); expect(generate).toHaveBeenCalledOnce();
  });
});
