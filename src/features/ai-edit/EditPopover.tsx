"use client";

import { completionCharactersSchema, isCompletionOperation } from "../../domain/completion";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

import {
  type AiEditErrorCode,
  type AiEditPresetId,
} from "../../domain/ai-edit";
import { AI_EDIT_LIMITS, AI_INSERT_CANDIDATE_COUNTS, AI_EDIT_CANDIDATE_COUNTS, codePointLength } from "../../domain/limits";
import type {
  AiConsent,
  AiModelPreference,
} from "../../domain/workspace";
import type { SelectionStaleReason } from "../editor/selection";
import {
  AiConsentDisclosure,
  type AiConsentChangeResult,
} from "./AiConsentDisclosure";
import { CandidatePreview } from "./CandidatePreview";
import {
  resolveRuntimeModel,
  type PublicAiRuntime,
} from "./consent";
import { getPresetDefaultInstruction } from "./intent";
import { ComparisonControls } from "./ComparisonControls";
import { AuthoringReferenceControls } from "./AuthoringReferenceControls";
import { authoringReferenceMemory } from "../../domain/authoring-profile";
import { StoryMemoryControls } from "./StoryMemoryControls";
import { hasStoryMemory, selectStoryMemory } from "../../domain/story-memory";
import type {
  AiEditActiveState,
  AiEditCommandInput,
  AiEditOperationError,
} from "./machine";
import styles from "./AiEdit.module.css";
import { CreativeControls } from "./CreativeControls";
import { WRITING_TOOLS, TRANSFORM_STRENGTHS, transformInstruction, writingToolPreset, type TransformStrength, type WritingToolId } from "./writing-tools";
import { AiToolPicker } from "./AiToolPicker";

const REWRITE_PRESETS = ["polish", "shorten", "dialogue", "connection"] as const;
const PRESET_LABELS = Object.freeze({
  polish: "自然に",
  shorten: "短く",
  dialogue: "台詞を自然に",
  connection: "前後の接続を改善",
} as const satisfies Readonly<Record<typeof REWRITE_PRESETS[number], string>>);

const JAPANESE_REFINEMENTS = [
  { label: "語尾の重複", instruction: "意味・時制・視点・人物の口調を保ち、繰り返す語尾や言い回しを整えてください。" },
  { label: "文のリズム", instruction: "意味・情報・視点を保ち、読点の位置や文の長短を調整して、日本語小説として読みやすいリズムにしてください。" },
  { label: "視点のぶれ", instruction: "新しい情報や心情を加えず、前後の語りの視点・人称に合わせて、選択範囲の表現を整えてください。" },
] as const;

const SERVER_ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "ChatGPTへの接続を確認し、再認証してください。",
  SUBSCRIPTION_LIMIT: "ChatGPTの利用枠を確認してください。別providerへの自動切替は行いません。",
  INVALID_REQUEST: "送信内容を検証できませんでした。",
  CONSENT_REQUIRED: "AIへの外部送信には同意が必要です。",
  FORBIDDEN_ORIGIN: "この送信元からAI機能は利用できません。",
  BODY_TOO_LARGE: "送信内容が大きすぎます。",
  UNSUPPORTED_MEDIA_TYPE: "AIリクエストの形式が正しくありません。",
  RATE_LIMITED: "AIの利用上限に達しました。しばらく待って再試行してください。",
  AI_UNAVAILABLE: "AI機能は現在利用できません。",
  PROVIDER_TIMEOUT: "AIの応答が時間内に完了しませんでした。",
  PROVIDER_REFUSAL: "AIがこの編集リクエストを処理できませんでした。",
  INVALID_OUTPUT: "AIの応答を安全に検証できませんでした。",
  INCOMPLETE_OUTPUT: "AIの応答が途中で終了しました。",
  PROVIDER_FAILURE: "AIの処理に失敗しました。",
} as const satisfies Readonly<Record<AiEditErrorCode, string>>);

export type EditPopoverHandle = Readonly<{
  element: () => HTMLDivElement | null;
  focusCloseControl: () => void;
  focusPrimaryControl: () => void;
}>;

type EditPopoverProps = Readonly<{
  writingTool: Exclude<WritingToolId, "dictionary">;
  /** Tools that fit the session target. Fewer than two hides the picker. */
  tools?: readonly (typeof WRITING_TOOLS)[number][];
  onToolChange?: (tool: WritingToolId) => void;
  canSubmit: boolean;
  consent: AiConsent | null;
  modelPreference: AiModelPreference;
  onAccept: () => void;
  onPartialSelectionChange?: (ids: readonly number[] | undefined) => void;
  onCancel: () => void;
  onReturnToEditor?: () => void;
  onConsentChange: (
    providerId: string | null,
  ) => Promise<AiConsentChangeResult>;
  onInputChange: (input: AiEditCommandInput) => void;
  onSelectCandidate: (candidateId: string) => void;
  onSubmit: () => void;
  position: Readonly<{ left: number; top: number; maxHeight?: number; maxWidth?: number; width?: number; dock?: string }>;
  runtime: PublicAiRuntime;
  state: AiEditActiveState;
}>;

function isCompositionEvent(event: ReactKeyboardEvent<HTMLDivElement>) {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

function staleMessage(reason: SelectionStaleReason): string {
  switch (reason) {
    case "document-changed":
    case "target-changed":
      return "本文が変更されたため、この編集コマンドは期限切れです。";
    case "selection-changed":
      return "選択範囲が変更されたため、この編集コマンドは期限切れです。";
    case "context-changed":
      return "AI参照設定が変更されたため、この編集コマンドは期限切れです。";
    case "editor-instance-changed":
    case "workspace-changed":
    case "editor-destroyed":
      return "編集中の原稿が切り替わったため、この編集コマンドは期限切れです。";
    case "editor-read-only":
      return "編集権限が失われたため、この編集コマンドは期限切れです。";
  }
}

function errorMessage(error: AiEditOperationError): string {
  switch (error.kind) {
    case "server":
      return SERVER_ERROR_MESSAGES[error.code];
    case "client-timeout":
      return "応答待ちが制限時間を超えたため停止しました。本文は変更されていません。";
    case "transport":
      return "AI編集サーバーへ接続できませんでした。本文は変更されていません。";
    case "invalid-response":
      return "サーバーの応答を安全に検証できませんでした。";
    case "invalid-input":
      return "編集指示または送信内容を確認してください。";
    case "session-unavailable":
      return "現在の編集状態を確認できませんでした。少し待って再試行してください。";
    case "ai-unavailable":
      return "AI機能は現在利用できません。";
  }
}

export const EditPopover = forwardRef<
  EditPopoverHandle,
  EditPopoverProps
>(function EditPopover(
  {
    canSubmit,
    consent,
    modelPreference,
    onAccept,
    onPartialSelectionChange,
    onCancel,
    onReturnToEditor,
    onConsentChange,
    onInputChange,
    onSelectCandidate,
    onSubmit,
    position,
    runtime,
    state,
    tools = [],
    onToolChange,
    writingTool,
  },
  forwardedRef,
) {
  const compositionRef = useRef(false);
  const [editSettings, setEditSettings] = useState(false);
  const [transformConcept, setTransformConcept] = useState("");
  const [transformStrength, setTransformStrength] = useState<TransformStrength>("標準");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // New candidates start at the top, where the tabs and the diff are.
  useLayoutEffect(() => { if (state.kind === "preview" && bodyRef.current) bodyRef.current.scrollTop = 0; }, [state.kind]);
  const instructionLength = codePointLength(state.input.instruction);
  const inserting = state.snapshot.operation === "insert";
  const completing = isCompletionOperation(state.snapshot.operation);
  const contextualInsert = state.snapshot.operation === "context-insert";
  const title = contextualInsert ? "AI文脈挿入" : completing ? (state.snapshot.operation === "infill" ? "AI中間補完" : "AIの続き執筆") : inserting ? "AI文章挿入" : "AI編集コマンド";
  const tool = WRITING_TOOLS.find((entry) => entry.id === writingTool) ?? WRITING_TOOLS[0];
  const comparing = (state.input.compareProviderIds?.length ?? 0) > 0;
  const usingMemory = hasStoryMemory(authoringReferenceMemory(state.snapshot.authoringProfile, state.input.authoringReference, state.input.useStoryMemory === true ? selectStoryMemory(state.snapshot.storyMemory, state.input.storyMemoryFields) : undefined));
  const comparisonResults = state.kind === "preview" || state.kind === "error" ? state.comparisonResults : undefined;
  const selectedModel = resolveRuntimeModel(runtime, modelPreference);
  const controlsReadOnly =
    state.kind === "generating" ||
    state.kind === "error" ||
    state.kind === "stale";
  const positionStyle: CSSProperties = {
    maxHeight: position.maxHeight, maxWidth: position.maxWidth, width: position.width,
    left: `${position.left}px`,
    top: `${position.top}px`,
  };

  useImperativeHandle(
    forwardedRef,
    () => ({
      element: () => containerRef.current,
      focusCloseControl() {
        closeRef.current?.focus();
      },
      focusPrimaryControl() {
        if (controlsReadOnly) {
          closeRef.current?.focus();
        } else {
          if (state.kind === "preview") {
            setEditSettings(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          } else inputRef.current?.focus();
        }
      },
    }),
    [controlsReadOnly, state.kind],
  );

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (compositionRef.current || isCompositionEvent(event)) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      ((event.target === inputRef.current &&
        state.kind === "command" &&
        canSubmit) ||
        state.kind === "preview")
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (state.kind === "preview") {
        onAccept();
      } else {
        onSubmit();
      }
    }
  }

  function updateInput(next: Partial<AiEditCommandInput>) {
    onInputChange({ ...state.input, ...next });
  }

  function acceptCandidate() {
    if (!compositionRef.current) {
      onAccept();
    }
  }

  function selectPreset(nextPresetId: AiEditPresetId) {
    updateInput({
      instruction: getPresetDefaultInstruction(nextPresetId),
      presetId: nextPresetId,
    });
  }

  return (
    <div
      aria-describedby="ai-command-help"
      aria-labelledby="ai-command-title"
      aria-modal="false"
      className={`${styles.popover}${state.kind === "preview" ? ` ${styles.comparisonPopover}` : ""}`}
      onKeyDown={handleKeyDown}
      onCompositionStartCapture={() => { compositionRef.current = true; }}
      onCompositionEndCapture={() => { compositionRef.current = false; }}
      ref={containerRef}
      role="dialog"
      data-dock={position.dock ?? "floating"}
      data-state={state.kind}
      style={positionStyle}
    >
      <div className={styles.headingRow}>
        <h2 id="ai-command-title">{title}</h2>
        <div className={styles.headingActions}>
        {onReturnToEditor ? <button type="button" className={styles.returnToEditor} onClick={() => {
          if (!compositionRef.current) onReturnToEditor();
        }}>本文へ</button> : null}
        <button
          aria-label={
            state.kind === "stale"
              ? "期限切れのコマンドを閉じる"
              : "AI編集をキャンセル"
          }
          className={styles.closeButton}
          onClick={onCancel}
          ref={closeRef}
          type="button"
        >
          閉じる
        </button>
        </div>
      </div>

      <div className={styles.popoverBody} role="region" aria-label="AI編集の内容" tabIndex={0} ref={bodyRef}>
      {!inserting && !completing && state.kind !== "preview" ? <section className={styles.originalSelection} aria-label="推敲する原文">
        <div><strong>選択した原文</strong><span>{codePointLength(state.snapshot.originalText).toLocaleString("ja-JP")}文字</span></div>
        <p>{state.snapshot.originalText}</p>
      </section> : null}

      {completing ? <p className={styles.reviewHint}>{contextualInsert ? "書きたい内容と前後の文脈に沿った文章を、カーソル位置に挿入します。前後の本文はそのまま残ります。" : state.snapshot.operation === "infill"
        ? "指定した空白だけを補完します。前後の本文はそのまま残ります。"
        : "現在の章の末尾に続きの候補を挿入します。"} 候補と差分を確認して「採用」するまで本文は変わりません。</p> : null}
      {state.kind === "stale" ? (
        <p className={styles.staleMessage} role="status">
          {staleMessage(state.reason)} 選択し直して開いてください。
        </p>
      ) : null}
      {state.kind === "generating" ? (
        <p aria-live="polite" className={styles.generatingMessage} role="status">
          候補を生成しています。本文編集は続けられます。
        </p>
      ) : null}
      {state.kind === "error" ? (
        <>
        <p className={styles.errorMessage} role="alert">
          {errorMessage(state.error)}
        </p>
        {state.error.kind === "server" && state.error.code === "SUBSCRIPTION_LIMIT" ? (
          <p><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPTで利用枠を確認</a>（設定のUsage）</p>
        ) : null}
        </>
      ) : null}
      {state.kind === "preview" ? (
        <CandidatePreview
          onAccept={acceptCandidate}
          onPartialSelectionChange={onPartialSelectionChange}
          onReject={onCancel}
          onRetry={onSubmit}
          onSelectCandidate={onSelectCandidate}
          state={state}
        />
      ) : null}
      {comparisonResults?.filter((result) => !result.success).map((result) => result.success ? null : (
        <p key={result.providerId} role="alert" className={styles.errorMessage}>
          {result.providerId}：{SERVER_ERROR_MESSAGES[result.code]} このAIの候補はありません。
        </p>
      ))}

      {state.kind === "preview" ? <button className={styles.editSettingsButton} type="button" aria-expanded={editSettings} onClick={() => setEditSettings(!editSettings)}>指示・送信設定を変更</button> : null}
      <div className={styles.commandSettings} hidden={state.kind === "preview" && !editSettings}>
      {onToolChange ? <AiToolPicker tools={tools} value={inserting ? "prompt-insert" : writingTool} disabled={state.kind !== "command" && state.kind !== "preview"} onChange={onToolChange} /> : null}
      <p id="ai-tool-description" className={styles.toolDescription}>{inserting ? "入力した指示だけから文章を作ります。本文・前後の文脈は送りません。" : tool.description}</p>
      {!inserting && writingTool === "transform" ? <fieldset className={styles.controlGroup} disabled={controlsReadOnly}>
        <legend>文体変換の条件</legend>
        <label className={styles.field}><span>雰囲気・概念</span>
          <input value={transformConcept} placeholder="例：静かな余韻、幻想的、緊張感"
            onChange={(event) => {
              const concept = event.target.value;
              setTransformConcept(concept);
              updateInput({ instruction: transformInstruction(concept, transformStrength), presetId: "transform" });
            }} />
        </label>
        <label className={styles.field}><span>変換の強さ</span>
          <select value={transformStrength} onChange={(event) => {
            const strength = TRANSFORM_STRENGTHS.find((value) => value === event.target.value);
            if (!strength) return;
            setTransformStrength(strength);
            updateInput({ instruction: transformInstruction(transformConcept, strength), presetId: "transform" });
          }}>{TRANSFORM_STRENGTHS.map((strength) => <option key={strength}>{strength}</option>)}</select>
        </label>
        <p>ここで条件を変えると、下の編集指示を組み直します。送信前に確認・調整できます。</p>
      </fieldset> : null}
      {writingTool === "describe" || writingTool === "guided-write" ? <CreativeControls key={writingTool} tool={writingTool} disabled={controlsReadOnly} onApply={(instruction) => updateInput({ instruction, presetId: null, candidateCount: Math.max(2, state.input.candidateCount) === 3 ? 3 : 2 })} /> : null}
      {completing ? <label className={styles.field}>
        <span id="ai-completion-length-label">目標文字数</span>
        <input type="number" min={1} max={AI_EDIT_LIMITS.replacementCodePoints} step={1}
          aria-labelledby="ai-completion-length-label" aria-describedby="ai-completion-length-help" aria-invalid={!completionCharactersSchema.safeParse(state.input.targetCharacters).success}
          disabled={controlsReadOnly} value={Number.isFinite(state.input.targetCharacters) ? state.input.targetCharacters : ""}
          onChange={(event) => updateInput({ targetCharacters: event.target.valueAsNumber })} />
        <span id="ai-completion-length-help">1〜3,000文字（改行を含む）。目安のため、候補の実際の文字数も確認してください。</span>
      </label> : null}
      <label className={styles.field}>
        <span>{contextualInsert ? "書きたい内容" : inserting ? "文章のプロンプト" : "編集の指示"}</span>
        <textarea
          aria-describedby="ai-command-help ai-instruction-count"
          disabled={controlsReadOnly}
          onChange={(event) =>
            updateInput({ instruction: event.target.value, presetId: inserting ? null : writingToolPreset(writingTool) })
          }
          onCompositionEnd={() => {
            compositionRef.current = false;
          }}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          ref={inputRef}
          placeholder={contextualInsert ? "例：主人公が返事をためらう仕草を、前後につながるように描いて" : completing ? "例：雨の音を描写し、静かな場面につなぐ" : inserting ? "挿入したい文章の内容を入力" : "例：語尾の重複を減らし、静かな余韻を残したい"}
          rows={2}
          value={state.input.instruction}
        />
      </label>
      <div className={styles.inputMeta}>
        <p id="ai-command-help">入力内容は生成時までこの画面だけに保持されます。</p>
        <output
          className={
            instructionLength > AI_EDIT_LIMITS.instructionCodePoints
              ? styles.invalidCount
              : undefined
          }
          id="ai-instruction-count"
        >
          {instructionLength} / {AI_EDIT_LIMITS.instructionCodePoints}文字
        </output>
      </div>
      {instructionLength > AI_EDIT_LIMITS.instructionCodePoints ? (
        <p className={styles.validationMessage} role="alert">
          指示を{AI_EDIT_LIMITS.instructionCodePoints}文字以内にしてください。
        </p>
      ) : null}

      {!inserting && writingTool === "rewrite" ? <fieldset className={styles.controlGroup} disabled={controlsReadOnly}>
        <legend>プリセット</legend>
        <div className={styles.presetGrid}>
          {REWRITE_PRESETS.map((id) => (
            <button
              aria-pressed={state.input.presetId === id}
              key={id}
              onClick={() => selectPreset(id)}
              type="button"
            >
              {PRESET_LABELS[id]}
            </button>
          ))}
        </div>
        <div className={styles.quickInstructions}>
          {JAPANESE_REFINEMENTS.map(({ label, instruction }) => <button type="button" key={label}
            title={instruction} onClick={() => updateInput({ instruction, presetId: null })}>{label}</button>)}
        </div>
      </fieldset> : null}

      <fieldset className={styles.controlGroup} disabled={controlsReadOnly}>
        <legend>候補数</legend>
        <div className={styles.radioRow}>
          {(writingTool === "describe" || writingTool === "guided-write" ? AI_EDIT_CANDIDATE_COUNTS : inserting || completing ? AI_INSERT_CANDIDATE_COUNTS : AI_EDIT_CANDIDATE_COUNTS).map((count) => (
            <label key={count}>
              <input
                checked={state.input.candidateCount === count}
                name="ai-candidate-count"
                onChange={() => updateInput({ candidateCount: count })}
                type="radio"
                value={count}
              />
              {count}案
            </label>
          ))}
        </div>
      </fieldset>

      {state.snapshot.authoringProfile?.presets.length ? <label className={styles.field}>保存した推敲プリセット
        <select value="" disabled={controlsReadOnly} onChange={(event) => {
          const preset = state.snapshot.authoringProfile?.presets.find((item) => item.id === event.target.value);
          if (preset) updateInput({ instruction: preset.instruction, presetId: null });
        }}><option value="">指示欄へ読み込む…</option>{state.snapshot.authoringProfile.presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select>
      </label> : null}
      <AuthoringReferenceControls state={state} disabled={controlsReadOnly} onChange={onInputChange} />
      <StoryMemoryControls state={state} disabled={controlsReadOnly} onChange={onInputChange} />
      <ComparisonControls runtime={runtime} input={state.input} disabled={controlsReadOnly} onChange={onInputChange} />

      {runtime.externalDataTransfer && !comparing ? (
        <AiConsentDisclosure
          promptOnly={inserting}
          storyMemoryIncluded={usingMemory}
          commonPromptIncluded={!inserting && state.snapshot.commonPrompt.length > 0}
          consent={consent}
          disabled={controlsReadOnly}
          manualStyleIncluded={!inserting && state.snapshot.manualStyle.length > 0}
          modelPreference={modelPreference}
          onChange={onConsentChange}
          runtime={runtime}
        />
      ) : null}

      <details className={styles.contextDetails}>
        <summary>送信予定の文脈を確認</summary>
        {inserting ? <p>{usingMemory ? "入力したプロンプトと、参照をONにした作品メモリを送信します。" : "入力したプロンプトだけを送信します。"}本文・前後の文脈・作品共通プロンプト・手動文体設定は送りません。挿入位置の座標も送りません。候補は各3,000文字以内です。</p> : <dl>
          <div>
            <dt>選択範囲</dt>
            <dd>{codePointLength(state.snapshot.originalText)}文字</dd>
          </div>
          <div>
            <dt>直前の本文</dt>
            <dd>
              最大{AI_EDIT_LIMITS.beforeTextCodePoints.toLocaleString("ja-JP")}
              文字
            </dd>
          </div>
          <div>
            <dt>直後の本文</dt>
            <dd>
              最大{AI_EDIT_LIMITS.afterTextCodePoints.toLocaleString("ja-JP")}
              文字
            </dd>
          </div>
          <div>
            <dt>作品共通プロンプト</dt>
            <dd>{state.snapshot.commonPrompt.length === 0 ? "なし" : "あり"}</dd>
          </div>
          <div>
            <dt>手動文体設定</dt>
            <dd>{state.snapshot.manualStyle.length === 0 ? "なし" : "あり"}</dd>
          </div>
          <div>
            <dt>編集指示</dt>
            <dd>生成時に送信</dd>
          </div>
          <div>
            <dt>実行環境</dt>
            <dd>
              {!runtime.available
                ? "AIは現在無効"
                : runtime.providerId === "mock"
                  ? "ローカルデモ（外部送信なし）"
                  : runtime.externalDataTransfer
                    ? "外部送信あり"
                    : "外部送信なし"}
            </dd>
          </div>
          <div>
            <dt>provider / model</dt>
            <dd>
              {runtime.providerId ?? "未設定"} / {selectedModel?.id ?? "利用不可"}
            </dd>
          </div>
        </dl>}
      </details>

      </div>
      </div>
      <div className={styles.actionRow} hidden={state.kind === "preview"}>
        <button onClick={onCancel} type="button">
          キャンセル
        </button>
        {state.kind === "command" && !canSubmit && state.input.instruction.trim() === "" ? (
          <p className={styles.submitHint} id="ai-submit-hint">{!inserting && writingTool === "rewrite" ? "指示を入力するか、プリセットを選ぶと生成できます。" : "指示を入力すると生成できます。"}</p>
        ) : null}
        {state.kind === "command" ? (
          <button className={styles.primaryButton} disabled={!canSubmit} onClick={onSubmit} type="button"
            aria-describedby={!canSubmit && state.input.instruction.trim() === "" ? "ai-submit-hint" : undefined}>
            {comparing ? `${state.input.compareProviderIds?.length ?? 0}個のAIへ同時送信` : "生成"}
          </button>
        ) : null}
        {state.kind === "generating" ? (
          <button disabled type="button">
            生成中…
          </button>
        ) : null}
        {state.kind === "error" && state.error.retryable ? (
          <button className={styles.primaryButton} disabled={!canSubmit} onClick={onSubmit} type="button">
            再試行
          </button>
        ) : null}
      </div>
    </div>
  );
});
