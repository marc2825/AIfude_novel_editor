"use client";

import type { PersistedDocument } from "../../domain/workspace";

import type { Editor } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { EditorSessions } from "./editor-sessions";
import { createEditorOptions } from "./create-editor";
import { EditorSurface } from "./EditorSurface";

type NovelEditorProps = Readonly<{
  onDictionaryCommand?: (editor: Editor) => boolean;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  sessions?: EditorSessions;
  sessionKey?: string;
  positionKey?: string;
  editable?: boolean;
  initialContentRevision?: number;
  initialText: string | PersistedDocument;
  onAiCommand?: (editor: Editor) => boolean;
  onDocumentChange?: (editor: Editor) => void;
  onEditorDestroy?: (editor: Editor) => void;
  onEditorReady?: (editor: Editor) => void;
  onEditorTransaction?: (editor: Editor) => void;
}>;

function TransientNovelEditor({
  onDictionaryCommand,
  toolbarStart,
  toolbarEnd,
  editable = true,
  initialContentRevision = 0,
  initialText,
  onAiCommand,
  onDocumentChange,
  onEditorDestroy,
  onEditorReady,
  onEditorTransaction,
}: NovelEditorProps) {
  const callbacks = useRef({
    onAiCommand,
    onDocumentChange,
    onEditorDestroy,
    onEditorReady,
    onEditorTransaction,
  });
  const readyEditorRef = useRef<Editor | null>(null);

  function notifyEditorReady(currentEditor: Editor) {
    if (readyEditorRef.current !== currentEditor) {
      readyEditorRef.current = currentEditor;
      callbacks.current.onEditorReady?.(currentEditor);
    }
  }

  useEffect(() => {
    callbacks.current = {
      onAiCommand,
      onDocumentChange,
      onEditorDestroy,
      onEditorReady,
      onEditorTransaction,
    };
  }, [
    onAiCommand,
    onDocumentChange,
    onEditorDestroy,
    onEditorReady,
    onEditorTransaction,
  ]);

  const [initialOptions] = useState(() =>
    createEditorOptions(initialText, initialContentRevision, onAiCommand),
  );
  const editor = useEditor(
    {
      ...initialOptions,
      editable,
      immediatelyRender: false,
      onCreate: ({ editor: createdEditor }) => {
        notifyEditorReady(createdEditor);
      },
      onTransaction: ({ editor: currentEditor, transaction }) => {
        // Tiptap's create event is deferred. The first input can arrive earlier.
        notifyEditorReady(currentEditor);
        callbacks.current.onEditorTransaction?.(currentEditor);

        if (transaction.docChanged) {
          callbacks.current.onDocumentChange?.(currentEditor);
        }
      },
    },
    [],
  );

  useEffect(() => {
    if (editor !== null && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  useEffect(() => {
    if (editor === null) {
      return;
    }

    return () => callbacks.current.onEditorDestroy?.(editor);
  }, [editor]);

  return <EditorSurface editor={editor} onAiCommand={onAiCommand} onDictionaryCommand={onDictionaryCommand} toolbarStart={toolbarStart} toolbarEnd={toolbarEnd} />;
}

function RetainedNovelEditor(props: NovelEditorProps & { sessions: EditorSessions; sessionKey: string; positionKey: string }) {
  const { sessions, sessionKey, positionKey } = props;
  const callbacks = useRef(props);
  const [editor, setEditor] = useState<Editor | null>(null);
  useLayoutEffect(() => { callbacks.current = props; sessions.bind(sessionKey, props); });
  useLayoutEffect(() => {
    const current = sessions.activate(sessionKey, positionKey, callbacks.current.initialText, callbacks.current.initialContentRevision ?? 0, callbacks.current);
    current.setEditable(callbacks.current.editable ?? true);
    callbacks.current.onEditorReady?.(current);
    setEditor(current);
    return () => { sessions.deactivate(sessionKey); callbacks.current.onEditorDestroy?.(current); };
  }, [sessions, sessionKey, positionKey]);
  useEffect(() => { if (editor && editor.isEditable !== (props.editable ?? true)) editor.setEditable(props.editable ?? true); }, [editor, props.editable]);
  return <EditorSurface editor={editor} onAiCommand={props.onAiCommand} onDictionaryCommand={props.onDictionaryCommand} toolbarStart={props.toolbarStart} toolbarEnd={props.toolbarEnd} />;
}

export function NovelEditor(props: NovelEditorProps) {
  return props.sessions && props.sessionKey && props.positionKey
    ? <RetainedNovelEditor {...props} sessions={props.sessions} sessionKey={props.sessionKey} positionKey={props.positionKey} />
    : <TransientNovelEditor {...props} />;
}
