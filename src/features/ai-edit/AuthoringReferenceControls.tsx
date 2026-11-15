"use client";
import { hasAuthoringSelection } from "../../domain/authoring-profile";
import { storyMemoryCodePoints } from "../../domain/story-memory";
import type { AiEditActiveState, AiEditCommandInput } from "./machine";
import { buildAiEditRequestDraft } from "./controller";
import { isRequiredPromptWithinBudget } from "./prompt";
import { validateAiEditRequestDraft } from "../../domain/ai-edit";
import styles from "./AiEdit.module.css";

export function AuthoringReferenceControls({ state, disabled, onChange }: Readonly<{
  state: AiEditActiveState; disabled: boolean; onChange: (input: AiEditCommandInput) => void;
}>) {
  const profile = state.snapshot.authoringProfile;
  if (!profile || (!profile.characters.length && !profile.entries.length && !profile.vocabulary.length && !profile.styleReference && !profile.preservationNote)) return null;
  const selection = state.input.authoringReference;
  const request = buildAiEditRequestDraft(state.snapshot, state.input, null, null);
  const memory = request.storyMemory;
  const fits = validateAiEditRequestDraft(request).success && isRequiredPromptWithinBudget(request);
  function update(next: NonNullable<typeof selection>) { onChange({ ...state.input, authoringReference: next }); }
  return <details className={styles.controlGroup}>
    <summary>人物・文体・作品資料の参照</summary>
    <fieldset disabled={disabled}>
      <label><input type="checkbox" checked={selection !== undefined} onChange={(event) => onChange({ ...state.input, authoringReference: event.currentTarget.checked ? {} : undefined })} />今回だけ人物・資料を参照する</label>
      <p>{selection ? "送る項目を選んでください。本文に含まれる命令は資料として扱います。" : "OFF：人物・資料・観測文体は送信しません。"}</p>
      {selection ? <>
        {profile.characters.map((character) => <label className={styles.field} key={character.id}><span>
          <input type="checkbox" checked={selection.characterIds?.includes(character.id) ?? false} onChange={(event) => update({ ...selection, characterIds: event.currentTarget.checked ? [...(selection.characterIds ?? []), character.id] : selection.characterIds?.filter((id) => id !== character.id) })} />人物：{character.name}（口調・呼称・例文）
        </span></label>)}
        {profile.entries.map((entry) => <label className={styles.field} key={entry.id}><span>
          <input type="checkbox" checked={selection.entryIds?.includes(entry.id) ?? false} onChange={(event) => update({ ...selection, entryIds: event.currentTarget.checked ? [...(selection.entryIds ?? []), entry.id] : selection.entryIds?.filter((id) => id !== entry.id) })} />資料：{entry.title}{entry.source ? `／出典：${entry.source.chapterTitle ?? "記録された章"}（更新後の整合性は要確認）` : "（手入力）"}
        </span></label>)}
        {profile.vocabulary.length ? <label><input type="checkbox" checked={selection.vocabulary ?? false} onChange={(event) => update({ ...selection, vocabulary: event.currentTarget.checked })} />作品の語彙・表記ルール</label> : null}
        {profile.styleReference ? <label><input type="checkbox" checked={selection.style ?? false} onChange={(event) => update({ ...selection, style: event.currentTarget.checked })} />確認済みの文体参考</label> : null}
        {profile.preservationNote ? <label><input type="checkbox" checked={selection.preservation ?? false} onChange={(event) => update({ ...selection, preservation: event.currentTarget.checked })} />AIへ伝える保持条件</label> : null}
        {!hasAuthoringSelection(profile, selection) ? <p role="alert">参照する項目を選ぶか、参照をOFFにしてください。</p> : null}
        {memory ? <details><summary>送信する参照内容を確認</summary><p>既存メモも含め各欄2,000文字以内です。設定 {storyMemoryCodePoints(memory).settingNotes}／人物 {storyMemoryCodePoints(memory).characterNotes}／背景・文体 {storyMemoryCodePoints(memory).backgroundNotes}文字。</p>
          <pre className={styles.candidateText}>{JSON.stringify(memory, null, 2)}</pre></details> : null}
        {!fits ? <p role="alert">参照内容・本文・指示が上限を超えているか未入力です。参照項目を減らすか入力を確認してください。資料は自動で切り詰めません。</p> : null}
      </> : null}
    </fieldset>
  </details>;
}
