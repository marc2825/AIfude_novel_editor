import fc from "fast-check";
import { redo, undo, undoDepth } from "@tiptap/pm/history";
import { describe, expect, it, vi } from "vitest";
import { validateAiEditRequest, validateLlmCandidateResponse } from "../../src/domain/ai-edit";
import { captureSelection, plainTextOffsetToProseMirrorPosition } from "../../src/features/editor/selection";
import { replaceCapturedSelection } from "../../src/features/editor/replace-selection";
import { createAiEditController, buildAiEditRequestDraft } from "../../src/features/ai-edit/controller";
import type { AiEditClientResult, SendAiEditRequest } from "../../src/features/ai-edit/client";
import { createAiEditService } from "../../src/server/ai/edit-service";
import { createMockEditingProvider } from "../../src/server/ai/mock-provider";
import { createAiRateLimiter } from "../../src/server/http/rate-limit";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { MOCK_AI_RUNTIME } from "../fixtures/ai-runtime";
import { createDeferred } from "../helpers/deferred";

const context = { chapterId: "chapter", commonPrompt: "作品設定は送らない", contextRevision: 1,
  documentId: "document", editable: true, manualStyle: "文体設定は送らない", projectId: "project" };

function insertion(initialText: string, offset: number) {
  const session = createTestEditor(initialText);
  const position = plainTextOffsetToProseMirrorPosition(session.editor.state.doc, offset);
  if (position === null) throw new Error("Invalid test position");
  setTextSelection(session.editor, position);
  const result = captureSelection(session.editor, context, "insert");
  if (result.status !== "captured") throw new Error("Expected insertion snapshot");
  return { ...session, snapshot: result.snapshot };
}

describe("safe prompt insertion", () => {
  it.each([
    ["", 0], ["前後", 0], ["前後", 1], ["前後", 2], ["前🙂\n\n後\n", 4], ["前🙂\n\n後\n", 7],
  ])("inserts multiline Unicode at %s / %i and undoes it in one step", (text, offset) => {
    const s = insertion(text, offset);
    const candidate = "　新しい文章🙂\n\n次の段落\n";
    try {
      const before = s.editor.state.doc.toJSON();
      expect(replaceCapturedSelection(s.editor, s.snapshot, candidate, context).status).toBe("applied");
      expect(s.getPlainText()).toBe(text.slice(0, offset) + candidate + text.slice(offset));
      expect(undoDepth(s.editor.state)).toBe(1);
      expect(undo(s.editor.state, s.editor.view.dispatch)).toBe(true);
      expect(s.editor.state.doc.toJSON()).toEqual(before);
      expect(redo(s.editor.state, s.editor.view.dispatch)).toBe(true);
      expect(s.getPlainText()).toBe(text.slice(0, offset) + candidate + text.slice(offset));
    } finally { s.destroy(); }
  });

  it("preserves both sides for generated Unicode and paragraph boundaries", () => {
    const text = fc.array(fc.constantFrom("あ", "🙂", "\n", "　", "é"), { maxLength: 25 }).map((parts) => parts.join(""));
    fc.assert(fc.property(text, text, (before, after) => {
      const s = insertion(before + after, before.length);
      try {
        expect(replaceCapturedSelection(s.editor, s.snapshot, "挿入\n🙂\n", context).status).toBe("applied");
        expect(s.getPlainText()).toBe(before + "挿入\n🙂\n" + after);
      } finally { s.destroy(); }
    }), { numRuns: 80 });
  });

  it("does not treat a nonempty selection as an insertion target", () => {
    const s = createTestEditor("前後");
    try {
      setTextSelection(s.editor, 1, 3);
      expect(captureSelection(s.editor, context, "insert")).toMatchObject({ status: "unavailable" });
    } finally { s.destroy(); }
  });

  it.each(["", "　\n", "長".repeat(3001), "\ud800"])("rejects invalid insertion without adding history", (text) => {
    const s = insertion("前後", 1);
    try {
      expect(replaceCapturedSelection(s.editor, s.snapshot, text, context).status).toBe("invalid-replacement");
      expect(s.getPlainText()).toBe("前後"); expect(undoDepth(s.editor.state)).toBe(0);
    } finally { s.destroy(); }
  });

  it("allows 3,000 characters, without the short-selection replacement allowance", () => {
    const s = insertion("前後", 1);
    try {
      expect(replaceCapturedSelection(s.editor, s.snapshot, "長".repeat(3000), context).status).toBe("applied");
      expect(s.getPlainText()).toBe(`前${"長".repeat(3000)}後`);
    } finally { s.destroy(); }
  });

  it.each(["caret", "document"])("does not reuse a snapshot after a %s change and restoration", (kind) => {
    const s = insertion("前後", 1);
    try {
      if (kind === "caret") { setTextSelection(s.editor, 1); setTextSelection(s.editor, s.snapshot.from); }
      else { s.editor.view.dispatch(s.editor.state.tr.insertText("追")); undo(s.editor.state, s.editor.view.dispatch); }
      expect(replaceCapturedSelection(s.editor, s.snapshot, "挿入", context).status).toBe("stale");
      expect(s.getPlainText()).toBe("前後");
    } finally { s.destroy(); }
  });

  it("sends only the typed prompt, validates the mode, and accepts one candidate", async () => {
    const s = insertion("前後", 1);
    try {
      const draft = buildAiEditRequestDraft(s.snapshot, { candidateCount: 1, instruction: "雨の描写を書いて", presetId: null }, null, null);
      expect(draft).toMatchObject({ operation: "insert", selectionText: "", beforeText: "", afterText: "", globalContext: { commonPrompt: "", manualStyle: "" } });
      const request = { ...draft, requestId: crypto.randomUUID() };
      expect(validateAiEditRequest(request).success).toBe(true);
      for (const invalid of [{ ...request, operation: undefined }, { ...request, selectionText: "本文" }, { ...request, beforeText: "前" }, { ...request, globalContext: context }, { ...request, presetId: "polish" }]) {
        expect(validateAiEditRequest(invalid).success).toBe(false);
      }
      const provider = createMockEditingProvider();
      const generate = vi.fn(provider.generateCandidates);
      const service = createAiEditService({ provider: { ...provider, generateCandidates: generate }, rateLimiter: createAiRateLimiter(() => 0) });
      const response = await service.generate(request, new AbortController().signal);
      expect(response.success).toBe(true);
      if (!response.success) throw new Error("Expected output");
      expect(response.data.candidates).toHaveLength(1);
      const sent = generate.mock.calls[0]?.[0].prompt;
      expect(JSON.parse(sent?.inputDataJson ?? "")).toEqual({ taskInstruction: "雨の描写を書いて", candidateCount: 1 });
      expect(sent?.systemInstruction).not.toContain("selectionTextだけを編集");
      expect(s.getPlainText()).toBe("前後");
      expect(validateLlmCandidateResponse({ candidates: [{ replacementText: "長".repeat(3000), explanation: "", riskNotes: [] }] }, "", 1, "insert").success).toBe(true);
    } finally { s.destroy(); }
  });

  it.each(["caret", "document"])("discards a successful late response after the %s changes, even if abort is ignored", async (kind) => {
    const s = insertion("前後", 1);
    const pending = createDeferred<AiEditClientResult>();
    const sendRequest = vi.fn<SendAiEditRequest>(() => pending.promise);
    const controller = createAiEditController({ getCaptureContext: () => context, getConsent: () => null, getEditor: () => s.editor,
      getModelPreference: () => "automatic", getRuntime: () => MOCK_AI_RUNTIME, onStateChange: () => undefined, sendRequest });
    try {
      controller.open(s.snapshot); controller.updateInput({ candidateCount: 1, instruction: "雨の描写", presetId: null });
      const submission = controller.submit();
      const request = sendRequest.mock.calls[0]?.[0];
      if (!request) throw new Error("Expected request");
      if (kind === "caret") setTextSelection(s.editor, 1);
      else s.editor.view.dispatch(s.editor.state.tr.insertText("追"));
      controller.revalidate();
      pending.resolve({ status: "success", data: createAiEditSuccessResponseFixture(request) });
      await submission;
      expect(controller.getState().kind).toBe("stale"); expect(controller.accept()).toBeNull();
      expect(s.getPlainText()).toBe(kind === "caret" ? "前後" : "前追後");
    } finally { controller.dispose(); s.destroy(); }
  });
});
