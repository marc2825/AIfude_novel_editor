"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { STORY_MEMORY_FIELDS, STORY_MEMORY_FIELD_LIMIT, storyMemoriesEqual, storyMemorySchema, type StoryMemory } from "../../domain/story-memory";
import { codePointLength } from "../../domain/limits";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "./Workspace.module.css";
import { HelpHeading } from "../ui/HelpTip";

export type StoryMemoryPanelHandle = Readonly<{ save: () => Promise<WorkspaceActionResult> }>;

export const StoryMemoryPanel = forwardRef<StoryMemoryPanelHandle, Readonly<{
  embedded?: boolean;
  memory: StoryMemory;
  disabled: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (memory: StoryMemory) => Promise<WorkspaceActionResult>;
}>>(function StoryMemoryPanel({ embedded = false, memory, disabled, onDirtyChange, onSave }, ref) {
  const [draft, setDraft] = useState(memory);
  const [savedDraft, setSavedDraft] = useState(memory);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = !storyMemoriesEqual(draft, savedDraft);

  async function save(): Promise<WorkspaceActionResult> {
    if (disabled || savingRef.current) return { ok: false, message: "現在はメモリを保存できません。" };
    setError(null); setMessage(null);
    const parsed = storyMemorySchema.safeParse(draft);
    if (!parsed.success) {
      const message = "各メモは2,000文字以内で、不正なUnicodeを含めずに入力してください。";
      setError(message);
      return { ok: false, message };
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await onSave(parsed.data);
      if (result.ok) {
        setSavedDraft(parsed.data);
        onDirtyChange?.(false);
        setMessage("作品メモリを保存しました。");
      }
      else setError(result.message ?? "メモリを保存できませんでした。入力内容はこの画面に保持しています。");
      return result;
    } catch {
      const message = "メモリを保存できませんでした。入力内容はこの画面に保持しています。";
      setError(message);
      return { ok: false, message };
    } finally { savingRef.current = false; setSaving(false); }
  }
  useImperativeHandle(ref, () => ({ save }));
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(); }

  return <details className={styles.settings} open={embedded || undefined}>
    <summary hidden={embedded}>作品メモリ（設定・背景・登場人物）</summary>
    <div className={styles.settingsContent}>
      <HelpHeading level={3} label="作品メモ" help={<>AIが自動で書き換えることはありません。AIへの参照は毎回初期OFFで、ONにすると選んだ項目の保存済みメモが送信先のAIへ渡ります。JSONバックアップにも含まれます。</>}>作品メモ</HelpHeading>
      <p>保存したメモだけをAI生成画面で参照できます。</p>
      {dirty ? <p role="status">保存していない作品メモリがあります。</p> : null}
      <form className={styles.settingsForm} onSubmit={submit}>
        {STORY_MEMORY_FIELDS.map(({ key, label }) => <label key={key}>
          {label}
          <textarea rows={4} disabled={disabled || saving} value={draft[key]} onChange={(event) => {
            const next = { ...draft, [key]: event.currentTarget.value };
            setDraft(next); onDirtyChange?.(!storyMemoriesEqual(next, savedDraft)); setMessage(null);
          }} />
          <span>{codePointLength(draft[key]).toLocaleString("ja-JP")} / {STORY_MEMORY_FIELD_LIMIT.toLocaleString("ja-JP")}文字</span>
        </label>)}
        <button type="submit" disabled={disabled || saving}>{saving ? "メモリ保存中…" : "メモリを保存"}</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  </details>;
});
