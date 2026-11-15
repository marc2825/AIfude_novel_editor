import { describe, expect, it, vi } from "vitest";
import { undo } from "@tiptap/pm/history";
import { handleComparisonPost } from "../../src/server/http/comparison-handler";
import { createAiRateLimiter, getProviderRateLimiter } from "../../src/server/http/rate-limit";
import { handleAiEditPost } from "../../src/server/http/ai-edit-handler";
import { readAiServerConfig } from "../../src/server/ai/config";
import type { EditingProvider, EditingProviderResult } from "../../src/server/ai/provider";
import { aiComparisonResponseSchema, type AiComparisonRequest, type AiComparisonResponse } from "../../src/domain/ai-comparison";
import { postAiComparisonRequest } from "../../src/features/ai-edit/comparison-client";
import { createAiEditController } from "../../src/features/ai-edit/controller";
import { captureSelection } from "../../src/features/editor/selection";
import { MOCK_AI_RUNTIME, LOCAL_AI_RUNTIME } from "../fixtures/ai-runtime";
import { createAiEditRequestFixture, createAiEditSuccessResponseFixture, createCandidateWireResponse } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";
import { createTestEditor, setTextSelection } from "../helpers/editor";

const origin = "http://127.0.0.1:3000";
const config = readAiServerConfig({ APP_ORIGIN: origin, AI_PROVIDER: "mock" });
function request(): AiComparisonRequest {
  return { request: { ...createAiEditRequestFixture(), operation: "insert", selectionText: "", beforeText: "", afterText: "",
    globalContext: { commonPrompt: "", manualStyle: "" }, candidateCount: 1, instruction: "雨の描写" },
    targets: [{ providerId: "mock" }, { providerId: "local" }], consent: true };
}
function http(value: unknown, sender = origin) {
  return new Request(`${origin}/api/ai/comparisons`, { method: "POST", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3000", Origin: sender }, body: JSON.stringify(value) });
}
function providers() {
  const mock = vi.fn<EditingProvider["generateCandidates"]>().mockResolvedValue({ status: "completed", output: createCandidateWireResponse(1), usage: null });
  const local = vi.fn<EditingProvider["generateCandidates"]>().mockResolvedValue({ status: "completed", output: createCandidateWireResponse(1), usage: null });
  const adapters: EditingProvider[] = [
    { providerId: "mock", defaultModelId: "local-demo", externalDataTransfer: false, generateCandidates: mock },
    { providerId: "local", defaultModelId: "local-default", externalDataTransfer: false, generateCandidates: local },
  ];
  return { mock, local, dependencies: { config, providers: adapters, rateLimiters: new Map(adapters.map((adapter) => [adapter.providerId, createAiRateLimiter(() => 0)])) } };
}
function response(input: AiComparisonRequest): AiComparisonResponse {
  const first = createAiEditSuccessResponseFixture(input.request);
  return { requestId: input.request.requestId, results: [
    { success: true, providerId: "mock", data: first },
    { success: true, providerId: "local", data: { ...first, provider: { providerId: "local", model: "local-default" }, candidates: first.candidates.map((candidate) => ({ ...candidate,
      id: crypto.randomUUID(), providerId: "local", model: "local-default", replacementText: "ローカルの文章" })) } },
  ] };
}

describe("simultaneous AI comparison", () => {
  it.each(["infill", "continue", "context-insert"] as const)("sends identical bounded %s context and character target to each provider", async (operation) => {
    const h = providers();
    const input = { ...request(), request: { ...request().request, operation, beforeText: "雨が止んだ。",
      afterText: operation === "continue" ? "" : "彼は歩き出した。", selectionText: operation === "infill" ? "　" : "", targetCharacters: 250 } };
    const result = aiComparisonResponseSchema.parse(await (await handleComparisonPost(http(input), h.dependencies)).json());
    expect(result.results.every((row) => row.success)).toBe(true);
    for (const generate of [h.mock, h.local]) {
      expect(JSON.parse(generate.mock.calls[0]?.[0].prompt.inputDataJson ?? "")).toMatchObject({ operation, beforeText: input.request.beforeText, afterText: input.request.afterText, targetCharacters: 250 });
    }
    expect(h.mock.mock.calls[0]?.[0].prompt).toEqual(h.local.mock.calls[0]?.[0].prompt);
  });

  it("includes the same explicitly selected memory for every compared provider", async () => {
    const h = providers(); const memory = { settingNotes: "魔法なし", backgroundNotes: "海辺", characterNotes: "葵" };
    const input = request();
    const result = aiComparisonResponseSchema.parse(await (await handleComparisonPost(http({ ...input, request: { ...input.request, storyMemory: memory } }), h.dependencies)).json());
    expect(result.results.every((row) => row.success)).toBe(true);
    for (const generate of [h.mock, h.local]) {
      const sent = generate.mock.calls[0]?.[0].prompt.inputDataJson;
      expect(JSON.parse(sent ?? "")).toMatchObject({ storyMemory: memory });
    }
    expect(h.mock.mock.calls[0]?.[0].prompt).toEqual(h.local.mock.calls[0]?.[0].prompt);
  });
  it("shares a provider's concurrency limit between single generation and comparison routes", async () => {
    const h = providers(); const pending = createDeferred<EditingProviderResult>(); h.local.mockReturnValue(pending.promise);
    const local = h.dependencies.providers.find((provider) => provider.providerId === "local"); if (!local) throw new Error("Missing provider");
    const rateLimiter = getProviderRateLimiter("local");
    const single = handleAiEditPost(http(request().request), { config, provider: local, rateLimiter });
    await vi.waitFor(() => expect(h.local).toHaveBeenCalledOnce());
    const compared = aiComparisonResponseSchema.parse(await (await handleComparisonPost(http(request()), { ...h.dependencies,
      rateLimiters: new Map([["mock", getProviderRateLimiter("mock")], ["local", getProviderRateLimiter("local")]]) })).json());
    expect(compared.results[1]).toMatchObject({ success: false, code: "RATE_LIMITED", providerId: "local" });
    expect(h.local).toHaveBeenCalledOnce();
    pending.resolve({ status: "completed", output: createCandidateWireResponse(1), usage: null }); expect((await single).status).toBe(200);
  });
  it("rejects an API target before submitting to any AI unless API opt-in is present", async () => {
    const h = providers();
    const mock = h.dependencies.providers[0];
    if (!mock) throw new Error("Missing mock provider");
    const api = { ...h.dependencies.providers[1], providerId: "gemini" as const, defaultModelId: "gemini-default" as const, externalDataTransfer: true, generateCandidates: h.local };
    const dependencies = { ...h.dependencies, providers: [mock, api], rateLimiters: new Map([["mock", createAiRateLimiter()], ["gemini", createAiRateLimiter()]]) };
    expect((await handleComparisonPost(http({ ...request(), targets: [{ providerId: "mock" }, { providerId: "gemini" }] }), dependencies)).status).toBe(400);
    expect(h.mock).not.toHaveBeenCalled(); expect(h.local).not.toHaveBeenCalled();
  });
  it("starts both providers before either completes and sends identical model-visible input", async () => {
    const h = providers();
    const one = createDeferred<EditingProviderResult>(); const two = createDeferred<EditingProviderResult>();
    h.mock.mockReturnValue(one.promise); h.local.mockReturnValue(two.promise);
    const result = handleComparisonPost(http(request()), h.dependencies);
    await vi.waitFor(() => { expect(h.mock).toHaveBeenCalledOnce(); expect(h.local).toHaveBeenCalledOnce(); });
    expect(h.mock.mock.calls[0]?.[0].prompt).toEqual(h.local.mock.calls[0]?.[0].prompt);
    one.resolve({ status: "completed", output: createCandidateWireResponse(1), usage: null });
    two.resolve({ status: "completed", output: createCandidateWireResponse(1), usage: null });
    const received = await result;
    expect(received.status).toBe(200); expect(received.headers.get("cache-control")).toBe("no-store");
    const parsed = aiComparisonResponseSchema.parse(await received.json());
    expect(parsed.results.map((result) => result.success)).toEqual([true, true]);
  });
  it("preserves the successful provider when another fails, with no retries or fallback", async () => {
    const h = providers(); h.local.mockResolvedValue({ status: "failed", reason: "failure" });
    const parsed = aiComparisonResponseSchema.parse(await (await handleComparisonPost(http(request()), h.dependencies)).json());
    expect(parsed.results[0]?.success).toBe(true);
    expect(parsed.results[1]).toEqual({ success: false, providerId: "local", code: "PROVIDER_FAILURE" });
    expect(h.mock).toHaveBeenCalledOnce(); expect(h.local).toHaveBeenCalledOnce();
  });
  it("rejects unknown, duplicate or missing targets, missing consent and hostile origin before calling any provider", async () => {
    const h = providers(); const input = request();
    for (const value of [{ ...input, consent: false }, { ...input, targets: [input.targets[0]] }, { ...input, targets: [input.targets[0], input.targets[0]] },
      { ...input, targets: [{ providerId: "unknown" }, input.targets[0]] }, { ...input, targets: [{ providerId: "chatgpt" }, input.targets[0]] }]) {
      expect((await handleComparisonPost(http(value), h.dependencies)).status).toBe(400);
    }
    expect((await handleComparisonPost(http(input, "https://evil.example"), h.dependencies)).status).toBe(403);
    expect(h.mock).not.toHaveBeenCalled(); expect(h.local).not.toHaveBeenCalled();
  });
  it("discards abort-ignoring providers when the caller cancels", async () => {
    const h = providers(); const pending = createDeferred<EditingProviderResult>();
    h.mock.mockReturnValue(pending.promise); h.local.mockReturnValue(pending.promise);
    const abort = new AbortController(); const input = http(request());
    const result = handleComparisonPost(new Request(input, { signal: abort.signal }), h.dependencies);
    await vi.waitFor(() => expect(h.local).toHaveBeenCalledOnce()); abort.abort();
    const received = aiComparisonResponseSchema.parse(await (await result).json());
    expect(received.results.every((result) => !result.success)).toBe(true);
    pending.resolve({ status: "completed", output: createCandidateWireResponse(1), usage: null });
  });
  it("validates result identities and preserves the provider order at the client boundary", async () => {
    const input = request(); const data = response(input);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data));
    const result = await postAiComparisonRequest(input, new AbortController().signal);
    expect(result.status).toBe("comparison-success");
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...data, results: [...data.results].reverse() }));
    expect((await postAiComparisonRequest(input, new AbortController().signal)).status).toBe("error");
  });
  it("returns promptly on cancellation even when fetch ignores it and later succeeds", async () => {
    const input = request(); const pending = createDeferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    const abort = new AbortController(); const result = postAiComparisonRequest(input, abort.signal); abort.abort();
    await expect(result).resolves.toEqual({ status: "cancelled" }); pending.resolve(Response.json(response(input)));
  });
  it("requires comparison consent and applies only the selected provider output with one Undo", async () => {
    const editor = createTestEditor("前後"); setTextSelection(editor.editor, 2);
    const context = { chapterId: "chapter", commonPrompt: "", contextRevision: 0, documentId: "document", editable: true, manualStyle: "", projectId: "project" };
    const capture = captureSelection(editor.editor, context, "insert"); if (capture.status !== "captured") throw new Error("Expected snapshot");
    const sendComparisonRequest = vi.fn(async (input: AiComparisonRequest) => ({ status: "comparison-success" as const, data: response(input) }));
    const sendRequest = vi.fn();
    const controller = createAiEditController({ getCaptureContext: () => context, getConsent: () => null, getEditor: () => editor.editor, getModelPreference: () => "automatic",
      getRuntime: () => ({ ...MOCK_AI_RUNTIME, comparisonProviders: [MOCK_AI_RUNTIME, LOCAL_AI_RUNTIME] }), onStateChange: () => undefined, sendComparisonRequest, sendRequest });
    try {
      controller.open(capture.snapshot);
      controller.updateInput({ candidateCount: 1, instruction: "雨の描写", presetId: null, compareProviderIds: ["mock", "local"] });
      expect(controller.canSubmit()).toBe(false); await controller.submit(); expect(sendComparisonRequest).not.toHaveBeenCalled();
      controller.updateInput({ candidateCount: 1, instruction: "雨の描写", presetId: null, compareProviderIds: ["mock", "local"], compareConsent: true });
      expect(controller.canSubmit()).toBe(true); await controller.submit();
      expect(sendComparisonRequest).toHaveBeenCalledOnce(); expect(sendRequest).not.toHaveBeenCalled();
      const state = controller.getState(); if (state.kind !== "preview") throw new Error("Expected preview");
      const local = state.comparisonResults?.find((result) => result.providerId === "local");
      if (!local?.success || !local.data.candidates[0]) throw new Error("Expected local result");
      controller.selectCandidate(local.data.candidates[0].id);
      expect(editor.getPlainText()).toBe("前後"); expect(controller.accept()?.status).toBe("applied");
      expect(editor.getPlainText()).toBe("前ローカルの文章後");
      undo(editor.editor.state, editor.editor.view.dispatch); expect(editor.getPlainText()).toBe("前後");
    } finally { controller.dispose(); editor.destroy(); }
  });
});
