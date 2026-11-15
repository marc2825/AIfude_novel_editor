"use client";

import { useId, useState } from "react";

import type {
  AiConsent,
  AiModelPreference,
} from "../../domain/workspace";
import {
  hasMatchingAiConsent,
  resolveRuntimeModel,
  type PublicAiRuntime,
} from "./consent";
import styles from "./AiEdit.module.css";
import { findAiProviderDefinition, isPaidApiProvider } from "../../domain/ai-models";

export type AiConsentChangeResult = Readonly<{
  message?: string;
  ok: boolean;
}>;

type AiConsentDisclosureProps = Readonly<{
  feedbackTextOnly?: boolean;
  dictionaryQueryOnly?: boolean;
  storyMemoryIncluded?: boolean;
  promptOnly?: boolean;
  allowRevoke?: boolean;
  commonPromptIncluded: boolean;
  consent: AiConsent | null;
  disabled?: boolean;
  manualStyleIncluded: boolean;
  modelPreference: AiModelPreference;
  onChange: (providerId: string | null) => Promise<AiConsentChangeResult>;
  runtime: PublicAiRuntime;
}>;

function providerName(providerId: string | null): string {
  if (providerId === "chatgpt") return "ChatGPT（OpenAI）";
  return providerId === "openai" ? "OpenAI" : (findAiProviderDefinition(providerId ?? "")?.displayName ?? "未設定");
}

export function AiConsentDisclosure({
  feedbackTextOnly = false,
  dictionaryQueryOnly = false,
  storyMemoryIncluded = false,
  promptOnly = false,
  allowRevoke = false,
  commonPromptIncluded,
  consent,
  disabled = false,
  manualStyleIncluded,
  modelPreference,
  onChange,
  runtime,
}: AiConsentDisclosureProps) {
  const checkboxId = useId();
  const headingId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const consentGranted = hasMatchingAiConsent(runtime, consent);
  const selectedModel = resolveRuntimeModel(runtime, modelPreference);
  const modelLabel =
    selectedModel === null
      ? `利用不可（${modelPreference}）`
      : `${selectedModel.displayName}（${selectedModel.id}）`;

  async function changeConsent(providerId: string | null) {
    setError(null);
    setMessage(null);
    setSubmitting(true);

    try {
      const result = await onChange(providerId);

      if (result.ok) {
        setMessage(
          providerId === null
            ? "外部送信への同意を撤回しました。"
            : "外部送信への同意を保存しました。新しいAI編集から有効です。",
        );
      } else {
        setError(result.message ?? "AI送信同意を変更できませんでした。");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const feedback = (
    <>
      {message === null ? null : (
        <p className={styles.consentGranted} role="status">
          {message}
        </p>
      )}
      {error === null ? null : (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      )}
    </>
  );

  if (!runtime.available) {
    return (
      <section aria-labelledby={headingId} className={styles.consentPanel}>
        <h3 id={headingId}>AI送信と同意</h3>
        <p>AIは現在無効です。外部送信は行われません。</p>
        <p>
          既存の外部送信同意：
          {consent === null
            ? "なし"
            : `${providerName(consent.providerId)}（現在は使用しません）`}
        </p>
        {allowRevoke && consent !== null ? (
          <button
            disabled={disabled || submitting}
            onClick={() => void changeConsent(null)}
            type="button"
          >
            同意を撤回
          </button>
        ) : null}
        {feedback}
      </section>
    );
  }

  if (!runtime.externalDataTransfer) {
    return (
      <section aria-labelledby={headingId} className={styles.consentPanel}>
        <h3 id={headingId}>AI送信と同意</h3>
        <dl className={styles.runtimeDetails}>
          <div>
            <dt>実行環境</dt>
            <dd>
              {runtime.providerId === "mock"
                ? "ローカルデモ（外部送信なし）"
                : "ローカルLLM（このPCへ送信）"}
            </dd>
          </div>
          <div>
            <dt>モデル</dt>
            <dd>{modelLabel}</dd>
          </div>
        </dl>
        <p>外部送信同意は不要です。</p>
        {runtime.providerId === "local" ? (
          <p>
            このPCの推論サーバーへ送信します。ローカルモデルを使用してください。
            推論サーバー側の転送・ログ・保存設定は、そのサーバーで管理されます。
          </p>
        ) : null}
        <p>
          既存の外部送信同意：
          {consent === null
            ? "なし"
            : `${providerName(consent.providerId)}（現在のローカル送信には使用しません）`}
        </p>
        {allowRevoke && consent !== null ? (
          <button
            disabled={disabled || submitting}
            onClick={() => void changeConsent(null)}
            type="button"
          >
            同意を撤回
          </button>
        ) : null}
        {feedback}
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className={styles.consentPanel}>
      <h3 id={headingId}>{runtime.providerId === "chatgpt" ? "ChatGPTサブスク" : providerName(runtime.providerId)}への外部送信</h3>
      {isPaidApiProvider(runtime.providerId) ? <p>{runtime.paidApiEnabled === true ? "API接続は有効です。サブスクとは別の料金体系で使用します。" : "API接続はOFFです。利用する場合は設定で有効にしてください。"}</p> : null}
      {runtime.providerId === "chatgpt" ? <p>
        {runtime.connectionId ? "ChatGPTのサブスク利用枠を使います。" : "設定とバックアップからChatGPTへ接続してください。"}
        {" "}<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPTで利用枠を確認</a>。自動切替は行いません。
      </p> : null}
      <dl className={styles.runtimeDetails}>
        <div>
          <dt>送信先</dt>
          <dd>{providerName(runtime.providerId)}</dd>
        </div>
        <div>
          <dt>モデル</dt>
          <dd>{modelLabel}</dd>
        </div>
        <div>
          <dt>同意状態</dt>
          <dd>{consentGranted ? "同意済み" : "未同意"}</dd>
        </div>
      </dl>

      <details className={styles.disclosureDetails}>
        <summary>外部へ送るデータの種類を確認</summary>
        <ul>
          {feedbackTextOnly ? <li>確認した章全体または選択範囲とFeedback用の指示だけ（作品設定・メモ・他章は送信しません）</li> : dictionaryQueryOnly ? <li>選択した語句と辞書用の指示だけ（前後本文・作品設定・メモは送信しません）</li> : promptOnly ? <li>{storyMemoryIncluded ? "入力した文章のプロンプトと、参照をONにした作品メモリ" : "入力した文章のプロンプトだけ（本文・前後文脈・作品設定は送信しません）"}</li> : <>
          <li>選択した原稿本文</li>
          <li>選択範囲の直前・直後の本文（それぞれ最大1,000文字）</li>
          <li>AI編集の指示</li>
          <li>
            作品共通プロンプト：
            {commonPromptIncluded ? "入力済みのため送信" : "空のため送信しない"}
          </li>
          <li>
            手動文体設定：
            {manualStyleIncluded ? "入力済みのため送信" : "空のため送信しない"}
          </li>
          </>}
          {!promptOnly && storyMemoryIncluded ? <li>参照をONにした作品メモリ（設定・背景・登場人物）</li> : null}
        </ul>
        <p>
          {feedbackTextOnly ? "確認した範囲だけを送り、ProseMirrorの位置情報は送りません。" : "原稿全文やProseMirrorの位置情報は送りません。"}APIキーはブラウザーへ渡さず、
          本文payloadにも含めません。
        </p>
      </details>

      <div className={styles.retentionNotice}>
        {runtime.providerId === "openai" || runtime.providerId === "chatgpt" ? <><p>
          このアプリはResponses APIで応答を後から取得するための保存を無効にする
          <code>store: false</code>を指定します。
        </p>
        <p>
          {runtime.providerId === "chatgpt"
            ? "これはOpenAI側のあらゆるデータ保持が行われないことを意味しません。ChatGPTの契約、アカウント設定、データ取扱いが別途適用されます。"
            : "これはOpenAI側のあらゆるデータ保持が行われないことを意味しません。契約、アカウント設定、OpenAIのデータ保持方針が別途適用されます。"}
        </p>
        <a
          href={runtime.providerId === "chatgpt" ? "https://learn.chatgpt.com/docs/sign-in-with-chatgpt" : "https://developers.openai.com/api/docs/guides/your-data"}
          rel="noreferrer"
          target="_blank"
        >
          {runtime.providerId === "chatgpt" ? "ChatGPT連携と利用枠の説明を確認" : "OpenAI APIのデータ取扱いを確認"}
        </a>
        </> : <p>送信先の契約・利用枠・データ取扱いが適用されます。外部サービス側のデータ保持がなくなることを保証するものではありません。</p>}
      </div>

      {consentGranted ? (
        allowRevoke ? (
          <button
            disabled={disabled || submitting}
            onClick={() => void changeConsent(null)}
            type="button"
          >
            同意を撤回
          </button>
        ) : (
          <p className={styles.consentGranted}>外部送信に同意済みです。</p>
        )
      ) : (
        <>
          <label className={styles.consentCheckbox} htmlFor={checkboxId}>
            <input
              checked={confirmed}
              disabled={disabled || submitting}
              id={checkboxId}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            上記のデータが{runtime.providerId === "chatgpt" ? "OpenAI" : providerName(runtime.providerId)}へ送信されることに同意します
          </label>
          <button
            disabled={
              disabled ||
              submitting ||
              !confirmed ||
              runtime.providerId === null
            }
            onClick={() => void changeConsent(runtime.providerId)}
            type="button"
          >
            同意を保存
          </button>
        </>
      )}

      {feedback}
    </section>
  );
}
