"use client";

import type { Editor } from "@tiptap/core";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { authoringProfileSchema, type AuthoringProfile, type CharacterProfile } from "../../domain/authoring-profile";
import { diagnosticAnalysisSchema } from "../../domain/japanese-diagnostics";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import { captureSearch, isSearchCurrent } from "../editor/search-replace";
import { getEditGuardState } from "../editor/plugins/edit-guard";
import { documentToPlainText } from "../editor/plain-text";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "../feedback/Feedback.module.css";
import { HelpHeading } from "../ui/HelpTip";

export type AuthoringPanelHandle = { save: () => Promise<WorkspaceActionResult> };
type Props = Readonly<{ profile: AuthoringProfile; workspace: WorkspaceSnapshot; editor: Editor | null; disabled: boolean;
  onSave: (value: AuthoringProfile) => Promise<WorkspaceActionResult>; onDirtyChange: (dirty: boolean) => void }>;
const stamp = () => ({ id: crypto.randomUUID(), revision: 0, updatedAt: new Date().toISOString() });
const lines = (value: string) => [...new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))];
const characterFields: readonly [keyof Pick<CharacterProfile, "name" | "firstPerson" | "secondPerson" | "addressTerms" | "speechStyle" | "examples" | "avoidedExpressions">, string, number][] = [
  ["name", "名前", 80], ["firstPerson", "一人称", 80], ["secondPerson", "二人称", 80], ["addressTerms", "相手ごとの呼称", 300],
  ["speechStyle", "口調・敬体/常体・語尾", 500], ["examples", "台詞の例", 500], ["avoidedExpressions", "避ける表現（1行1件）", 300],
];
const entryKinds = ["world", "relationship", "timeline", "summary"] as const;
const entryLabels = { world: "世界・設定", relationship: "人物関係", timeline: "出来事・時系列", summary: "章要約" };

export const AuthoringPanel = forwardRef<AuthoringPanelHandle, Props>(function AuthoringPanel({ profile, workspace, editor, disabled, onSave, onDirtyChange }, forwardedRef) {
  const [draft, setDraft] = useState(profile);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [observation, setObservation] = useState<AuthoringProfile["styleReference"]>(null);
  const workerRef = useRef<Worker | null>(null);
  const editorRef = useRef(editor);
  const composing = useRef(false);
  useLayoutEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => () => workerRef.current?.terminate(), []);
  function change(next: AuthoringProfile) { setDraft(next); setDirty(true); onDirtyChange(true); }
  async function save(): Promise<WorkspaceActionResult> {
    if (disabled || busy || composing.current || editor?.view.composing) return { ok: false, message: "変換を確定してから保存してください。" };
    const revise = <Item extends { id: string; revision: number; updatedAt: string }>(items: Item[], previous: Item[]): Item[] => items.map((item) => {
      const old = previous.find((value) => value.id === item.id);
      return old && JSON.stringify(old) === JSON.stringify(item) ? item : { ...item, revision: (old?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
    });
    const parsed = authoringProfileSchema.safeParse({ ...draft, revision: profile.revision + 1,
      preservedTerms: lines(draft.preservedTerms.join("\n")),
      characters: revise(draft.characters.map((item) => ({ ...item, aliases: lines(item.aliases.join("\n")) })), profile.characters), vocabulary: revise(draft.vocabulary.map((item) => ({ ...item, variants: lines(item.variants.join("\n")) })), profile.vocabulary),
      entries: revise(draft.entries, profile.entries), presets: revise(draft.presets, profile.presets) });
    if (!parsed.success) { const result = { ok: false, message: "執筆設定の名前・文字数・重複・入力内容を確認してください。" }; setMessage(result.message); return result; }
    setBusy(true);
    try {
      const result = await onSave(parsed.data);
      if (result.ok) { setDraft(parsed.data); setDirty(false); onDirtyChange(false); }
      setMessage(result.ok ? "人物・文体・ルールを保存しました。AI参照は生成ごとに選択します。" : result.message ?? "保存できませんでした。入力は保持しています。");
      return result;
    } catch { const result = { ok: false, message: "保存できませんでした。入力は保持しています。" }; setMessage(result.message); return result;
    } finally { setBusy(false); }
  }
  useImperativeHandle(forwardedRef, () => ({ save }));
  function source() {
    if (!editor || editor.isDestroyed || editor.view.composing) return null;
    const guard = getEditGuardState(editor.state); if (!guard) return null;
    return { chapterId: workspace.chapter.id, chapterTitle: workspace.chapter.title, contentRevision: guard.contentRevision,
      quote: Array.from(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n")).slice(0, 300).join("") };
  }
  function observeStyle() {
    if (!editor || editor.isDestroyed || editor.view.composing || composing.current) return;
    workerRef.current?.terminate(); const snapshot = captureSearch(editor, "", true); const origin = source();
    try {
      const worker = new Worker(new URL("../feedback/diagnostics.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker; setMessage("文体の観測値を計算中です。本文は送信しません。");
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (workerRef.current !== worker) return;
        worker.terminate(); workerRef.current = null;
        if (editorRef.current !== editor || !isSearchCurrent(editor, snapshot)) { setMessage("本文・章が変わりました。再分析してください。"); return; }
        const result = diagnosticAnalysisSchema.safeParse(event.data);
        if (!result.success) { setMessage("分析できませんでした。本文は保持されています。"); return; }
        const stats = result.data.stats;
        setObservation({ source: origin, description: `作者の本文から観測：${stats.characters}文字、${stats.sentences}文。平均文長${stats.averageLength.toFixed(1)}文字、最長${stats.longestSentence}文字。短文（20字以下）${stats.shortSentences}文、長文（80字以上）${stats.longSentences}文。台詞括弧内${(stats.dialogueRatio * 100).toFixed(1)}%、漢字${(stats.kanjiRatio * 100).toFixed(1)}%、ひらがな${(stats.hiraganaRatio * 100).toFixed(1)}%。読点${stats.commas}、句点${stats.periods}。これらは文体の一部の観測であり、作風や品質の評価ではない。` });
        setMessage("観測値を確認して、必要な場合だけ文体欄へ取り込んでください。");
      };
      worker.onerror = () => { worker.terminate(); if (workerRef.current === worker) { workerRef.current = null; setMessage("文体分析を実行できませんでした。"); } };
      worker.postMessage(documentToPlainText(snapshot.document));
    } catch { setMessage("この環境では文体分析を実行できません。"); }
  }
  const locked = disabled || busy;
  function sourceLabel(value: CharacterProfile["source"]) {
    if (!value) return "手入力（出典なし）";
    const chapter = [workspace.chapter, ...workspace.additionalChapters].find((item) => item.id === value.chapterId);
    return `出典：${chapter?.title ?? "削除済み/未確認の章"}・revision ${value.contentRevision}（現在の整合性は要確認）`;
  }
  return <section className={styles.panel} aria-label="人物・文体・執筆ルール" onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}>
    <HelpHeading level={3} label="人物・文体・執筆ルール" help={<>作品ごとに保存します。AIへの参照は生成ごとに初期OFFです。</>}>人物・文体・執筆ルール</HelpHeading>
    <fieldset disabled={locked}>
      <details><summary>人物と台詞の口調（{draft.characters.length}）</summary>
        {draft.characters.map((character) => <details key={character.id}><summary>{character.name || "名前未入力"}</summary>
          {characterFields.map(([key, label, maximum]) => <label key={key}>{label}<textarea aria-label={label} rows={key === "name" ? 1 : 2} maxLength={maximum} value={character[key]}
            onChange={(event) => change({ ...draft, characters: draft.characters.map((item) => item.id === character.id ? { ...item, [key]: event.target.value } : item) })} /></label>)}
          <label>別名（1行1件）<textarea value={character.aliases.join("\n")} onChange={(event) => change({ ...draft, characters: draft.characters.map((item) => item.id === character.id ? { ...item, aliases: event.target.value.split("\n") } : item) })} /></label>
          <p>{sourceLabel(character.source)}</p>
          <button type="button" onClick={() => change({ ...draft, characters: draft.characters.map((item) => item.id === character.id ? { ...item, source: source() } : item) })}>現在の章・選択を出典にする</button>
          <button type="button" onClick={() => change({ ...draft, characters: draft.characters.filter((item) => item.id !== character.id) })}>この人物を設定から除く</button>
        </details>)}
        <button type="button" disabled={draft.characters.length >= 50} onClick={() => change({ ...draft, characters: [...draft.characters, { ...stamp(), name: "新しい人物", aliases: [], firstPerson: "", secondPerson: "", addressTerms: "", speechStyle: "", examples: "", avoidedExpressions: "", source: null }] })}>人物を追加</button>
      </details>
      <details><summary>作品独自の語彙・表記（{draft.vocabulary.length}）</summary>
        {draft.vocabulary.map((entry) => <div key={entry.id}>
          <label>推奨表記<input value={entry.preferred} maxLength={80} onChange={(event) => change({ ...draft, vocabulary: draft.vocabulary.map((item) => item.id === entry.id ? { ...item, preferred: event.target.value } : item) })} /></label>
          <label>別表記（1行1件）<textarea value={entry.variants.join("\n")} onChange={(event) => change({ ...draft, vocabulary: draft.vocabulary.map((item) => item.id === entry.id ? { ...item, variants: event.target.value.split("\n") } : item) })} /></label>
          <label>使い分けのメモ<input value={entry.note} maxLength={200} onChange={(event) => change({ ...draft, vocabulary: draft.vocabulary.map((item) => item.id === entry.id ? { ...item, note: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => change({ ...draft, vocabulary: draft.vocabulary.filter((item) => item.id !== entry.id) })}>この語彙を除く</button>
        </div>)}
        <button type="button" disabled={draft.vocabulary.length >= 100} onClick={() => change({ ...draft, vocabulary: [...draft.vocabulary, { ...stamp(), preferred: "新しい語", variants: [], note: "" }] })}>語彙を追加</button>
      </details>
      <details><summary>設定・関係・出来事・章要約（{draft.entries.length}）</summary>
        {draft.entries.map((entry) => <details key={entry.id}><summary>{entryLabels[entry.kind]}：{entry.title}</summary>
          <label>資料の種類<select value={entry.kind} onChange={(event) => {
            const kind = entryKinds.find((kind) => kind === event.target.value);
            if (kind) change({ ...draft, entries: draft.entries.map((item) => item.id === entry.id ? { ...item, kind } : item) });
          }}>{entryKinds.map((kind) => <option key={kind} value={kind}>{entryLabels[kind]}</option>)}</select></label>
          <label>資料名<input maxLength={80} value={entry.title} onChange={(event) => change({ ...draft, entries: draft.entries.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item) })} /></label>
          <label>資料の内容<textarea maxLength={1_000} value={entry.content} onChange={(event) => change({ ...draft, entries: draft.entries.map((item) => item.id === entry.id ? { ...item, content: event.target.value } : item) })} /></label>
          <p>{sourceLabel(entry.source)}</p>
          <button type="button" onClick={() => change({ ...draft, entries: draft.entries.map((item) => item.id === entry.id ? { ...item, source: source() } : item) })}>現在の章を資料の出典にする</button>
          <button type="button" onClick={() => change({ ...draft, entries: draft.entries.filter((item) => item.id !== entry.id) })}>この資料を除く</button>
        </details>)}
        <button type="button" disabled={draft.entries.length >= 100} onClick={() => change({ ...draft, entries: [...draft.entries, { ...stamp(), kind: "world", title: "新しい資料", content: "", source: null }] })}>資料を追加</button>
      </details>
      <details><summary>作者文体の観測と保持条件</summary>
        <button type="button" disabled={!editor} onClick={observeStyle}>現在の章から文体を分析</button>
        {observation ? <><p>{observation.description}</p><button type="button" onClick={() => { change({ ...draft, styleReference: observation }); setObservation(null); }}>観測値を文体欄へ取り込む</button></> : null}
        <label>確認済みの文体参考<textarea maxLength={1_000} value={draft.styleReference?.description ?? ""} onChange={(event) => change({ ...draft, styleReference: { description: event.target.value, source: draft.styleReference?.source ?? null } })} /></label>
        <p>{sourceLabel(draft.styleReference?.source ?? null)}</p>
        <label>字面の出現回数を必須保持（1行1件）<textarea value={draft.preservedTerms.join("\n")} onChange={(event) => change({ ...draft, preservedTerms: event.target.value.split("\n") })} /></label>
        <p>原文にある登録文字列の出現回数が変わるAI候補は採用できません。意味・出来事・視点の維持を保証するものではありません。</p>
        <label>AIへ伝える保持条件<textarea maxLength={400} value={draft.preservationNote} onChange={(event) => change({ ...draft, preservationNote: event.target.value })} /></label>
      </details>
      <details><summary>推敲プリセット（{draft.presets.length}）</summary>
        {draft.presets.map((preset) => <div key={preset.id}>
          <label>プリセット名<input maxLength={80} value={preset.name} onChange={(event) => change({ ...draft, presets: draft.presets.map((item) => item.id === preset.id ? { ...item, name: event.target.value } : item) })} /></label>
          <label>保存する推敲指示<textarea maxLength={500} value={preset.instruction} onChange={(event) => change({ ...draft, presets: draft.presets.map((item) => item.id === preset.id ? { ...item, instruction: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => change({ ...draft, presets: draft.presets.filter((item) => item.id !== preset.id) })}>このプリセットを除く</button>
        </div>)}
        <button type="button" disabled={draft.presets.length >= 50} onClick={() => change({ ...draft, presets: [...draft.presets, { ...stamp(), name: "新しいプリセット", instruction: "意味と文体を保ち、表現を整えてください。" }] })}>プリセットを追加</button>
      </details>
    </fieldset>
    <button type="button" disabled={locked || !dirty} onClick={() => void save()}>人物・文体・ルールを保存</button>
    <p role="status">{dirty ? "未保存の執筆設定があります。" : ""}{message}</p>
  </section>;
});
