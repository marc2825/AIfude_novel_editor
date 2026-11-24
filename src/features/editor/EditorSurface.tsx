"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { undo, redo } from "@tiptap/pm/history";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import styles from "./Editor.module.css";

type Menu = Readonly<{ x: number; y: number; state: EditorState }>;

export function EditorSurface({ editor, onAiCommand, onDictionaryCommand, toolbarStart, toolbarEnd }: Readonly<{
  editor: Editor | null; onAiCommand?: (editor: Editor) => boolean;
  /** Looks up the selected words. Offered in the context menu next to the AI suggestion. */
  onDictionaryCommand?: (editor: Editor) => boolean;
  /** Shown at the start and the end of the slim toolbar above the manuscript. */
  toolbarStart?: ReactNode; toolbarEnd?: ReactNode;
}>) {
  const [menu, setMenu] = useState<Menu | null>(null);
  // ProseMirror can end its composition bookkeeping in its native contextmenu handler.
  // Keep the actual composition event boundary before React receives the bubbling menu event.
  const composingRef = useRef(false);
  const touchRef = useRef(false);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [composing, setComposing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  function menuItems(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  }
  function runFromMenu(command: ((editor: Editor) => boolean) | undefined) {
    if (menu && editor && !editor.isDestroyed && editor.isEditable && !editor.view.composing && !composingRef.current && editor.state.doc === menu.state.doc && editor.state.selection.eq(menu.state.selection)) {
      setMenu(null); command?.(editor);
    } else close(true);
  }
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
    // Without selected text the browser's own menu (paste and so on) stays available.
    if (selection.empty || blank) return false;
    setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 248)), y: Math.max(8, Math.min(y, window.innerHeight - 152)), state: editor.state });
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
      <h2 id="editor-title" className={styles.visuallyHidden}>本文</h2>
      <div className={styles.toolbarStart}>{toolbarStart}</div>
      <div className={styles.touchActions} role="group" aria-label="本文の操作">
        {toolbarEnd}
        <button type="button" aria-label="元に戻す" title="元に戻す" disabled={!editor?.isEditable || composing || !history.undo}
          onPointerDown={preserveSelection} onClick={() => changeHistory(undo)}><HistoryIcon direction="undo" /></button>
        <button type="button" aria-label="やり直す" title="やり直す" disabled={!editor?.isEditable || composing || !history.redo}
          onPointerDown={preserveSelection} onClick={() => changeHistory(redo)}><HistoryIcon direction="redo" /></button>
        <button type="button" className={styles.aiTrigger} disabled={!editor?.isEditable || !onAiCommand || composing}
          title="文章を選ぶか、書きたい位置にカーソルを置いて押します"
          onPointerDown={preserveSelection} onClick={() => {
            if (editor && canAct()) { setMenu(null); onAiCommand?.(editor); }
          }}>AI提案<kbd aria-hidden="true">⌘ / Ctrl K</kbd></button>
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
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = menuItems();
          const index = items.findIndex((item) => item === document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      <button type="button" role="menuitem" ref={itemRef} onPointerDown={(event) => event.preventDefault()}
        onClick={() => runFromMenu(onAiCommand)}><span>AI提案</span><kbd>⌘ / Ctrl K</kbd></button>
      {onDictionaryCommand ? <button type="button" role="menuitem" onPointerDown={(event) => event.preventDefault()}
        onClick={() => runFromMenu(onDictionaryCommand)}><span>辞書で調べる</span></button> : null}
      <p>選んだ文章の言い換えを比べるか、語句の意味を調べます。</p>
    </div> : null}
  </section>;
}

function HistoryIcon({ direction }: Readonly<{ direction: "undo" | "redo" }>) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    style={direction === "redo" ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>;
}
