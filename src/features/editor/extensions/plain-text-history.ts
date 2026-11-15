import { Extension } from "@tiptap/core";
import { splitBlock } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { keydownHandler } from "@tiptap/pm/keymap";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const plainTextKeyboardKey = new PluginKey("plainTextKeyboard");

export function isCompositionKeyEvent(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  return view.composing || event.isComposing || event.keyCode === 229;
}

export const PlainTextHistory = Extension.create({
  name: "plainTextHistory",
  priority: 1_000,

  addProseMirrorPlugins() {
    const handleShortcut = keydownHandler({
      Enter: splitBlock,
      "Shift-Enter": splitBlock,
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
    });

    return [
      history(),
      new Plugin({
        key: plainTextKeyboardKey,
        props: {
          handleDOMEvents: {
            keydown(view, event) {
              // Returning true from handleDOMEvents stops ProseMirror's keymaps.
              // Intentionally do not preventDefault: the active IME owns the key.
              return isCompositionKeyEvent(view, event);
            },
          },
          handleKeyDown(view, event) {
            if (isCompositionKeyEvent(view, event)) {
              return false;
            }

            return handleShortcut(view, event);
          },
        },
      }),
    ];
  },
});
