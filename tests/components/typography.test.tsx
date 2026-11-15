import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TypographyPanel } from "../../src/features/workspace/TypographyPanel";
import { CreativeControls } from "../../src/features/ai-edit/CreativeControls";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { persistedDocumentSchema } from "../../src/domain/workspace";

const context = { chapterId: "c", documentId: "d", projectId: "p", commonPrompt: "", manualStyle: "", contextRevision: 0, editable: true };
describe("typography and creative UI", () => {
  it("does not change the manuscript until annotation adoption and stales a changed target", () => {
    const h = createTestEditor("前葵後"); setTextSelection(h.editor, 2, 3);
    const workspace = createWorkspaceFixture();
    try {
      render(<TypographyPanel editor={h.editor} context={context} active getCurrentSnapshot={() => ({ ...workspace, chapter: { ...workspace.chapter, body: persistedDocumentSchema.parse(h.editor.state.doc.toJSON()) } })} />);
      fireEvent.click(screen.getByText("ルビ・傍点", { exact: true })); fireEvent.click(screen.getByRole("button", { name: "選択範囲の注釈を準備" }));
      fireEvent.change(screen.getByRole("textbox", { name: "ルビの読み" }), { target: { value: "あおい" } });
      expect(h.editor.view.dom.querySelector("[data-novel-ruby]")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "注釈を採用" }));
      expect(h.getPlainText()).toBe("前葵後"); expect(h.editor.view.dom.querySelector("[data-novel-ruby]")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "選択範囲の注釈を準備" }));
      act(() => setTextSelection(h.editor, 1, 2)); expect(screen.getByRole("button", { name: "注釈を採用" })).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent("対象を取り直し");
    } finally { h.destroy(); }
  });
  it("requires an explicit brief and opt-in for additional facts without generating", () => {
    const onApply = vi.fn(); render(<CreativeControls tool="describe" disabled={false} onApply={onApply} />);
    expect(screen.getByRole("checkbox", { name: /追加事実/u })).not.toBeChecked(); expect(screen.getByRole("button", { name: "条件を編集指示へ反映" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "描きたい対象・場面" }), { target: { value: "静かな雨音" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "聴覚" })); expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "条件を編集指示へ反映" })); expect(onApply).toHaveBeenLastCalledWith(expect.stringContaining("追加しない"));
    fireEvent.click(screen.getByRole("checkbox", { name: /追加事実/u })); fireEvent.click(screen.getByRole("button", { name: "条件を編集指示へ反映" })); expect(onApply).toHaveBeenLastCalledWith(expect.stringContaining("創作を許可"));
  });
});
