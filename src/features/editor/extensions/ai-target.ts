import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type AiTarget = Readonly<{ from: number; to: number }>;

const key = new PluginKey<DecorationSet>("aiTargetHighlight");

/**
 * Marks the range an open AI session refers to. The marker is a view decoration:
 * it is never stored in the document, and it does not move the selection.
 */
export const AiTargetHighlight = Extension.create({
  name: "aiTargetHighlight",
  addProseMirrorPlugins: () => [new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, current) {
        const value: unknown = transaction.getMeta(key);
        if (value instanceof DecorationSet) return value;
        // A changed document makes the session stale; the marker must not drift onto other text.
        return transaction.docChanged ? DecorationSet.empty : current;
      },
    },
    props: { decorations: (state) => key.getState(state) },
  })],
});

function caretMarker(): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "ai-target-caret";
  marker.setAttribute("aria-hidden", "true");
  return marker;
}

export function hasAiTarget(editor: Editor): boolean {
  return (key.getState(editor.state)?.find().length ?? 0) > 0;
}

/** Shows the marker for `target`, or removes it when `target` is null. Never changes the document or the selection. */
export function showAiTarget(editor: Editor, target: AiTarget | null): void {
  if (editor.isDestroyed || key.getState(editor.state) === undefined) return;
  const size = editor.state.doc.content.size;
  const valid = target !== null && Number.isInteger(target.from) && Number.isInteger(target.to)
    && target.from >= 0 && target.from <= target.to && target.to <= size;
  if (!valid && !hasAiTarget(editor)) return;
  const decorations = !valid || target === null ? DecorationSet.empty : DecorationSet.create(editor.state.doc, [
    target.from === target.to
      ? Decoration.widget(target.from, caretMarker, { key: "ai-target-caret", side: 1, ignoreSelection: true })
      : Decoration.inline(target.from, target.to, { class: "ai-target" }),
  ]);
  editor.view.dispatch(editor.state.tr.setMeta(key, decorations).setMeta("addToHistory", false));
}
