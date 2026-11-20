"use client";
import { useRef, useState } from "react";
import { readLibraryBackup, MAX_LIBRARY_BACKUP_BYTES, type LibraryBackup } from "../../persistence/library-backup";
import styles from "./Workspace.module.css";
import { downloadWorkspaceFile } from "./backup";
import type { WorkspaceActionResult } from "./use-workspace";
import { HelpHeading } from "../ui/HelpTip";

export function LibraryBackupPanel({ disabled, onExport, onImport }: Readonly<{ disabled: boolean;
  onExport: () => Promise<LibraryBackup>; onImport: (bundle: LibraryBackup, password?: string) => Promise<WorkspaceActionResult>;
}>) {
  // A backup with secret works waits here for the password it was made with.
  const [pending, setPending] = useState<LibraryBackup | null>(null); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [feedback, setFeedback] = useState(""); const inputRef = useRef<HTMLInputElement>(null);
  async function run(action: () => Promise<void>) {
    if (disabled || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFeedback("");
    try { await action(); } catch { setFeedback("一括バックアップを処理できませんでした。形式・容量と保存状態を確認してください。既存作品は保持されています。"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function download() {
    const contents = JSON.stringify(await onExport(), null, 2);
    if (new Blob([contents]).size > MAX_LIBRARY_BACKUP_BYTES) throw new Error("容量超過");
    downloadWorkspaceFile({ contents, filename: `novel-library-${new Date().toISOString().slice(0, 10)}.json`, mimeType: "application/json;charset=utf-8" });
    setFeedback("全作品・全章・メモ・履歴・ごみ箱を書き出しました。");
  }
  return <section className={styles.files} aria-label="全作品のバックアップ">
    <HelpHeading level={3} label="全作品のバックアップ" help={<>全作品をJSONで書き出します（100MiBまで）。復元時は別の作品として追加し、既存の作品は上書きしません。外部AIへの同意は引き継ぎません。</>}>全作品のバックアップ</HelpHeading>
    <button type="button" disabled={disabled || busy} onClick={() => void run(download)}>全作品を一括バックアップ</button>
    <button type="button" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>一括バックアップを復元</button>
    <input type="file" hidden accept=".json,application/json" aria-label="一括バックアップファイル" ref={inputRef} disabled={disabled || busy} onChange={(event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (file) void run(async () => {
        const bundle = await readLibraryBackup(file);
        if (!window.confirm(`${bundle.workspaces.length}作品とごみ箱${bundle.trash.length}件をコピーとして追加しますか？ 既存作品は上書きされません。`)) { setFeedback("復元を取り消しました。"); return; }
        const result = await onImport(bundle); setFeedback(result.message ?? (result.ok ? "復元しました。" : "復元できませんでした。"));
        if (result.needsPassword) setPending(bundle);
      });
    }} />
    {pending ? <form onSubmit={(event) => {
      event.preventDefault();
      const bundle = pending;
      void run(async () => {
        const result = await onImport(bundle, password); setFeedback(result.message ?? (result.ok ? "復元しました。" : "復元できませんでした。"));
        if (!result.needsPassword) { setPending(null); setPassword(""); }
      });
    }}>
      <label>バックアップ作成時のパスワード<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="submit" disabled={disabled || busy || password.length === 0}>パスワードを入力して復元</button>
      <button type="button" disabled={busy} onClick={() => { setPending(null); setPassword(""); setFeedback("復元を取り消しました。"); }}>取り消す</button>
    </form> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
  </section>;
}
