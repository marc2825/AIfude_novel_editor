"use client";

import type { Editor } from "@tiptap/core";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AI_EDIT_LIMITS, codePointLength } from "../../domain/limits";
import type {
  AiConsent,
  AiModelPreference,
} from "../../domain/workspace";
import {
  captureSelection,
  type SelectionCaptureContext,
  type SelectionCaptureUnavailableReason,
  type SelectionSnapshot,
} from "../editor/selection";
import {
  createAiEditController,
  type PublicAiRuntime,
} from "./controller";
import type { AiConsentChangeResult } from "./AiConsentDisclosure";
import {
  EditPopover,
  type EditPopoverHandle,
} from "./EditPopover";
import {
  CLOSED_AI_EDIT_STATE,
  type AiEditCommandInput,
  type AiEditMachineState,
} from "./machine";
import styles from "./AiEdit.module.css";
import { hasAnnotationsInRange } from "../editor/annotations";
import { showAiTarget } from "../editor/extensions/ai-target";
import {
  rememberWritingTool, resolveWritingTool, writingToolOperation, writingToolInput, writingToolsFor,
  type WritingToolId, type WritingToolMemory, type WritingToolTarget,
} from "./writing-tools";
import { DictionaryPopover } from "./DictionaryPopover";
import { DICTIONARY_QUERY_LIMIT, dictionaryQuerySchema } from "../../domain/dictionary";

const VIEWPORT_MARGIN = 12;
const POPOVER_GAP = 8;
const FALLBACK_POPOVER_WIDTH = 580;
const FALLBACK_POPOVER_HEIGHT = 640;
const DOCK_INSET = 12;
const MARGIN_MIN_WIDTH = 280;

/** Where the AI panel sits: the side margin on wide screens, a bottom tray on medium ones, a sheet on phones. */
export type AiDock = "floating" | "margin" | "tray" | "sheet";
export type AiPanelPosition = Readonly<{ left: number; top: number; maxHeight?: number; maxWidth?: number; width?: number; dock: AiDock }>;
type Position = AiPanelPosition;

export type AiEditBoundaryHandle = Readonly<{
  invalidateContext: () => void;
  /** Opens a session. Without `tool`, the selection decides the tool (or the fixed `writingTool` prop does). */
  invoke: (editor: Editor, instruction?: string, tool?: WritingToolId) => boolean;
  revalidate: (editor: Editor | null) => void;
}>;

type AiEditBoundaryProps = Readonly<{
  /** Fixed tool for every new session. Changing it closes the open session. */
  writingTool?: WritingToolId;
  /** When given, the selection picks the tool group and this remembers the last tool of each group. */
  toolMemory?: WritingToolMemory;
  onToolMemoryChange?: (memory: WritingToolMemory) => void;
  captureContext: SelectionCaptureContext;
  consent: AiConsent | null;
  modelPreference: AiModelPreference;
  onAccepted?: () => void;
  onConsentChange: (
    providerId: string | null,
  ) => Promise<AiConsentChangeResult>;
  onRequestEditorFocus: (editor: Editor) => void;
  runtime: PublicAiRuntime;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function positionFor(
  editor: Editor,
  snapshot: SelectionSnapshot,
  element: HTMLElement | null,
): Position {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth <= 900) {
    const viewport = window.visualViewport;
    const visibleHeight = viewport?.height ?? viewportHeight;
    const visibleWidth = viewport?.width ?? viewportWidth;
    const maxHeight = Math.max(0, visibleHeight - 16);
    // Keep part of the manuscript reachable; the sheet stays nonmodal even
    // while generating. At keyboard heights, its body scrolls independently.
    const height = Math.min(element?.getBoundingClientRect().height || 640, visibleHeight * .82, maxHeight);
    return { dock: "sheet", left: (viewport?.offsetLeft ?? 0) + 8, top: (viewport?.offsetTop ?? 0) + visibleHeight - height - 8,
      maxWidth: Math.max(0, visibleWidth - 16), maxHeight: Math.min(visibleHeight * .82, maxHeight) };
  }
  const workbenchElement = editor.view.dom.closest("[data-writing-workbench]");
  const workbench = workbenchElement?.getBoundingClientRect();
  const minimumTop = Math.max(VIEWPORT_MARGIN, workbench?.top ?? VIEWPORT_MARGIN);
  const maxHeight = Math.max(120, viewportHeight - minimumTop - VIEWPORT_MARGIN);
  // Wide screens: the panel lives in the reserved margin column and never covers the manuscript.
  const marginBox = workbenchElement?.querySelector<HTMLElement>("[data-ai-margin]")?.getBoundingClientRect();
  if (marginBox && marginBox.width >= MARGIN_MIN_WIDTH) {
    const width = marginBox.width - DOCK_INSET * 2;
    const height = Math.min(element?.getBoundingClientRect().height || FALLBACK_POPOVER_HEIGHT, maxHeight);
    let anchorTop = minimumTop;
    try { anchorTop = editor.view.coordsAtPos(snapshot.originalSelection.head).top - DOCK_INSET; } catch { /* keep the top of the column */ }
    return { dock: "margin", left: marginBox.left + DOCK_INSET, width, maxWidth: width, maxHeight,
      top: clamp(anchorTop, minimumTop, viewportHeight - height - VIEWPORT_MARGIN) };
  }
  // Medium screens: a tray under the manuscript; the text above it stays readable.
  const area = workbenchElement?.querySelector<HTMLElement>("[data-manuscript-area]")?.getBoundingClientRect();
  if (area) {
    const width = Math.max(240, area.width - DOCK_INSET * 2);
    const trayMax = Math.max(160, Math.min(maxHeight, Math.round(viewportHeight * .5)));
    const height = Math.min(element?.getBoundingClientRect().height || trayMax, trayMax);
    return { dock: "tray", left: area.left + DOCK_INSET, width, maxWidth: width, maxHeight: trayMax, top: viewportHeight - height - VIEWPORT_MARGIN };
  }
  // Without the workspace layout (embedding, tests) the panel floats next to the selection.
  const rightInset = VIEWPORT_MARGIN;
  const maxWidth = Math.max(240, viewportWidth - rightInset - VIEWPORT_MARGIN);
  const width = Math.min(element?.getBoundingClientRect().width || FALLBACK_POPOVER_WIDTH, maxWidth);
  const height = Math.min(element?.getBoundingClientRect().height || FALLBACK_POPOVER_HEIGHT, maxHeight);

  try {
    const anchor = editor.view.coordsAtPos(snapshot.originalSelection.head);
    const below = anchor.bottom + POPOVER_GAP;
    const fitsBelow = below + height <= viewportHeight - VIEWPORT_MARGIN;
    const fitsAbove = anchor.top - height - POPOVER_GAP >= minimumTop;
    const top =
      fitsBelow
        ? below
        : anchor.top - height - POPOVER_GAP;

    return {
      dock: "floating", maxHeight, maxWidth,
      left: clamp(
        // A tall panel otherwise covers the manuscript and memory controls.
        !fitsBelow && !fitsAbove ? viewportWidth - width - rightInset : anchor.left,
        VIEWPORT_MARGIN,
        viewportWidth - width - rightInset,
      ),
      top: clamp(
        top,
        minimumTop,
        viewportHeight - height - VIEWPORT_MARGIN,
      ),
    };
  } catch {
    return { dock: "floating", left: VIEWPORT_MARGIN, top: minimumTop, maxHeight, maxWidth };
  }
}

function invalidSelectionMessage(
  reason: SelectionCaptureUnavailableReason,
): string | null {
  switch (reason) {
    case "blank-selection":
    case "empty-selection":
      return "編集する文字列を選択してください";
    case "invalid-completion-target":
      return "補完する空白または章の末尾を指定してください。";
    case "invalid-range":
    case "invalid-text-boundary":
    case "unsupported-selection":
      return "この選択範囲はAI編集に使用できません。";
    case "editor-composing":
    case "editor-destroyed":
    case "editor-not-ready":
    case "editor-read-only":
    case "guard-unavailable":
      return null;
  }
}

function activeSnapshot(state: AiEditMachineState): SelectionSnapshot | null {
  return state.kind === "closed" ? null : state.snapshot;
}

function unavailableToolMessage(tool: WritingToolId, fallback: string): string {
  if (tool === "prompt-insert" || writingToolOperation(tool) === "context-insert") return "文章を挿入したい位置に、範囲選択せずカーソルを置いてください。";
  if (tool === "infill") return "前後に本文がある空白だけを選択するか、途中の空段落にカーソルを置いてください。";
  if (tool === "continue") return "続けたい章の本文末尾に、範囲選択せずカーソルを置いてください。";
  if (tool === "dictionary") return "意味を調べる語句を選択してください。";
  return fallback;
}

function captureOperation(editor: Editor, tool: WritingToolId) {
  if (tool === "prompt-insert") return "insert" as const;
  return writingToolOperation(tool) ?? (editor.state.selection.empty && tool !== "dictionary" ? "insert" as const : undefined);
}

function selectionTarget(editor: Editor): WritingToolTarget {
  const { empty, from, to } = editor.state.selection;
  if (empty) return "caret";
  return editor.state.doc.textBetween(from, to, "\n").trim().length === 0 ? "blank" : "text";
}

function sessionTarget(snapshot: SelectionSnapshot): WritingToolTarget {
  return snapshot.operation !== undefined ? "caret" : "text";
}

export const AiEditBoundary = forwardRef<
  AiEditBoundaryHandle,
  AiEditBoundaryProps
>(function AiEditBoundary(
  {
    captureContext,
    consent,
    modelPreference,
    onAccepted,
    onConsentChange,
    onRequestEditorFocus,
    runtime,
    toolMemory,
    onToolMemoryChange,
    writingTool = "rewrite",
  },
  forwardedRef,
) {
  const activeEditorRef = useRef<Editor | null>(null);
  const captureContextRef = useRef(captureContext);
  const consentRef = useRef(consent);
  const modelPreferenceRef = useRef(modelPreference);
  const runtimeRef = useRef(runtime);
  const previousToolRef = useRef(writingTool);
  const toolMemoryRef = useRef(toolMemory);
  const onToolMemoryChangeRef = useRef(onToolMemoryChange);
  const popoverRef = useRef<EditPopoverHandle>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [sessionTool, setSessionTool] = useState<WritingToolId>(writingTool);
  const [position, setPosition] = useState<Position>({ dock: "floating", left: 12, top: 12 });
  toolMemoryRef.current = toolMemory;
  onToolMemoryChangeRef.current = onToolMemoryChange;
  const [machineState, setMachineState] = useState<AiEditMachineState>(
    CLOSED_AI_EDIT_STATE,
  );
  captureContextRef.current = captureContext;
  consentRef.current = consent;
  modelPreferenceRef.current = modelPreference;
  runtimeRef.current = runtime;

  const [controller] = useState(() =>
    createAiEditController({
      getCaptureContext: () => captureContextRef.current,
      getConsent: () => consentRef.current,
      getEditor: () => activeEditorRef.current,
      getModelPreference: () => modelPreferenceRef.current,
      getRuntime: () => runtimeRef.current,
      onStateChange: setMachineState,
    }),
  );

  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);

  useLayoutEffect(() => {
    if (previousToolRef.current !== writingTool) {
      const current = controller.getState();
      // The rail selects a local editing tool; prompt-only insertion is independent.
      if (current.kind === "closed" || current.snapshot.operation !== "insert" || writingToolOperation(writingTool) !== undefined) {
        controller.close();
        setMinimized(false);
        activeEditorRef.current = null;
        setNotice(null);
      }
      previousToolRef.current = writingTool;
    }
  }, [controller, writingTool]);

  const revalidate = useCallback(
    (editor: Editor | null) => {
      controller.revalidate(editor);
    },
    [controller],
  );

  /** Validates the tool against the current selection, then replaces any open session with a new one. */
  const openWith = useCallback(
    (editor: Editor, tool: WritingToolId, instruction?: string): "opened" | "refused" | "unavailable" => {
      if (tool !== "dictionary" && hasAnnotationsInRange(editor.state.doc, editor.state.selection.from, editor.state.selection.to)) {
        setNotice("対象にルビ・傍点があります。注釈を確認して解除してからAI編集してください。本文は変更していません。"); return "refused";
      }
      const result = captureSelection(editor, captureContextRef.current, captureOperation(editor, tool));

      if (result.status === "unavailable") {
        const message = invalidSelectionMessage(result.reason);

        if (message === null) {
          return "unavailable";
        }

        setNotice(unavailableToolMessage(tool, message));
        return "refused";
      }

      const selectionLength = codePointLength(result.snapshot.originalText);

      if (tool === "dictionary" && !dictionaryQuerySchema.safeParse(result.snapshot.originalText).success) {
        setNotice(`意味を調べる語句を1〜${DICTIONARY_QUERY_LIMIT}文字で選択してください。`);
        return "refused";
      }

      if (selectionLength > AI_EDIT_LIMITS.selectionTextCodePoints) {
        setNotice(
          `選択範囲を${AI_EDIT_LIMITS.selectionTextCodePoints.toLocaleString("ja-JP")}文字以内に短くしてください（現在${selectionLength.toLocaleString("ja-JP")}文字／上限${AI_EDIT_LIMITS.selectionTextCodePoints.toLocaleString("ja-JP")}文字）`,
        );
        return "refused";
      }

      // The old session, its request and its candidates end here; a late response is dropped by its request ID.
      if (controller.getState().kind !== "closed") controller.close();
      activeEditorRef.current = editor;

      if (!controller.open(result.snapshot)) {
        activeEditorRef.current = null;
        return "unavailable";
      }

      const opened = controller.getState();
      if (tool !== "dictionary" && result.snapshot.operation !== "insert" && opened.kind === "command") {
        controller.updateInput({ ...opened.input, ...writingToolInput(tool) });
      }
      if (instruction !== undefined && opened.kind === "command") {
        controller.updateInput({ ...opened.input, instruction, presetId: null });
      }

      setSessionTool(result.snapshot.operation === "insert" ? "prompt-insert" : tool);
      setNotice(null);
      setMinimized(false);
      setPosition(positionFor(editor, result.snapshot, null));
      return "opened";
    },
    [controller],
  );

  const rememberTool = useCallback((tool: WritingToolId) => {
    const memory = toolMemoryRef.current;
    if (memory === undefined) return;
    const next = rememberWritingTool(memory, tool);
    if (next !== memory) { toolMemoryRef.current = next; onToolMemoryChangeRef.current?.(next); }
  }, []);

  const invoke = useCallback(
    (editor: Editor, instruction?: string, requestedTool?: WritingToolId): boolean => {
      if (instruction !== undefined) controller.close();
      if (controller.getState().kind !== "closed" && (requestedTool === undefined || requestedTool === sessionTool)) {
        if (minimized) {
          setMinimized(false);
          requestAnimationFrame(() => popoverRef.current?.focusPrimaryControl());
        } else popoverRef.current?.focusPrimaryControl();
        return true;
      }

      const memory = toolMemoryRef.current;
      let tool = requestedTool ?? (memory === undefined ? writingTool : resolveWritingTool(selectionTarget(editor), memory));
      // A remembered writing tool may not fit this caret (for example "continue" away from the chapter end).
      if (requestedTool === undefined && memory !== undefined && tool !== "prompt-insert" && editor.state.selection.empty
        && captureSelection(editor, captureContextRef.current, captureOperation(editor, tool)).status === "unavailable") tool = "prompt-insert";
      const result = openWith(editor, tool, instruction);
      if (result === "opened" && requestedTool !== undefined) rememberTool(requestedTool);
      return result !== "unavailable";
    },
    [controller, minimized, openWith, rememberTool, sessionTool, writingTool],
  );

  /** Switches the tool from inside the panel. An unsuitable tool leaves the open session as it is. */
  const changeTool = useCallback((tool: WritingToolId) => {
    const editor = activeEditorRef.current;
    const current = controller.getState();
    if (editor === null || editor.isDestroyed || current.kind === "closed" || current.kind === "stale" || tool === sessionTool) return;
    if (openWith(editor, tool) === "opened") {
      // Arrow keys walk through the radios; focus must stay on the picker between steps.
      keepPickerFocusRef.current = true;
      rememberTool(tool);
    }
  }, [controller, openWith, rememberTool, sessionTool]);

  useImperativeHandle(
    forwardedRef,
    () => ({ invoke, revalidate, invalidateContext: () => controller.invalidateContext() }),
    [controller, invoke, revalidate],
  );

  useEffect(() => {
    revalidate(activeEditorRef.current);
  }, [captureContext, revalidate]);

  const reposition = useCallback(() => {
    const editor = activeEditorRef.current;
    const snapshot = activeSnapshot(controller.getState());

    if (editor === null || snapshot === null || editor.isDestroyed) {
      return;
    }

    setPosition(
      positionFor(editor, snapshot, popoverRef.current?.element() ?? null),
    );
  }, [controller]);

  const snapshot = activeSnapshot(machineState);
  const targetVisible = snapshot !== null && machineState.kind !== "stale";

  // Keep the target visible in the manuscript while focus is in the AI panel.
  useEffect(() => {
    const editor = activeEditorRef.current;
    if (!targetVisible || snapshot === null || editor === null || editor.isDestroyed) return;
    showAiTarget(editor, { from: snapshot.from, to: snapshot.to });
    return () => { if (!editor.isDestroyed) showAiTarget(editor, null); };
  }, [snapshot, targetVisible]);

  // A tray takes room below the manuscript: reserve it and bring the target above it once.
  const keepPickerFocusRef = useRef(false);
  const trayScrolledFor = useRef<SelectionSnapshot | null>(null);
  useEffect(() => {
    const editor = activeEditorRef.current;
    const workbench = editor === null || editor.isDestroyed ? null : editor.view.dom.closest<HTMLElement>("[data-writing-workbench]");
    if (snapshot === null || minimized || position.dock !== "tray" || editor === null || !workbench) return;
    const height = popoverRef.current?.element()?.getBoundingClientRect().height ?? 0;
    workbench.style.setProperty("--ai-dock-inset", `${Math.round(height + VIEWPORT_MARGIN * 2)}px`);
    if (trayScrolledFor.current !== snapshot && height > 0) {
      trayScrolledFor.current = snapshot;
      try {
        const head = editor.view.coordsAtPos(snapshot.originalSelection.head);
        const overlap = head.bottom - (position.top - 16);
        if (overlap > 0) workbench.querySelector<HTMLElement>("[data-manuscript-area]")?.scrollBy({ top: overlap });
      } catch { /* the target stays where it is */ }
    }
    return () => { workbench.style.removeProperty("--ai-dock-inset"); };
  }, [minimized, position.dock, position.top, snapshot]);

  useLayoutEffect(() => {
    if (snapshot === null) {
      return;
    }

    reposition();
    const picked = keepPickerFocusRef.current
      ? popoverRef.current?.element()?.querySelector<HTMLInputElement>('input[name="ai-tool"]:checked') ?? null
      : null;
    keepPickerFocusRef.current = false;
    if (picked) picked.focus({ preventScroll: true });
    else popoverRef.current?.focusPrimaryControl();
  }, [reposition, snapshot]);

  useEffect(() => {
    if (snapshot === null) {
      return;
    }

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    const element = popoverRef.current?.element();
    if (element) observer?.observe(element);
    const editor = activeEditorRef.current;
    if (editor && !editor.isDestroyed) {
      observer?.observe(editor.view.dom);
      const workbench = editor.view.dom.closest("[data-writing-workbench]");
      for (const selector of ["[data-ai-margin]", "[data-manuscript-area]"]) {
        const region = workbench?.querySelector(selector);
        if (region) observer?.observe(region);
      }
    }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", reposition);
    viewport?.addEventListener("scroll", reposition);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      viewport?.removeEventListener("resize", reposition);
      viewport?.removeEventListener("scroll", reposition);
    };
  }, [reposition, snapshot]);

  const cancel = useCallback(() => {
    const editor = activeEditorRef.current;
    const popover = popoverRef.current?.element() ?? null;
    const shouldRestoreFocus =
      minimized || (popover !== null && popover.contains(document.activeElement));

    controller.close();
    setMinimized(false);
    activeEditorRef.current = null;
    setNotice(null);

    if (shouldRestoreFocus && editor !== null && !editor.isDestroyed) {
      queueMicrotask(() => onRequestEditorFocus(editor));
    }
  }, [controller, minimized, onRequestEditorFocus]);

  const updateInput = useCallback(
    (input: AiEditCommandInput) => controller.updateInput(input),
    [controller],
  );

  const selectCandidate = useCallback(
    (candidateId: string) => controller.selectCandidate(candidateId),
    [controller],
  );

  const changeConsent = useCallback(
    async (providerId: string | null) => {
      const popover = popoverRef.current?.element() ?? null;
      const result = await onConsentChange(providerId);
      const activeElement = document.activeElement;
      const shouldKeepFocus =
        popover !== null &&
        (popover.contains(activeElement) || activeElement === document.body);

      if (result.ok && shouldKeepFocus) {
        setTimeout(() => popoverRef.current?.focusCloseControl(), 0);
      }

      return result;
    },
    [onConsentChange],
  );

  const accept = useCallback(() => {
    const editor = activeEditorRef.current;
    const result = controller.accept();

    if (result?.status !== "applied") {
      return;
    }

    activeEditorRef.current = null;
    setNotice(null);
    onAccepted?.();
    setMinimized(false);

    if (editor !== null && !editor.isDestroyed) {
      queueMicrotask(() => onRequestEditorFocus(editor));
    }
  }, [controller, onAccepted, onRequestEditorFocus]);

  const submit = useCallback(() => {
    // Keep keyboard focus inside the popover before its input becomes disabled.
    const popover = popoverRef.current?.element();
    if (popover?.contains(document.activeElement)) popoverRef.current?.focusCloseControl();
    void controller.submit();
  }, [controller]);

  const returnToEditor = useCallback(() => {
    const editor = activeEditorRef.current;
    setMinimized(true);
    if (editor && !editor.isDestroyed) onRequestEditorFocus(editor);
  }, [onRequestEditorFocus]);

  return (
    <>
      {notice === null ? null : (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {minimized && machineState.kind !== "closed" ? <div className={styles.resumeSession}>
        <span role="status">{machineState.kind === "stale" ? "AIの対象は期限切れです" : machineState.kind === "generating" ? "AI生成中" : machineState.kind === "preview" ? "AI候補が届いています" : "AI画面を保持しています"}</span>
        <button type="button" onClick={() => {
          setMinimized(false);
          requestAnimationFrame(() => { reposition(); popoverRef.current?.focusCloseControl(); });
        }}>AI画面に戻る</button>
        <button type="button" onClick={cancel} aria-label="保持中のAI画面を閉じる">閉じる</button>
      </div> : null}
      <div hidden={minimized}>
      {machineState.kind === "closed" ? null : sessionTool === "dictionary" && machineState.snapshot.operation !== "insert" ? (
        <DictionaryPopover key={machineState.sessionId} query={machineState.snapshot.originalText} stale={machineState.kind === "stale"}
          consent={consent} modelPreference={modelPreference} runtime={runtime}
          tools={writingToolsFor(sessionTarget(machineState.snapshot))} onToolChange={changeTool}
          onCancel={cancel} onReturnToEditor={returnToEditor} onConsentChange={changeConsent} position={position} ref={popoverRef} />
      ) : (
        <EditPopover
          writingTool={sessionTool === "dictionary" ? "rewrite" : sessionTool}
          tools={writingToolsFor(sessionTarget(machineState.snapshot))}
          onToolChange={changeTool}
          canSubmit={controller.canSubmit()}
          consent={consent}
          modelPreference={modelPreference}
          onAccept={accept}
          onPartialSelectionChange={(ids) => controller.selectPartialHunks(ids)}
          onCancel={cancel}
          onReturnToEditor={returnToEditor}
          onConsentChange={changeConsent}
          onInputChange={updateInput}
          onSelectCandidate={selectCandidate}
          onSubmit={submit}
          position={position}
          ref={popoverRef}
          runtime={runtime}
          state={machineState}
        />
      )}
      </div>
    </>
  );
});
