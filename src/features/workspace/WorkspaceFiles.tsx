"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { EditorUiStateStore } from "../../persistence/editor-ui-state";
import type { WorkspaceSnapshot } from "../../domain/workspace";
import type { WorkspaceFileInfo } from "../../persistence/workspace-repository";
import type { WorkspaceActionResult } from "./use-workspace";
import { createJsonWorkspaceDownload, downloadWorkspaceFile } from "./backup";
import { HelpTip } from "../ui/HelpTip";
import styles from "./Workspace.module.css";

type Props = Readonly<{
  uiState?: EditorUiStateStore;
  activeProjectId: string | null;
  disabled: boolean;
  files: readonly WorkspaceFileInfo[];
  getCurrentSnapshot: () => WorkspaceSnapshot | null;
  onNew: () => Promise<WorkspaceActionResult>;
  onOpen: (file: File) => Promise<WorkspaceActionResult>;
  onSave: () => Promise<WorkspaceActionResult>;
  onSwitch: (projectId: string) => Promise<WorkspaceActionResult>;
  onManage?: () => void;
}>;

function tabPosition(index: number): CSSProperties & { "--file-row": number } {
  return { gridColumn: index + 1, "--file-row": index + 1 };
}

export function WorkspaceFiles({ uiState, activeProjectId, disabled, files, getCurrentSnapshot, onNew, onOpen, onSave, onSwitch, onManage }: Props) {
  const [closedIds, setClosedIds] = useState<readonly string[]>(() => uiState?.closedProjects() ?? []);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuItemsRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<WorkspaceActionResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusRequestRef = useRef<string | null>(null);
  const tabs = files.filter((file) => file.projectId === activeProjectId || !closedIds.includes(file.projectId));
  const controlsDisabled = disabled || busy;

  useEffect(() => { uiState?.setClosedProjects(closedIds); }, [closedIds, uiState]);

  useEffect(() => {
    if (!busy && focusRequestRef.current !== null) {
      tabRefs.current.get(focusRequestRef.current)?.focus();
      focusRequestRef.current = null;
    }
  }, [busy, activeProjectId, closedIds]);

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

  async function switchTo(projectId: string) {
    const result = await onSwitch(projectId);
    if (result.ok) {
      focusRequestRef.current = projectId;
      setClosedIds((ids) => ids.filter((id) => id !== projectId));
    }
    return result;
  }

  async function close(projectId: string) {
    let focusTarget = activeProjectId;
    if (projectId === activeProjectId) {
      const next = tabs.find((file) => file.projectId !== projectId);
      if (next === undefined) return { ok: false };
      const result = await switchTo(next.projectId);
      if (!result.ok) return result;
      focusTarget = next.projectId;
    }
    focusRequestRef.current = focusTarget;
    setClosedIds((ids) => [...ids, projectId]);
    return { ok: true };
  }

  async function download() {
    const result = await onSave();
    if (!result.ok) return result;
    const snapshot = getCurrentSnapshot();
    if (snapshot === null) return { ok: false, message: "保存する作品がありません。" };
    downloadWorkspaceFile(createJsonWorkspaceDownload(snapshot));
    return { ok: true };
  }

  return <section className={styles.files} aria-label="作品ファイル">
    <div className={styles.fileActions}>
      <button className={styles.fileMenuTrigger} ref={menuTriggerRef} type="button" aria-expanded={menuOpen}
        aria-controls="workspace-file-actions" onClick={() => setMenuOpen(!menuOpen)}>作品操作</button>
      <div ref={menuItemsRef} className={styles.fileMenuItems} id="workspace-file-actions" data-open={menuOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault(); setMenuOpen(false); menuTriggerRef.current?.focus();
          }
        }}>
      <button type="button" disabled={controlsDisabled} onClick={() => void run(onNew, "新しい作品を作成しました。")}>新規作品</button>
      <span className={styles.fileActionGroup}><button type="button" disabled={controlsDisabled} onClick={() => inputRef.current?.click()}>ファイルを開く</button>
        <HelpTip label="ファイルを開く">作品のJSON（.json）またはUTF-8のテキスト（.txt）を、新しい作品として開きます。10MiBまで。既存の作品は上書きしません。</HelpTip></span>
      <input hidden type="file" accept=".json,.txt,application/json,text/plain" ref={inputRef} aria-label="作品ファイルを開く"
        disabled={controlsDisabled} onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) void run(() => onOpen(file), "ファイルを新しい作品として開きました。");
        }} />
      <button type="button" disabled={controlsDisabled || activeProjectId === null} onClick={() => void run(download, "JSONファイルを保存しました。")}>JSONで保存</button>
      <label>保存済み作品を開く
        <select aria-label="保存済み作品を開く" value="" disabled={controlsDisabled || files.length === 0}
          onChange={(event) => { const id = event.currentTarget.value; if (id) void run(() => switchTo(id), "作品を開きました。"); }}>
          <option value="">作品を選択</option>
          {files.map((file) => <option key={file.projectId} value={file.projectId}>{file.title}</option>)}
        </select>
      </label>
      {onManage ? <button type="button" disabled={disabled} onClick={() => { setMenuOpen(false); onManage(); }}>作品を管理</button> : null}
      </div>
      <button className={styles.saveButton} title="Cmd/Ctrl + S" type="button" disabled={controlsDisabled || activeProjectId === null} onClick={() => void run(onSave, "本文と作品メモリを保存しました。")}>保存</button>
    </div>
    <div className={styles.tabs}>
    <div className={styles.tabList} hidden={tabs.length === 0} role="tablist" aria-label="開いている作品">
      {tabs.map((file, index) => <button key={file.projectId} className={styles.fileTab} style={tabPosition(index)} type="button" role="tab" aria-selected={file.projectId === activeProjectId} aria-controls="workspace-editor"
          tabIndex={file.projectId === activeProjectId || (activeProjectId === null && index === 0) ? 0 : -1} disabled={controlsDisabled}
          ref={(element) => { if (element) tabRefs.current.set(file.projectId, element); else tabRefs.current.delete(file.projectId); }}
          onKeyDown={(event) => {
            const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : offset ? tabs[(index + offset + tabs.length) % tabs.length] : undefined;
            if (target) { event.preventDefault(); tabRefs.current.get(target.projectId)?.focus(); }
          }}
          onClick={() => void run(() => switchTo(file.projectId), "作品を開きました。")}>{file.title}</button>)}
    </div>
    {tabs.map((file, index) => <button key={file.projectId} className={styles.tabClose} style={tabPosition(index)} type="button" aria-label={`${file.title}のタブを閉じる`} disabled={controlsDisabled || (tabs.length === 1 && file.projectId === activeProjectId)}
          onClick={() => void run(() => close(file.projectId), "タブを閉じました。保存済み一覧から開き直せます。")}>×</button>
      )}
    </div>

    {feedback?.message ? <p role={feedback.ok ? "status" : "alert"}>{feedback.message}</p> : null}
  </section>;
}
