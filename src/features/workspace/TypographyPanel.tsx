"use client";
import type { Editor } from "@tiptap/core";
import { HelpTip } from "../ui/HelpTip";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { annotationProblems, japaneseInputSuggestion, manuscriptDocumentSchema, paragraphRuns, publicationText, type ManuscriptDocument, type PublicationFormat } from "../../domain/typography";
import { orderedChapters } from "../../domain/chapters";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import { captureSelection, validateSelectionSnapshot, type SelectionCaptureContext, type SelectionSnapshot } from "../editor/selection";
import { applyAnnotation } from "../editor/annotations";
import { replaceCapturedSelection } from "../editor/replace-selection";
import { DiffPreview } from "../ai-edit/DiffPreview";
import { downloadWorkspaceFile } from "./backup";
import styles from "./Typography.module.css";

function exportSource(workspace: WorkspaceSnapshot, all: boolean): string {
  return JSON.stringify((all ? orderedChapters(workspace) : [workspace.chapter]).map(({ id, title, body }) => ({ id, title, body })));
}
function ManuscriptPreview({ body }: { body: ManuscriptDocument }) {
  return body.content.map((paragraph, index) => <p key={index}>{paragraphRuns(paragraph).map((node, part) => {
    const mark = node.marks?.[0];
    return mark?.type === "ruby" ? <ruby key={part}>{node.text}<rp>（</rp><rt>{mark.attrs.reading}</rt><rp>）</rp></ruby>
      : mark?.type === "emphasis" ? <span className={styles.emphasis} key={part}>{node.text}</span> : <span key={part}>{node.text}</span>;
  })}{!("content" in paragraph) ? <br /> : null}</p>);
}
export function TypographyPanel({ editor, context, active, getCurrentSnapshot }: Readonly<{ editor: Editor | null; context: SelectionCaptureContext; active: boolean; getCurrentSnapshot: () => WorkspaceSnapshot | null }>) {
  const subscribe = useCallback((notify: () => void) => { if (!editor) return () => undefined; editor.on("transaction", notify); return () => { editor.off("transaction", notify); }; }, [editor]);
  const getState = useCallback(() => editor && !editor.isDestroyed ? editor.state : null, [editor]);
  const state = useSyncExternalStore(subscribe, getState, () => null);
  const body = active && state ? manuscriptDocumentSchema.parse(state.doc.toJSON()) : null;
  const [vertical, setVertical] = useState(false); const [message, setMessage] = useState("");
  const [target, setTarget] = useState<SelectionSnapshot | null>(null); const [reading, setReading] = useState("");
  const [kind, setKind] = useState<"ruby" | "emphasis" | "remove">("ruby");
  const [formatting, setFormatting] = useState<{ snapshot: SelectionSnapshot; text: string } | null>(null);
  const [format, setFormat] = useState<PublicationFormat>("kakuyomu"); const [allChapters, setAllChapters] = useState(false);
  const [exportPreview, setExportPreview] = useState<{ text: string; source: string; format: PublicationFormat; all: boolean } | null>(null);
  const composing = useRef(false);
  const locked = !editor || !context.editable;
  function capture() {
    if (composing.current) return null;
    const result = captureSelection(editor, context);
    if (result.status !== "captured") { setMessage("本文で対象を選択し、変換を確定してから操作してください。"); return null; }
    return result.snapshot;
  }
  function prepareAnnotation() {
    const snapshot = capture(); if (!snapshot) return;
    setTarget(snapshot); setFormatting(null); setMessage("");
    const mark = editor?.state.doc.nodeAt(snapshot.from)?.marks.find((mark) => mark.type.name === "ruby");
    setReading(typeof mark?.attrs.reading === "string" ? mark.attrs.reading : "");
  }
  function prepareFormatting(mode: "symbols" | "indent") {
    const snapshot = capture(); if (!snapshot) return;
    setFormatting({ snapshot, text: japaneseInputSuggestion(snapshot.originalText, mode) }); setTarget(null); setMessage("");
  }
  function prepareExport() {
    if (composing.current || editor?.view.composing) { setMessage("変換を確定してから書き出してください。"); return; }
    const workspace = getCurrentSnapshot(); if (!workspace) return;
    try {
      const chapters = allChapters ? orderedChapters(workspace) : [workspace.chapter];
      const text = chapters.map((chapter) => `${allChapters ? `${publicationText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `【${chapter.title}】` }] }] }, format)}\n` : ""}${publicationText(chapter.body, format)}`).join("\n\n");
      setExportPreview({ text, source: exportSource(workspace, allChapters), format, all: allChapters }); setMessage("");
    } catch (error: unknown) { setExportPreview(null); setMessage(error instanceof Error ? error.message : "変換できませんでした。"); }
  }
  function download() {
    const workspace = getCurrentSnapshot();
    if (!workspace || !exportPreview || composing.current || editor?.view.composing || exportPreview.format !== format || exportPreview.all !== allChapters || exportPreview.source !== exportSource(workspace, allChapters)) { setMessage("原稿または出力条件が変わりました。出力を再確認してください。"); return; }
    downloadWorkspaceFile({ contents: exportPreview.text, filename: `${format}-${allChapters ? "all-chapters" : "chapter"}.txt`, mimeType: "text/plain;charset=utf-8" });
    setMessage("確認した出力を書き出しました。投稿先へは送信していません。");
  }
  const current = target && validateSelectionSnapshot(editor, target, context).status === "valid";
  const problems = body ? annotationProblems(body) : [];
  return <section className={styles.panel} aria-label="組版と投稿用出力" onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}>
    <p>本文で範囲を選び、ここで確認して採用します。<HelpTip label="組版">横書きの本文が編集の正本です。</HelpTip></p>
    <details><summary>ルビ・傍点</summary>
      <button type="button" disabled={locked} onClick={prepareAnnotation}>選択範囲の注釈を準備</button>
      {target ? <><p>対象：{target.originalText}</p><label>注釈の操作<select value={kind} onChange={(event) => {
        const value = event.target.value; if (value === "ruby" || value === "emphasis" || value === "remove") setKind(value);
      }}><option value="ruby">ルビを付ける・読みを更新</option><option value="emphasis">傍点を付ける</option><option value="remove">注釈を解除する</option></select></label>
        {kind === "ruby" ? <label>ルビの読み<input maxLength={160} value={reading} onChange={(event) => setReading(event.target.value)} /></label> : null}
        <p>ルビと傍点は重ねません。現在の注釈は選んだ操作に置き換わります。</p>
        {!current ? <p role="alert">本文・選択・設定が変わりました。対象を取り直してください。</p> : null}
        <button type="button" disabled={locked || !current} onClick={() => {
          if (composing.current) return; const result = applyAnnotation(editor, target, context, kind, reading); setMessage(result.message); if (result.ok) setTarget(null);
        }}>注釈を採用</button></> : null}
      <p>横書き本文ではルビ範囲に下線を表示し、読みはプレビューで確認できます。AI・検索置換の前は対象の注釈を明示解除してください。</p>
    </details>
    <details><summary>日本語入力の補助</summary><p>選択範囲だけの整形案です。自動変換は行いません。</p>
      <button type="button" disabled={locked} onClick={() => prepareFormatting("symbols")}>全角記号の候補を確認</button>
      <button type="button" disabled={locked} onClick={() => prepareFormatting("indent")}>段落字下げの候補を確認</button>
      {formatting ? <><DiffPreview candidateId="formatting" candidatePosition={1} candidateText={formatting.text} originalText={formatting.snapshot.originalText} requestId="formatting" />
        <button type="button" disabled={locked} onClick={() => {
          if (composing.current) return; const result = replaceCapturedSelection(editor, formatting.snapshot, formatting.text, context);
          setMessage(result.status === "applied" ? "整形案を採用しました。1回のUndoで戻せます。" : "採用できません。範囲の変更・注釈・文字数・変換中でないか確認してください。"); if (result.status === "applied") setFormatting(null);
        }}>整形案を採用</button></> : null}
    </details>
    <details><summary>縦書きプレビュー</summary><label><input type="checkbox" checked={vertical} onChange={(event) => setVertical(event.target.checked)} />縦書きで読む</label>
      <p>閲覧専用です。ここでの選択をAI編集の対象には使いません。</p>
      {body ? <div tabIndex={0} role="region" aria-label="原稿プレビュー（閲覧専用）" className={vertical ? styles.vertical : styles.horizontal}><ManuscriptPreview body={body} /></div> : null}
    </details>
    {problems.length ? <div role="alert">{problems.slice(0, 10).map((problem, index) => <p key={index}>{problem}</p>)}</div> : null}
    <details><summary>投稿用テキストを書き出す</summary>
      <label>投稿先の記法<select value={format} onChange={(event) => { if (event.target.value === "kakuyomu" || event.target.value === "narou" || event.target.value === "pixiv") setFormat(event.target.value); setExportPreview(null); }}><option value="kakuyomu">カクヨム</option><option value="narou">小説家になろう（ルビのみ）</option><option value="pixiv">pixiv（ルビのみ）</option></select></label>
        <HelpTip label="投稿先の記法">カクヨムは親文字20字・読み50字まで。なろうは各10字までで、傍点は出力しません。pixivは「[[rb:親文字 &gt; 読み]]」で、読みはかな・漢字・英字だけ。傍点と半角の [ ] は出力しません。投稿記法に似た記号を含む本文は変換を拒否します。完全な復元にはJSONバックアップを使ってください。</HelpTip>
      <label><input type="checkbox" checked={allChapters} onChange={(event) => { setAllChapters(event.target.checked); setExportPreview(null); }} />全章を章見出し付きで出力</label>
      <button type="button" disabled={!editor} onClick={prepareExport}>投稿用出力を確認</button>
      {exportPreview ? <><pre className={styles.exportText}>{exportPreview.text}</pre><button type="button" onClick={download}>確認した投稿用txtを保存</button></> : null}
    </details>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
