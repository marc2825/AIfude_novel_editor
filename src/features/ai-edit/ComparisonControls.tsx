"use client";
import { findAiProviderDefinition, isPaidApiProvider } from "../../domain/ai-models";
import { MAX_COMPARISON_PROVIDERS } from "../../domain/ai-comparison";
import type { PublicAiRuntime } from "./consent";
import type { AiEditCommandInput } from "./machine";
import styles from "./AiEdit.module.css";

export function ComparisonControls({ runtime, input, disabled, onChange }: Readonly<{
  runtime: PublicAiRuntime; input: AiEditCommandInput; disabled: boolean; onChange: (input: AiEditCommandInput) => void;
}>) {
  const providers = runtime.comparisonProviders ?? [];
  const selected = input.compareProviderIds ?? [];
  if (providers.length < 2) return null;
  return <fieldset className={styles.controlGroup} disabled={disabled}>
    <legend>複数AIへ同時送信して比較</legend>
    <p>比較したいAIを2〜{MAX_COMPARISON_PROVIDERS}個選んでください。同じ指示と送信内容を選んだAIだけへ同時に送ります。各AIの利用枠を消費します。</p>
    {providers.map((provider) => {
      const id = provider.providerId;
      if (id === null) return null;
      const checked = selected.includes(id);
      const model = provider.models.find((model) => model.id === provider.defaultModelId);
      return <label className={styles.field} key={id}>
        <span><input type="checkbox" checked={checked} disabled={!checked && (selected.length >= MAX_COMPARISON_PROVIDERS || !provider.available || (isPaidApiProvider(id) && runtime.paidApiEnabled !== true) || (id === "chatgpt" && !provider.connectionId))}
          onChange={() => onChange({ ...input, compareProviderIds: checked ? selected.filter((value) => value !== id) : [...selected, id], compareConsent: false })} />
          {findAiProviderDefinition(id)?.displayName ?? id}：{model?.displayName ?? "利用不可"}{isPaidApiProvider(id) ? runtime.paidApiEnabled === true ? "（API別料金）" : "（API接続OFF）" : ""}
          {id === "chatgpt" && !provider.connectionId ? "（設定画面で接続してください）" : ""}</span>
      </label>;
    })}
    {selected.length > 0 ? <label className={styles.field}><span>
      <input checked={input.compareConsent === true} type="checkbox" onChange={(event) => onChange({ ...input, compareConsent: event.currentTarget.checked })} />
      選択したAIすべてへの送信と各利用枠の消費に同意します
    </span></label> : null}
    <p>他のAIへの自動切替はしません。選択をすべて外すと、通常の1つのAIで生成します。</p>
  </fieldset>;
}
