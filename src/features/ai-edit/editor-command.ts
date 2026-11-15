import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { isCompositionKeyEvent } from "../editor/extensions/plain-text-history";

const aiCommandKey = new PluginKey("aiCommandKeyboard");

export type AiCommandHandler = (editor: Editor) => boolean;

export function isAiCommandShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function createAiCommandExtension(
  onCommand: AiCommandHandler,
): Extension {
  return Extension.create({
    name: "aiCommandKeyboard",
    priority: 1_100,

    addProseMirrorPlugins() {
      const editor = this.editor;

      return [
        new Plugin({
          key: aiCommandKey,
          props: {
            handleKeyDown(view, event) {
              if (
                isCompositionKeyEvent(view, event) ||
                !isAiCommandShortcut(event)
              ) {
                return false;
              }

              return onCommand(editor);
            },
          },
        }),
      ];
    },
  });
}
