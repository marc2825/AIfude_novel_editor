import { describe, expect, it, vi } from "vitest";
import { undoDepth } from "@tiptap/pm/history";
import { createAiEditController } from "../../src/features/ai-edit/controller";
import type { AiEditClientResult, SendAiEditRequest } from "../../src/features/ai-edit/client";
import { captureSelection } from "../../src/features/editor/selection";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createDeferred } from "../helpers/deferred";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { CHATGPT_CONNECTION_ID, CHATGPT_RUNTIME } from "../fixtures/chatgpt";

describe("subscription connection changes during editing", () => {
  it.each(["generating", "preview"])("invalidates %s synchronously and prevents accepting old output", async (phase) => {
    const editor = createTestEditor("前対象後");
    setTextSelection(editor.editor, 2, 4);
    const context = { chapterId: "chapter", commonPrompt: "", contextRevision: 0, documentId: "document", editable: true, manualStyle: "", projectId: "project" };
    const captured = captureSelection(editor.editor, context);
    if (captured.status !== "captured") throw new Error("Expected selection");
    const pending = createDeferred<AiEditClientResult>();
    const sendRequest = vi.fn<SendAiEditRequest>((request) => {
      expect(request.connectionId).toBe(CHATGPT_CONNECTION_ID);
      const fixture = createAiEditSuccessResponseFixture(request);
      if (phase === "preview") pending.resolve({ data: fixture, status: "success" });
      return pending.promise;
    });
    const controller = createAiEditController({
      getCaptureContext: () => context,
      getConsent: () => ({ grantedAt: "2026-10-14T00:00:00.000Z", policyVersion: 1, providerId: "chatgpt" }),
      getEditor: () => editor.editor, getModelPreference: () => "automatic", getRuntime: () => CHATGPT_RUNTIME,
      onStateChange: () => undefined, sendRequest,
    });
    try {
      controller.open(captured.snapshot); controller.updateInput({ candidateCount: 2, instruction: "自然に", presetId: null });
      const submission = controller.submit();
      if (phase === "preview") await submission;
      expect(controller.getState().kind).toBe(phase);
      controller.invalidateContext();
      expect(controller.getState().kind).toBe("stale");
      expect(controller.accept()).toBeNull();
      const request = sendRequest.mock.calls[0]?.[0];
      if (!request) throw new Error("Expected submitted request");
      pending.resolve({ data: createAiEditSuccessResponseFixture(request), status: "success" });
      await submission;
      expect(controller.getState().kind).toBe("stale");
      expect(editor.getPlainText()).toBe("前対象後"); expect(undoDepth(editor.editor.state)).toBe(0);
    } finally { controller.dispose(); editor.destroy(); }
  });
});
