import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiFeedbackPanel } from "../../src/features/feedback/AiFeedbackPanel";
import * as client from "../../src/features/feedback/feedback-client";
import type { FeedbackResponse } from "../../src/domain/feedback";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createDeferred } from "../helpers/deferred";
import { LOCAL_DEMO_MODEL_ID, findAiModelDefinition } from "../../src/domain/ai-models";

const editors: ReturnType<typeof createTestEditor>[] = [];
afterEach(() => { cleanup(); editors.splice(0).forEach((editor) => editor.destroy()); vi.restoreAllMocks(); });
function setup() {
  const value = createTestEditor("一番最初に会った。"); editors.push(value);
  const model = findAiModelDefinition(LOCAL_DEMO_MODEL_ID); if (!model) throw new Error("fixture model");
  const props = { editor: value.editor, contextRevision: 0, consent: null, modelPreference: "automatic", onConsentChange: vi.fn(async () => ({ ok: true })),
    runtime: { available: true, externalDataTransfer: false, providerId: "mock" as const, defaultModelId: LOCAL_DEMO_MODEL_ID, models: [model] } };
  const view = render(<AiFeedbackPanel {...props} />);
  return { ...value, props, view };
}
function response(requestId: string): FeedbackResponse {
  return { schemaVersion: 1, requestId, provider: { providerId: "mock", model: LOCAL_DEMO_MODEL_ID },
    comments: [{ id: crypto.randomUUID(), quote: "一番最初", comment: "強調が必要か確認してください。", cautions: [] }] };
}
describe("Feedback UI lifecycle", () => {
  it("requires reviewed scope and explicit generation, never offers Accept or mutates text", async () => {
    const send = vi.spyOn(client, "requestFeedback").mockImplementation(async (request) => response(request.requestId));
    const { getPlainText } = setup();
    expect(screen.getByRole("button", { name: "AIコメントを生成" })).toBeDisabled(); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "章全体を対象にする" })); expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AIコメントを生成" }));
    await screen.findByText("強調が必要か確認してください。");
    expect(screen.queryByRole("button", { name: "採用" })).toBeNull(); expect(getPlainText()).toBe("一番最初に会った。");
    expect(send.mock.calls[0][0].focus).toBe("general");
    fireEvent.change(screen.getByRole("combobox", { name: "確認の種類" }), { target: { value: "typos" } });
    expect(screen.queryByText("強調が必要か確認してください。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AIコメントを生成" }));
    await screen.findByText("強調が必要か確認してください。"); expect(send.mock.calls[1][0].focus).toBe("typos");
  });
  it.each(["document", "selection", "cancel", "context"] as const)("discards abort-ignoring late replies after %s changes", async (kind) => {
    const pending = createDeferred<FeedbackResponse>(); const send = vi.spyOn(client, "requestFeedback").mockReturnValue(pending.promise);
    const { editor, props, view, getPlainText } = setup();
    fireEvent.click(screen.getByRole("button", { name: "章全体を対象にする" }));
    fireEvent.click(screen.getByRole("button", { name: "AIコメントを生成" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce()); const request = send.mock.calls[0][0];
    act(() => {
      if (kind === "document") editor.view.dispatch(editor.state.tr.insertText("追加", 1));
      if (kind === "selection") setTextSelection(editor, 2);
      if (kind === "cancel") fireEvent.click(screen.getByRole("button", { name: "Feedbackを中止" }));
      if (kind === "context") view.rerender(<AiFeedbackPanel {...props} contextRevision={1} />);
    });
    await act(async () => pending.resolve(response(request.requestId)));
    expect(screen.queryByText("強調が必要か確認してください。")).toBeNull();
    expect(getPlainText()).toBe(kind === "document" ? "追加一番最初に会った。" : "一番最初に会った。");
  });
});
