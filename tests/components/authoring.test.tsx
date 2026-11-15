import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthoringPanel } from "../../src/features/workspace/AuthoringPanel";
import { AuthoringReferenceControls } from "../../src/features/ai-edit/AuthoringReferenceControls";
import { openAiEditCommand } from "../../src/features/ai-edit/machine";
import { captureSelection } from "../../src/features/editor/selection";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { authoringFixture } from "../fixtures/authoring";
import { createTestEditor, setTextSelection } from "../helpers/editor";

describe("authoring UI", () => {
  it("retains failed drafts, normalizes configuration lines on one save and respects IME", async () => {
    const workspace = createWorkspaceFixture(); const onSave = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue({ ok: true }); const dirty = vi.fn();
    render(<AuthoringPanel profile={workspace.project.authoringProfile} workspace={workspace} editor={null} disabled={false} onSave={onSave} onDirtyChange={dirty} />);
    fireEvent.click(screen.getByText("作者文体の観測と保持条件"));
    const field = screen.getByRole("textbox", { name: /字面の出現回数/u });
    fireEvent.change(field, { target: { value: "葵\n葵\n\n" } });
    const button = screen.getByRole("button", { name: "人物・文体・ルールを保存" });
    fireEvent.compositionStart(field); fireEvent.click(button); expect(onSave).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field); fireEvent.click(button);
    await screen.findByText(/入力は保持しています/u); expect(field).toHaveValue("葵\n葵\n\n"); expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(button); await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ preservedTerms: ["葵"], revision: 1 })); expect(field).toHaveValue("葵");
  });
  it("shows references as explicit opt-in and refuses oversized complete data", () => {
    const editor = createTestEditor("本文"); setTextSelection(editor.editor, 1, 3);
    const profile = authoringFixture(); profile.characters[0].speechStyle = "字".repeat(500); profile.characters[0].examples = "例".repeat(500); profile.characters[0].avoidedExpressions = "避".repeat(300); profile.characters[0].addressTerms = "呼".repeat(300); if (profile.characters[0].source) profile.characters[0].source.quote = "出".repeat(300);
    const capture = captureSelection(editor.editor, { chapterId: "c", documentId: "d", projectId: "p", editable: true, contextRevision: 0, commonPrompt: "", manualStyle: "", authoringProfile: profile }); if (capture.status !== "captured") throw new Error("capture");
    const state = openAiEditCommand(capture.snapshot, crypto.randomUUID()); const onChange = vi.fn();
    try {
      const view = render(<AuthoringReferenceControls state={state} disabled={false} onChange={onChange} />);
      fireEvent.click(screen.getByText("人物・文体・作品資料の参照"));
      const checkbox = screen.getByRole("checkbox", { name: "今回だけ人物・資料を参照する" }); expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox); expect(onChange).toHaveBeenCalledWith({ ...state.input, authoringReference: {} });
      view.rerender(<AuthoringReferenceControls state={{ ...state, input: { ...state.input, instruction: "自然に", authoringReference: { characterIds: [profile.characters[0].id] } } }} disabled={false} onChange={onChange} />);
      expect(screen.getByRole("alert")).toHaveTextContent("上限");
    } finally { editor.destroy(); }
  });
});
