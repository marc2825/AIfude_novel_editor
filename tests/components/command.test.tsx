import type { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useCallback, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  validateAiEditRequest,
  type AiEditRequest,
} from "../../src/domain/ai-edit";
import { AI_MODEL_PREFERENCE_AUTOMATIC } from "../../src/domain/ai-models";
import type {
  AiConsent,
  AiModelPreference,
} from "../../src/domain/workspace";
import {
  AiEditBoundary,
  type AiEditBoundaryHandle,
} from "../../src/features/ai-edit/AiEditBoundary";
import type { AiConsentChangeResult } from "../../src/features/ai-edit/AiConsentDisclosure";
import type { PublicAiRuntime } from "../../src/features/ai-edit/controller";
import { parseDiffWorkerRequest } from "../../src/features/ai-edit/diff/protocol";
import { NovelEditor } from "../../src/features/editor/NovelEditor";
import type { SelectionCaptureContext } from "../../src/features/editor/selection";
import { documentToPlainText } from "../../src/features/editor/plain-text";
import { plainTextOffsetToProseMirrorPosition } from "../../src/features/editor/selection";
import { getEditGuardState } from "../../src/features/editor/plugins/edit-guard";
import {
  dispatchComposition,
  dispatchKey,
  setTextSelection,
} from "../helpers/editor";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import {
  MOCK_AI_RUNTIME,
  OPENAI_AI_RUNTIME,
} from "../fixtures/ai-runtime";
import { createDeferred } from "../helpers/deferred";
import { FakeDiffWorker } from "../helpers/diff-worker";
import { DEFAULT_WRITING_TOOL_MEMORY, type WritingToolId, type WritingToolMemory } from "../../src/features/ai-edit/writing-tools";
import { dictionaryGenerationRequest, dictionaryRequestSchema } from "../../src/domain/dictionary";

const captureObservation = vi.hoisted(() => ({ spy: vi.fn() }));

vi.mock("../../src/features/editor/selection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/features/editor/selection")
  >();

  return {
    ...actual,
    captureSelection(
      editor: Editor | null,
      context: SelectionCaptureContext,
      operation?: import("../../src/domain/completion").AiTextOperation,
    ) {
      const activeElement = document.activeElement;
      const result = actual.captureSelection(editor, context, operation);
      captureObservation.spy({ activeElement, result });
      return result;
    },
  };
});

const BASE_CONTEXT = Object.freeze({
  chapterId: "22222222-2222-4222-8222-222222222222",
  commonPrompt: "余韻を保つ",
  contextRevision: 3,
  documentId: "11111111-1111-4111-8111-111111111111",
  editable: true,
  manualStyle: "静かな文体",
  projectId: "00000000-0000-4000-8000-000000000000",
} satisfies SelectionCaptureContext);

const MOCK_RUNTIME = MOCK_AI_RUNTIME;
const OPENAI_RUNTIME = OPENAI_AI_RUNTIME;

const OPENAI_CONSENT = Object.freeze({
  grantedAt: "2026-09-20T00:00:00.000Z",
  policyVersion: 1 as const,
  providerId: "openai",
});

const rejectConsentChange = async (): Promise<AiConsentChangeResult> => ({
  ok: false,
});

type HarnessProps = Readonly<{
  writingTool?: WritingToolId;
  toolMemory?: WritingToolMemory;
  onToolMemoryChange?: (memory: WritingToolMemory) => void;
  consent?: AiConsent | null;
  context?: SelectionCaptureContext;
  editorKey?: string;
  initialText?: string;
  modelPreference?: AiModelPreference;
  onAccepted?: () => void;
  onConsentChange?: (
    providerId: string | null,
  ) => Promise<AiConsentChangeResult>;
  onDocumentChange?: (editor: Editor) => void;
  onEditorReady: (editor: Editor) => void;
  runtime?: PublicAiRuntime;
}>;

function CommandHarness({
  writingTool = "rewrite",
  toolMemory,
  onToolMemoryChange,
  consent = null,
  context = BASE_CONTEXT,
  editorKey = "editor-a",
  initialText = "春の風と夏の雨",
  modelPreference = AI_MODEL_PREFERENCE_AUTOMATIC,
  onAccepted,
  onConsentChange = rejectConsentChange,
  onDocumentChange,
  onEditorReady,
  runtime = MOCK_RUNTIME,
}: HarnessProps) {
  const boundaryRef = useRef<AiEditBoundaryHandle>(null);
  const editorRef = useRef<Editor | null>(null);

  const handleCommand = useCallback((editor: Editor) => {
    return boundaryRef.current?.invoke(editor) ?? false;
  }, []);
  const handleDictionary = useCallback((editor: Editor) => {
    return boundaryRef.current?.invoke(editor, undefined, "dictionary") ?? false;
  }, []);
  const handleReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      onEditorReady(editor);
      boundaryRef.current?.revalidate(editor);
    },
    [onEditorReady],
  );
  const handleDestroy = useCallback((editor: Editor) => {
    if (editorRef.current === editor) {
      editorRef.current = null;
    }

    boundaryRef.current?.revalidate(editor);
  }, []);
  const handleTransaction = useCallback((editor: Editor) => {
    boundaryRef.current?.revalidate(editor);
  }, []);
  const requestFocus = useCallback((editor: Editor) => {
    if (editorRef.current === editor && !editor.isDestroyed) {
      editor.view.focus();
    }
  }, []);

  return (
    <>
      <NovelEditor
        editable={context.editable}
        initialText={initialText}
        key={editorKey}
        onAiCommand={handleCommand}
        onDictionaryCommand={handleDictionary}
        onDocumentChange={onDocumentChange}
        onEditorDestroy={handleDestroy}
        onEditorReady={handleReady}
        onEditorTransaction={handleTransaction}
      />
      <AiEditBoundary
        writingTool={writingTool}
        toolMemory={toolMemory}
        onToolMemoryChange={onToolMemoryChange}
        captureContext={context}
        consent={consent}
        modelPreference={modelPreference}
        onAccepted={onAccepted}
        onConsentChange={onConsentChange}
        onRequestEditorFocus={requestFocus}
        ref={boundaryRef}
        runtime={runtime}
      />
    </>
  );
}

async function renderHarness(
  options: Partial<Omit<HarnessProps, "onEditorReady">> = {},
) {
  let editor: Editor | null = null;
  const onEditorReady = vi.fn((readyEditor: Editor) => {
    editor = readyEditor;
  });
  const view = render(
    <CommandHarness
      {...options}
      onEditorReady={onEditorReady}
    />,
  );
  const editorElement = await within(view.container).findByRole("textbox", {
    name: "小説本文",
  });
  await waitFor(() => expect(editor).not.toBeNull());

  return {
    container: view.container,
    editor: () => {
      if (editor === null) {
        throw new Error("editor is not ready");
      }

      return editor;
    },
    editorElement,
    onEditorReady,
    rerender(next: Partial<Omit<HarnessProps, "onEditorReady">>) {
      view.rerender(
        <CommandHarness
          {...options}
          {...next}
          onEditorReady={onEditorReady}
        />,
      );
    },
  };
}

function selectAndFocus(editor: Editor, from: number, to: number) {
  act(() => {
    setTextSelection(editor, from, to);
    editor.view.focus();
  });
}

function openWithShortcut(
  editorElement: HTMLElement,
  modifier: "ctrl" | "meta" = "ctrl",
) {
  return dispatchKey(editorElement, "k", {
    ctrlKey: modifier === "ctrl",
    keyCode: 75,
    metaKey: modifier === "meta",
  });
}

beforeEach(() => {
  captureObservation.spy.mockClear();
});

afterEach(() => {
  FakeDiffWorker.reset();
  vi.unstubAllGlobals();
});

describe("AI edit command UI", () => {
  it("captures the current PM selection on tap and leaves native touch selection and composition alone", async () => {
    const harness = await renderHarness({ initialText: "前対象後" });
    selectAndFocus(harness.editor(), 2, 4);
    const trigger = screen.getByRole("button", { name: "AI提案" });
    fireEvent.pointerDown(harness.editorElement, { pointerType: "touch" });
    const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(harness.editorElement, context);
    expect(context.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.compositionStart(harness.editorElement);
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    fireEvent(trigger, down); fireEvent.click(trigger);
    expect(down.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.compositionEnd(harness.editorElement);
    await waitFor(() => expect(harness.editor().view.composing).toBe(false));
    selectAndFocus(harness.editor(), 2, 4);
    fireEvent.pointerDown(trigger); fireEvent.click(trigger);
    expect(await screen.findByRole("region", { name: "推敲する原文" })).toHaveTextContent("対象");
    expect(harness.editor().state.selection.from).toBe(2);
    expect(harness.editor().state.selection.to).toBe(4);
    expect(documentToPlainText(harness.editor().state.doc)).toBe("前対象後");
    expect(undoDepth(harness.editor().state)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "AI編集をキャンセル" }));
  });

  it("repositions the sheet on visual viewport resize/scroll without refreshing the snapshot or draft", async () => {
    vi.stubGlobal("innerWidth", 390);
    const viewport = Object.assign(new EventTarget(), { height: 700, width: 390, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal("visualViewport", viewport);
    const harness = await renderHarness({ initialText: "前対象後" });
    selectAndFocus(harness.editor(), 2, 4);
    fireEvent.click(screen.getByRole("button", { name: "AI提案" }));
    const dialog = await screen.findByRole("dialog", { name: "AI編集コマンド" });
    const input = screen.getByRole("textbox", { name: "編集の指示" });
    fireEvent.change(input, { target: { value: "入力中の指示" } });
    const captures = captureObservation.spy.mock.calls.length;
    act(() => { viewport.height = 280; viewport.offsetTop = 100; viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); });
    expect(parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(280);
    expect(parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(100);
    expect(parseFloat(dialog.style.top) + parseFloat(dialog.style.maxHeight)).toBeLessThanOrEqual(380);
    expect(input).toHaveValue("入力中の指示");
    expect(captureObservation.spy.mock.calls).toHaveLength(captures);
    expect(harness.editor().state.selection.from).toBe(2);
    expect(screen.queryByText(/期限切れです/u)).not.toBeInTheDocument();
  });

  it("keeps focus during instruction composition and retains the draft when returning to the manuscript", async () => {
    const harness = await renderHarness({ initialText: "前対象後" });
    selectAndFocus(harness.editor(), 2, 4);
    fireEvent.click(screen.getByRole("button", { name: "AI提案" }));
    const input = await screen.findByRole("textbox", { name: "編集の指示" });
    fireEvent.change(input, { target: { value: "入力中の指示" } });
    fireEvent.compositionStart(input);
    fireEvent.click(screen.getByRole("button", { name: "本文へ" }));
    expect(input).toHaveFocus(); expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.compositionEnd(input);
    fireEvent.click(screen.getByRole("button", { name: "本文へ" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(harness.editorElement).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "AI画面に戻る" }));
    expect(screen.getByRole("textbox", { name: "編集の指示" })).toHaveValue("入力中の指示");
    expect(harness.editor().state.selection.from).toBe(2);
    expect(harness.editor().state.selection.to).toBe(4);
  });

  it("uses existing history for touch Undo/Redo and refuses both during composition", async () => {
    const harness = await renderHarness({ initialText: "原稿" });
    // jsdom has no layout Range metrics; browser E2E verifies the actual scroll.
    harness.editor().view.setProps({ handleScrollToSelection: () => true });
    act(() => { harness.editor().commands.insertContent("手入力"); });
    const changed = documentToPlainText(harness.editor().state.doc);
    const undoButton = screen.getByRole("button", { name: "元に戻す" });
    fireEvent.compositionStart(harness.editorElement);
    fireEvent.click(undoButton);
    expect(documentToPlainText(harness.editor().state.doc)).toBe(changed);
    fireEvent.compositionEnd(harness.editorElement);
    await waitFor(() => expect(harness.editor().view.composing).toBe(false));
    fireEvent.click(undoButton); expect(documentToPlainText(harness.editor().state.doc)).toBe("原稿");
    fireEvent.compositionStart(harness.editorElement);
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(documentToPlainText(harness.editor().state.doc)).toBe("原稿");
    fireEvent.compositionEnd(harness.editorElement);
    await waitFor(() => expect(harness.editor().view.composing).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(documentToPlainText(harness.editor().state.doc)).toBe(changed);
  });

  it("requires content for contextual insertion and discards old candidates when the content changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = validateAiEditRequest(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
      if (!request.success) throw new Error("Invalid request");
      expect(request.data).toMatchObject({ operation: "context-insert", beforeText: "前。", afterText: "後。", selectionText: "", presetId: null });
      return Response.json(createAiEditSuccessResponseFixture(request.data));
    });
    const h = await renderHarness({ writingTool: "context-insert", initialText: "前。後。" });
    selectAndFocus(h.editor(), 3, 3); act(() => { openWithShortcut(h.editorElement); });
    const dialog = screen.getByRole("dialog", { name: "AI文脈挿入" });
    const content = within(dialog).getByRole("textbox", { name: "書きたい内容" });
    expect(content).toHaveFocus(); expect(content).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "生成" })).toBeDisabled();
    for (const value of ["　\n", "指".repeat(501)]) {
      fireEvent.change(content, { target: { value } });
      expect(within(dialog).getByRole("button", { name: "生成" })).toBeDisabled();
    }
    fireEvent.change(content, { target: { value: "主人公のためらう仕草" } });
    fireEvent.compositionStart(content);
    dispatchKey(content, "Enter", { ctrlKey: true, isComposing: true });
    expect(fetchSpy).not.toHaveBeenCalled(); fireEvent.compositionEnd(content);
    fireEvent.click(within(dialog).getByRole("button", { name: "生成" }));
    await within(dialog).findByRole("button", { name: "採用" });
    expect(documentToPlainText(h.editor().state.doc)).toBe("前。後。"); expect(undoDepth(h.editor().state)).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "指示・送信設定を変更" }));
    fireEvent.change(content, { target: { value: "雨の音を描写" } });
    expect(within(dialog).queryByRole("button", { name: "採用" })).not.toBeInTheDocument(); expect(fetchSpy).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole("button", { name: "生成" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "採用" }));
    expect(documentToPlainText(h.editor().state.doc)).toBe("前。【デモ候補1】後。"); expect(undoDepth(h.editor().state)).toBe(1);
  });

  it.each(["infill", "continue"] as const)("%s validates the target length, previews actual length, and requires explicit Accept", async (writingTool) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = validateAiEditRequest(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
      if (!request.success) throw new Error("Invalid request");
      expect(request.data).toMatchObject({ operation: writingTool, targetCharacters: 250, candidateCount: 1 });
      expect(request.data.beforeText).toBe("前。");
      expect(request.data.afterText).toBe(writingTool === "infill" ? "後。" : "");
      return Response.json(createAiEditSuccessResponseFixture(request.data));
    });
    const initialText = writingTool === "infill" ? "前。　後。" : "前。";
    const h = await renderHarness({ writingTool, initialText });
    selectAndFocus(h.editor(), 3, writingTool === "infill" ? 4 : 3);
    act(() => { openWithShortcut(h.editorElement); });
    const dialog = screen.getByRole("dialog", { name: writingTool === "infill" ? "AI中間補完" : "AIの続き執筆" });
    const target = within(dialog).getByRole("spinbutton", { name: "目標文字数" });
    for (const value of ["", "0", "3001", "1.5"]) {
      fireEvent.change(target, { target: { value } });
      expect(within(dialog).getByRole("button", { name: "生成" })).toBeDisabled();
    }
    fireEvent.change(target, { target: { value: "250" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "生成" }));
    await within(dialog).findByRole("button", { name: "採用" });
    expect(within(dialog).getByText(/目標 250文字/u)).toBeVisible();
    expect(documentToPlainText(h.editor().state.doc)).toBe(initialText);
    expect(undoDepth(h.editor().state)).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "指示・送信設定を変更" }));
    fireEvent.change(target, { target: { value: "200" } });
    expect(within(dialog).queryByRole("button", { name: "採用" })).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(documentToPlainText(h.editor().state.doc)).toBe(initialText);
  });

  it.each(["infill", "context-insert"] as const)("closes a generating %s on mode change and ignores its late response", async (writingTool) => {
    const pending = createDeferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    const h = await renderHarness({ writingTool, initialText: "前。　後。" });
    selectAndFocus(h.editor(), 3, writingTool === "infill" ? 4 : 3);
    act(() => { openWithShortcut(h.editorElement); });
    if (writingTool === "context-insert") fireEvent.change(screen.getByRole("textbox", { name: "書きたい内容" }), { target: { value: "雨の音" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    const options = fetchSpy.mock.calls[0]?.[1];
    const parsed = validateAiEditRequest(JSON.parse(typeof options?.body === "string" ? options.body : "null"));
    if (!parsed.success) throw new Error("Missing request");
    h.rerender({ writingTool: "rewrite" });
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(Response.json(createAiEditSuccessResponseFixture(parsed.data))); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(documentToPlainText(h.editor().state.doc)).toBe("前。　後。");
  });

  it.each(["infill", "continue", "context-insert"] as const)("%s rejects an ordinary selected sentence without sending", async (writingTool) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const h = await renderHarness({ writingTool }); selectAndFocus(h.editor(), 1, 3);
    act(() => { openWithShortcut(h.editorElement); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(writingTool === "context-insert" ? "挿入したい位置" : writingTool === "infill" ? "空白だけ" : "本文末尾");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("looks up a word without sending manuscript context, interpreting HTML, or offering Accept", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe("/api/ai/dictionary");
      const value: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null");
      const request = dictionaryRequestSchema.parse(value);
      expect(request.query).toBe("春の風と");
      expect(value).not.toHaveProperty("beforeText"); expect(value).not.toHaveProperty("storyMemory");
      const response = createAiEditSuccessResponseFixture(dictionaryGenerationRequest(request));
      return Response.json({ ...response, candidates: response.candidates.map((candidate) => ({ ...candidate, replacementText: "意味：<img src=x onerror=alert(1)>" })) });
    });
    const harness = await renderHarness({ writingTool: "dictionary" });
    const editor = harness.editor(); selectAndFocus(editor, 1, 5);
    const original = editor.state.doc; const depth = undoDepth(editor.state);
    openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "語句を調べる" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "LLMで調べる" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "LLMで調べる" }));
    await screen.findByText("意味：<img src=x onerror=alert(1)>");
    expect(harness.container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "採用" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    const search = screen.getByRole("link", { name: "Googleで意味を検索（別タブ）" });
    expect(search).toHaveAttribute("rel", "noopener noreferrer");
    expect(search).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(editor.state.doc).toBe(original); expect(undoDepth(editor.state)).toBe(depth);
  });

  it("cancels dictionary lookup and rejects its late reply after a new lookup succeeds", async () => {
    const pending = createDeferred<Response>();
    const observed: { signal: AbortSignal | null; response: Response | null } = { signal: null, response: null };
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = dictionaryRequestSchema.parse(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
      calls++;
      const response = createAiEditSuccessResponseFixture(dictionaryGenerationRequest(request));
      const result = Response.json({ ...response, candidates: response.candidates.map((candidate) => ({ ...candidate, replacementText: calls === 1 ? "古い語義" : "新しい語義" })) });
      if (calls === 1) {
        observed.signal = init?.signal instanceof AbortSignal ? init.signal : null;
        observed.response = result; return pending.promise;
      }
      return result;
    });
    const harness = await renderHarness({ writingTool: "dictionary" });
    const editor = harness.editor(); selectAndFocus(editor, 1, 5); const original = editor.state.doc;
    openWithShortcut(harness.editorElement);
    fireEvent.click(await screen.findByRole("button", { name: "LLMで調べる" }));
    fireEvent.click(await screen.findByRole("button", { name: "照会を中止" }));
    expect(observed.signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "LLMで調べる" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "LLMで調べる" }));
    await screen.findByText("新しい語義");
    await act(async () => { pending.resolve(observed.response ?? new Response()); await pending.promise; });
    expect(screen.queryByText("古い語義")).toBeNull(); expect(editor.state.doc).toBe(original);
    act(() => setTextSelection(editor, 2, 5));
    await screen.findByText(/この辞書照会は期限切れ/u);
    expect(screen.queryByText("新しい語義")).toBeNull();
    expect(screen.queryByRole("link", { name: "Googleで意味を検索（別タブ）" })).toBeNull();
  });

  it("aborts dictionary lookup when changing modes and ignores an abort-ignoring response", async () => {
    const pending = createDeferred<Response>();
    const observed: { signal: AbortSignal | null } = { signal: null };
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      observed.signal = init?.signal instanceof AbortSignal ? init.signal : null;
      return pending.promise;
    });
    const harness = await renderHarness({ writingTool: "dictionary" });
    selectAndFocus(harness.editor(), 1, 5); const original = harness.editor().state.doc;
    openWithShortcut(harness.editorElement);
    fireEvent.click(await screen.findByRole("button", { name: "LLMで調べる" }));
    harness.rerender({ writingTool: "expand" });
    expect(observed.signal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { pending.resolve(new Response()); await pending.promise; });
    expect(harness.editor().state.doc).toBe(original);
  });

  it("requires a bounded selection for dictionary and keeps external API lookup off without opt-in", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness({ writingTool: "dictionary", initialText: "語".repeat(101), runtime: { ...OPENAI_RUNTIME, paidApiEnabled: false }, consent: OPENAI_CONSENT });
    selectAndFocus(harness.editor(), 1, 1); openWithShortcut(harness.editorElement);
    expect(await screen.findByText("意味を調べる語句を選択してください。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    selectAndFocus(harness.editor(), 1, 102); openWithShortcut(harness.editorElement);
    await screen.findByText("意味を調べる語句を1〜100文字で選択してください。");
    expect(screen.queryByRole("dialog")).toBeNull();
    selectAndFocus(harness.editor(), 1, 3); openWithShortcut(harness.editorElement);
    expect(await screen.findByRole("button", { name: "LLMで調べる" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Googleで意味を検索（別タブ）" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("closes an old tool session and discards an abort-ignoring reply after opening another tool", async () => {
    const pending = createDeferred<Response>();
    let request: AiEditRequest | null = null;
    const observed: { signal: AbortSignal | null } = { signal: null };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const parsed = validateAiEditRequest(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      if (!parsed.success) throw new Error("Invalid test request");
      request = parsed.data;
      observed.signal = init?.signal instanceof AbortSignal ? init.signal : null;
      return pending.promise;
    });
    const harness = await renderHarness({ writingTool: "expand" });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const original = editor.state.doc;
    openWithShortcut(harness.editorElement);
    await screen.findByRole("radio", { name: "膨らませる", checked: true });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    harness.rerender({ writingTool: "custom" });
    expect(observed.signal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.state.doc).toBe(original);
    selectAndFocus(editor, 1, 5);
    openWithShortcut(harness.editorElement);
    await screen.findByRole("radio", { name: "自由指示", checked: true });
    await act(async () => {
      if (!request) throw new Error("Missing test request");
      pending.resolve(Response.json(createAiEditSuccessResponseFixture(request)));
      await pending.promise;
    });
    expect(screen.queryByRole("button", { name: "採用" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "編集の指示" })).toHaveValue("");
    expect(editor.state.doc).toBe(original);
  });

  it("lets the selection decide the tool, and remembers the tool chosen inside the panel", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onToolMemoryChange = vi.fn();
    const harness = await renderHarness({ toolMemory: DEFAULT_WRITING_TOOL_MEMORY, onToolMemoryChange, initialText: "前。対象の文。" });
    const editor = harness.editor(); const original = editor.state.doc;
    selectAndFocus(editor, 3, 8); openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI編集コマンド" });
    expect(screen.getByRole("radio", { name: "書き直し" })).toBeChecked();
    // Revising tools and the dictionary fit selected text; writing tools need a caret.
    expect(screen.getAllByRole("radio").filter((radio) => radio.getAttribute("name") === "ai-tool").map((radio) => radio.getAttribute("value")))
      .toEqual(["rewrite", "transform", "expand", "condense", "custom", "dictionary"]);
    fireEvent.click(screen.getByRole("radio", { name: "短くする" }));
    expect(screen.getByRole("radio", { name: "短くする" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "編集の指示" })).not.toHaveValue("");
    expect(onToolMemoryChange).toHaveBeenLastCalledWith({ revise: "condense", write: "prompt-insert" });
    harness.rerender({ toolMemory: { revise: "condense", write: "prompt-insert" }, onToolMemoryChange, initialText: "前。対象の文。" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    selectAndFocus(editor, 2, 2); openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI文章挿入" });
    expect(screen.getByRole("radio", { name: "指示から書く" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "書き直し" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    selectAndFocus(editor, 3, 8); openWithShortcut(harness.editorElement);
    expect(await screen.findByRole("radio", { name: "短くする" })).toBeChecked();
    // Choosing tools never sends anything and never edits the manuscript.
    expect(fetchSpy).not.toHaveBeenCalled(); expect(editor.state.doc).toBe(original); expect(undoDepth(editor.state)).toBe(0);
  });

  it("falls back to prompt-only writing when the remembered writing tool does not fit the caret", async () => {
    const harness = await renderHarness({ toolMemory: { revise: "rewrite", write: "continue" }, initialText: "前。後。" });
    selectAndFocus(harness.editor(), 3, 3); openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI文章挿入" });
    expect(screen.getByRole("radio", { name: "指示から書く" })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    selectAndFocus(harness.editor(), 5, 5); openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AIの続き執筆" });
    expect(screen.getByRole("radio", { name: "続きを書く" })).toBeChecked();
  });

  it("keeps the open session and its input when the chosen tool does not fit the target", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness({ toolMemory: DEFAULT_WRITING_TOOL_MEMORY, initialText: "前。後。" });
    const editor = harness.editor(); const original = editor.state.doc;
    selectAndFocus(editor, 3, 3); openWithShortcut(harness.editorElement);
    const dialog = await screen.findByRole("dialog", { name: "AI文章挿入" });
    fireEvent.change(screen.getByRole("textbox", { name: "文章のプロンプト" }), { target: { value: "雨の描写" } });
    fireEvent.click(screen.getByRole("radio", { name: "続きを書く" }));
    expect(await screen.findByText("続けたい章の本文末尾に、範囲選択せずカーソルを置いてください。")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument(); expect(screen.getByRole("radio", { name: "指示から書く" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "文章のプロンプト" })).toHaveValue("雨の描写");
    expect(fetchSpy).not.toHaveBeenCalled(); expect(editor.state.doc).toBe(original);
  });

  it("discards received candidates when the tool changes, and never applies them afterwards", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const parsed = validateAiEditRequest(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      if (!parsed.success) throw new Error("Invalid test request");
      return Response.json(createAiEditSuccessResponseFixture(parsed.data));
    });
    const harness = await renderHarness({ toolMemory: DEFAULT_WRITING_TOOL_MEMORY });
    const editor = harness.editor(); const original = editor.state.doc;
    selectAndFocus(editor, 1, 5); openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI編集コマンド" });
    fireEvent.click(screen.getByRole("button", { name: "自然に" })); fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByRole("button", { name: "採用" });
    fireEvent.click(screen.getByRole("button", { name: "指示・送信設定を変更" }));
    fireEvent.click(screen.getByRole("radio", { name: "膨らませる" }));
    expect(screen.queryByRole("button", { name: "採用" })).toBeNull();
    expect(screen.getByRole("radio", { name: "膨らませる" })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ctrlKey: true });
    expect(editor.state.doc).toBe(original); expect(undoDepth(editor.state)).toBe(0);
  });

  it("aborts a running request when the dictionary is opened from the context menu, and ignores its late reply", async () => {
    const pending = createDeferred<Response>();
    let request: AiEditRequest | null = null;
    const observed: { signal: AbortSignal | null } = { signal: null };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const parsed = validateAiEditRequest(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      if (!parsed.success) throw new Error("Invalid test request");
      request = parsed.data;
      observed.signal = init?.signal instanceof AbortSignal ? init.signal : null;
      // This mock ignores abort and answers later.
      return pending.promise;
    });
    const harness = await renderHarness({ toolMemory: DEFAULT_WRITING_TOOL_MEMORY });
    const editor = harness.editor(); const original = editor.state.doc;
    selectAndFocus(editor, 1, 5); openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI編集コマンド" });
    fireEvent.click(screen.getByRole("button", { name: "自然に" })); fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    // While generating, the picker is read-only like the other inputs.
    expect(screen.getByRole("radio", { name: "短くする" })).toBeDisabled();
    fireEvent(harness.editorElement, new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "辞書で調べる" }));
    await screen.findByRole("dialog", { name: "語句を調べる" });
    expect(observed.signal?.aborted).toBe(true);
    expect(screen.getByRole("radio", { name: "辞書" })).toBeChecked();
    await act(async () => {
      if (!request) throw new Error("Missing test request");
      pending.resolve(Response.json(createAiEditSuccessResponseFixture(request)));
      await pending.promise;
    });
    expect(screen.queryByRole("button", { name: "採用" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "語句を調べる" })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce(); expect(editor.state.doc).toBe(original);
  });

  it("marks the target in the manuscript while the panel is open and removes it on close and on a stale session", async () => {
    const harness = await renderHarness({ toolMemory: DEFAULT_WRITING_TOOL_MEMORY, initialText: "前対象後" });
    const editor = harness.editor(); const original = editor.state.doc;
    selectAndFocus(editor, 2, 4);
    const guard = getEditGuardState(editor.state);
    openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI編集コマンド" });
    await waitFor(() => expect(harness.editorElement.querySelector(".ai-target")?.textContent).toBe("対象"));
    // The marker is a decoration: the same document, selection revision and history.
    expect(editor.state.doc).toBe(original); expect(getEditGuardState(editor.state)).toBe(guard); expect(undoDepth(editor.state)).toBe(0);
    expect(screen.queryByText(/期限切れ/u)).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(harness.editorElement.querySelector(".ai-target")).toBeNull());
    selectAndFocus(editor, 2, 4); openWithShortcut(harness.editorElement);
    await waitFor(() => expect(harness.editorElement.querySelector(".ai-target")).not.toBeNull());
    act(() => { setTextSelection(editor, 1, 2); });
    expect(await screen.findByText(/選択範囲が変更されたため/u)).toBeInTheDocument();
    await waitFor(() => expect(harness.editorElement.querySelector(".ai-target")).toBeNull());
    expect(editor.state.doc).toBe(original);
  });

  it("keeps prompt insertion independent of the chosen selection tool", async () => {
    const harness = await renderHarness({ writingTool: "expand" });
    selectAndFocus(harness.editor(), 2, 2);
    openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog", { name: "AI文章挿入" });
    expect(screen.getByRole("textbox", { name: "文章のプロンプト" })).toHaveValue("");
    expect(screen.queryByRole("radio", { name: "膨らませる" })).toBeNull();
    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "文章のプロンプト" }), { target: { value: "雨の描写を書いて" } });
    harness.rerender({ writingTool: "custom" });
    expect(screen.getByRole("dialog", { name: "AI文章挿入" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "文章のプロンプト" })).toHaveValue("雨の描写を書いて");
  });

  it("protects composition and validates long instructions from the Transform concept field", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness({ writingTool: "transform" });
    selectAndFocus(harness.editor(), 1, 5);
    const original = harness.editor().state.doc;
    openWithShortcut(harness.editorElement);
    const concept = await screen.findByRole("textbox", { name: "雰囲気・概念" });
    fireEvent.compositionStart(concept);
    const escape = dispatchKey(concept, "Escape");
    expect(escape.defaultPrevented).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.compositionEnd(concept);
    fireEvent.change(concept, { target: { value: "雰".repeat(501) } });
    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("指示を500文字以内にしてください");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(harness.editor().state.doc).toBe(original);
  });

  it("opens the selection context menu without generating or changing the document, and discards a changed selection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness();
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const document = editor.state.doc;
    const guard = getEditGuardState(editor.state);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 100 });
    fireEvent(harness.editorElement, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("menuitem", { name: /AI提案/u })).toHaveFocus();
    expect(editor.state.doc).toBe(document);
    expect(getEditGuardState(editor.state)).toEqual(guard);
    expect(fetchSpy).not.toHaveBeenCalled();
    act(() => setTextSelection(editor, 2, 5));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.state.doc).toBe(document);
  });

  it("leaves native context menus available during composition, without selection, and when read-only", async () => {
    const harness = await renderHarness();
    const editor = harness.editor();
    function contextMenu() {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      fireEvent(harness.editorElement, event);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByRole("menu")).toBeNull();
    }
    contextMenu();
    selectAndFocus(editor, 1, 5);
    dispatchComposition(harness.editorElement, "compositionstart", "に");
    contextMenu();
    dispatchComposition(harness.editorElement, "compositionend", "に");
    act(() => editor.setEditable(false));
    contextMenu();
  });

  it("captures before focus transfer, keeps editor state, and starts a fresh session after cancel", async () => {
    const onDocumentChange = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness({ onDocumentChange });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const initialGuard = getEditGuardState(editor.state);
    const initialDocument = editor.state.doc;
    const initialSelection = editor.state.selection;
    const initialUndoDepth = undoDepth(editor.state);

    const shortcut = openWithShortcut(harness.editorElement);

    expect(shortcut.defaultPrevented).toBe(true);
    const input = await screen.findByRole("textbox", { name: "編集の指示" });
    expect(input).toHaveFocus();
    expect(captureObservation.spy).toHaveBeenCalledOnce();
    const firstCapture = captureObservation.spy.mock.calls[0]?.[0];
    expect(firstCapture.activeElement).toBe(harness.editorElement);
    expect(firstCapture.result).toMatchObject({
      snapshot: { originalText: "春の風と" },
      status: "captured",
    });
    expect(within(screen.getByRole("region", { name: "推敲する原文" })).getByText("4文字")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2案" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "3案" })).not.toBeChecked();

    fireEvent.change(input, { target: { value: "語順は保って整える" } });
    expect(input).toHaveValue("語順は保って整える");
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    expect(input).toHaveValue("短く");
    expect(screen.getByRole("button", { name: "短く" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(input, { target: { value: "  生の指示🙂  " } });
    expect(input).toHaveValue("  生の指示🙂  ");
    expect(screen.getByRole("button", { name: "短く" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("radio", { name: "3案" }));
    expect(screen.getByRole("radio", { name: "3案" })).toBeChecked();

    const oversizedInstruction = "🙂".repeat(501);
    fireEvent.change(input, { target: { value: oversizedInstruction } });
    expect(input).toHaveValue(oversizedInstruction);
    expect(screen.getByText("501 / 500文字")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "指示を500文字以内にしてください。",
    );
    fireEvent.resize(window);
    fireEvent.scroll(window);
    expect(captureObservation.spy).toHaveBeenCalledOnce();

    act(() => editor.view.focus());
    openWithShortcut(harness.editorElement);
    expect(input).toHaveFocus();
    expect(captureObservation.spy).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    expect(editor.state.doc).toBe(initialDocument);
    expect(editor.state.selection.eq(initialSelection)).toBe(true);
    expect(getEditGuardState(editor.state)).toEqual(initialGuard);
    expect(undoDepth(editor.state)).toBe(initialUndoDepth);
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(harness.editorElement).toHaveFocus());
    expect(editor.state.doc).toBe(initialDocument);
    expect(undoDepth(editor.state)).toBe(initialUndoDepth);
    expect(onDocumentChange).not.toHaveBeenCalled();

    selectAndFocus(editor, 5, 8);
    openWithShortcut(harness.editorElement);
    const reopenedInput = await screen.findByRole("textbox", {
      name: "編集の指示",
    });
    expect(reopenedInput).toHaveValue("");
    expect(screen.getByRole("radio", { name: "2案" })).toBeChecked();
    expect(captureObservation.spy).toHaveBeenCalledTimes(2);
    expect(captureObservation.spy.mock.calls[1]?.[0].result).toMatchObject({
      snapshot: { originalText: "夏の雨" },
      status: "captured",
    });
  });

  it("supports Meta+K without introducing a global shortcut", async () => {
    const harness = await renderHarness();
    selectAndFocus(harness.editor(), 1, 3);

    const shortcut = openWithShortcut(harness.editorElement, "meta");

    expect(shortcut.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole("textbox", { name: "編集の指示" }),
    ).toHaveFocus();
    expect(captureObservation.spy).toHaveBeenCalledOnce();
  });

  it("opens prompt-only insertion at a caret without changing the manuscript", async () => {
    const caretHarness = await renderHarness();
    selectAndFocus(caretHarness.editor(), 1, 1);
    const caretShortcut = openWithShortcut(caretHarness.editorElement);
    expect(caretShortcut.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole("textbox", { name: "文章のプロンプト" }),
    ).toHaveFocus();
    expect(screen.getByRole("radio", { name: "1案" })).toBeChecked();
    expect(documentToPlainText(caretHarness.editor().state.doc)).toBe("春の風と夏の雨");
    expect(screen.queryByRole("group", { name: "プリセット" })).not.toBeInTheDocument();
  });

  it("shows selection guidance for a blank-only selection", async () => {
    const blankHarness = await renderHarness({ initialText: "前　 後" });
    selectAndFocus(blankHarness.editor(), 2, 4);
    openWithShortcut(blankHarness.editorElement);
    expect(
      await within(blankHarness.container).findByText(
        "編集する文字列を選択してください",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the actual count and limit for an oversized selection", async () => {
    const oversizedHarness = await renderHarness({
      initialText: `前${"長".repeat(2_001)}後`,
    });
    selectAndFocus(oversizedHarness.editor(), 2, 2_003);
    openWithShortcut(oversizedHarness.editorElement);
    expect(
      await within(oversizedHarness.container).findByText(
        "選択範囲を2,000文字以内に短くしてください（現在2,001文字／上限2,000文字）",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not consume read-only or composing invocation", async () => {
    const readOnlyContext = { ...BASE_CONTEXT, editable: false };
    const readOnlyHarness = await renderHarness({ context: readOnlyContext });
    selectAndFocus(readOnlyHarness.editor(), 1, 3);
    const readOnlyShortcut = openWithShortcut(readOnlyHarness.editorElement);
    expect(readOnlyShortcut.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    captureObservation.spy.mockClear();

    const compositionHarness = await renderHarness();
    const composingEditor = compositionHarness.editor();
    selectAndFocus(composingEditor, 1, 3);
    dispatchComposition(
      compositionHarness.editorElement,
      "compositionstart",
      "に",
    );
    expect(composingEditor.view.composing).toBe(true);
    const composingShortcut = openWithShortcut(
      compositionHarness.editorElement,
    );
    expect(composingShortcut.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    dispatchComposition(
      compositionHarness.editorElement,
      "compositionend",
      "に",
    );

    const compatibilityShortcut = dispatchKey(
      compositionHarness.editorElement,
      "k",
      { ctrlKey: true, isComposing: true, keyCode: 229 },
    );
    expect(compatibilityShortcut.defaultPrevented).toBe(false);
    expect(captureObservation.spy).not.toHaveBeenCalled();
  });

  it("keeps instruction IME and multiline input native until a non-composing Escape", async () => {
    const pending = createDeferred<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => pending.promise);
    const harness = await renderHarness();
    selectAndFocus(harness.editor(), 1, 3);
    openWithShortcut(harness.editorElement);
    const input = await screen.findByRole("textbox", { name: "編集の指示" });

    fireEvent.compositionStart(input, { data: "自然" });
    fireEvent.change(input, { target: { value: "自然" } });
    fireEvent.keyDown(input, {
      isComposing: true,
      key: "Escape",
      keyCode: 229,
    });
    fireEvent.keyDown(input, {
      ctrlKey: true,
      isComposing: true,
      key: "Enter",
      keyCode: 229,
    });
    expect(input).toHaveValue("自然");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input, { data: "自然" });
    fireEvent.change(input, { target: { value: "自然\n丁寧に" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("自然\n丁寧に");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { ctrlKey: true, key: "Enter" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(
      await screen.findByText("候補を生成しています。本文編集は続けられます。"),
    ).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    pending.resolve(new Response());
  });

  it("sends exactly one canonical request and stores only a validated result", async () => {
    const pending = createDeferred<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => pending.promise);
    const onDocumentChange = vi.fn();
    const harness = await renderHarness({ onDocumentChange });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const initialDocument = editor.state.doc;
    const initialGuard = getEditGuardState(editor.state);
    const initialSelection = editor.state.selection;
    const initialUndoDepth = undoDepth(editor.state);

    openWithShortcut(harness.editorElement);
    const input = await screen.findByRole("textbox", { name: "編集の指示" });
    fireEvent.change(input, { target: { value: "  自然🙂  " } });
    fireEvent.click(screen.getByRole("radio", { name: "3案" }));
    const generate = screen.getByRole("button", { name: "生成" });
    expect(generate).toBeEnabled();

    fireEvent.click(generate);
    fireEvent.click(generate);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(
      await screen.findByText("候補を生成しています。本文編集は続けられます。"),
    ).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(screen.getByRole("radio", { name: "3案" })).toBeDisabled();

    const fetchOptions = fetchSpy.mock.calls[0]?.[1];
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/ai/edits");
    expect(fetchOptions).toMatchObject({
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(fetchOptions?.signal).toBeInstanceOf(AbortSignal);
    const body =
      typeof fetchOptions?.body === "string"
        ? JSON.parse(fetchOptions.body)
        : null;
    const requestValidation = validateAiEditRequest(body);
    expect(requestValidation.success).toBe(true);

    if (!requestValidation.success) {
      throw new Error("request body was not canonical");
    }

    const request = requestValidation.data;
    expect(Object.keys(request).sort()).toEqual([
      "afterText",
      "beforeText",
      "candidateCount",
      "consent",
      "globalContext",
      "instruction",
      "modelId",
      "presetId",
      "requestId",
      "schemaVersion",
      "selectionText",
    ]);
    expect(request).toMatchObject({
      afterText: "夏の雨",
      beforeText: "",
      candidateCount: 3,
      consent: null,
      globalContext: {
        commonPrompt: "余韻を保つ",
        manualStyle: "静かな文体",
      },
      instruction: "  自然🙂  ",
      modelId: null,
      presetId: null,
      selectionText: "春の風と",
    });
    expect(JSON.stringify(request)).not.toMatch(
      /contentRevision|selectionRevision|contextRevision|editorInstanceId|sessionId|storageVersion|dirtySequence|originalSlice|productRules|editIntent|promptPlan/u,
    );

    pending.resolve(
      Response.json(createAiEditSuccessResponseFixture(request)),
    );

    expect(await screen.findByText("3件の候補を受信しました。")).toBeInTheDocument();
    expect(
      screen.getByText("ローカルデモ候補（外部送信なし）"),
    ).toBeInTheDocument();
    expect(editor.state.doc).toBe(initialDocument);
    expect(editor.state.selection.eq(initialSelection)).toBe(true);
    expect(getEditGuardState(editor.state)).toEqual(initialGuard);
    expect(undoDepth(editor.state)).toBe(initialUndoDepth);
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("switches by canonical candidate ID and applies only an explicit choice once", async () => {
    let request: AiEditRequest | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("missing request body");
        }

        const validation = validateAiEditRequest(JSON.parse(init.body));

        if (!validation.success) {
          throw new Error("invalid request body");
        }

        request = validation.data;
        return Response.json(createAiEditSuccessResponseFixture(validation.data));
      },
    );
    const onAccepted = vi.fn();
    const onDocumentChange = vi.fn();
    const harness = await renderHarness({ onAccepted, onDocumentChange });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const documentBeforeGeneration = editor.state.doc;
    const selectionBeforeGeneration = editor.state.selection;
    const guardBeforeGeneration = getEditGuardState(editor.state);
    const historyBeforeGeneration = undoDepth(editor.state);

    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("2件の候補を受信しました。");

    expect(editor.state.doc).toBe(documentBeforeGeneration);
    expect(editor.state.selection.eq(selectionBeforeGeneration)).toBe(true);
    expect(getEditGuardState(editor.state)).toEqual(guardBeforeGeneration);
    expect(undoDepth(editor.state)).toBe(historyBeforeGeneration);
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "候補 2" }));
    expect(screen.getByText("候補 2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "春の風と【デモ候補2】",
    );
    expect(editor.state.doc).toBe(documentBeforeGeneration);
    expect(editor.state.selection.eq(selectionBeforeGeneration)).toBe(true);
    expect(getEditGuardState(editor.state)).toEqual(guardBeforeGeneration);
    expect(undoDepth(editor.state)).toBe(historyBeforeGeneration);
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();

    const dialog = screen.getByRole("dialog", { name: "AI編集コマンド" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(documentToPlainText(editor.state.doc)).toBe("春の風と夏の雨");

    const accept = screen.getByRole("button", { name: "採用" });
    fireEvent.click(accept);
    fireEvent.click(accept);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(harness.editorElement).toHaveFocus());
    expect(request).not.toBeNull();
    expect(documentToPlainText(editor.state.doc)).toBe(
      "春の風と【デモ候補2】夏の雨",
    );
    expect(onDocumentChange).toHaveBeenCalledOnce();
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(undoDepth(editor.state)).toBe(1);

  });

  it("rejects a completed candidate session without manuscript side effects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("missing request body");
      }

      const validation = validateAiEditRequest(JSON.parse(init.body));

      if (!validation.success) {
        throw new Error("invalid request body");
      }

      return Response.json(createAiEditSuccessResponseFixture(validation.data));
    });
    const onAccepted = vi.fn();
    const onDocumentChange = vi.fn();
    const harness = await renderHarness({ onAccepted, onDocumentChange });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const initialDocument = editor.state.doc;
    const initialGuard = getEditGuardState(editor.state);
    const initialHistory = undoDepth(editor.state);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("2件の候補を受信しました。");

    fireEvent.click(screen.getByRole("button", { name: "却下" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(editor.state.doc).toBe(initialDocument);
    expect(getEditGuardState(editor.state)).toEqual(initialGuard);
    expect(undoDepth(editor.state)).toBe(initialHistory);
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("invalidates old candidates before a Preview retry starts", async () => {
    const secondResponse = createDeferred<Response>();
    const requestIds: string[] = [];
    let retryRequest: AiEditRequest | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("missing request body");
        }

        const validation = validateAiEditRequest(JSON.parse(init.body));

        if (!validation.success) {
          throw new Error("invalid request body");
        }

        requestIds.push(validation.data.requestId);

        if (requestIds.length === 1) {
          return Response.json(
            createAiEditSuccessResponseFixture(validation.data),
          );
        }

        retryRequest = validation.data;
        return secondResponse.promise;
      },
    );
    const onDocumentChange = vi.fn();
    const harness = await renderHarness({ onDocumentChange });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("2件の候補を受信しました。");
    const oldAccept = screen.getByRole("button", { name: "採用" });

    fireEvent.click(screen.getByRole("button", { name: "再生成" }));

    expect(
      await screen.findByText("候補を生成しています。本文編集は続けられます。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "採用" })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
    fireEvent.click(oldAccept);
    expect(documentToPlainText(editor.state.doc)).toBe("春の風と夏の雨");
    expect(onDocumentChange).not.toHaveBeenCalled();

    if (retryRequest === null) {
      throw new Error("retry request was not captured");
    }

    secondResponse.resolve(
      Response.json(
        createAiEditSuccessResponseFixture(retryRequest),
      ),
    );
    await screen.findByText("2件の候補を受信しました。");
    expect(documentToPlainText(editor.state.doc)).toBe("春の風と夏の雨");
  });

  it("does not Accept while the instruction field is composing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("missing request body");
      }

      const validation = validateAiEditRequest(JSON.parse(init.body));

      if (!validation.success) {
        throw new Error("invalid request body");
      }

      return Response.json(createAiEditSuccessResponseFixture(validation.data));
    });
    const harness = await renderHarness();
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    openWithShortcut(harness.editorElement);
    const input = await screen.findByRole("textbox", { name: "編集の指示" });
    fireEvent.change(input, { target: { value: "自然に" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("2件の候補を受信しました。");

    fireEvent.compositionStart(input, { data: "変換" });
    fireEvent.keyDown(input, {
      ctrlKey: true,
      isComposing: true,
      key: "Enter",
      keyCode: 229,
    });
    fireEvent.click(screen.getByRole("button", { name: "採用" }));
    expect(documentToPlainText(editor.state.doc)).toBe("春の風と夏の雨");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.compositionEnd(input, { data: "変換" });
    fireEvent.keyDown(input, { ctrlKey: true, key: "Enter" });
    expect(documentToPlainText(editor.state.doc)).toBe(
      "春の風と【デモ候補1】夏の雨",
    );
  });

  it("applies a multiline candidate across paragraphs as literal plain text", async () => {
    FakeDiffWorker.reset();
    vi.stubGlobal("Worker", FakeDiffWorker);
    const replacement = '\n先頭🙂\n\n<script>alert("x")</script>\n末尾　 ';
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("missing request body");
        }

        const validation = validateAiEditRequest(JSON.parse(init.body));

        if (!validation.success) {
          throw new Error("invalid request body");
        }

        const response = createAiEditSuccessResponseFixture(validation.data);
        return Response.json({
          ...response,
          candidates: response.candidates.map((candidate, index) => ({
            ...candidate,
            replacementText:
              index === 0 ? replacement : "別の候補\n二段目",
          })),
        });
      },
    );
    const onDocumentChange = vi.fn();
    const initialText = "前段\n甲\n\n乙\n後段";
    const harness = await renderHarness({ initialText, onDocumentChange });
    const editor = harness.editor();
    const from = plainTextOffsetToProseMirrorPosition(editor.state.doc, 3);
    const to = plainTextOffsetToProseMirrorPosition(editor.state.doc, 7);

    if (from === null || to === null) {
      throw new Error("test range did not map to ProseMirror positions");
    }

    selectAndFocus(editor, from, to);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("2件の候補を受信しました。");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent('<script>alert("x")</script>');
    expect(panel.querySelector("script")).toBeNull();
    expect(documentToPlainText(editor.state.doc)).toBe(initialText);

    await waitFor(() =>
      expect(FakeDiffWorker.instances[0]?.messages).toHaveLength(1),
    );
    const diffWorker = FakeDiffWorker.instances[0];
    const diffRequest = parseDiffWorkerRequest(diffWorker?.messages[0]);

    if (diffWorker === undefined || diffRequest === null) {
      throw new Error("diff worker did not receive the active candidate");
    }

    act(() => {
      diffWorker.emitMessage({
        candidateId: diffRequest.candidateId,
        parts: [
          {
            kind: "insert",
            text: "このDiff文字列を本文へ適用してはならない",
          },
        ],
        requestId: diffRequest.requestId,
        type: "result",
      });
    });
    expect(
      screen.getByText("このDiff文字列を本文へ適用してはならない"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "採用" }));

    expect(documentToPlainText(editor.state.doc)).toBe(
      `前段\n${replacement}\n後段`,
    );
    expect(documentToPlainText(editor.state.doc)).not.toContain(
      "このDiff文字列を本文へ適用してはならない",
    );
    expect(onDocumentChange).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("disposes the snapshot-based Diff when a preview becomes stale", async () => {
    FakeDiffWorker.reset();
    vi.stubGlobal("Worker", FakeDiffWorker);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("missing request body");
      }

      const validation = validateAiEditRequest(JSON.parse(init.body));

      if (!validation.success) {
        throw new Error("invalid request body");
      }

      return Response.json(createAiEditSuccessResponseFixture(validation.data));
    });
    const harness = await renderHarness();
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("2件の候補を受信しました。");

    await waitFor(() =>
      expect(FakeDiffWorker.instances[0]?.messages).toHaveLength(1),
    );
    const worker = FakeDiffWorker.instances[0];
    const request = parseDiffWorkerRequest(worker?.messages[0]);

    if (worker === undefined || request === null) {
      throw new Error("diff worker did not receive the preview snapshot");
    }

    expect(request.originalText).toBe("春の風と");
    act(() => {
      worker.emitMessage({
        candidateId: request.candidateId,
        parts: [{ kind: "equal", text: request.originalText }],
        requestId: request.requestId,
        type: "result",
      });
    });
    expect(
      screen.getByRole("region", { name: "候補 1 の原文との差分" }),
    ).toBeInTheDocument();

    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("追", 1));
    });

    expect(await screen.findByText(/本文が変更されたため/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /原文との差分/u })).not.toBeInTheDocument();
    expect(worker.terminated).toBe(true);
    expect(FakeDiffWorker.instances).toHaveLength(1);
    expect(captureObservation.spy).toHaveBeenCalledOnce();
    expect(documentToPlainText(editor.state.doc)).toBe("追春の風と夏の雨");
  });

  it("aborts generation on stale changes and ignores a late HTTP response", async () => {
    const pending = createDeferred<Response>();
    const requestObservation: {
      request: AiEditRequest | null;
      signal: AbortSignal | null;
    } = { request: null, signal: null };
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestObservation.signal =
        init?.signal instanceof AbortSignal ? init.signal : null;
      if (typeof init?.body === "string") {
        const validation = validateAiEditRequest(JSON.parse(init.body));
        requestObservation.request = validation.success
          ? validation.data
          : null;
      }
      return pending.promise;
    });
    const harness = await renderHarness();
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("候補を生成しています。本文編集は続けられます。");

    act(() => {
      editor.commands.insertContentAt(1, "追");
    });

    expect(await screen.findByText(/本文が変更されたため/u)).toBeInTheDocument();
    expect(requestObservation.signal?.aborted).toBe(true);

    if (requestObservation.request === null) {
      throw new Error("request was not captured");
    }

    pending.resolve(
      Response.json(
        createAiEditSuccessResponseFixture(requestObservation.request),
      ),
    );
    await act(async () => Promise.resolve());
    expect(screen.queryByText(/件の候補を受信しました/u)).not.toBeInTheDocument();
    expect(screen.getByText(/本文が変更されたため/u)).toBeInTheDocument();
    expect(editor.state.doc.textContent).toBe("追春の風と夏の雨");
  });

  it("aborts an active external request and stales its session when consent is revoked", async () => {
    const pending = createDeferred<Response>();
    const requestObservation: { signal: AbortSignal | null } = {
      signal: null,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestObservation.signal =
        init?.signal instanceof AbortSignal ? init.signal : null;
      return pending.promise;
    });
    const harness = await renderHarness({
      consent: OPENAI_CONSENT,
      runtime: OPENAI_RUNTIME,
    });
    selectAndFocus(harness.editor(), 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("候補を生成しています。本文編集は続けられます。");

    harness.rerender({
      consent: null,
      context: { ...BASE_CONTEXT, contextRevision: 4 },
      runtime: OPENAI_RUNTIME,
    });

    expect(
      await screen.findByText(/AI参照設定が変更されたため/u),
    ).toBeInTheDocument();
    expect(requestObservation.signal?.aborted).toBe(true);
    expect(documentToPlainText(harness.editor().state.doc)).toBe(
      "春の風と夏の雨",
    );

    pending.resolve(new Response());
  });

  it("keeps canonical errors safe and retries with a new request ID", async () => {
    const requestIds: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("missing body");
        }

        const validation = validateAiEditRequest(JSON.parse(init.body));
        if (!validation.success) {
          throw new Error("invalid request");
        }

        requestIds.push(validation.data.requestId);

        if (requestIds.length === 1) {
          return Response.json(
            {
              error: {
                code: "RATE_LIMITED",
                message: "raw server message must not be shown",
                requestId: validation.data.requestId,
                retryable: true,
              },
            },
            { status: 429 },
          );
        }

        return Response.json(
          createAiEditSuccessResponseFixture(validation.data),
        );
      },
    );
    const harness = await renderHarness();
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const initialDocument = editor.state.doc;
    const initialUndoDepth = undoDepth(editor.state);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    expect(
      await screen.findByText(
        "AIの利用上限に達しました。しばらく待って再試行してください。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("raw server message must not be shown"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    expect(await screen.findByText("2件の候補を受信しました。")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
    expect(editor.state.doc).toBe(initialDocument);
    expect(undoDepth(editor.state)).toBe(initialUndoDepth);
  });

  it("shows a typed transport failure without exposing raw errors or changing the document", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("socket reset with private diagnostic details"),
    );
    const onDocumentChange = vi.fn();
    const harness = await renderHarness({ onDocumentChange });
    const editor = harness.editor();
    selectAndFocus(editor, 1, 5);
    const initialDocument = editor.state.doc;
    const initialUndoDepth = undoDepth(editor.state);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    expect(
      await screen.findByText(
        "AI編集サーバーへ接続できませんでした。本文は変更されていません。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/socket reset with private diagnostic details/u),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeEnabled();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(editor.state.doc).toBe(initialDocument);
    expect(undoDepth(editor.state)).toBe(initialUndoDepth);
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("discloses OpenAI transfer details and performs no fetch before persisted consent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness({ runtime: OPENAI_RUNTIME });
    selectAndFocus(harness.editor(), 1, 5);
    openWithShortcut(harness.editorElement);
    const dialog = await screen.findByRole("dialog", {
      name: "AI編集コマンド",
    });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );

    expect(within(dialog).getByText("OpenAIへの外部送信")).toBeInTheDocument();
    expect(
      within(dialog).getByText("GPT-5.6 Terra（gpt-5.6-terra）"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("checkbox", {
        name: "上記のデータがOpenAIへ送信されることに同意します",
      }),
    ).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "同意を保存" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "生成" })).toBeDisabled();

    fireEvent.click(within(dialog).getByText("外部へ送るデータの種類を確認"));
    expect(within(dialog).getByText("選択した原稿本文")).toBeInTheDocument();
    expect(within(dialog).getByText(/直前・直後の本文/u)).toBeInTheDocument();
    expect(within(dialog).getByText("AI編集の指示")).toBeInTheDocument();
    expect(within(dialog).getByText("store: false")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", {
        name: "OpenAI APIのデータ取扱いを確認",
      }),
    ).toHaveAttribute(
      "href",
      "https://developers.openai.com/api/docs/guides/your-data",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends matching persisted provider consent without its local timestamp", async () => {
    let sentRequest: AiEditRequest | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("missing request body");
        }

        const validation = validateAiEditRequest(JSON.parse(init.body));

        if (!validation.success) {
          throw new Error("invalid request body");
        }

        sentRequest = validation.data;
        return Response.json(createAiEditSuccessResponseFixture(validation.data));
      },
    );
    const harness = await renderHarness({
      consent: OPENAI_CONSENT,
      modelPreference: "gpt-5.6-luna",
      runtime: OPENAI_RUNTIME,
    });
    selectAndFocus(harness.editor(), 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText("2件の候補を受信しました。")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(sentRequest).toMatchObject({
      allowPaidApi: true,
      consent: { policyVersion: 1, providerId: "openai" },
      modelId: "gpt-5.6-luna",
    });
    expect(JSON.stringify(sentRequest)).not.toContain("grantedAt");
  });

  it("stales the open session when newly persisted consent advances context revision", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onConsentChange = vi.fn(async () => ({ ok: true }));
    const harness = await renderHarness({
      onConsentChange,
      runtime: OPENAI_RUNTIME,
    });
    selectAndFocus(harness.editor(), 1, 5);
    openWithShortcut(harness.editorElement);
    const checkbox = await screen.findByRole("checkbox", {
      name: "上記のデータがOpenAIへ送信されることに同意します",
    });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "同意を保存" }));
    await waitFor(() => expect(onConsentChange).toHaveBeenCalledWith("openai"));

    harness.rerender({
      consent: OPENAI_CONSENT,
      context: { ...BASE_CONTEXT, contextRevision: 4 },
      onConsentChange,
      runtime: OPENAI_RUNTIME,
    });

    expect(
      await screen.findByText(/AI参照設定が変更されたため/u),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not send when public runtime information says AI is disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const harness = await renderHarness({
      runtime: {
        available: false,
        defaultModelId: null,
        externalDataTransfer: false,
        models: [],
        providerId: null,
      },
    });
    selectAndFocus(harness.editor(), 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );

    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();
    expect(screen.getByText("AIは現在無効")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks the original session stale after selection or document changes", async () => {
    const selectionHarness = await renderHarness();
    selectAndFocus(selectionHarness.editor(), 1, 3);
    openWithShortcut(selectionHarness.editorElement);
    await screen.findByRole("dialog");

    act(() => setTextSelection(selectionHarness.editor(), 3, 5));
    expect(
      await screen.findByText(/選択範囲が変更されたため/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "編集の指示" })).toBeDisabled();
    expect(captureObservation.spy).toHaveBeenCalledOnce();

    const documentHarness = await renderHarness();
    selectAndFocus(documentHarness.editor(), 1, 3);
    openWithShortcut(documentHarness.editorElement);
    await screen.findAllByRole("dialog");
    act(() => {
      documentHarness.editor().commands.insertContentAt(1, "追");
    });
    expect(
      await screen.findByText(/本文が変更されたため/u),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "context change",
      { ...BASE_CONTEXT, commonPrompt: "別の方針", contextRevision: 4 },
      /AI参照設定が変更されたため/u,
    ],
    [
      "read-only transition",
      { ...BASE_CONTEXT, editable: false },
      /編集権限が失われたため/u,
    ],
  ])("keeps the snapshot and becomes stale on %s", async (_name, context, message) => {
    const harness = await renderHarness();
    selectAndFocus(harness.editor(), 1, 3);
    openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog");

    harness.rerender({ context });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(captureObservation.spy).toHaveBeenCalledOnce();
  });

  it("aborts generation and stales the session when the workspace model changes", async () => {
    const pending = createDeferred<Response>();
    const requestObservation: { signal: AbortSignal | null } = {
      signal: null,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestObservation.signal =
        init?.signal instanceof AbortSignal ? init.signal : null;
      return pending.promise;
    });
    const harness = await renderHarness({
      consent: OPENAI_CONSENT,
      modelPreference: "gpt-5.6-terra",
      runtime: OPENAI_RUNTIME,
    });
    selectAndFocus(harness.editor(), 1, 5);
    openWithShortcut(harness.editorElement);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("候補を生成しています。本文編集は続けられます。");

    harness.rerender({
      consent: OPENAI_CONSENT,
      context: { ...BASE_CONTEXT, contextRevision: 4 },
      modelPreference: "gpt-6-astra",
      runtime: OPENAI_RUNTIME,
    });

    expect(
      await screen.findByText(/AI参照設定が変更されたため/u),
    ).toBeInTheDocument();
    expect(requestObservation.signal?.aborted).toBe(true);
    expect(documentToPlainText(harness.editor().state.doc)).toBe(
      "春の風と夏の雨",
    );
    pending.resolve(new Response());
  });

  it("becomes stale when the editor instance is recreated", async () => {
    const harness = await renderHarness();
    selectAndFocus(harness.editor(), 1, 3);
    openWithShortcut(harness.editorElement);
    await screen.findByRole("dialog");

    harness.rerender({ editorKey: "editor-b" });

    await waitFor(() => expect(harness.onEditorReady).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/編集中の原稿が切り替わったため/u),
    ).toBeInTheDocument();
    expect(captureObservation.spy).toHaveBeenCalledOnce();
  });

  it("reports unsupported ProseMirror selections without opening a session", async () => {
    const harness = await renderHarness();
    const editor = harness.editor();
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
      );
      editor.view.focus();
    });

    const shortcut = openWithShortcut(harness.editorElement);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(
      await screen.findByText("この選択範囲はAI編集に使用できません。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
