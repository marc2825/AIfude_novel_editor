"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./Workspace.module.css";

export type WorkspacePanelId = "memory" | "chapters" | "history" | "settings" | "connections" | "backup" | "feedback" | "typography";
const PANELS: readonly WorkspacePanelId[] = ["backup", "chapters", "memory", "feedback", "history", "typography", "connections", "settings"];
const LABELS: Record<WorkspacePanelId, string> = {
  typography: "組版と投稿用出力", feedback: "日本語診断とFeedback", memory: "作品メモリ", chapters: "章とアウトライン", history: "保存履歴・復元",
  settings: "設定とバックアップ", connections: "AI接続の設定・診断", backup: "ファイルとバックアップ",
};
/** Short words shown under the rail icons; the full name stays the accessible name. */
const RAIL_TEXT: Record<WorkspacePanelId, string> = {
  backup: "作品", chapters: "章", memory: "メモ", feedback: "診断", history: "履歴", typography: "組版", connections: "AI接続", settings: "設定",
};
/** The work itself first, the application settings last. */
const WORK_PANELS: readonly WorkspacePanelId[] = ["backup", "chapters", "memory", "feedback", "history", "typography"];
const APP_PANELS: readonly WorkspacePanelId[] = ["connections", "settings"];

export function WorkspaceLayout({ header, files, editor, panels, alerts, children, active, onActiveChange, secretAction }: Readonly<{
  secretAction?: ReactNode;
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
  function trigger(panel: WorkspacePanelId) {
    return <button key={panel} type="button" disabled={panels[panel] === null} aria-label={LABELS[panel]} aria-expanded={active === panel}
      aria-controls={`workspace-panel-${panel}`} onClick={(event) => {
        triggerRef.current = event.currentTarget; focusPanelRef.current = active !== panel;
        onActiveChange(active === panel ? null : panel);
      }}><WorkspaceIcon name={panel} /><span>{RAIL_TEXT[panel]}</span></button>;
  }
  return <main className={styles.workspace} ref={rootRef}>
    <div className={styles.topbar}>
      {header}
      {files}
      <span className={styles.topSpacer} aria-hidden="true" />
      {secretAction ? <div className={styles.topActions}>{secretAction}</div> : null}
    </div>
    <div className={styles.workspaceAlerts}>{alerts}</div>
    <div className={styles.workbench} data-writing-workbench data-panel-open={active !== null}>
      <nav aria-label="執筆の補助" className={styles.sideRail}>
        {WORK_PANELS.map(trigger)}
        <span className={styles.railSpacer} aria-hidden="true" />
        {APP_PANELS.map(trigger)}
      </nav>
      <aside data-writing-panel className={styles.sidePanel} hidden={active === null} aria-label="執筆サイドパネル"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault(); event.stopPropagation(); close();
          }
        }}>
        <div className={styles.panelHeading}><h2>{active === null ? "執筆の補助" : LABELS[active]}</h2>
          <button type="button" ref={closeRef} aria-label="サイドパネルを閉じる" onClick={close}><WorkspaceIcon name="close" /></button></div>
        {PANELS.map((panel) => <div key={panel} id={`workspace-panel-${panel}`}
          className={styles.panelContent} hidden={active !== panel}>{panels[panel]}</div>)}
      </aside>
      <div className={styles.manuscriptArea} data-manuscript-area>{editor}</div>
      {/* Reserved for the AI panel on wide screens, so a suggestion never covers the manuscript. */}
      <div className={styles.aiMargin} data-ai-margin>
        <p>文章を選んで <kbd>⌘ / Ctrl K</kbd> を押すと、AIの提案がここに出ます。</p>
      </div>
    </div>
    {children}
  </main>;
}
