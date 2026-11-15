"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrashEntry } from "../../persistence/trash-repository";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "./Workspace.module.css";

type Props = Readonly<{ disabled: boolean; projectId: string | null; refreshKey: string; onList: () => Promise<TrashEntry[]>;
  onRestore: (entry: TrashEntry) => Promise<WorkspaceActionResult>; onPurge: (id: string) => Promise<WorkspaceActionResult>;
}>;
export function TrashPanel({ disabled, projectId, refreshKey, onList, onRestore, onPurge }: Props) {
  const [open, setOpen] = useState(false); const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [message, setMessage] = useState("");
  const loadGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const own = ++loadGeneration.current;
    try { const next = await onList(); if (own === loadGeneration.current) setEntries(next); }
    catch { if (own === loadGeneration.current) setMessage("ごみ箱を読み込めませんでした。"); }
  }, [onList]);
  useEffect(() => {
    const owner = loadGeneration; const own = ++owner.current;
    if (open) void Promise.resolve().then(onList).then((next) => {
      if (own === owner.current) setEntries(next);
    }).catch(() => { if (own === owner.current) setMessage("ごみ箱を読み込めませんでした。"); });
    return () => { owner.current++; };
  }, [open, refreshKey, onList]);
  async function run(action: () => Promise<WorkspaceActionResult>) {
    if (disabled || busyRef.current) return; busyRef.current = true; setBusy(true);
    try { const result = await action(); setMessage(result.message ?? (result.ok ? "ごみ箱を更新しました。" : "操作できませんでした。")); if (result.ok) await refresh(); }
    catch { setMessage("ごみ箱を更新できませんでした。現在の作品は保持されています。"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section className={styles.files} aria-label="ごみ箱">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>ごみ箱・削除の復元</button>
    {open ? <div>
      <p>作品・章を完全削除するまで保持します（最大200件）。章は元の作品を開いて復元してください。</p>
      <button type="button" disabled={busy} onClick={() => void refresh()}>ごみ箱を再読み込み</button>
      {entries.length === 0 ? <p>ごみ箱は空です。</p> : null}
      <ul>{entries.map((entry) => {
        const chapter = [entry.snapshot.chapter, ...entry.snapshot.additionalChapters].find((item) => item.id === entry.chapterId);
        const label = entry.kind === "workspace" ? `作品：${entry.snapshot.project.title}` : `章：${chapter?.title ?? "章"}（${entry.snapshot.project.title}）`;
        return <li key={entry.id}><p>{label} ／ {new Date(entry.deletedAt).toLocaleString("ja-JP")}</p>
          <button type="button" aria-label={`${label}を復元`} disabled={disabled || busy || (entry.kind === "chapter" && projectId !== entry.projectId)} onClick={() => {
            if (window.confirm(`「${label}」を復元しますか？ 現在の本文は上書きしません。`)) void run(() => onRestore(entry));
          }}>復元</button>
          <button type="button" aria-label={`${label}を完全削除`} disabled={disabled || busy} onClick={() => {
            if (window.confirm(`「${label}」を完全削除しますか？ この操作は元に戻せません。${entry.kind === "workspace" ? " この作品だけに残る同期の送信待ち・コピーも端末から削除します。同期先の原稿は削除しません。" : ""}`)) void run(() => onPurge(entry.id));
          }}>完全削除</button>
        </li>;
      })}</ul>
      {message ? <p role="status">{message}</p> : null}
    </div> : null}
  </section>;
}
