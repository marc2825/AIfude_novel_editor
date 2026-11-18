"use client";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import styles from "../workspace/Workspace.module.css";
import { applySearchReplacement, captureSearch, isSearchCurrent, type SearchSnapshot } from "./search-replace";

export function SearchPanel({ editor, disabled }: Readonly<{ editor: Editor | null; disabled: boolean }>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(""); const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [search, setSearch] = useState<SearchSnapshot | null>(null); const [index, setIndex] = useState(0);
  const [stale, setStale] = useState(false); const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editor) return;
    function transaction() { if (editor && search && !isSearchCurrent(editor, search)) setStale(true); }
    editor.on("transaction", transaction);
    return () => { editor.off("transaction", transaction); };
  }, [editor, search]);
  useEffect(() => {
    if (!editor) return;
    function shortcut(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229 || editor?.view.composing || !(event.metaKey || event.ctrlKey) || !["f", "h"].includes(event.key.toLowerCase())) return;
      event.preventDefault(); setOpen(true); requestAnimationFrame(() => inputRef.current?.focus());
    }
    const element = editor.view.dom; element.addEventListener("keydown", shortcut);
    return () => element.removeEventListener("keydown", shortcut);
  }, [editor]);
  function find() {
    if (!editor || editor.view.composing) return;
    try { const result = captureSearch(editor, query, caseSensitive); setSearch(result); setIndex(0); setStale(false); setMessage(`${result.matches.length}件一致しました。`);
      const first = result.matches[0];
      if (first) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, first.from, first.to)).scrollIntoView()); }
    catch (error: unknown) { setSearch(null); setMessage(error instanceof Error ? error.message : "検索できません。"); }
  }
  function selectMatch(next: number) {
    if (!editor || !search || editor.view.composing || !isSearchCurrent(editor, search)) { setStale(true); return; }
    const match = search.matches[next]; if (!match) return;
    setIndex(next); editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView());
    editor.view.focus();
  }
  function replace(all: boolean) {
    if (!editor || !search) return;
    if (!window.confirm(all ? `${search.matches.length}件を「${replacement}」に置換しますか？` : `選択した1件を「${replacement}」に置換しますか？`)) return;
    try {
      const ok = applySearchReplacement(editor, search, replacement, all ? "all" : index);
      setMessage(ok ? "置換しました。Undoで戻せます。続ける場合は再検索してください。" : "本文が変更されています。再検索してください。");
      if (ok) setSearch(null); else setStale(true);
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "置換できません。"); }
  }
  const valid = search !== null && search.matches.length > 0 && !stale;
  return <section className={styles.writingTools} aria-label="本文の検索と置換">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>検索・置換</button>
    {open ? <div>
      <p>現在の章を検索します。（Cmd/Ctrl + F または H）</p>
      <label>検索語<textarea rows={1} ref={inputRef} aria-label="検索語" value={query} onChange={(event) => { setQuery(event.target.value); setSearch(null); }} /></label>
      <label><input type="checkbox" checked={caseSensitive} onChange={(event) => { setCaseSensitive(event.target.checked); setSearch(null); }} />大文字・小文字を区別</label>
      <button type="button" disabled={!editor || !query} onClick={find}>検索</button>
      <button type="button" disabled={!valid} onClick={() => selectMatch((index + (search?.matches.length ?? 1) - 1) % (search?.matches.length ?? 1))}>前の一致</button>
      <button type="button" disabled={!valid} onClick={() => selectMatch((index + 1) % (search?.matches.length ?? 1))}>次の一致</button>
      {valid ? <p>一致 {index + 1} / {search.matches.length}：{search.document.textBetween(search.matches[index].from, search.matches[index].to, "\n")}</p> : null}
      <label>置換後の文章<textarea aria-label="置換後の文章" value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
      <button type="button" disabled={disabled || !valid} onClick={() => replace(false)}>確認して1件置換</button>
      <button type="button" disabled={disabled || !valid} onClick={() => replace(true)}>確認してすべて置換</button>
      {stale ? <p role="alert">本文が変更されたため、再検索してください。</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </div> : null}
  </section>;
}
