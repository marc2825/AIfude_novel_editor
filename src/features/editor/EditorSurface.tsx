"use client";

import type { Editor } from "@tiptap/core";
import type { CompletionOperation } from "../../domain/completion";
import { EditorContent } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { undo, redo } from "@tiptap/pm/history";
import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./Editor.module.css";

type Menu = Readonly<{ x: number; y: number; state: EditorState }>;

export function EditorSurface({ editor, onAiCommand, dictionaryMode = false, completionMode }: Readonly<{
  editor: Editor | null; onAiCommand?: (editor: Editor) => boolean; dictionaryMode?: boolean; completionMode?: CompletionOperation;
}>) {
  const actionLabel = completionMode === "context-insert" ? "文脈で挿入" : completionMode === "infill" ? "中間補完" : completionMode === "continue" ? "続きを書く" : dictionaryMode ? "辞書で調べる" : "AI提案";
  const hint = completionMode === "context-insert" ? "挿入位置にカーソル・右クリック → " : completionMode === "infill" ? "空白を選択／空段落にカーソル → " : completionMode === "continue" ? "章の末尾にカーソル → " : "選択して右クリック → ";
  const [menu, setMenu] = useState<Menu | null>(null);
  // ProseMirror can end its composition bookkeeping in its native contextmenu handler.
  // Keep the actual composition event boundary before React receives the bubbling menu event.
  const composingRef = useRef(false);
  const touchRef = useRef(false);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [composing, setComposing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = { undo: undo(editor.state), redo: redo(editor.state) };
      setHistory((previous) => previous.undo === next.undo && previous.redo === next.redo ? previous : next);
    };
    update(); editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);
  function canAct() {
    return editor !== null && !editor.isDestroyed && editor.isEditable && !editor.view.composing && !composingRef.current;
  }
  function preserveSelection(event: ReactPointerEvent<HTMLButtonElement>) {
    // Only this explicit control prevents focus transfer. Native manuscript touch
    // selection/composition events are never cancelled or replayed.
    if (canAct()) event.preventDefault();
  }
  function changeHistory(command: typeof undo) {
    if (editor && canAct()) { command(editor.state, editor.view.dispatch); editor.view.focus(); }
  }
  function close(restoreFocus: boolean) {
    setMenu(null);
    if (restoreFocus && editor && !editor.isDestroyed) editor.view.focus();
  }
  function open(x: number, y: number): boolean {
    if (!editor || editor.isDestroyed || !editor.isEditable || editor.view.composing || composingRef.current || !(editor.state.selection instanceof TextSelection) || !onAiCommand) return false;
    const selection = editor.state.selection;
    const blank = editor.state.doc.textBetween(selection.from, selection.to, "\n").trim().length === 0;
    if (completionMode === "infill" ? !blank : completionMode === "continue" || completionMode === "context-insert" ? !selection.empty : selection.empty || blank) return false;
    setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 248)), y: Math.max(8, Math.min(y, window.innerHeight - 104)), state: editor.state });
    return true;
  }
  useLayoutEffect(() => { if (menu) itemRef.current?.focus({ preventScroll: true }); }, [menu]);
  useEffect(() => {
    if (!menu || !editor) return;
    function changed() {
      if (editor && (editor.state.doc !== menu?.state.doc || !editor.state.selection.eq(menu.state.selection))) setMenu(null);
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null);
    }
    function dismiss() { setMenu(null); }
    editor.on("transaction", changed);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      editor.off("transaction", changed);
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [editor, menu]);

  return <section className={styles.editorSection} aria-labelledby="editor-title">
    <div className={styles.editorHeader}>
      <h2 id="editor-title">本文</h2>
      <p>{hint}{actionLabel} <kbd>⌘ / Ctrl K</kbd></p>
      <div className={styles.touchActions} role="group" aria-label="本文の操作">
        <button type="button" aria-label="元に戻す" title="元に戻す" disabled={!editor?.isEditable || composing || !history.undo}
          onPointerDown={preserveSelection} onClick={() => changeHistory(undo)}>↶</button>
        <button type="button" aria-label="やり直す" title="やり直す" disabled={!editor?.isEditable || composing || !history.redo}
          onPointerDown={preserveSelection} onClick={() => changeHistory(redo)}>↷</button>
        <button type="button" className={styles.aiTrigger} disabled={!editor?.isEditable || !onAiCommand || composing}
          onPointerDown={preserveSelection} onClick={() => {
            if (editor && canAct()) { setMenu(null); onAiCommand?.(editor); }
          }}>{actionLabel}</button>
      </div>
    </div>
    <div onPointerDownCapture={(event) => { touchRef.current = event.pointerType === "touch"; }}
      onCompositionStartCapture={() => { composingRef.current = true; setComposing(true); }}
      onCompositionEndCapture={() => { composingRef.current = false; setComposing(false); }} onContextMenu={(event) => {
      if (touchRef.current) return;
      if (open(event.clientX, event.clientY)) event.preventDefault();
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || editor?.view.composing || composingRef.current) return;
      if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
        if (!editor || editor.isDestroyed) return;
        const anchor = editor.view.coordsAtPos(editor.state.selection.head);
        if (open(anchor.left, anchor.bottom)) { event.preventDefault(); event.stopPropagation(); }
      }
    }}>
      <EditorContent className={styles.editor} editor={editor} />
    </div>
    {menu ? <div className={styles.contextMenu} ref={menuRef} role="menu" aria-label="選択した文章の操作"
      style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === "Tab") close(true);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); itemRef.current?.focus(); }
      }}>
      <button type="button" role="menuitem" ref={itemRef} onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (editor && !editor.isDestroyed && editor.isEditable && !editor.view.composing && !composingRef.current && editor.state.doc === menu.state.doc && editor.state.selection.eq(menu.state.selection)) {
            setMenu(null); onAiCommand?.(editor);
          } else close(true);
        }}><span>✦ {actionLabel}</span><kbd>⌘ / Ctrl K</kbd></button>
      <p>{completionMode ? "指定位置に入れる候補を比較" : dictionaryMode ? "選択した語句の意味を確認" : "選択した文章の言い換えを比較"}</p>
    </div> : null}
  </section>;
}
