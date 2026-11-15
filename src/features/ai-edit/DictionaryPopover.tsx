"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { DICTIONARY_QUERY_LIMIT, dictionaryQuerySchema, dictionaryRequestSchema, dictionarySearchUrl } from "../../domain/dictionary";
import type { AiEditSuccessResponse } from "../../domain/ai-edit";
import type { AiConsent, AiModelPreference } from "../../domain/workspace";
import { AiConsentDisclosure, type AiConsentChangeResult } from "./AiConsentDisclosure";
import { canUseAiRuntime, requestConsentForRuntime, requestModelIdForRuntime, resolveRuntimeModel, type PublicAiRuntime } from "./consent";
import { postDictionaryRequest } from "./dictionary-client";
import type { EditPopoverHandle } from "./EditPopover";
import styles from "./AiEdit.module.css";

type LookupState = { kind: "idle" } | { kind: "loading" } | { kind: "success"; response: AiEditSuccessResponse } | { kind: "error"; message: string };
type Props = Readonly<{
  query: string; stale: boolean; consent: AiConsent | null; modelPreference: AiModelPreference;
  runtime: PublicAiRuntime; onCancel: () => void;
  onReturnToEditor?: () => void;
  onConsentChange: (providerId: string | null) => Promise<AiConsentChangeResult>;
  position: Readonly<{ left: number; top: number; maxHeight?: number; maxWidth?: number }>;
}>;

export const DictionaryPopover = forwardRef<EditPopoverHandle, Props>(function DictionaryPopover({ query, stale, consent, modelPreference, runtime, onCancel, onReturnToEditor, onConsentChange, position }, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lookupRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLAnchorElement>(null);
  const composingRef = useRef(false);
  const staleRef = useRef(stale);
  staleRef.current = stale;
  const activeRequest = useRef<{ id: string; controller: AbortController } | null>(null);
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const parsedQuery = dictionaryQuerySchema.safeParse(query);
  const searchUrl = dictionarySearchUrl(query);
  const allowed = !stale && parsedQuery.success && canUseAiRuntime(runtime, consent, modelPreference);
  const model = resolveRuntimeModel(runtime, modelPreference);

  function abort() {
    const request = activeRequest.current;
    activeRequest.current = null;
    request?.controller.abort();
  }
  useEffect(() => () => abort(), []);
  useLayoutEffect(() => { if (stale) { abort(); setLookup({ kind: "idle" }); } }, [stale]);
  useImperativeHandle(forwardedRef, () => ({
    element: () => containerRef.current,
    focusCloseControl: () => closeRef.current?.focus(),
    focusPrimaryControl: () => {
      if (lookupRef.current && !lookupRef.current.disabled) lookupRef.current.focus();
      else if (!stale && searchRef.current) searchRef.current.focus();
      else closeRef.current?.focus();
    },
  }), [stale]);

  async function lookupWord() {
    if (!allowed || !parsedQuery.success || activeRequest.current) return;
    const requestId = crypto.randomUUID();
    const parsed = dictionaryRequestSchema.safeParse({
      schemaVersion: 1, requestId, query: parsedQuery.data,
      modelId: requestModelIdForRuntime(runtime, modelPreference),
      consent: requestConsentForRuntime(runtime, consent),
      ...(runtime.paidApiEnabled === true ? { allowPaidApi: true } : {}),
      ...(runtime.connectionId === undefined ? {} : { connectionId: runtime.connectionId }),
    });
    if (!parsed.success) { setLookup({ kind: "error", message: "照会する語句とAI接続を確認してください。" }); return; }
    const controller = new AbortController();
    activeRequest.current = { id: requestId, controller };
    closeRef.current?.focus();
    setLookup({ kind: "loading" });
    const result = await postDictionaryRequest(parsed.data, controller.signal, runtime);
    if (activeRequest.current?.id !== requestId || controller.signal.aborted || staleRef.current) return;
    activeRequest.current = null;
    if (result.status === "success") setLookup({ kind: "success", response: result.data });
    else if (result.status === "cancelled") setLookup({ kind: "idle" });
    else setLookup({ kind: "error", message: result.error.kind === "server"
      ? `LLMで調べられませんでした（${result.error.code}）。接続・同意・利用枠を確認して再試行してください。`
      : "LLMの応答を取得・検証できませんでした。接続を確認して再試行してください。" });
  }

  return <div ref={containerRef} role="dialog" aria-modal="false" aria-labelledby="dictionary-title"
    className={styles.popover} style={position}
    onCompositionStartCapture={() => { composingRef.current = true; }} onCompositionEndCapture={() => { composingRef.current = false; }}
    onKeyDown={(event) => {
      if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
    }}>
    <div className={styles.headingRow}><div><p className={styles.eyebrow}>辞書 / Dictionary · 読み取り専用</p><h2 id="dictionary-title">語句を調べる</h2></div>
      <div className={styles.headingActions}>
        {onReturnToEditor ? <button type="button" className={styles.returnToEditor} onClick={() => {
          if (!composingRef.current) onReturnToEditor();
        }}>本文へ</button> : null}
        <button type="button" ref={closeRef} aria-label="辞書を閉じる" onClick={onCancel}>閉じる</button></div></div>
    <div className={styles.popoverBody} role="region" aria-label="辞書の内容" tabIndex={0}>
      <section className={styles.originalSelection} aria-label="調べる語句"><strong>選択した語句</strong><p>{query}</p></section>
      {stale ? <p role="status" className={styles.staleMessage}>本文・選択範囲・AI参照設定が変わったため、この辞書照会は期限切れです。語句を選び直して開いてください。</p> : null}
      {!parsedQuery.success ? <p role="alert">調べる語句を1〜{DICTIONARY_QUERY_LIMIT}文字で選択してください。</p> : null}
      <p>LLMには語句と辞書用の指示だけを送ります。前後本文・作品設定・メモは送りません。</p>
      <p>{model ? `LLM：${model.displayName}（${model.id}）` : "LLMは未接続、または選択モデルを利用できません。"}</p>
      <button type="button" ref={lookupRef} disabled={!allowed || lookup.kind === "loading"} onClick={() => void lookupWord()}>LLMで調べる</button>
      {lookup.kind === "loading" && !stale ? <><p role="status">語句の意味を調べています。本文編集は続けられます。</p>
        <button type="button" onClick={() => { abort(); setLookup({ kind: "idle" }); requestAnimationFrame(() => lookupRef.current?.focus()); }}>照会を中止</button></> : null}
      {lookup.kind === "error" && !stale ? <p role="alert" className={styles.errorMessage}>{lookup.message}</p> : null}
      {lookup.kind === "success" && !stale ? <section aria-label="LLMによる語句の説明" className={styles.dictionaryResult}>
        <h3>LLMの説明</h3><p role="status">語句の説明を受信しました。</p>
        {lookup.response.provider.providerId === "mock" ? <p>デモ応答です。実際の語義説明ではありません。</p> : null}
        <p className={styles.candidateText} tabIndex={0} aria-label="語句の説明本文">{lookup.response.candidates[0]?.replacementText}</p>
        {lookup.response.candidates[0]?.riskNotes.map((note, index) => <p key={index}>{note}</p>)}
        <p>検索結果や出典付き辞書ではありません。不明な点や正確な用法は辞書・検索先でも確認してください。</p>
      </section> : null}
      <section aria-label="外部検索"><h3>検索で確認する</h3><p>押すと語句と「意味」をGoogleへ送り、検索結果を別タブで開きます。</p>
        {searchUrl && !stale ? <a ref={searchRef} href={searchUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Googleで意味を検索（別タブ）</a> : null}
      </section>
      <AiConsentDisclosure dictionaryQueryOnly promptOnly commonPromptIncluded={false} manualStyleIncluded={false}
        consent={consent} modelPreference={modelPreference} runtime={runtime} onChange={onConsentChange} disabled={stale || lookup.kind === "loading"} />
    </div>
  </div>;
});
