import { redo, undo } from "@tiptap/pm/history";
import { describe, expect, it, vi } from "vitest";
import { createAiEditController } from "../../src/features/ai-edit/controller";
import { captureSelection, validateSelectionSnapshot } from "../../src/features/editor/selection";
import type { SendAiEditRequest, AiEditClientResult } from "../../src/features/ai-edit/client";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createDeferred } from "../helpers/deferred";
import { MOCK_AI_RUNTIME } from "../fixtures/ai-runtime";

function harness(operation?: "insert") {
  const session = createTestEditor("前対象後"); setTextSelection(session.editor, 2, operation ? 2 : 4);
  const memory = { settingNotes: "魔法はない", backgroundNotes: "海辺", characterNotes: "葵" };
  const context = { chapterId: "chapter", documentId: "document", projectId: "project", commonPrompt: "", manualStyle: "", editable: true, contextRevision: 0, storyMemory: memory };
  const captured = captureSelection(session.editor, context, operation); if (captured.status !== "captured") throw new Error("Expected snapshot");
  const sendRequest = vi.fn<SendAiEditRequest>().mockImplementation(async (request) => ({ status: "success", data: createAiEditSuccessResponseFixture(request) }));
  const controller = createAiEditController({ getCaptureContext: () => context, getConsent: () => null, getEditor: () => session.editor, getModelPreference: () => "automatic", getRuntime: () => MOCK_AI_RUNTIME, onStateChange: () => undefined, sendRequest });
  controller.open(captured.snapshot);
  const input = { candidateCount: operation ? 1 as const : 2 as const, instruction: "自然に", presetId: null };
  controller.updateInput(input);
  return { ...session, context, controller, sendRequest, snapshot: captured.snapshot, input,
    cleanup() { controller.dispose(); session.destroy(); } };
}

describe("optional story memory sessions", () => {
  it("invalidates candidates on field selection, sends only characters and refuses an empty ON selection", async () => {
    const h = harness();
    try {
      h.controller.updateInput({ ...h.input, useStoryMemory: true }); await h.controller.submit();
      h.controller.updateInput({ ...h.input, useStoryMemory: true, storyMemoryFields: ["characterNotes"] });
      expect(h.controller.getState().kind).toBe("command"); expect(h.controller.accept()).toBeNull();
      await h.controller.submit();
      expect(h.sendRequest.mock.calls[1]?.[0].storyMemory).toEqual({ settingNotes: "", backgroundNotes: "", characterNotes: "葵" });
      h.controller.updateInput({ ...h.input, useStoryMemory: true, storyMemoryFields: [] });
      expect(h.controller.canSubmit()).toBe(false); await h.controller.submit();
      expect(h.sendRequest).toHaveBeenCalledTimes(2); expect(h.getPlainText()).toBe("前対象後");
    } finally { h.cleanup(); }
  });
  it.each([undefined, "insert"] as const)("resets to OFF and invalidates previous candidates on toggle without changing body: %s", async (operation) => {
    const h = harness(operation);
    try {
      expect(h.controller.getState()).toMatchObject({ kind: "command", input: h.input });
      await h.controller.submit(); expect(h.sendRequest.mock.calls[0]?.[0]).not.toHaveProperty("storyMemory");
      expect(h.controller.getState().kind).toBe("preview");
      h.controller.updateInput({ ...h.input, useStoryMemory: true });
      expect(h.controller.getState().kind).toBe("command"); expect(h.controller.accept()).toBeNull(); expect(h.getPlainText()).toBe("前対象後");
      await h.controller.submit(); expect(h.sendRequest.mock.calls[1]?.[0].storyMemory).toEqual(h.context.storyMemory);
      expect(h.controller.accept()?.status).toBe("applied");
      const applied = h.getPlainText(); expect(applied).toContain("【デモ候補1】");
      undo(h.editor.state, h.editor.view.dispatch); expect(h.getPlainText()).toBe("前対象後");
      redo(h.editor.state, h.editor.view.dispatch); expect(h.getPlainText()).toBe(applied);
    } finally { h.cleanup(); }
  });
  it.each(["generating", "preview"] as const)("stales %s after saved memory changes, including an abort-ignoring response", async (phase) => {
    const h = harness(); const pending = createDeferred<AiEditClientResult>();
    try {
      h.controller.updateInput({ ...h.input, useStoryMemory: true });
      if (phase === "generating") h.sendRequest.mockReturnValue(pending.promise);
      const submitted = h.controller.submit(); if (phase === "preview") await submitted;
      const sent = h.sendRequest.mock.calls[0]; if (!sent) throw new Error("Missing request");
      h.context.storyMemory.characterNotes = "葵：変更後"; h.context.contextRevision += 1;
      h.controller.revalidate(); expect(h.controller.getState().kind).toBe("stale"); expect(sent[1].aborted).toBe(phase === "generating");
      if (phase === "generating") pending.resolve({ status: "success", data: createAiEditSuccessResponseFixture(sent[0]) });
      await submitted;
      expect(h.controller.getState().kind).toBe("stale"); expect(h.controller.accept()).toBeNull(); expect(h.getPlainText()).toBe("前対象後");
      expect(h.snapshot.storyMemory?.characterNotes).toBe("葵"); expect(Object.isFrozen(h.snapshot.storyMemory)).toBe(true);
    } finally { h.cleanup(); }
  });
  it("validates memory values synchronously at Accept even if revision updates are missed", async () => {
    const h = harness();
    try {
      await h.controller.submit(); h.context.storyMemory.settingNotes = "設定を変更";
      expect(validateSelectionSnapshot(h.editor, h.snapshot, h.context)).toEqual({ status: "stale", reason: "context-changed" });
      expect(h.controller.accept()?.status).toBe("stale"); expect(h.getPlainText()).toBe("前対象後");
    } finally { h.cleanup(); }
  });
  it("blocks a client submission that cannot fit the complete selected memory", async () => {
    const h = harness();
    try {
      h.controller.close();
      h.context.storyMemory = { settingNotes: "🙂".repeat(2000), backgroundNotes: "🙂".repeat(2000), characterNotes: "🙂".repeat(2000) };
      const capture = captureSelection(h.editor, h.context); if (capture.status !== "captured") throw new Error("Expected snapshot");
      h.controller.open(capture.snapshot); h.controller.updateInput({ ...h.input, useStoryMemory: true });
      expect(h.controller.canSubmit()).toBe(false); await h.controller.submit(); expect(h.sendRequest).not.toHaveBeenCalled();
      expect(h.getPlainText()).toBe("前対象後");
    } finally { h.cleanup(); }
  });
});
