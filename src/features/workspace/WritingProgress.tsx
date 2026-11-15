"use client";
import { countDocumentCharacters } from "../../domain/chapters";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import { useState } from "react";
import type { WorkspaceActionResult } from "./use-workspace";

export function WritingProgress({ workspace, activeCount, disabled, onSave }: Readonly<{
  workspace: WorkspaceSnapshot; activeCount: number; disabled: boolean;
  onSave: (goal: number, autoHistory: boolean) => Promise<WorkspaceActionResult>;
}>) {
  const [feedback, setFeedback] = useState(""); const [busy, setBusy] = useState(false);
  const total = activeCount + workspace.additionalChapters.reduce((sum, chapter) => sum + countDocumentCharacters(chapter.body), 0);
  const goal = workspace.project.writingGoal;
  async function changeGoal() {
    const value = window.prompt("作品の目標文字数（0で無効、最大10,000,000）", String(goal));
    if (value === null) return;
    if (!/^\d+$/u.test(value) || Number(value) > 10_000_000) { setFeedback("目標は0〜10,000,000の整数にしてください。"); return; }
    setBusy(true);
    try { const result = await onSave(Number(value), workspace.project.autoHistoryEnabled); setFeedback(result.ok ? "目標を保存しました。" : result.message ?? "保存できません。"); }
    finally { setBusy(false); }
  }
  return <section aria-label="文字数と執筆進捗">
    <p>現在の章：{activeCount.toLocaleString("ja-JP")}文字 ／ 作品全体：{total.toLocaleString("ja-JP")}文字</p>
    {goal > 0 ? <><label htmlFor="writing-progress">目標 {goal.toLocaleString("ja-JP")}文字：{Math.floor(total / goal * 100)}%</label><progress id="writing-progress" max={goal} value={Math.min(total, goal)} /></> : null}
    <button type="button" disabled={disabled || busy} onClick={() => void changeGoal()}>目標文字数を設定</button>
    {feedback ? <p role="status">{feedback}</p> : null}
  </section>;
}
