import fc from "fast-check";
import { redo, undo, undoDepth } from "@tiptap/pm/history";
import { describe, expect, it, vi } from "vitest";
import { validateAiEditRequest, validateLlmCandidateResponse, type AiEditRequest } from "../../src/domain/ai-edit";
import type { CompletionOperation } from "../../src/domain/completion";
import { captureSelection, plainTextOffsetToProseMirrorPosition } from "../../src/features/editor/selection";
import { replaceCapturedSelection } from "../../src/features/editor/replace-selection";
import { buildAiEditRequestDraft, createAiEditController } from "../../src/features/ai-edit/controller";
import { createAiEditModelInput } from "../../src/features/ai-edit/intent";
import { createPromptPlan, renderPromptPlan } from "../../src/features/ai-edit/prompt";
import { validateAiEditClientSuccess, type AiEditClientResult, type SendAiEditRequest } from "../../src/features/ai-edit/client";
import { createAiEditService } from "../../src/server/ai/edit-service";
import { createMockEditingProvider } from "../../src/server/ai/mock-provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createAiEditRequestFixture, createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { MOCK_AI_RUNTIME } from "../fixtures/ai-runtime";
import { createDeferred } from "../helpers/deferred";

const context = { chapterId: "chapter", commonPrompt: "静かな物語", contextRevision: 1,
  documentId: "document", editable: true, manualStyle: "常体", projectId: "project",
  storyMemory: { settingNotes: "秘密の設定", backgroundNotes: "海辺", characterNotes: "葵" } };

function session(operation: CompletionOperation, text: string, from: number, to = from) {
  const s = createTestEditor(text);
  const start = plainTextOffsetToProseMirrorPosition(s.editor.state.doc, from);
  const end = plainTextOffsetToProseMirrorPosition(s.editor.state.doc, to);
  if (start === null || end === null) throw new Error("Invalid fixture range");
  setTextSelection(s.editor, start, end);
  return { ...s, capture: () => captureSelection(s.editor, context, operation) };
}
function request(operation: CompletionOperation = "infill"): AiEditRequest {
  return { ...createAiEditRequestFixture(), operation, selectionText: operation === "infill" ? "　\n" : "",
    afterText: operation === "infill" ? "彼女は振り返った。" : "", candidateCount: 1, targetCharacters: 400 };
}

describe("explicit contextual completion", () => {
  it("inserts at arbitrary Unicode boundaries without changing either side", () => {
    const prose = fc.array(fc.constantFrom("あ", "🙂", "\n", "é", "　"), { maxLength: 15 }).map((chars) => chars.join(""));
    fc.assert(fc.property(prose, prose, (before, after) => {
      const s = session("context-insert", before + after, before.length);
      try {
        const captured = s.capture(); if (captured.status !== "captured") throw new Error("Missing snapshot");
        expect(replaceCapturedSelection(s.editor, captured.snapshot, "挿入🙂\n", context).status).toBe("applied");
        expect(s.getPlainText()).toBe(before + "挿入🙂\n" + after);
      } finally { s.destroy(); }
    }), { numRuns: 80 });
  });

  it.each([["前。", "後。"], ["", "後。"], ["前。", ""], ["", ""]])("generates from the supplied content and available context (%s / %s)", async (beforeText, afterText) => {
    const value = { ...request("context-insert"), beforeText, afterText, instruction: "主人公が返事をためらう仕草を描いて" };
    expect(validateAiEditRequest(value).success).toBe(true);
    const provider = createMockEditingProvider(); const generate = vi.fn(provider.generateCandidates);
    const service = createAiEditService({ provider: { ...provider, generateCandidates: generate }, rateLimiter: createAiRateLimiter(() => 0) });
    const result = await service.generate(value, new AbortController().signal); expect(result.success).toBe(true);
    const sent = generate.mock.calls[0]?.[0].prompt;
    expect(JSON.parse(sent?.inputDataJson ?? "")).toMatchObject({ operation: "context-insert", taskInstruction: value.instruction, beforeText, afterText, selectionText: "", targetCharacters: 400 });
    expect(sent?.systemInstruction).toContain("taskInstructionの書きたい内容を主題として");
    expect(sent?.systemInstruction).toContain("前後の語句・語り口・場面に自然につなぎ");
    expect(sent?.systemInstruction).not.toContain("現在の章の末尾へ挿入する続き");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("rejects blank content, nonempty targets and invalid context-insert bounds before calling any provider", async () => {
    const value = { ...request("context-insert"), afterText: "後。" };
    const provider = createMockEditingProvider(); const generate = vi.fn(provider.generateCandidates);
    const service = createAiEditService({ provider: { ...provider, generateCandidates: generate }, rateLimiter: createAiRateLimiter(() => 0) });
    const invalid = [
      ...["", "　\n", "指".repeat(501), "\ud800"].map((instruction) => ({ ...value, instruction })),
      ...[undefined, 0, 1.5, 3001].map((targetCharacters) => ({ ...value, targetCharacters })),
      { ...value, selectionText: "原文" }, { ...value, selectionText: "　" }, { ...value, presetId: "polish" },
      { ...value, beforeText: "前".repeat(1001) }, { ...value, afterText: "後".repeat(1001) },
      { ...value, from: 1 }, { ...value, operation: "unknown-insert" },
    ];
    for (const input of invalid) {
      expect(validateAiEditRequest(input).success).toBe(false);
      expect((await service.generate(input, new AbortController().signal)).success).toBe(false);
    }
    expect(generate).not.toHaveBeenCalled();
    expect(validateAiEditRequest({ ...value, instruction: "指".repeat(500), targetCharacters: 1 }).success).toBe(true);
    expect(validateAiEditRequest({ ...value, targetCharacters: 3000 }).success).toBe(true);
    for (const replacementText of ["", "　\n", "\ud800", "長".repeat(3001)]) {
      expect(validateLlmCandidateResponse({ candidates: [{ replacementText, explanation: "", riskNotes: [] }] }, "", 1, "context-insert").success).toBe(false);
    }
  });

  it.each(["infill", "continue", "context-insert"] as const)("%s accepts 3,000 Unicode characters without a short-gap length cap", (op) => {
    const s = op === "infill" ? session(op, "前。　後。", 2, 3) : session(op, "前。", 2);
    try {
      const captured = s.capture(); if (captured.status !== "captured") throw new Error("Missing snapshot");
      expect(replaceCapturedSelection(s.editor, captured.snapshot, "🙂".repeat(3001), context).status).toBe("invalid-replacement");
      expect(undoDepth(s.editor.state)).toBe(0);
      expect(replaceCapturedSelection(s.editor, captured.snapshot, "🙂".repeat(3000), context).status).toBe("applied");
      expect(s.getPlainText()).toBe("前。" + "🙂".repeat(3000) + (op === "infill" ? "後。" : ""));
      expect(undo(s.editor.state, s.editor.view.dispatch)).toBe(true);
      expect(s.getPlainText()).toBe(op === "infill" ? "前。　後。" : "前。");
    } finally { s.destroy(); }
  });

  it.each([
    ["context-insert", "前🙂後。", 3, 3],
    ["context-insert", "前🙂後。", 0, 0],
    ["context-insert", "前🙂後。", 5, 5],
    ["context-insert", "前。\n後。", 2, 2],
    ["context-insert", "前。\n\n後。", 3, 3],
    ["context-insert", "", 0, 0],
    ["infill", "前🙂。　 \n　後。", 4, 8],
    ["infill", "前。\n\n後。", 3, 3],
    ["infill", "前。\n\n後。", 2, 4],
    ["continue", "前🙂。", 4, 4],
    ["continue", "前。\n", 3, 3],
  ] as const)("%s applies only the captured gap in %s with one Undo and Redo", (op, text, from, to) => {
    const s = session(op, text, from, to);
    try {
      const result = s.capture(); expect(result.status).toBe("captured");
      if (result.status !== "captured") throw new Error("Missing snapshot");
      const before = s.editor.state.doc.toJSON();
      const candidate = "　足音🙂が響いた。\n\n彼は振り返った。";
      expect(replaceCapturedSelection(s.editor, result.snapshot, candidate, context).status).toBe("applied");
      const expected = text.slice(0, from) + candidate + text.slice(to);
      expect(s.getPlainText()).toBe(expected); expect(undoDepth(s.editor.state)).toBe(1);
      expect(undo(s.editor.state, s.editor.view.dispatch)).toBe(true); expect(s.editor.state.doc.toJSON()).toEqual(before);
      expect(redo(s.editor.state, s.editor.view.dispatch)).toBe(true); expect(s.getPlainText()).toBe(expected);
    } finally { s.destroy(); }
  });

  it("preserves exact prefix and suffix across Unicode whitespace ranges", () => {
    const prose = fc.array(fc.constantFrom("あ", "🙂", "\n", "é"), { maxLength: 12 }).map((chars) => chars.join(""));
    const gap = fc.array(fc.constantFrom(" ", "　", "\n", "\t"), { minLength: 1, maxLength: 10 }).map((chars) => chars.join(""));
    fc.assert(fc.property(prose, gap, prose, (left, blank, right) => {
      const before = `前${left}`, after = `${right}後`;
      const s = session("infill", before + blank + after, before.length, before.length + blank.length);
      try {
        const captured = s.capture(); if (captured.status !== "captured") throw new Error("Missing snapshot");
        expect(replaceCapturedSelection(s.editor, captured.snapshot, "補完🙂\n", context).status).toBe("applied");
        expect(s.getPlainText()).toBe(before + "補完🙂\n" + after);
      } finally { s.destroy(); }
    }), { numRuns: 80 });
  });

  it.each([
    ["infill", "前後", 1, 1], ["infill", "前後", 0, 1], ["infill", "　後", 0, 1],
    ["infill", "前　", 1, 2], ["infill", "", 0, 0],
    ["context-insert", "前後", 0, 1], ["context-insert", "前　後", 1, 2],
    ["continue", "前後", 1, 1], ["continue", "前後", 0, 2], ["continue", "　\n", 2, 2],
  ] as const)("rejects %s at an invalid target in %s", (op, text, from, to) => {
    const s = session(op, text, from, to);
    try { expect(s.capture().status).toBe("unavailable"); expect(undoDepth(s.editor.state)).toBe(0); }
    finally { s.destroy(); }
  });

  it.each(["infill", "continue"] as const)("bounds %s requests and output on client and server", async (op) => {
    const valid = request(op);
    expect(validateAiEditRequest(valid).success).toBe(true);
    const provider = createMockEditingProvider(); const generate = vi.fn(provider.generateCandidates);
    const service = createAiEditService({ provider: { ...provider, generateCandidates: generate }, rateLimiter: createAiRateLimiter(() => 0) });
    const invalid = [
      ...[undefined, 0, -1, 1.5, 3001, "400", Infinity].map((targetCharacters) => ({ ...valid, targetCharacters })),
      { ...valid, beforeText: "" }, { ...valid, selectionText: "既存の文章" }, { ...valid, presetId: "expand" },
      { ...valid, selectionText: "\ud800" }, { ...valid, beforeText: "前".repeat(1001) },
      { ...valid, afterText: op === "infill" ? "" : "後" },
      { ...createAiEditRequestFixture(), targetCharacters: 400 },
    ];
    for (const value of invalid) {
      expect(validateAiEditRequest(value).success).toBe(false);
      expect((await service.generate(value, new AbortController().signal)).success).toBe(false);
    }
    expect(generate).not.toHaveBeenCalled();
    const response = await service.generate(valid, new AbortController().signal); expect(response.success).toBe(true);
    const sent = generate.mock.calls[0]?.[0].prompt;
    expect(JSON.parse(sent?.inputDataJson ?? "")).toMatchObject({ operation: op, targetCharacters: 400, beforeText: valid.beforeText, afterText: valid.afterText });
    expect(sent?.systemInstruction).toContain("新たな描写・会話・出来事を創作できます");
    expect(sent?.systemInstruction).not.toContain("selectionTextだけです");
    for (const text of ["", " \n", "長".repeat(3001), "\ud800"]) {
      const wire = { candidates: [{ replacementText: text, explanation: "", riskNotes: [] }] };
      expect(validateLlmCandidateResponse(wire, valid.selectionText, 1, op).success).toBe(false);
    }
    const fixture = createAiEditSuccessResponseFixture(valid);
    const oversized = { ...fixture, candidates: fixture.candidates.map((candidate) => ({ ...candidate, replacementText: "長".repeat(3001) })) };
    expect(validateAiEditClientSuccess(oversized, valid)?.status).toBe("error");
    expect(validateLlmCandidateResponse({ candidates: [{ replacementText: "長".repeat(3000), explanation: "", riskNotes: [] }] }, valid.selectionText, 1, op).success).toBe(true);
    expect(validateAiEditRequest({ ...valid, targetCharacters: 1 }).success).toBe(true);
    expect(validateAiEditRequest({ ...valid, targetCharacters: 3000 }).success).toBe(true);
  });

  it.each(["infill", "context-insert"] as const)("%s sends bounded adjacent context, optional selected memory, no coordinates, and retains the target in the prompt budget", (operation) => {
    const text = "前".repeat(1200) + (operation === "infill" ? "　" : "") + "後".repeat(1200);
    const s = session(operation, text, 1200, operation === "infill" ? 1201 : 1200);
    try {
      const captured = s.capture(); if (captured.status !== "captured") throw new Error("Missing snapshot");
      const input = { candidateCount: 1 as const, instruction: "雨の描写", presetId: null, targetCharacters: 800 };
      const draft = buildAiEditRequestDraft(captured.snapshot, input, null, null);
      expect(draft.beforeText).toHaveLength(1000); expect(draft.afterText).toHaveLength(1000);
      expect(draft).not.toHaveProperty("storyMemory"); expect(draft).not.toHaveProperty("from");
      const withMemory = buildAiEditRequestDraft(captured.snapshot, { ...input, useStoryMemory: true, storyMemoryFields: ["characterNotes"] }, null, null);
      expect(withMemory.storyMemory).toEqual({ settingNotes: "", backgroundNotes: "", characterNotes: "葵" });
      const plan = createPromptPlan(createAiEditModelInput(withMemory)); if (!plan.success) throw new Error("Invalid prompt");
      const payload: unknown = JSON.parse(renderPromptPlan(plan.data.promptPlan).inputDataJson);
      expect(payload).toMatchObject({ targetCharacters: 800, storyMemory: withMemory.storyMemory });
      expect(JSON.stringify(payload)).not.toContain("秘密の設定");
      expect(createPromptPlan({ ...createAiEditModelInput(withMemory), beforeText: "" }).success).toBe(operation === "context-insert");
    } finally { s.destroy(); }
  });

  it.each(["infill", "continue", "context-insert"] as const)("%s ignores abort-ignoring late responses after selection or text changes", async (op) => {
    for (const change of ["selection", "text"] as const) {
      const s = op === "infill" ? session(op, "前。　後。", 2, 3) : session(op, op === "context-insert" ? "前。後。" : "前。", 2);
      const pending = createDeferred<AiEditClientResult>(); const sendRequest = vi.fn<SendAiEditRequest>(() => pending.promise);
      const controller = createAiEditController({ getCaptureContext: () => context, getConsent: () => null, getEditor: () => s.editor,
        getModelPreference: () => "automatic", getRuntime: () => MOCK_AI_RUNTIME, onStateChange: () => undefined, sendRequest });
      try {
        const captured = s.capture(); if (captured.status !== "captured") throw new Error("Missing snapshot");
        controller.open(captured.snapshot); controller.updateInput({ candidateCount: 1, instruction: "自然につなぐ", presetId: null, targetCharacters: 400 });
        const submission = controller.submit(); const submitted = sendRequest.mock.calls[0]?.[0]; if (!submitted) throw new Error("Missing request");
        if (change === "selection") { setTextSelection(s.editor, 1); setTextSelection(s.editor, captured.snapshot.from, captured.snapshot.to); }
        else { s.editor.view.dispatch(s.editor.state.tr.insertText("手入力")); undo(s.editor.state, s.editor.view.dispatch); }
        controller.revalidate(); expect(sendRequest.mock.calls[0]?.[1].aborted).toBe(true);
        pending.resolve({ status: "success", data: createAiEditSuccessResponseFixture(submitted) }); await submission;
        expect(controller.getState().kind).toBe("stale"); expect(controller.accept()).toBeNull();
        expect(replaceCapturedSelection(s.editor, captured.snapshot, "古い候補", context).status).toBe("stale");
      } finally { controller.dispose(); s.destroy(); }
    }
  });
});
