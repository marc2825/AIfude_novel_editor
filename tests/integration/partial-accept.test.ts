import { redo, undo, undoDepth } from "@tiptap/pm/history";
import { describe, expect, it, vi } from "vitest";
import { createAiEditController } from "../../src/features/ai-edit/controller";
import { captureSelection } from "../../src/features/editor/selection";
import type { SendAiEditRequest, AiEditClientResult } from "../../src/features/ai-edit/client";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createDeferred } from "../helpers/deferred";
import { MOCK_AI_RUNTIME } from "../fixtures/ai-runtime";
import { authoringFixture } from "../fixtures/authoring";

const original = "葵は青い空を見る。\n風は弱い。🙂";
const replacement = "葵は赤い空を見る。\n風は強い。🙂";
function harness(after = replacement) {
  const session = createTestEditor(`前${original}後`);
  session.editor.setOptions({ editorProps: { handleScrollToSelection: () => true } });
  // Paragraph boundaries occupy two PM positions, while the newline is one code unit.
  setTextSelection(session.editor, 2, original.length + 3);
  const context = { chapterId: "chapter", documentId: "document", projectId: "project", commonPrompt: "", manualStyle: "", editable: true, contextRevision: 0, authoringProfile: authoringFixture() };
  const capture = captureSelection(session.editor, context); if (capture.status !== "captured") throw new Error("capture");
  const sendRequest = vi.fn<SendAiEditRequest>().mockImplementation(async (request) => {
    const data = createAiEditSuccessResponseFixture(request);
    return { status: "success", data: { ...data, candidates: data.candidates.map((candidate) => ({ ...candidate, replacementText: after })) } };
  });
  const controller = createAiEditController({ getCaptureContext: () => context, getConsent: () => null, getEditor: () => session.editor, getModelPreference: () => "automatic", getRuntime: () => MOCK_AI_RUNTIME, onStateChange: () => undefined, sendRequest });
  controller.open(capture.snapshot); const input = { candidateCount: 2 as const, instruction: "推敲", presetId: null };
  controller.updateInput(input);
  return { ...session, context, controller, sendRequest, input, snapshot: capture.snapshot, cleanup() { controller.dispose(); session.destroy(); } };
}
describe("partial accept through the synchronous editor guard", () => {
  it("applies only one change in a single undoable transaction, preserving both outside ranges", async () => {
    const h = harness(); try {
      expect(h.snapshot.originalText).toBe(original);
      await h.controller.submit(); h.controller.selectPartialHunks([1]);
      expect(h.getPlainText()).toBe(`前${original}後`);
      expect(h.controller.accept()?.status).toBe("applied");
      expect(h.getPlainText()).toBe("前葵は青い空を見る。\n風は強い。🙂後"); expect(undoDepth(h.editor.state)).toBe(1);
      undo(h.editor.state, h.editor.view.dispatch); expect(h.getPlainText()).toBe(`前${original}後`);
      redo(h.editor.state, h.editor.view.dispatch); expect(h.getPlainText()).toContain("風は強い");
    } finally { h.cleanup(); }
  });
  it.each(["selection", "document", "profile", "composing", "invalid"] as const)("refuses unsafe partial application: %s", async (change) => {
    const h = harness(); try {
      await h.controller.submit(); h.controller.selectPartialHunks([0]);
      if (change === "selection") setTextSelection(h.editor, 1, 2);
      if (change === "document") h.editor.view.dispatch(h.editor.state.tr.insertText("加", 1));
      if (change === "profile") h.context.authoringProfile.characters[0].name = "変更";
      if (change === "composing") Object.defineProperty(h.editor.view, "composing", { configurable: true, value: true });
      if (change === "invalid") h.controller.selectPartialHunks([999]);
      const before = h.getPlainText(); expect(h.controller.accept()?.status).not.toBe("applied"); expect(h.getPlainText()).toBe(before);
    } finally { h.cleanup(); }
  });
  it("checks literal preservation even when Accept bypasses the UI", async () => {
    const h = harness(replacement.replace("葵", "凪")); try {
      await h.controller.submit(); expect(h.controller.accept()?.status).not.toBe("applied");
      expect(h.controller.getState()).toMatchObject({ kind: "preview", applyError: "preservation-violation" });
      expect(h.getPlainText()).toBe(`前${original}後`);
    } finally { h.cleanup(); }
  });
  it("resets partial choices on candidate switches and refuses empty reference submission", async () => {
    const h = harness(); try {
      await h.controller.submit(); h.controller.selectPartialHunks([0]);
      h.controller.selectCandidate("20000000-0000-4000-8000-000000000002");
      expect(h.controller.getState()).toMatchObject({ partialHunkIds: undefined });
      h.controller.updateInput({ ...h.input, authoringReference: {} });
      expect(h.controller.canSubmit()).toBe(false); await h.controller.submit(); expect(h.sendRequest).toHaveBeenCalledOnce();
    } finally { h.cleanup(); }
  });
  it("discards an abort-ignoring reply after a profile changes and keeps the captured profile immutable", async () => {
    const h = harness(); const pending = createDeferred<AiEditClientResult>(); try {
      h.sendRequest.mockReturnValue(pending.promise); const submitted = h.controller.submit();
      const sent = h.sendRequest.mock.calls[0]; if (!sent) throw new Error("request");
      h.context.authoringProfile.characters[0].firstPerson = "私"; h.controller.revalidate();
      expect(sent[1].aborted).toBe(true);
      pending.resolve({ status: "success", data: createAiEditSuccessResponseFixture(sent[0]) }); await submitted;
      expect(h.controller.getState().kind).toBe("stale"); expect(h.controller.accept()).toBeNull();
      expect(h.snapshot.authoringProfile?.characters[0].firstPerson).toBe("僕"); expect(h.getPlainText()).toBe(`前${original}後`);
    } finally { h.cleanup(); }
  });
});
