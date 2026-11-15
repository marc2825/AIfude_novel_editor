"use client";
import { useState } from "react";
import { DESCRIPTION_FOCUSES, creativeInstruction, type DescriptionFocus } from "./writing-tools";
import styles from "./AiEdit.module.css";

export function CreativeControls({ tool, disabled, onApply }: Readonly<{ tool: "describe" | "guided-write"; disabled: boolean; onApply: (instruction: string) => void }>) {
  const [brief, setBrief] = useState(""); const [focuses, setFocuses] = useState<DescriptionFocus[]>(["視覚"]);
  const [allowNewFacts, setAllowNewFacts] = useState(false);
  const instruction = creativeInstruction(tool, brief, focuses, allowNewFacts);
  return <fieldset className={styles.controlGroup} disabled={disabled}>
    <legend>{tool === "describe" ? "Describeの条件" : "Guided Writeの条件"}</legend>
    <label className={styles.field}>{tool === "describe" ? "描きたい対象・場面" : "次に起こしたいこと"}<textarea maxLength={300} rows={2} value={brief} onChange={(event) => setBrief(event.target.value)} /></label>
    {tool === "describe" ? <div className={styles.radioGroup}>{DESCRIPTION_FOCUSES.map((focus) => <label key={focus}><input type="checkbox" checked={focuses.includes(focus)} onChange={(event) => setFocuses(event.target.checked ? [...focuses, focus] : focuses.filter((value) => value !== focus))} />{focus}</label>)}</div> : null}
    <label><input type="checkbox" checked={allowNewFacts} onChange={(event) => setAllowNewFacts(event.target.checked)} />指定した場面に必要な追加事実の創作を許可する</label>
    <p>初期状態では追加事実を許可しません。AIへの指示であり、遵守は候補を読んで確認してください。</p>
    <button type="button" disabled={disabled || !instruction} onClick={() => onApply(instruction)}>条件を編集指示へ反映</button>
    <p>反映後の指示と下の目標文字数を確認し、生成を押してください。本文への挿入には採用が必要です。</p>
  </fieldset>;
}
