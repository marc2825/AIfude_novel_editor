"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./HelpTip.module.css";

const TIP_WIDTH = 288;

/**
 * A small "?" button whose explanation appears on mouse hover, keyboard focus or tap.
 * The text stays in the DOM and is linked with aria-describedby, so screen readers get it
 * without opening. Fixed positioning keeps it from being clipped by scrolling panels.
 */
export function HelpTip({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const visible = hovered || focused || pinned;

  useLayoutEffect(() => {
    if (!visible) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(TIP_WIDTH, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    setPosition({ top: rect.bottom + 6, left });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const close = () => { setHovered(false); setPinned(false); };
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setPinned(false); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [visible]);

  return <span className={styles.root} ref={rootRef}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(false); }}>
    <button ref={buttonRef} type="button" className={styles.button} aria-label={`${label}の説明`} aria-describedby={id}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onClick={() => setPinned((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && visible && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); setHovered(false); setFocused(false); setPinned(false);
        }
      }}>?</button>
    <span id={id} role="tooltip" className={styles.tip} hidden={!visible}
      style={position ? { top: position.top, left: position.left } : undefined}>{children}</span>
  </span>;
}

/** A heading with its help next to it. The tip stays outside the heading so the heading's accessible name is only its title. */
export function HelpHeading({ level = 3, id, label, help, children }: Readonly<{ level?: 2 | 3 | 4; id?: string; label: string; help: ReactNode; children: ReactNode }>) {
  const Tag = level === 2 ? "h2" : level === 4 ? "h4" : "h3";
  return <div className={styles.headingRow}><Tag id={id} style={{ margin: 0 }}>{children}</Tag><HelpTip label={label}>{help}</HelpTip></div>;
}
