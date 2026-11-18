"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FEEDBACK_FOCUSES, FEEDBACK_TEXT_LIMIT, feedbackRequestSchema, uniqueQuoteRange, type FeedbackFocus, type FeedbackResponse } from "../../domain/feedback";
import { HelpHeading } from "../ui/HelpTip";
import type { AiConsent, AiModelPreference } from "../../domain/workspace";
import { captureSearch, isSearchCurrent, type SearchSnapshot } from "../editor/search-replace";
import { getEditGuardState } from "../editor/plugins/edit-guard";
import { documentToPlainText } from "../editor/plain-text";
import { proseMirrorPositionToPlainTextOffset } from "../editor/selection";
import { canUseAiRuntime, requestConsentForRuntime, requestModelIdForRuntime, resolveRuntimeModel, type PublicAiRuntime } from "../ai-edit/consent";
import { AiConsentDisclosure, type AiConsentChangeResult } from "../ai-edit/AiConsentDisclosure";
import { requestFeedback } from "./feedback-client";
import { selectDiagnostic } from "./diagnostic-anchors";
import styles from "./Feedback.module.css";

type Source = { snapshot: SearchSnapshot; text: string; offset: number; selectionRevision: number; contextRevision: number };
type Props = Readonly<{
  editor: Editor | null; contextRevision: number; runtime: PublicAiRuntime; consent: AiConsent | null; modelPreference: AiModelPreference;
  onConsentChange: (providerId: string | null) => Promise<AiConsentChangeResult>;
}>;
export function AiFeedbackPanel(props: Props) {
  const runtime = props.runtime;
  const sessionKey = JSON.stringify([props.contextRevision, runtime.providerId, runtime.settingsRevision, runtime.connectionId, runtime.paidApiEnabled, props.modelPreference, runtime.available]);
  return <FeedbackSession key={sessionKey} {...props} />;
}
function FeedbackSession({ editor, contextRevision, runtime, consent, modelPreference, onConsentChange }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const sourceRef = useRef(source);
  useLayoutEffect(() => { sourceRef.current = source; }, [source]);
  const [response, setResponse] = useState<FeedbackResponse | null>(null);
  const [focus, setFocus] = useState<FeedbackFocus>("general");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const composing = useRef(false);
  function cancel() { const pending = active.current; active.current = null; pending?.controller.abort(); setBusy(false); }
  function current(value: Source): boolean {
    return !!editor && !editor.isDestroyed && isSearchCurrent(editor, value.snapshot) &&
      getEditGuardState(editor.state)?.selectionRevision === value.selectionRevision && contextRevision === value.contextRevision;
  }
  useEffect(() => {
    if (!editor) return;
    const changed = () => {
      const value = sourceRef.current;
      if (value && (!isSearchCurrent(editor, value.snapshot) || getEditGuardState(editor.state)?.selectionRevision !== value.selectionRevision)) {
        sourceRef.current = null; cancel(); setSource(null); setResponse(null); setMessage("本文・選択が変わりました。Feedbackの対象を指定し直してください。");
      }
    };
    editor.on("transaction", changed);
    return () => { editor.off("transaction", changed); const pending = active.current; active.current = null; pending?.controller.abort(); };
  }, [editor]);

  function prepare(selectionOnly: boolean) {
    if (!editor || editor.isDestroyed || editor.view.composing || composing.current) return;
    cancel(); setResponse(null);
    const snapshot = captureSearch(editor, "", true);
    const text = documentToPlainText(snapshot.document);
    const { from, to } = editor.state.selection;
    const start = selectionOnly ? proseMirrorPositionToPlainTextOffset(snapshot.document, from) : 0;
    const end = selectionOnly ? proseMirrorPositionToPlainTextOffset(snapshot.document, to) : text.length;
    const guard = getEditGuardState(editor.state);
    if (start === null || end === null || !guard || !text.slice(start, end).trim()) { setMessage("対象の本文を入力・選択してください。"); return; }
    const value = { snapshot, text: text.slice(start, end), offset: start, selectionRevision: guard.selectionRevision, contextRevision };
    sourceRef.current = value; setSource(value); setMessage("送信範囲を確認してから生成してください。本文は変更しません。");
  }
  async function generate() {
    if (!source || !current(source) || busy || composing.current || editor?.view.composing || !canUseAiRuntime(runtime, consent, modelPreference)) return;
    const request = feedbackRequestSchema.safeParse({ schemaVersion: 1, requestId: crypto.randomUUID(), text: source.text, focus,
      modelId: requestModelIdForRuntime(runtime, modelPreference), consent: requestConsentForRuntime(runtime, consent),
      ...(runtime.paidApiEnabled ? { allowPaidApi: true } : {}), ...(runtime.connectionId ? { connectionId: runtime.connectionId } : {}),
    });
    if (!request.success) { setMessage(`対象は${FEEDBACK_TEXT_LIMIT}文字以内です。短い章または選択範囲を指定してください。`); return; }
    const controller = new AbortController(); const id = request.data.requestId;
    active.current = { id, controller }; setBusy(true); setResponse(null); setMessage("AIコメントを生成中です。本文編集は続けられます。");
    const timeout = setTimeout(() => {
      if (active.current?.id === id) { cancel(); setMessage("応答待ちが期限を超えました。自動再送はしません。"); }
    }, 185_000);
    try {
      const result = await requestFeedback(request.data, controller.signal, runtime.settingsRevision);
      if (active.current?.id !== id || controller.signal.aborted || !current(source)) return;
      setResponse(result); setMessage("AIによる主観的コメントです。事実や意味保持の保証ではありません。");
    } catch {
      if (active.current?.id === id) setMessage("AIコメントを取得できませんでした。接続・同意・入力上限を確認してください。本文は保持されています。");
    } finally { clearTimeout(timeout); if (active.current?.id === id) { active.current = null; setBusy(false); } }
  }
  const model = resolveRuntimeModel(runtime, modelPreference);
  return <section className={styles.panel} aria-label="AI Feedback"
    onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}>
    <HelpHeading level={3} label="AIコメント" help={<>章全体または選択範囲を最大{FEEDBACK_TEXT_LIMIT.toLocaleString("ja-JP")}文字まで送信します。作品メモ・他章は含めません。本文は変更しません。</>}>AIコメント（読み取り専用）</HelpHeading>
    <label>確認の種類<select value={focus} disabled={busy} onChange={(event) => {
      const next = FEEDBACK_FOCUSES.find((entry) => entry.id === event.target.value);
      if (next) { setFocus(next.id); setResponse(null); }
    }}>{FEEDBACK_FOCUSES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
    <div className={styles.actions}>
      <button type="button" disabled={!editor || busy} onClick={() => prepare(false)}>章全体を対象にする</button>
      <button type="button" disabled={!editor || busy} onClick={() => prepare(true)}>選択範囲を対象にする</button>
    </div>
    {source ? <details><summary>送信する本文（{Array.from(source.text).length}文字）</summary><p className={styles.text}>{source.text}</p></details> : null}
    <p>提供元：{runtime.providerId ?? "未接続"} / {model?.displayName ?? "モデル利用不可"}</p>
    <button type="button" disabled={!source || busy || !canUseAiRuntime(runtime, consent, modelPreference) || Array.from(source.text).length > FEEDBACK_TEXT_LIMIT} onClick={() => void generate()}>AIコメントを生成</button>
    {busy ? <button type="button" onClick={() => { cancel(); setMessage("生成を中止しました。"); }}>Feedbackを中止</button> : null}
    <p role="status">{message}</p>
    {response && source ? <section aria-label="AIの主観的コメント">
      <p>{response.provider.providerId} / {response.provider.model}{response.provider.providerId === "mock" ? "（デモ。実LLM評価ではありません）" : ""}</p>
      {response.comments.map((comment) => {
        const range = uniqueQuoteRange(source.text, comment.quote);
        return <article key={comment.id}><blockquote className={styles.text}>{comment.quote}</blockquote><p className={styles.text}>{comment.comment}</p>
          {comment.cautions.map((caution, index) => <p key={index}>{caution}</p>)}
          {range ? <button type="button" onClick={() => {
            if (editor && current(source)) selectDiagnostic(editor, source.snapshot, { from: source.offset + range.from, to: source.offset + range.to });
          }}>引用の位置へ</button> : <p>一意の引用位置を確認できないため、本文への位置表示はありません。</p>}
        </article>;
      })}
    </section> : null}
    <AiConsentDisclosure feedbackTextOnly consent={consent} modelPreference={modelPreference} runtime={runtime}
      commonPromptIncluded={false} manualStyleIncluded={false} onChange={onConsentChange} disabled={busy} />
  </section>;
}
