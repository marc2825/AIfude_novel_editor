"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { orderedChapters, withChapters } from "../../domain/chapters";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "./Workspace.module.css";

export type ChapterPanelHandle = { save: () => Promise<WorkspaceActionResult> };
type Props = Readonly<{ embedded?: boolean; workspace: WorkspaceSnapshot; disabled: boolean;
  onChange: (change: (current: WorkspaceSnapshot) => WorkspaceSnapshot) => Promise<WorkspaceActionResult>;
  onDelete: () => Promise<WorkspaceActionResult>;
  onDirtyChange: (dirty: boolean) => void;
}>;
export const ChapterPanel = forwardRef<ChapterPanelHandle, Props>(function ChapterPanel({ embedded = false, workspace, disabled, onChange, onDelete, onDirtyChange }, ref) {
  const [title, setTitle] = useState(workspace.chapter.title);
  const [outline, setOutline] = useState(workspace.chapter.outlineNotes);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<WorkspaceActionResult | null>(null);
  const dirty = title !== workspace.chapter.title || outline !== workspace.chapter.outlineNotes;
  function updateDraft(nextTitle: string, nextOutline: string) { setTitle(nextTitle); setOutline(nextOutline); onDirtyChange(nextTitle !== workspace.chapter.title || nextOutline !== workspace.chapter.outlineNotes); }
  async function run(change: (current: WorkspaceSnapshot) => WorkspaceSnapshot, discard = false, savedDraft = false): Promise<WorkspaceActionResult> {
    if (disabled || busyRef.current) return { ok: false };
    if (discard && dirty && !window.confirm("未保存の章タイトル・アウトラインを破棄して続行しますか？")) return { ok: false };
    busyRef.current = true; setBusy(true);
    try { const result = await onChange(change); setFeedback(result.ok ? { ok: true, message: "章を保存しました。" } : result); if (result.ok && (discard || savedDraft)) onDirtyChange(false); return result; }
    finally { busyRef.current = false; setBusy(false); }
  }
  function save() { return run((current) => ({ ...current, chapter: { ...current.chapter, title, outlineNotes: outline, updatedAt: new Date().toISOString() } }), false, true); }
  useImperativeHandle(ref, () => ({ save }));
  const chapters = orderedChapters(workspace);
  return <section className={styles.files} aria-label="章とアウトライン">
    <details className={styles.settings} open><summary hidden={embedded}>章とアウトライン</summary><div className={styles.settingsContent}>
    <ol>{chapters.map((chapter, index) => <li key={chapter.id}>
      <button type="button" disabled={disabled || busy} aria-current={chapter.id === workspace.chapter.id ? "page" : undefined}
        onClick={() => { if (chapter.id !== workspace.chapter.id) void run((current) => withChapters(current, orderedChapters(current), chapter.id), true); }}>{chapter.title}</button>
      <button type="button" aria-label={`${chapter.title}を上へ`} disabled={disabled || busy || index === 0} onClick={() => void run((current) => {
        const items = orderedChapters(current); [items[index - 1], items[index]] = [items[index], items[index - 1]]; return withChapters(current, items);
      })}>↑</button>
      <button type="button" aria-label={`${chapter.title}を下へ`} disabled={disabled || busy || index === chapters.length - 1} onClick={() => void run((current) => {
        const items = orderedChapters(current); [items[index], items[index + 1]] = [items[index + 1], items[index]]; return withChapters(current, items);
      })}>↓</button>
      {chapter.outlineNotes ? <p style={{ whiteSpace: "pre-wrap" }}>{chapter.outlineNotes}</p> : null}
    </li>)}</ol>
    <button type="button" disabled={disabled || busy || chapters.length >= 200} onClick={() => void run((current) => {
      const id = crypto.randomUUID(); const timestamp = new Date().toISOString();
      return withChapters(current, [...orderedChapters(current), { id, documentId: current.document.id, title: `第${current.document.chapterIds.length + 1}章`,
        outlineNotes: "", orderIndex: current.document.chapterIds.length, body: { type: "doc", content: [{ type: "paragraph" }] }, contentRevision: 0, createdAt: timestamp, updatedAt: timestamp }], id);
    }, true)}>章を追加</button>
    <label>章タイトル<input aria-label="章タイトル" disabled={disabled || busy} value={title} onChange={(event) => updateDraft(event.target.value, outline)} /></label>
    <label>章のアウトライン<textarea aria-label="章のアウトライン" disabled={disabled || busy} value={outline} onChange={(event) => updateDraft(title, event.target.value)} /></label>
    <button type="button" disabled={disabled || busy || !dirty} onClick={() => void save()}>章の設定を保存</button>
    <button type="button" disabled={disabled || busy || chapters.length === 1} onClick={() => {
      if (dirty && !window.confirm("未保存の章タイトル・アウトラインを破棄して続行しますか？")) return;
      if (window.confirm(`「${workspace.chapter.title}」をごみ箱へ移しますか？ 後から本文も復元できます。`)) {
        if (disabled || busyRef.current) return;
        busyRef.current = true; setBusy(true);
        void onDelete().then((result) => { setFeedback(result); if (result.ok) onDirtyChange(false); })
          .finally(() => { busyRef.current = false; setBusy(false); });
      }
    }}>現在の章を削除</button>
    {dirty ? <p role="status">章の設定に未保存の変更があります。</p> : null}
    {feedback?.message ? <p role={feedback.ok ? "status" : "alert"}>{feedback.message}</p> : null}
    </div></details>
  </section>;
});
