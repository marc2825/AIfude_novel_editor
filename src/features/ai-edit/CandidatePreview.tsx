"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";

import { authoringChangeWarnings, changedPreservedTerms, characterStyleWarnings } from "../../domain/authoring-profile";
import { createPartialEditPlan, composePartialEdit, partialEditSentences } from "../../domain/partial-edit";
import { codePointLength } from "../../domain/limits";
import { findAiProviderDefinition, findAiModelDefinition } from "../../domain/ai-models";
import { previewCandidates, type AiEditPreviewState } from "./machine";
import styles from "./AiEdit.module.css";
import { DiffPreview } from "./DiffPreview";

type CandidatePreviewProps = Readonly<{
  onAccept: () => void;
  onPartialSelectionChange?: (ids: readonly number[] | undefined) => void;
  onReject: () => void;
  onRetry: () => void;
  onSelectCandidate: (candidateId: string) => void;
  state: AiEditPreviewState;
}>;

function candidateTabId(candidateId: string): string {
  return `ai-candidate-tab-${candidateId}`;
}

function candidatePanelId(candidateId: string): string {
  return `ai-candidate-panel-${candidateId}`;
}

function applyErrorMessage(error: AiEditPreviewState["applyError"]): string | null {
  switch (error) {
    case "preservation-violation":
      return "必須にした文字列の出現回数が変わるため採用できません。候補または保持設定を確認してください。";
    case null:
      return null;
    case "editor-composing":
      return "文字入力の変換中は採用できません。変換を確定してから再度採用してください。";
    case "editor-not-ready":
    case "guard-unavailable":
      return "現在の編集状態を確認できないため、候補を採用できませんでした。";
    case "no-change":
      return "原文と同じ候補のため、本文は変更されませんでした。";
    case "invalid-replacement":
    case "unsafe-replacement":
      return "候補を安全に適用できなかったため、本文は変更されませんでした。";
  }
}

export function CandidatePreview({
  onAccept,
  onPartialSelectionChange,
  onReject,
  onRetry,
  onSelectCandidate,
  state,
}: CandidatePreviewProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [copyResult, setCopyResult] = useState<{ id: string; message: string } | null>(null);
  const candidates = previewCandidates(state);
  const activeIndex = candidates.findIndex(
    (candidate) => candidate.id === state.activeCandidateId,
  );
  const candidate = candidates[activeIndex];
  const originalText = state.snapshot.originalText;
  const replacementText = candidate?.replacementText ?? "";
  const plan = createPartialEditPlan(originalText, replacementText);
  const merged = state.partialHunkIds === undefined ? candidate?.replacementText ?? ""
    : composePartialEdit(state.snapshot.originalText, candidate?.replacementText ?? "", state.partialHunkIds);
  const protectedChanges = changedPreservedTerms(state.snapshot.originalText, merged ?? "", state.snapshot.authoringProfile);
  const warnings = [...authoringChangeWarnings(state.snapshot.originalText, merged ?? "", state.snapshot.authoringProfile), ...characterStyleWarnings(merged ?? "", state.snapshot.authoringProfile, state.input.authoringReference?.characterIds)];
  const applyError = applyErrorMessage(state.applyError);
  const responseModel = findAiModelDefinition(candidate?.model ?? "");
  const modelLabel = responseModel?.displayName ?? candidate?.model;

  if (candidate === undefined) {
    return (
      <p className={styles.errorMessage} role="alert">
        候補を安全に表示できませんでした。
      </p>
    );
  }

  function selectAndFocus(nextIndex: number): void {
    const nextCandidate = candidates[nextIndex];

    if (nextCandidate === undefined) {
      return;
    }

    onSelectCandidate(nextCandidate.id);
    queueMicrotask(() => tabRefs.current.get(nextCandidate.id)?.focus());
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextIndex =
          (activeIndex - 1 + candidates.length) % candidates.length;
        break;
      case "ArrowRight":
        nextIndex = (activeIndex + 1) % candidates.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = candidates.length - 1;
        break;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      selectAndFocus(nextIndex);
    }
  }

  return (
    <section aria-labelledby="candidate-preview-title" className={styles.candidatePreview}>
      <p className={styles.candidateSummary} role="status">
        {candidates.length}件の候補を受信しました。
      </p>
      {state.input.targetCharacters !== undefined ? <p className={styles.lengthDelta}>
        目標 {state.input.targetCharacters}文字 · この候補 {codePointLength(candidate.replacementText)}文字（改行を含む）
      </p> : null}
      <div className={styles.candidateHeading}>
        <div>
          <h3 id="candidate-preview-title">候補を確認</h3>
          <p aria-live="polite">
            候補 {activeIndex + 1} / {candidates.length}
          </p>
        </div>
        <p className={styles.providerLabel}>
          {candidate.providerId === "mock"
            ? `${modelLabel}（外部送信なし）`
            : `${modelLabel} / ${candidate.model}（${candidate.providerId}）`}
        </p>
      </div>

      {candidates.length > 1 ? <div className={styles.comparisonGrid} aria-label={state.comparisonResults ? "AI出力の並列比較" : "言い換え候補の比較"}>
        {candidates.map((item) => <article key={item.id} data-selected={item.id === candidate.id} aria-label={`${item.providerId}の候補${item.index + 1}`}>
          <div className={styles.cardHeading}><h4>{findAiProviderDefinition(item.providerId)?.displayName ?? item.providerId}<span>候補 {item.index + 1}</span></h4>
            <p>{item.model}</p></div>
          <p className={styles.lengthDelta}>{codePointLength(item.replacementText)}文字 · 原文比 {codePointLength(item.replacementText) - codePointLength(state.snapshot.originalText) > 0 ? "+" : ""}{codePointLength(item.replacementText) - codePointLength(state.snapshot.originalText)}文字</p>
          <p className={styles.candidateText}>{item.replacementText}</p>
          <button type="button" onClick={() => onSelectCandidate(item.id)} aria-pressed={item.id === candidate.id}>この候補のDiffを確認</button>
        </article>)}
      </div> : null}

      <div
        aria-label="編集候補"
        className={styles.candidateTabs}
        onKeyDown={handleTabKeyDown}
        role="tablist"
      >
        {candidates.map((item, index) => (
          <button
            aria-controls={candidatePanelId(item.id)}
            aria-selected={item.id === candidate.id}
            id={candidateTabId(item.id)}
            key={item.id}
            onClick={() => onSelectCandidate(item.id)}
            ref={(element) => {
              if (element === null) {
                tabRefs.current.delete(item.id);
              } else {
                tabRefs.current.set(item.id, element);
              }
            }}
            role="tab"
            tabIndex={item.id === candidate.id ? 0 : -1}
            type="button"
          >
            {state.comparisonResults ? `${item.providerId} / ${item.model} — ` : ""}候補 {index + 1}
          </button>
        ))}
      </div>

      {candidates.map((item) => (
        <div
          aria-labelledby={candidateTabId(item.id)}
          className={styles.candidatePanel}
          hidden={item.id !== candidate.id}
          id={candidatePanelId(item.id)}
          key={item.id}
          role="tabpanel"
        >
          <div className={styles.reviewColumns}>
          <div>
            <h4>{state.snapshot.from === state.snapshot.to ? "挿入する本文" : "置換する本文"}</h4>
            <p aria-label="候補本文" className={styles.candidateText}>
              {item.id === candidate.id ? merged ?? item.replacementText : item.replacementText}
            </p>
          </div>
          {item.id === candidate.id ? (
            <DiffPreview
              candidateId={item.id}
              candidatePosition={activeIndex + 1}
              candidateText={merged ?? item.replacementText}
              originalText={state.snapshot.originalText}
              requestId={state.requestId}
            />
          ) : null}
          </div>
          <div>
            <h4>変更説明</h4>
            <p className={styles.candidateMetadata}>{item.explanation}</p>
          </div>
          <div>
            <h4>注意事項</h4>
            {item.riskNotes.length === 0 ? (
              <p className={styles.candidateMetadata}>なし</p>
            ) : (
              <ul className={styles.riskNotes}>
                {item.riskNotes.map((note, index) => (
                  <li key={`${item.id}-risk-${index}`}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}

      {onPartialSelectionChange && state.snapshot.operation === undefined ? <details className={styles.controlGroup}>
        <summary>差分を選んで部分採用</summary>
        {plan.reason ? <p>この差分は{plan.reason === "ambiguous" ? "位置の対応が曖昧" : plan.reason === "no-change" ? "変更がない" : "複雑"}なため部分採用できません。</p> : <>
          <label><input type="checkbox" checked={state.partialHunkIds !== undefined} onChange={(event) => onPartialSelectionChange(event.currentTarget.checked ? [] : undefined)} />採用する差分を自分で選ぶ</label>
          {state.partialHunkIds !== undefined ? <div aria-label="部分採用の差分">
            {partialEditSentences(originalText, plan).map((sentence, index) => <div key={index}><p>{sentence.text}</p>
              <button type="button" onClick={() => onPartialSelectionChange([...new Set([...(state.partialHunkIds ?? []), ...sentence.ids])])}>文 {index + 1} の差分をまとめて選ぶ</button></div>)}
            <p>さらに細かく選ぶ場合は、各差分を切り替えてください。文をまたぐ差分はまとめて扱います。</p>
            {plan.hunks.map((hunk, index) => <label className={styles.field} key={index}>
            <span><input type="checkbox" checked={state.partialHunkIds?.includes(index)} onChange={(event) => onPartialSelectionChange(event.currentTarget.checked ? [...(state.partialHunkIds ?? []), index] : state.partialHunkIds?.filter((id) => id !== index))} />差分 {index + 1}</span>
            <del>{hunk.original || "（挿入位置）"}</del><ins>{hunk.replacement || "（削除）"}</ins>
          </label>)}</div> : null}
          <p>上の本文とDiffは選んだ差分を合成した結果です。採用は1回のUndoで戻せます。</p>
        </>}
      </details> : null}
      {protectedChanges.length ? <p role="alert">必須文字列の出現回数が変わります：{protectedChanges.join("、")}。採用できません。</p> : null}
      {warnings.length ? <section aria-label="保持条件の確認"><h4>字面の変更を確認</h4>{warnings.map((warning) => <p key={warning}>{warning}</p>)}<p>出来事・視点・意味・設定の整合性は機械的に保証していません。</p></section> : null}
      {applyError === null ? null : (
        <p className={styles.errorMessage} role="alert">
          {applyError}
        </p>
      )}

      <p className={styles.reviewHint}>意味・視点・人物の口調を確認して採用してください。採用後は1回のUndoで戻せます。</p>
      <div className={styles.candidateActions}>
        <button type="button" disabled={merged === null} onClick={async () => {
          if (merged === null) return;
          try { await navigator.clipboard.writeText(merged); setCopyResult({ id: candidate.id, message: "選んだ候補をコピーしました。本文は変更していません。" }); }
          catch { setCopyResult({ id: candidate.id, message: "コピーできませんでした。候補本文を選択してコピーしてください。" }); }
        }}>候補をコピー</button>
        <button onClick={onReject} type="button">
          却下
        </button>
        <button onClick={onRetry} type="button">
          再生成
        </button>
        <button className={styles.primaryButton} onClick={onAccept} type="button" disabled={merged === null || protectedChanges.length > 0 || state.partialHunkIds?.length === 0}>
          採用
        </button>
      </div>
      {copyResult?.id === candidate.id ? <p role="status">{copyResult.message}</p> : null}
    </section>
  );
}
