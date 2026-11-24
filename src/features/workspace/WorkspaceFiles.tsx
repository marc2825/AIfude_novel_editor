"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import type { WorkspaceFileInfo } from "../../persistence/workspace-repository";
import type { WorkspaceActionResult } from "./use-workspace";
import { createJsonWorkspaceDownload, downloadWorkspaceFile } from "./backup";
import { HelpTip } from "../ui/HelpTip";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./Workspace.module.css";

type Props = Readonly<{
  activeProjectId: string | null;
  disabled: boolean;
  files: readonly WorkspaceFileInfo[];
  getCurrentSnapshot: () => WorkspaceSnapshot | null;
  onNew: () => Promise<WorkspaceActionResult>;
  onOpen: (file: File) => Promise<WorkspaceActionResult>;
  onSave: () => Promise<WorkspaceActionResult>;
  onSwitch: (projectId: string) => Promise<WorkspaceActionResult>;
  onManage?: () => void;
  confirmExport?: () => boolean;
}>;

/**
 * The work switcher in the top bar. One button shows the current work; its menu lists every
 * saved work and the file actions. Saving stays one visible button next to it.
 */
export function WorkspaceFiles({ activeProjectId, disabled, files, getCurrentSnapshot, onNew, onOpen, onSave, onSwitch, onManage, confirmExport }: Props) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuItemsRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<WorkspaceActionResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsDisabled = disabled || busy;
  const activeTitle = files.find((file) => file.projectId === activeProjectId)?.title ?? "作品を選択";

  async function run(action: () => Promise<WorkspaceActionResult>, message: string) {
    if (disabled || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFeedback(null);
    try {
      const result = await action();
      setFeedback(result.ok ? { ok: true, message } : result);
      if (result.ok) {
        if (menuItemsRef.current?.contains(document.activeElement) && menuTriggerRef.current?.getClientRects().length) {
          menuTriggerRef.current.focus({ preventScroll: true });
        }
        setMenuOpen(false);
      }
    } catch { setFeedback({ ok: false, message: "ファイル操作に失敗しました。現在の本文は保持されています。" }); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const saveActionRef = useRef(() => {});
  useEffect(() => { saveActionRef.current = () => { void run(onSave, "本文と作品メモリを保存しました。"); }; });
  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      saveActionRef.current();
    }
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [menuOpen]);

  async function download() {
    if (confirmExport && !confirmExport()) return { ok: false, message: "書き出しを取り消しました。" };
    const result = await onSave();
    if (!result.ok) return result;
    const snapshot = getCurrentSnapshot();
    if (snapshot === null) return { ok: false, message: "保存する作品がありません。" };
    downloadWorkspaceFile(createJsonWorkspaceDownload(snapshot));
    return { ok: true };
  }

  return <section className={styles.files} aria-label="作品ファイル">
    <div className={styles.workMenu} ref={rootRef}>
      <button className={styles.workMenuTrigger} ref={menuTriggerRef} type="button" aria-expanded={menuOpen}
        aria-controls="workspace-file-actions" aria-label={`${activeTitle}（作品の切替と操作）`} onClick={() => setMenuOpen(!menuOpen)}>
        <span>{activeTitle}</span><WorkspaceIcon name="chevron" />
      </button>
      <div ref={menuItemsRef} className={styles.workMenuItems} id="workspace-file-actions" hidden={!menuOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault(); setMenuOpen(false); menuTriggerRef.current?.focus();
          }
        }}>
        <h2 id="saved-work-list-title">作品を切り替える</h2>
        {files.length === 0 ? <p>保存済みの作品はありません。</p> : <ul className={styles.workList} aria-labelledby="saved-work-list-title">
          {files.map((file) => <li key={file.projectId}>
            <button type="button" data-project-id={file.projectId} aria-current={file.projectId === activeProjectId ? "true" : undefined} disabled={controlsDisabled}
              onClick={() => { if (file.projectId === activeProjectId) setMenuOpen(false); else void run(() => onSwitch(file.projectId), "作品を開きました。"); }}>{file.title}</button>
          </li>)}
        </ul>}
        <div className={styles.workActions}>
          <button type="button" disabled={controlsDisabled} onClick={() => void run(onNew, "新しい作品を作成しました。")}>新規作品</button>
          <span className={styles.fileActionGroup}><button type="button" disabled={controlsDisabled} onClick={() => inputRef.current?.click()}>ファイルを開く</button>
            <HelpTip label="ファイルを開く">作品のJSON（.json）またはUTF-8のテキスト（.txt）を、新しい作品として開きます。10MiBまで。既存の作品は上書きしません。</HelpTip></span>
          <button type="button" disabled={controlsDisabled || activeProjectId === null} onClick={() => void run(download, "JSONファイルを書き出しました。")}>JSONで書き出す</button>
          {onManage ? <button type="button" disabled={disabled} onClick={() => { setMenuOpen(false); onManage(); }}>作品を管理</button> : null}
        </div>
      </div>
      {/* Outside the menu so a test or an assistive tool can set a file without opening it. */}
      <input hidden type="file" accept=".json,.txt,application/json,text/plain" ref={inputRef} aria-label="作品ファイルを開く"
        disabled={controlsDisabled} onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) void run(() => onOpen(file), "ファイルを新しい作品として開きました。");
        }} />
    </div>
    {feedback?.message ? <p className={styles.fileFeedback} role={feedback.ok ? "status" : "alert"}>{feedback.message}</p> : null}
    <button className={styles.saveButton} title="Cmd/Ctrl + S" type="button" disabled={controlsDisabled || activeProjectId === null} onClick={() => void run(onSave, "本文と作品メモリを保存しました。")}>保存</button>
  </section>;
}
