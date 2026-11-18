"use client";
import { useEffect, useRef, useState } from "react";
import { paragraphRuns } from "../../domain/typography";
import { orderedChapters } from "../../domain/chapters";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import type { WritingHistoryEntry } from "../../persistence/writing-history";
import { DiffPreview } from "../ai-edit/DiffPreview";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "./Workspace.module.css";
import { HelpTip } from "../ui/HelpTip";

function preview(workspace: WorkspaceSnapshot): string {
  return orderedChapters(workspace).map((chapter) => `【${chapter.title}】\n${chapter.body.content.map((p) => "content" in p ? p.content.map((node) => node.text).join("") : "").join("\n")}\nアウトライン：${chapter.outlineNotes}`).join("\n\n") +
    `\n\n作品名：${workspace.project.title}\n共通プロンプト：${workspace.project.commonPrompt}\n文体：${workspace.styleProfile.manualInstructions}\n設定：${workspace.project.storyMemory.settingNotes}\n背景：${workspace.project.storyMemory.backgroundNotes}\n登場人物：${workspace.project.storyMemory.characterNotes}\n目標：${workspace.project.writingGoal}\n人物・文体・執筆設定：${JSON.stringify(workspace.project.authoringProfile)}\nルビ・傍点：${JSON.stringify(orderedChapters(workspace).map((chapter) => ({ chapter: chapter.title, annotations: chapter.body.content.flatMap((paragraph, index) => paragraphRuns(paragraph).filter((run) => run.marks).map((run) => ({ paragraph: index + 1, text: run.text, marks: run.marks }))) })))}`;
}
type Props = Readonly<{ embedded?: boolean; active?: boolean; workspace: WorkspaceSnapshot; disabled: boolean; warning: string | null;
  getCurrentSnapshot: () => WorkspaceSnapshot | null;
  onList: () => Promise<WritingHistoryEntry[]>; onCreate: (label: string) => Promise<WorkspaceActionResult>;
  onRestore: (entry: WritingHistoryEntry) => Promise<WorkspaceActionResult>; onClear: () => Promise<WorkspaceActionResult>;
  onAutoChange: (enabled: boolean) => Promise<WorkspaceActionResult>;
}>;
export function WritingHistoryPanel({ embedded = false, active = false, workspace, disabled, warning, getCurrentSnapshot, onList, onCreate, onRestore, onClear, onAutoChange }: Props) {
  const [open, setOpen] = useState(embedded); const [entries, setEntries] = useState<WritingHistoryEntry[]>([]);
  const [selected, setSelected] = useState<WritingHistoryEntry | null>(null); const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!embedded || !active) return;
    let current = true;
    void onList().then((items) => { if (current) setEntries(items); })
      .catch(() => { if (current) setFeedback("履歴を読み込めませんでした。"); });
    return () => { current = false; };
  }, [active, embedded, onList]);
  async function refresh() { try { setEntries(await onList()); } catch { setFeedback("履歴を読み込めませんでした。"); } }
  async function run(action: () => Promise<WorkspaceActionResult>) {
    if (busyRef.current || disabled) return;
    busyRef.current = true; setBusy(true);
    try { const result = await action(); setFeedback(result.message ?? (result.ok ? "履歴を更新しました。" : "操作できませんでした。")); if (result.ok) { setSelected(null); await refresh(); } }
    catch { setFeedback("履歴を更新できませんでした。現在の作品は保持されています。"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section className={styles.files} aria-label="保存履歴">
    <button hidden={embedded} type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void refresh(); }}>保存履歴・復元</button>
    {warning ? <p role="alert">{warning}</p> : null}
    {open ? <div>
      <p>作品ごとに直近50件を残します。<HelpTip label="保存履歴">本文・章・作品メモリ・設定を保存します。AIの候補は保存しません。</HelpTip></p>
      <label><input type="checkbox" checked={workspace.project.autoHistoryEnabled} disabled={disabled || busy} onChange={(event) => void run(() => onAutoChange(event.target.checked))} />自動保存前の状態を履歴に残す（初期OFF）</label>
      <label>履歴の名前<input aria-label="履歴の名前" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} /></label>
      <button type="button" disabled={disabled || busy} onClick={() => void run(() => onCreate(label.trim() || "手動保存"))}>現在の状態を履歴に保存</button>
      <button type="button" disabled={busy} onClick={() => void refresh()}>履歴を再読み込み</button>
      <ol>{entries.map((entry) => <li key={entry.id}><button type="button" disabled={busy} onClick={() => setSelected(entry)}>{entry.label}（{new Date(entry.createdAt).toLocaleString("ja-JP")}）</button></li>)}</ol>
      {entries.length === 0 ? <p>保存履歴はありません。</p> : null}
      {selected ? <div aria-label="履歴の復元プレビュー">
        <h3>「{selected.label}」を現在の作品と比較</h3>
        <DiffPreview candidateId={selected.id} requestId={selected.id} candidatePosition={1} candidateText={preview(selected.snapshot)} originalText={preview(getCurrentSnapshot() ?? workspace)} />
        <p>復元すると全章・メモ・設定をこの時点へ戻します。復元直前の状態も履歴に保存します。</p>
        <button type="button" disabled={disabled || busy} onClick={() => { if (window.confirm("この履歴へ作品を復元しますか？ 現在の状態も履歴へ保存します。")) void run(() => onRestore(selected)); }}>確認してこの履歴を復元</button>
        <button type="button" onClick={() => setSelected(null)}>復元をキャンセル</button>
      </div> : null}
      <button type="button" disabled={disabled || busy || entries.length === 0} onClick={() => { if (window.confirm("この作品の保存履歴をすべて削除しますか？ 現在の作品は残ります。")) void run(onClear); }}>この作品の履歴を削除</button>
      {feedback ? <p role="status">{feedback}</p> : null}
    </div> : null}
  </section>;
}
