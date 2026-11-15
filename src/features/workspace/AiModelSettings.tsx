"use client";

import { useId, useState, type FormEvent } from "react";

import {
  AI_MODEL_PREFERENCE_AUTOMATIC,
  findAiProviderDefinition,
} from "../../domain/ai-models";
import type { AiModelPreference } from "../../domain/workspace";
import {
  resolveRuntimeModel,
  type PublicAiRuntime,
} from "../ai-edit/consent";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "./Workspace.module.css";

type AiModelSettingsProps = Readonly<{
  disabled: boolean;
  onChange: (
    preference: AiModelPreference,
  ) => Promise<WorkspaceActionResult>;
  preference: AiModelPreference;
  runtime: PublicAiRuntime;
}>;

export function AiModelSettings({
  disabled,
  onChange,
  preference,
  runtime,
}: AiModelSettingsProps) {
  const descriptionId = useId();
  const [draft, setDraft] = useState(preference);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectableModels = runtime.models.filter((model) => model.selectable);
  const defaultModel = runtime.models.find(
    (model) => model.id === runtime.defaultModelId,
  );
  const selectedModel = resolveRuntimeModel(runtime, preference);
  const draftIsAvailable =
    draft === AI_MODEL_PREFERENCE_AUTOMATIC
      ? runtime.available && defaultModel !== undefined
      : selectableModels.some((model) => model.id === draft);
  const savedPreferenceUnavailable =
    preference !== AI_MODEL_PREFERENCE_AUTOMATIC && selectedModel === null;

  async function saveModelPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!draftIsAvailable) {
      setError("利用可能なモデルを選択してください。");
      return;
    }

    setSubmitting(true);

    try {
      const result = await onChange(draft);

      if (result.ok) {
        setMessage("AIモデル設定を保存しました。新しいAI編集から有効です。");
      } else {
        setError(result.message ?? "AIモデル設定を保存できませんでした。");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="ai-model-settings-title" className={styles.modelSettings}>
      <h2 id="ai-model-settings-title">AIモデル</h2>
      <p id={descriptionId}>
        {runtime.providerId === "chatgpt"
          ? "サブスクで使うモデルはサーバー設定で指定します。「自動（サーバー既定）」を選択してください。生成前にアカウントの利用可能モデルを確認します。"
          : runtime.providerId === "local"
          ? "ローカルモデルはサーバー設定で指定します。「自動（サーバー既定）」でそのモデルを使用します。変更後はアプリのサーバーを再起動してください。"
          : "モデルは作品ごとに保存されます。文章品質の順位ではなく、providerが示す用途と能力を表示しています。"}
      </p>
      <form onSubmit={saveModelPreference}>
        <label>
          使用モデル
          <select
            aria-describedby={descriptionId}
            disabled={disabled || submitting}
            onChange={(event) => setDraft(event.currentTarget.value)}
            value={draft}
          >
            <option value={AI_MODEL_PREFERENCE_AUTOMATIC}>
              自動（サーバー既定
              {defaultModel === undefined
                ? "：利用不可"
                : `：${defaultModel.displayName}`}
              ）
            </option>
            {savedPreferenceUnavailable ? (
              <option disabled value={preference}>
                利用不可：{preference}
              </option>
            ) : null}
            {selectableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || submitting || !draftIsAvailable}
          type="submit"
        >
          モデル設定を保存
        </button>
      </form>

      {savedPreferenceUnavailable ? (
        <p className={styles.error} role="alert">
          保存済みモデル「{preference}」は現在利用できません。別のモデルまたは自動を選択してください。
        </p>
      ) : null}

      {runtime.available ? (
        <p>
          現在のprovider：
          {findAiProviderDefinition(runtime.providerId ?? "")?.displayName ??
            runtime.providerId}
          {runtime.providerId === "local" || runtime.providerId === "chatgpt"
            ? "。接続先でのモデルの利用可否は生成時に確認されます。"
            : "。アカウントでの利用可否は生成時に確認されます。"}
        </p>
      ) : (
        <p>AIは現在無効です。自動の既定モデルを解決できません。</p>
      )}

      {selectableModels.length === 0 ? null : (
        <ul className={styles.modelList}>
          {selectableModels.map((model) => (
            <li key={model.id}>
              <strong>{model.displayName}</strong> <code>{model.id}</code>
              <p>{model.description}</p>
              <p>
                Responses API、text入出力、Structured Outputs対応。context
                {"limits" in model
                  ? ` ${model.limits.contextWindowTokens.toLocaleString("ja-JP")} token、最大出力 ${model.limits.maxOutputTokens.toLocaleString("ja-JP")} token。`
                  : "情報なし。"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {message === null ? null : (
        <p className={styles.actionMessage} role="status">
          {message}
        </p>
      )}
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
