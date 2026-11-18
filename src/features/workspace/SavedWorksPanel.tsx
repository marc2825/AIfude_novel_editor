"use client";

import { useState } from "react";
import type { WorkspaceFileInfo } from "../../persistence/workspace-repository";
import type { WorkspaceActionResult } from "./use-workspace";
import { HelpHeading } from "../ui/HelpTip";
import styles from "./Workspace.module.css";

type Props = Readonly<{
  activeProjectId: string | null;
  disabled: boolean;
  files: readonly WorkspaceFileInfo[];
  onOpen: (projectId: string) => Promise<WorkspaceActionResult>;
  onTrash: (projectId: string) => Promise<WorkspaceActionResult>;
  onTrashActive: () => Promise<WorkspaceActionResult>;
}>;

/** Saved works with open and move-to-trash actions. Deleting always goes through the trash. */
export function SavedWorksPanel({ activeProjectId, disabled, files, onOpen, onTrash, onTrashActive }: Props) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<WorkspaceActionResult | null>(null);
  async function run(action: () => Promise<WorkspaceActionResult>) {
    setBusy(true); setFeedback(null);
    try { setFeedback(await action()); }
    catch { setFeedback({ ok: false, message: "操作できませんでした。作品は保持されています。" }); }
    finally { setBusy(false); }
  }
  return <section className={styles.files} aria-labelledby="saved-works-title">
    <HelpHeading level={3} id="saved-works-title" label="保存済みの作品" help={<>
      ごみ箱へ移した作品は、本文・設定・保存履歴ごと「ごみ箱・削除の復元」から戻せます。完全に消すのはごみ箱からです。
    </>}>保存済みの作品</HelpHeading>
    {files.length === 0 ? <p>保存済みの作品はありません。</p> : <ul className={styles.savedWorks}>
      {files.map((file) => {
        const active = file.projectId === activeProjectId;
        return <li key={file.projectId}>
          <span className={styles.savedWorkTitle}>{file.title}{active ? <small>（開いています）</small> : null}</span>
          <span className={styles.savedWorkActions}>
            {active ? null : <button type="button" disabled={disabled || busy} onClick={() => void run(() => onOpen(file.projectId))}>開く</button>}
            <button type="button" disabled={disabled || busy} aria-label={`${file.title}をごみ箱へ移す`} onClick={() => {
              if (!window.confirm(`「${file.title}」をごみ箱へ移しますか？ 本文・設定・保存履歴はごみ箱から復元できます。`)) return;
              void run(() => active ? onTrashActive() : onTrash(file.projectId));
            }}>ごみ箱へ</button>
          </span>
        </li>;
      })}
    </ul>}
    {feedback?.message ? <p role={feedback.ok ? "status" : "alert"}>{feedback.message}</p> : null}
  </section>;
}
