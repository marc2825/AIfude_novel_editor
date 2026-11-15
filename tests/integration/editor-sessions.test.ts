import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { undo, redo, undoDepth } from "@tiptap/pm/history";
import { EditorSessions } from "../../src/features/editor/editor-sessions";
import { EditorUiStateStore } from "../../src/persistence/editor-ui-state";
import { setTextSelection } from "../helpers/editor";

const owners: EditorSessions[] = [];
function setup(onError?: () => void) { const sessions = new EditorSessions(new EditorUiStateStore(onError)); owners.push(sessions); return sessions; }
beforeEach(() => localStorage.clear());
afterEach(async () => { for (const owner of owners.splice(0)) owner.disposeLater(); await Promise.resolve(); });
describe("retained editor sessions and local UI metadata", () => {
  it("keeps independent Undo and selection while disabling callbacks from inactive editors", () => {
    const owner = setup(); const changed = vi.fn(); const first = owner.activate("a:0", "a", "元", 0, { onDocumentChange: changed });
    first.view.dispatch(first.state.tr.insertText("追記", 1)); setTextSelection(first, 2); owner.deactivate("a:0");
    first.view.dispatch(first.state.tr.setMeta("test", true)); expect(changed).toHaveBeenCalledTimes(1);
    const second = owner.activate("b:0", "b", "別", 0, {}); second.view.dispatch(second.state.tr.insertText("二", 1));
    const restored = owner.activate("a:0", "a", "この値で上書きしない", 1, { onDocumentChange: changed }); restored.setEditable(true);
    expect(restored).toBe(first); expect(restored.state.selection.anchor).toBe(2); expect(undoDepth(restored.state)).toBe(1);
    undo(restored.state, restored.view.dispatch); expect(restored.state.doc.textContent).toBe("元");
    redo(restored.state, restored.view.dispatch); expect(restored.state.doc.textContent).toBe("追記元"); expect(second.state.doc.textContent).toBe("二別");
  });
  it("restores a persisted caret only for the same saved content revision and bounds", async () => {
    const owner = setup(); const first = owner.activate("a", "position", "ABC😀", 4, {}); setTextSelection(first, 3);
    owner.uiState.setClosedProjects(["10000000-0000-4000-8000-000000000001"]);
    owner.disposeLater(); await Promise.resolve();
    const next = setup(); const restored = next.activate("a", "position", "ABC😀", 4, {}); expect(restored.state.selection.anchor).toBe(3);
    expect(next.uiState.closedProjects()).toHaveLength(1);
    expect(next.activate("b", "position", "ABC😀", 5, {}).state.selection.anchor).toBe(1);
    next.uiState.setPosition("outside", { anchor: 999, head: 999, revision: 4 });
    expect(next.activate("c", "outside", "ABC😀", 4, {}).state.selection.anchor).toBe(1);
    expect(undoDepth(restored.state)).toBe(0);
  });
  it("fails safely on invalid metadata or unavailable localStorage without losing editor text", () => {
    const onError = vi.fn(); localStorage.setItem("novel-editor-ui-v1", "not json");
    const owner = setup(onError); const editor = owner.activate("a", "a", "残す本文", 0, {}); expect(onError).toHaveBeenCalledOnce();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    editor.view.dispatch(editor.state.tr.insertText("追記", 1)); expect(editor.state.doc.textContent).toBe("追記残す本文"); expect(onError).toHaveBeenCalledTimes(2);
  });
  it("survives Strict Mode's temporary disposal but destroys editors on real disposal", async () => {
    const owner = setup(); const editor = owner.activate("a", "a", "本文", 0, {});
    owner.disposeLater(); owner.retain(); await Promise.resolve(); expect(editor.isDestroyed).toBe(false);
    owner.disposeLater(); await Promise.resolve(); expect(editor.isDestroyed).toBe(true);
  });
});
