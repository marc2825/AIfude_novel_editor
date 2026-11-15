import type { PersistedDocument } from "../../domain/workspace";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { EditorUiStateStore } from "../../persistence/editor-ui-state";
import { createEditorOptions } from "./create-editor";
import { getEditGuardState } from "./plugins/edit-guard";

export type EditorCallbacks = Readonly<{
  onAiCommand?: (editor: Editor) => boolean;
  onDocumentChange?: (editor: Editor) => void;
  onEditorTransaction?: (editor: Editor) => void;
}>;
type Session = { editor: Editor; callbacks: EditorCallbacks | null };

/** Owns live PM documents and their history; React only mounts the active view. */
export class EditorSessions {
  private readonly sessions = new Map<string, Session>();
  private disposalGeneration = 0;
  constructor(readonly uiState: EditorUiStateStore) {}
  activate(key: string, positionKey: string, text: string | PersistedDocument, revision: number, callbacks: EditorCallbacks): Editor {
    const existing = this.sessions.get(key);
    if (existing) { existing.callbacks = callbacks; return existing.editor; }
    const session: Session = { editor: new Editor({
      ...createEditorOptions(text, revision, (editor) => session.callbacks?.onAiCommand?.(editor) ?? false),
      onTransaction: ({ editor, transaction }) => {
        const guard = getEditGuardState(editor.state);
        if (guard) this.uiState.setPosition(positionKey, { anchor: editor.state.selection.anchor, head: editor.state.selection.head, revision: guard.contentRevision });
        session.callbacks?.onEditorTransaction?.(editor);
        if (transaction.docChanged) session.callbacks?.onDocumentChange?.(editor);
      },
    }), callbacks: null };
    this.sessions.set(key, session);
    const saved = this.uiState.position(positionKey);
    if (saved && saved.revision === revision && saved.anchor >= 1 && saved.head >= 1 && saved.anchor < session.editor.state.doc.content.size && saved.head < session.editor.state.doc.content.size) {
      session.editor.view.dispatch(session.editor.state.tr.setSelection(TextSelection.create(session.editor.state.doc, saved.anchor, saved.head)));
    }
    session.callbacks = callbacks;
    return session.editor;
  }
  bind(key: string, callbacks: EditorCallbacks): void { const session = this.sessions.get(key); if (session) session.callbacks = callbacks; }
  deactivate(key: string): void { const session = this.sessions.get(key); if (session) { session.callbacks = null; session.editor.setEditable(false); } }
  retain(): void { this.disposalGeneration++; }
  disposeLater(): void {
    const generation = ++this.disposalGeneration;
    queueMicrotask(() => {
      if (generation !== this.disposalGeneration) return;
      for (const session of this.sessions.values()) session.editor.destroy();
      this.sessions.clear();
    });
  }
}
