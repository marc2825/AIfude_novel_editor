"use client";

import { hasStoryMemory, selectStoryMemory, STORY_MEMORY_FIELDS, storyMemoryCodePoints, type StoryMemoryField } from "../../domain/story-memory";
import { buildAiEditRequestDraft } from "./controller";
import { isRequiredPromptWithinBudget } from "./prompt";
import type { AiEditActiveState, AiEditCommandInput } from "./machine";
import styles from "./AiEdit.module.css";

export function StoryMemoryControls({ state, disabled, onChange }: Readonly<{
  state: AiEditActiveState;
  disabled: boolean;
  onChange: (input: AiEditCommandInput) => void;
}>) {
  const memory = state.snapshot.storyMemory;
  const available = hasStoryMemory(memory);
  const selected = state.input.useStoryMemory === true && available;
  const fields = state.input.storyMemoryFields ?? STORY_MEMORY_FIELDS.map(({ key }) => key);
  const selectedMemory = selectStoryMemory(memory, fields);
  const draft = buildAiEditRequestDraft(state.snapshot, state.input, null, null);
  const fits = isRequiredPromptWithinBudget(draft);
  const counts = selectedMemory ? storyMemoryCodePoints(selectedMemory) : null;
  function toggleField(field: StoryMemoryField, checked: boolean) {
    const nextFields = STORY_MEMORY_FIELDS.map(({ key }) => key).filter((key) => key === field ? checked : fields.includes(key));
    onChange({ ...state.input, storyMemoryFields: nextFields });
  }
  return <fieldset className={styles.controlGroup} disabled={disabled}>
    <legend>作品メモリの参照</legend>
    <label className={styles.field}><span>
      <input type="checkbox" checked={selected} disabled={!available} onChange={(event) => onChange({ ...state.input, useStoryMemory: event.currentTarget.checked })} />
      保存済み作品メモリを参照する
    </span></label>
    <p>{available ? selected ? "ON：選択した項目の保存済みメモを、選んだAIへ送信します。" : "OFF：作品メモリは送信しません。" : "作品メモリ欄でメモを入力・保存すると参照できます。"}</p>
    {selected && memory ? <div aria-label="参照するメモの項目">
      {STORY_MEMORY_FIELDS.map(({ key, label }) => <label className={styles.field} key={key}><span>
        <input type="checkbox" checked={fields.includes(key) && memory[key].length > 0} disabled={memory[key].length === 0}
          onChange={(event) => toggleField(key, event.currentTarget.checked)} />{label}を参照
      </span></label>)}
    </div> : null}
    {selected && !selectedMemory ? <p role="alert">参照するメモを1つ以上選ぶか、作品メモリの参照をOFFにしてください。</p> : null}
    {selected && selectedMemory && counts ? <details>
      <summary>送信するメモを確認</summary>
      <dl>{STORY_MEMORY_FIELDS.filter(({ key }) => fields.includes(key) && selectedMemory[key].length > 0).map(({ key, label }) => <div key={key}>
        <dt>{label}（{counts[key].toLocaleString("ja-JP")}文字）</dt>
        <dd className={styles.candidateText}>{selectedMemory[key]}</dd>
      </div>)}</dl>
    </details> : null}
    {!fits ? <p role="alert" className={styles.errorMessage}>メモリ・本文・指示の合計が入力予算を超えています。参照する項目を減らす、メモリを短く保存する、または参照をOFFにしてください。メモリを黙って切り詰めることはありません。</p> : null}
  </fieldset>;
}
