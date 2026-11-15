"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { WRITING_TOOLS, type WritingToolId } from "../ai-edit/writing-tools";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./Workspace.module.css";

export type WorkspacePanelId = "memory" | "chapters" | "history" | "settings" | "connections" | "backup" | "feedback" | "typography";
const PANELS: readonly WorkspacePanelId[] = ["memory", "chapters", "history", "settings", "connections", "backup", "feedback", "typography"];
const LABELS: Record<WorkspacePanelId, string> = {
  typography: "組版と投稿用出力", feedback: "日本語診断とFeedback", memory: "作品メモリ", chapters: "章とアウトライン", history: "保存履歴・復元",
  settings: "設定とバックアップ", connections: "AI接続の設定・診断", backup: "ファイルとバックアップ",
};

export function WorkspaceLayout({ header, files, editor, panels, alerts, children, active, onActiveChange, writingTool = "rewrite", onWritingToolChange }: Readonly<{
  writingTool?: WritingToolId; onWritingToolChange?: (tool: WritingToolId) => void;
  active: WorkspacePanelId | null; onActiveChange: (panel: WorkspacePanelId | null) => void;
  header: ReactNode; files: ReactNode; editor: ReactNode; alerts: ReactNode; children: ReactNode;
  panels: Record<WorkspacePanelId, ReactNode>;
}>) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const focusPanelRef = useRef(false);
  useLayoutEffect(() => {
    if (active && focusPanelRef.current) closeRef.current?.focus({ preventScroll: true });
    focusPanelRef.current = false;
  }, [active]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      rootRef.current?.style.setProperty("--visual-height", `${viewport.height}px`);
      rootRef.current?.style.setProperty("--visual-top", `${viewport.offsetTop}px`);
    };
    update(); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, []);
  function close() { onActiveChange(null); triggerRef.current?.focus(); }
  function trigger(panel: WorkspacePanelId, text: string) {
    return <button type="button" disabled={panels[panel] === null} aria-label={LABELS[panel]} aria-expanded={active === panel}
      aria-controls={`workspace-panel-${panel}`} onClick={(event) => {
        triggerRef.current = event.currentTarget; focusPanelRef.current = active !== panel;
        onActiveChange(active === panel ? null : panel);
      }}><WorkspaceIcon name={panel} /><span>{text}</span></button>;
  }
  return <main className={styles.workspace} ref={rootRef}>
    <div className={styles.topbar}>
      {header}
      <nav aria-label="アプリの設定" className={styles.topActions}>
        {trigger("backup", "ファイル")}
        {trigger("connections", "AI接続")}
        {trigger("settings", "設定")}
      </nav>
    </div>
    {files}
    <div className={styles.workspaceAlerts}>{alerts}</div>
    <div className={styles.workbench} data-writing-workbench>
      <div className={styles.manuscriptArea}>{editor}</div>
      <aside data-writing-panel className={styles.sidePanel} hidden={active === null} aria-label="執筆サイドパネル"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault(); event.stopPropagation(); close();
          }
        }}>
        <div className={styles.panelHeading}><h2>{active === null ? "執筆ツール" : LABELS[active]}</h2>
          <button type="button" ref={closeRef} aria-label="サイドパネルを閉じる" onClick={close}>×</button></div>
        {PANELS.map((panel) => <div key={panel} id={`workspace-panel-${panel}`}
          className={styles.panelContent} hidden={active !== panel}>{panels[panel]}</div>)}
      </aside>
      <nav aria-label="執筆ツール" className={styles.sideRail}>
        <label className={styles.mobileToolSelect}>AIツール
          <select aria-label="AIツール" value={writingTool} disabled={!onWritingToolChange} onChange={(event) => {
            const tool = WRITING_TOOLS.find((entry) => entry.id === event.target.value);
            if (tool) onWritingToolChange?.(tool.id);
          }}>{WRITING_TOOLS.map((tool) => <option value={tool.id} key={tool.id}>{tool.label}</option>)}</select>
        </label>
        <fieldset className={styles.writingTools}>
          <legend>AIツール</legend>
          {WRITING_TOOLS.map((tool) => <label key={tool.id} title={`${tool.english}：${tool.description}`}>
            <input type="radio" name="writing-tool" aria-label={`${tool.label}（${tool.english}）`}
              checked={writingTool === tool.id} disabled={!onWritingToolChange}
              onChange={() => onWritingToolChange?.(tool.id)} />
            <span className={styles.writingToolOption}><WorkspaceIcon name={tool.id} /><span>{tool.label}</span></span>
          </label>)}
        </fieldset>
        <div className={styles.panelTools}>
          {trigger("feedback", "診断")}
          {trigger("memory", "メモリ")}
          {trigger("chapters", "章")}
          {trigger("history", "履歴")}
          {trigger("typography", "組版")}
        </div>
      </nav>
    </div>
    {children}
  </main>;
}
