"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./HelpTip.module.css";

const TIP_WIDTH = 288;
const GAP = 6;
const MARGIN = 8;

/**
 * A small "?" button whose explanation appears on mouse hover, keyboard focus or tap.
 * The text stays in the DOM and is linked with aria-describedby, so screen readers get it
 * without opening. Fixed positioning keeps it from being clipped by scrolling panels; it
 * follows the button on scroll and opens upward when there is no room below.
 */
export function HelpTip({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Focus caused by a click or tap must not keep the tip open; only keyboard focus opens it.
  const pointerDownRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const visible = hovered || focused || pinned;
  const closeAll = useCallback(() => { setHovered(false); setFocused(false); setPinned(false); }, []);

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    const tip = tipRef.current;
    if (!rect || !tip) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) { closeAll(); return; }
    const width = Math.min(TIP_WIDTH, window.innerWidth - MARGIN * 2);
    const height = tip.offsetHeight;
    const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const top = below + height <= window.innerHeight - MARGIN ? below
      : above >= MARGIN ? above
      : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    setPosition({ top, left });
  }, [closeAll]);

  useLayoutEffect(() => { if (visible) place(); }, [visible, place]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) closeAll(); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [visible, place, closeAll]);

  return <span className={styles.root} ref={rootRef}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(false); }}>
    <button ref={buttonRef} type="button" className={styles.button} aria-label={`${label}の説明`} aria-describedby={id}
      onPointerDown={() => { pointerDownRef.current = true; }}
      onFocus={() => { if (!pointerDownRef.current) setFocused(true); }}
      onBlur={() => { pointerDownRef.current = false; setFocused(false); }}
      onClick={() => { pointerDownRef.current = false; if (pinned) closeAll(); else setPinned(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && visible && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); closeAll();
        }
      }}>?</button>
    <span id={id} ref={tipRef} role="tooltip" className={styles.tip} hidden={!visible}
      style={position ? { top: position.top, left: position.left } : undefined}>{children}</span>
  </span>;
}

/** A heading with its help next to it. The tip stays outside the heading so the heading's accessible name is only its title. */
export function HelpHeading({ level = 3, id, label, help, children }: Readonly<{ level?: 2 | 3 | 4; id?: string; label: string; help: ReactNode; children: ReactNode }>) {
  const Tag = level === 2 ? "h2" : level === 4 ? "h4" : "h3";
  return <div className={styles.headingRow}><Tag id={id} style={{ margin: 0 }}>{children}</Tag><HelpTip label={label}>{help}</HelpTip></div>;
}
