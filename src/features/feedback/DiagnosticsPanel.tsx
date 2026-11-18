"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { diagnosticAnalysisSchema, type DiagnosticAnalysis, type DiagnosticIssue } from "../../domain/japanese-diagnostics";
import { documentToPlainText } from "../editor/plain-text";
import { captureSearch, isSearchCurrent, type SearchSnapshot } from "../editor/search-replace";
import { captureSelection, validateSelectionSnapshot, type SelectionCaptureContext, type SelectionSnapshot } from "../editor/selection";
import { replaceCapturedSelection } from "../editor/replace-selection";
import { DiffPreview } from "../ai-edit/DiffPreview";
import { selectDiagnostic, showDiagnostics } from "./diagnostic-anchors";
import styles from "./Feedback.module.css";
import { HelpHeading } from "../ui/HelpTip";

type Result = { snapshot: SearchSnapshot; analysis: DiagnosticAnalysis };
export function DiagnosticsPanel({ editor, context, onAi, children }: Readonly<{
  editor: Editor | null; context: SelectionCaptureContext; onAi: (editor: Editor, instruction: string) => void;
  children?: React.ReactNode;
}>) {
  const [result, setResult] = useState<Result | null>(null);
  const resultRef = useRef<Result | null>(null);
  const [status, setStatus] = useState("章全体をローカルで解析します。本文は送信しません。");
  const [busy, setBusy] = useState(false);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const [correction, setCorrection] = useState<SelectionSnapshot | null>(null);
  const [replacement, setReplacement] = useState("");
  const [currentCorrection, setCurrentCorrection] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const contextRef = useRef(context);
  useLayoutEffect(() => { contextRef.current = context; }, [context]);
  const correctionRef = useRef(correction);
  useLayoutEffect(() => { correctionRef.current = correction; }, [correction]);
  const composing = useRef(false);

  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => {
      const current = resultRef.current;
      if (current && !isSearchCurrent(editor, current.snapshot)) {
        workerRef.current?.terminate(); workerRef.current = null;
        resultRef.current = null; setResult(null); setBusy(false);
        setStatus("本文が変わったため解析結果は期限切れです。再解析してください。");
      }
      const snapshot = correctionRef.current;
      if (snapshot) setCurrentCorrection(validateSelectionSnapshot(editor, snapshot, contextRef.current).status === "valid");
    };
    editor.on("transaction", onTransaction);
    return () => { editor.off("transaction", onTransaction); workerRef.current?.terminate(); workerRef.current = null; };
  }, [editor]);

  function analyze() {
    if (!editor || editor.isDestroyed || editor.view.composing || composing.current) return;
    workerRef.current?.terminate();
    setCorrection(null); setBusy(true); setStatus("解析中です。本文編集は続けられます。");
    const snapshot = captureSearch(editor, "", true);
    try {
      const worker = new Worker(new URL("./diagnostics.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (workerRef.current !== worker) return;
        worker.terminate(); workerRef.current = null; setBusy(false);
        if (!isSearchCurrent(editor, snapshot)) { setStatus("本文が変わりました。再解析してください。"); return; }
        const parsed = diagnosticAnalysisSchema.safeParse(event.data);
        if (!parsed.success) { setStatus("解析できませんでした。章の長さを確認して再試行してください。"); return; }
        const value = { snapshot, analysis: parsed.data }; resultRef.current = value; setResult(value);
        showDiagnostics(editor, snapshot, parsed.data.issues.filter((issue) => !ignored.has(`${issue.rule}:${issue.key}`)));
        setStatus(`${parsed.data.issues.length}件の確認候補があります。誤りの断定ではありません。`);
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        worker.terminate(); workerRef.current = null; setBusy(false); setStatus("解析を実行できませんでした。本文と保存は利用できます。");
      };
      worker.postMessage(documentToPlainText(snapshot.document));
    } catch { setBusy(false); setStatus("この環境では解析Workerを利用できません。本文と保存は利用できます。"); }
  }
  function ignore(issue: DiagnosticIssue) {
    const next = new Set(ignored); next.add(`${issue.rule}:${issue.key}`); setIgnored(next);
    if (editor && result) showDiagnostics(editor, result.snapshot, result.analysis.issues.filter((entry) => !next.has(`${entry.rule}:${entry.key}`)));
  }
  function select(issue: DiagnosticIssue): boolean {
    return !!editor && !!result && !composing.current && selectDiagnostic(editor, result.snapshot, issue);
  }
  const visible = result?.analysis.issues.filter((issue) => !ignored.has(`${issue.rule}:${issue.key}`)) ?? [];
  const stats = result?.analysis.stats;
  return <section className={styles.panel} aria-label="日本語診断とFeedback"
    onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}>
    <HelpHeading level={3} label="日本語の確認候補" help={<>誤字の候補、語尾や語の反復、長い文、括弧の対応などを、この端末内の規則で調べます。本文は送信しません。意図した反復や台詞は「この表現を無視」で残せます。</>}>日本語の確認候補</HelpHeading>
    <button type="button" disabled={!editor || busy} onClick={analyze}>{result ? "再解析" : "章を解析"}</button>
    <p role="status">{status}</p>
    {stats ? <section aria-label="章全体のローカルFeedback"><HelpHeading level={4} label="章全体のリズム" help={<>文の境界と語の区切りは推定です。長短の偏りは作風として選べます。</>}>章全体のリズム</HelpHeading>
      <dl className={styles.stats}><dt>文字数 / 文数</dt><dd>{stats.characters} / {stats.sentences}</dd>
        <dt>平均 / 最長の文</dt><dd>{stats.averageLength.toFixed(1)} / {stats.longestSentence}文字</dd>
        <dt>短文≤20 / 長文≥80</dt><dd>{stats.shortSentences} / {stats.longSentences}文</dd>
        <dt>括弧内の台詞比率</dt><dd>{(stats.dialogueRatio * 100).toFixed(1)}%</dd>
        <dt>漢字 / ひらがな</dt><dd>{(stats.kanjiRatio * 100).toFixed(1)}% / {(stats.hiraganaRatio * 100).toFixed(1)}%</dd>
      </dl></section> : null}
    {ignored.size ? <button type="button" onClick={() => { setIgnored(new Set()); if (editor && result) showDiagnostics(editor, result.snapshot, result.analysis.issues); }}>無視を解除（この章を開いている間）</button> : null}
    {result?.analysis.truncated ? <p>表示は先頭1,000件までです。本文は省略せず統計を計算しています。</p> : null}
    <ol className={styles.issues}>{visible.map((issue) => <li key={issue.id}>
      <strong>{issue.title}</strong><p>{issue.evidence}</p><p>{issue.suggestion}</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => select(issue)}>本文の位置へ</button>
        <button type="button" onClick={() => ignore(issue)}>この表現を無視</button>
        <button type="button" onClick={() => {
          if (!select(issue) || !editor) return;
          const captured = captureSelection(editor, contextRef.current);
          if (captured.status === "captured") { setCorrection(captured.snapshot); setReplacement(captured.snapshot.originalText); setCurrentCorrection(true); }
        }}>個別修正</button>
        <button type="button" onClick={() => {
          if (select(issue) && editor) onAi(editor, `日本語小説の局所推敲です。${issue.title}：${issue.evidence}。${issue.suggestion} 意味・固有名詞・視点・出来事は保持してください。`);
        }}>AI推敲を準備</button>
      </div>
    </li>)}</ol>
    {correction ? <section aria-label="個別修正の確認"><h4>原文と修正案</h4>
      <p className={styles.text}>{correction.originalText}</p>
      <label>修正案<textarea value={replacement} maxLength={3_000} onChange={(event) => setReplacement(event.target.value)} /></label>
      <DiffPreview originalText={correction.originalText} candidateText={replacement} candidateId="manual-diagnostic" requestId={String(correction.identity.contentRevision)} candidatePosition={0} />
      {!currentCorrection ? <p role="status">本文・選択が変わったため修正案は期限切れです。</p> : null}
      <button type="button" disabled={!currentCorrection || !replacement.trim()} onClick={() => {
        if (!editor || composing.current) return;
        const applied = replaceCapturedSelection(editor, correction, replacement, contextRef.current);
        if (applied.status === "applied") { setCorrection(null); setStatus("修正を採用しました。1回のUndoで戻せます。再解析してください。"); }
        else setStatus("修正案を適用できませんでした。対象と文字数を確認してください。");
      }}>修正を採用</button>
      <button type="button" onClick={() => setCorrection(null)}>修正を却下</button>
    </section> : null}
    {children}
  </section>;
}
