import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";

export type EditGuardState = Readonly<{
  contentRevision: number;
  editorInstanceId: string;
  selectionRevision: number;
}>;

export const editGuardPluginKey = new PluginKey<EditGuardState>(
  "editGuard",
);

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("revisionは0以上の安全な整数である必要があります。");
  }
}

function nextRevision(revision: number): number {
  if (revision === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("revisionをこれ以上更新できません。");
  }

  return revision + 1;
}

export function getEditGuardState(
  editorState: EditorState,
): EditGuardState | null {
  return editGuardPluginKey.getState(editorState) ?? null;
}

export function createEditGuardExtension(
  initialContentRevision = 0,
): Extension {
  assertRevision(initialContentRevision);

  return Extension.create({
    name: "editGuard",

    addProseMirrorPlugins() {
      return [
        new Plugin<EditGuardState>({
          key: editGuardPluginKey,
          state: {
            init() {
              return Object.freeze({
                contentRevision: initialContentRevision,
                editorInstanceId: crypto.randomUUID(),
                selectionRevision: 0,
              });
            },
            apply(transaction, current, oldState, newState) {
              const documentChanged = transaction.docChanged;
              const selectionChanged = !oldState.selection.eq(
                newState.selection,
              );

              if (!documentChanged && !selectionChanged) {
                return current;
              }

              return Object.freeze({
                contentRevision: documentChanged
                  ? nextRevision(current.contentRevision)
                  : current.contentRevision,
                editorInstanceId: current.editorInstanceId,
                selectionRevision: selectionChanged
                  ? nextRevision(current.selectionRevision)
                  : current.selectionRevision,
              });
            },
          },
        }),
      ];
    },
  });
}
