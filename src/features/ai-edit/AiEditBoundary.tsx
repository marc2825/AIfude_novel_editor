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
import { writingToolOperation, writingToolInput, type WritingToolId } from "./writing-tools";
import { DictionaryPopover } from "./DictionaryPopover";
import { DICTIONARY_QUERY_LIMIT, dictionaryQuerySchema } from "../../domain/dictionary";

const VIEWPORT_MARGIN = 12;
const POPOVER_GAP = 8;
const FALLBACK_POPOVER_WIDTH = 580;
const FALLBACK_POPOVER_HEIGHT = 640;

type Position = Readonly<{ left: number; top: number; maxHeight?: number; maxWidth?: number }>;

export type AiEditBoundaryHandle = Readonly<{
  invalidateContext: () => void;
  invoke: (editor: Editor, instruction?: string) => boolean;
  revalidate: (editor: Editor | null) => void;
}>;

type AiEditBoundaryProps = Readonly<{
  writingTool?: WritingToolId;
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
    return { left: (viewport?.offsetLeft ?? 0) + 8, top: (viewport?.offsetTop ?? 0) + visibleHeight - height - 8,
      maxWidth: Math.max(0, visibleWidth - 16), maxHeight: Math.min(visibleHeight * .82, maxHeight) };
  }
  // Reserve the workspace toolbar and tool rail; the manuscript stays interactive.
  const workbenchElement = editor.view.dom.closest("[data-writing-workbench]");
  const workbench = workbenchElement?.getBoundingClientRect();
  const panel = workbenchElement?.querySelector<HTMLElement>("[data-writing-panel]");
  const minimumTop = Math.max(VIEWPORT_MARGIN, workbench?.top ?? VIEWPORT_MARGIN);
  const rightInset = panel && !panel.hidden ? viewportWidth - panel.getBoundingClientRect().left + VIEWPORT_MARGIN : workbench ? 82 : VIEWPORT_MARGIN;
  const maxHeight = Math.max(120, viewportHeight - minimumTop - VIEWPORT_MARGIN);
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
      maxHeight, maxWidth,
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
    return { left: VIEWPORT_MARGIN, top: minimumTop, maxHeight, maxWidth };
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
  const popoverRef = useRef<EditPopoverHandle>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 12, top: 12 });
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

  const invoke = useCallback(
    (editor: Editor, instruction?: string): boolean => {
      if (instruction !== undefined) controller.close();
      if (controller.getState().kind !== "closed") {
        if (minimized) {
          setMinimized(false);
          requestAnimationFrame(() => popoverRef.current?.focusPrimaryControl());
        } else popoverRef.current?.focusPrimaryControl();
        return true;
      }

      if (writingTool !== "dictionary" && hasAnnotationsInRange(editor.state.doc, editor.state.selection.from, editor.state.selection.to)) {
        setNotice("対象にルビ・傍点があります。注釈を確認して解除してからAI編集してください。本文は変更していません。"); return true;
      }
      const result = captureSelection(editor, captureContextRef.current, writingToolOperation(writingTool) !== undefined ? writingToolOperation(writingTool) : editor.state.selection.empty && writingTool !== "dictionary" ? "insert" : undefined);

      if (result.status === "unavailable") {
        const message = invalidSelectionMessage(result.reason);

        if (message === null) {
          return false;
        }

        setNotice(writingToolOperation(writingTool) === "context-insert" ? "文章を挿入したい位置に、範囲選択せずカーソルを置いてください。" : writingTool === "infill" ? "前後に本文がある空白だけを選択するか、途中の空段落にカーソルを置いてください。" : writingTool === "continue" ? "続けたい章の本文末尾に、範囲選択せずカーソルを置いてください。" : writingTool === "dictionary" ? "意味を調べる語句を選択してください。" : message);
        return true;
      }

      const selectionLength = codePointLength(result.snapshot.originalText);

      if (writingTool === "dictionary" && !dictionaryQuerySchema.safeParse(result.snapshot.originalText).success) {
        setNotice(`意味を調べる語句を1〜${DICTIONARY_QUERY_LIMIT}文字で選択してください。`);
        return true;
      }

      if (selectionLength > AI_EDIT_LIMITS.selectionTextCodePoints) {
        setNotice(
          `選択範囲を${AI_EDIT_LIMITS.selectionTextCodePoints.toLocaleString("ja-JP")}文字以内に短くしてください（現在${selectionLength.toLocaleString("ja-JP")}文字／上限${AI_EDIT_LIMITS.selectionTextCodePoints.toLocaleString("ja-JP")}文字）`,
        );
        return true;
      }

      activeEditorRef.current = editor;

      if (!controller.open(result.snapshot)) {
        return false;
      }

      const opened = controller.getState();
      if (writingTool !== "dictionary" && result.snapshot.operation !== "insert" && opened.kind === "command") {
        controller.updateInput({ ...opened.input, ...writingToolInput(writingTool) });
      }
      if (instruction !== undefined && opened.kind === "command") {
        controller.updateInput({ ...opened.input, instruction, presetId: null });
      }

      setNotice(null);
      setMinimized(false);
      setPosition(positionFor(editor, result.snapshot, null));
      return true;
    },
    [controller, minimized, writingTool],
  );

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

  useLayoutEffect(() => {
    if (snapshot === null) {
      return;
    }

    reposition();
    popoverRef.current?.focusPrimaryControl();
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
      const panel = editor.view.dom.closest("[data-writing-workbench]")?.querySelector("[data-writing-panel]");
      if (panel) observer?.observe(panel);
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
      {machineState.kind === "closed" ? null : writingTool === "dictionary" && machineState.snapshot.operation !== "insert" ? (
        <DictionaryPopover key={machineState.sessionId} query={machineState.snapshot.originalText} stale={machineState.kind === "stale"}
          consent={consent} modelPreference={modelPreference} runtime={runtime}
          onCancel={cancel} onReturnToEditor={returnToEditor} onConsentChange={changeConsent} position={position} ref={popoverRef} />
      ) : (
        <EditPopover
          writingTool={writingTool === "dictionary" ? "rewrite" : writingTool}
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
