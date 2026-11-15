import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryMemoryPanel } from "../../src/features/workspace/StoryMemoryPanel";
import { StoryMemoryControls } from "../../src/features/ai-edit/StoryMemoryControls";
import { EMPTY_STORY_MEMORY } from "../../src/domain/story-memory";
import { openAiEditCommand } from "../../src/features/ai-edit/machine";
import { captureSelection } from "../../src/features/editor/selection";
import { createTestEditor, setTextSelection } from "../helpers/editor";

describe("story memory UI", () => {
  it("reports edits, reversions and successful saves while keeping failed saves dirty", async () => {
    const onDirtyChange = vi.fn(); const onSave = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    render(<StoryMemoryPanel memory={EMPTY_STORY_MEMORY} disabled={false} onSave={onSave} onDirtyChange={onDirtyChange} />);
    fireEvent.click(screen.getByText("作品メモリ（設定・背景・登場人物）"));
    const field = screen.getByRole("textbox", { name: /設定メモ/u });
    fireEvent.change(field, { target: { value: "未保存" } }); expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(field, { target: { value: "" } }); expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(field, { target: { value: "保存する" } }); fireEvent.click(screen.getByRole("button", { name: "メモリを保存" }));
    await screen.findByRole("alert"); expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "メモリを保存" })); await screen.findByText("作品メモリを保存しました。");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false); expect(screen.queryByText("保存していない作品メモリがあります。")).not.toBeInTheDocument();
  });
  it("retains notes on save failure and rejects oversized notes before saving", async () => {
    const onSave = vi.fn(async () => ({ ok: false }));
    render(<StoryMemoryPanel memory={EMPTY_STORY_MEMORY} disabled={false} onSave={onSave} />);
    fireEvent.click(screen.getByText("作品メモリ（設定・背景・登場人物）"));
    const field = screen.getByRole("textbox", { name: /設定メモ/u });
    fireEvent.change(field, { target: { value: "残す設定" } }); fireEvent.click(screen.getByRole("button", { name: "メモリを保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("入力内容はこの画面に保持"); expect(field).toHaveValue("残す設定");
    fireEvent.change(field, { target: { value: "字".repeat(2001) } }); fireEvent.click(screen.getByRole("button", { name: "メモリを保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2,000文字以内"); expect(onSave).toHaveBeenCalledOnce();
  });
  it("keeps a locked workspace's memory fields and save disabled", () => {
    render(<StoryMemoryPanel memory={EMPTY_STORY_MEMORY} disabled onSave={async () => ({ ok: true })} />);
    fireEvent.click(screen.getByText("作品メモリ（設定・背景・登場人物）"));
    for (const field of screen.getAllByRole("textbox")) expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "メモリを保存" })).toBeDisabled();
  });
  it("starts OFF, exposes selected notes as text, and explains a budget overflow", () => {
    const session = createTestEditor("対象"); setTextSelection(session.editor, 1, 3);
    const memory = { settingNotes: "🙂".repeat(2000), backgroundNotes: "🙂".repeat(2000), characterNotes: "🙂".repeat(2000) };
    const context = { chapterId: "chapter", documentId: "document", projectId: "project", contextRevision: 0, commonPrompt: "", manualStyle: "", editable: true, storyMemory: memory };
    const capture = captureSelection(session.editor, context); if (capture.status !== "captured") throw new Error("Expected snapshot");
    const state = openAiEditCommand(capture.snapshot, crypto.randomUUID()); const onChange = vi.fn();
    try {
      const view = render(<StoryMemoryControls state={state} disabled={false} onChange={onChange} />);
      const checkbox = screen.getByRole("checkbox", { name: "保存済み作品メモリを参照する" }); expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox); expect(onChange).toHaveBeenCalledWith({ ...state.input, useStoryMemory: true });
      view.rerender(<StoryMemoryControls state={{ ...state, input: { ...state.input, useStoryMemory: true } }} disabled={false} onChange={onChange} />);
      expect(screen.getByRole("alert")).toHaveTextContent("入力予算を超えています");
      fireEvent.click(screen.getByText("送信するメモを確認")); expect(screen.getAllByText(memory.settingNotes)).toHaveLength(3);
    } finally { session.destroy(); }
  });
});
