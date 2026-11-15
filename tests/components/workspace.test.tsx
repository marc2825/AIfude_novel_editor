import "fake-indexeddb/auto";

import type { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  validateAiEditRequest,
  type AiEditRequest,
} from "../../src/domain/ai-edit";
import { WorkspaceApp } from "../../src/features/workspace/WorkspaceApp";
import {
  MOCK_AI_RUNTIME,
  OPENAI_AI_RUNTIME,
} from "../fixtures/ai-runtime";
import {
  openWorkspaceDatabase,
  WORKSPACES_STORE_NAME,
} from "../../src/persistence/indexeddb";
import { WritingHistoryRepository } from "../../src/persistence/writing-history";
import { WorkspaceRepository } from "../../src/persistence/workspace-repository";
import {
  createWorkspaceFixture,
  emptyPersistedDocument,
  multilinePersistedDocument,
} from "../fixtures/workspace";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";
import { createPublicConnectionStateFixture } from "../fixtures/ai-connections";
import { connectionActionSchema } from "../../src/domain/ai-connections";
import {
  dispatchKey,
  dispatchPaste,
  setTextSelection,
} from "../helpers/editor";
import {
  installTestLockManager,
  removeTestLockManager,
} from "../helpers/web-locks";

const OPENAI_RUNTIME = OPENAI_AI_RUNTIME;
const MOCK_RUNTIME = MOCK_AI_RUNTIME;

const workspaceEditorObservation = vi.hoisted(() => ({
  current: null as Editor | null,
}));

vi.mock("../../src/features/editor/NovelEditor", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/features/editor/NovelEditor")
  >();

  return {
    ...actual,
    NovelEditor(props: ComponentProps<typeof actual.NovelEditor>) {
      return (
        <actual.NovelEditor
          {...props}
          onEditorDestroy={(editor) => {
            if (workspaceEditorObservation.current === editor) {
              workspaceEditorObservation.current = null;
            }

            props.onEditorDestroy?.(editor);
          }}
          onEditorReady={(editor) => {
            workspaceEditorObservation.current = editor;
            props.onEditorReady?.(editor);
          }}
        />
      );
    },
  };
});

async function seedWorkspace(
  workspace = createWorkspaceFixture(),
) {
  const database = await openWorkspaceDatabase();
  const saved = await new WorkspaceRepository(database).save(workspace);
  database.close();
  return saved;
}

async function loadWorkspace() {
  const database = await openWorkspaceDatabase();

  try {
    return await new WorkspaceRepository(database).load();
  } finally {
    database.close();
  }
}

async function waitForEditableEditor() {
  const editor = await screen.findByRole("textbox", { name: "小説本文" }, { timeout: 3_000 });
  await screen.findByText("保存済み");
  expect(editor).toHaveAttribute("contenteditable", "true");
  return editor;
}

async function editAndWaitForSave(editor: HTMLElement, text: string) {
  dispatchPaste(editor, { "text/plain": text });
  await screen.findByText("未保存");
  await screen.findByText("保存済み", {}, { timeout: 2_000 });
}

function openWorkspaceSettings() {
  fireEvent.click(screen.getByRole("button", { name: "設定とバックアップ" }));
}

function bodyWithText(text: string) {
  return {
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        content: [{ type: "text" as const, text }],
      },
    ],
  };
}

function selectEditorText(selectedText: string) {
  const editor = workspaceEditorObservation.current;

  if (editor === null) {
    throw new Error("workspace editor was not ready");
  }

  const start = editor.state.doc.textContent.indexOf(selectedText);

  if (start < 0) {
    throw new Error("selection target was not found");
  }

  setTextSelection(editor, start + 1, start + selectedText.length + 1);
  editor.view.focus();
}

function parseAiRequest(init: RequestInit | undefined): AiEditRequest {
  if (typeof init?.body !== "string") {
    throw new Error("AI request body was missing");
  }

  const validation = validateAiEditRequest(JSON.parse(init.body));

  if (!validation.success) {
    throw new Error("AI request body was not canonical");
  }

  return validation.data;
}

function installSuccessfulAiFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const request = parseAiRequest(init);
      return Response.json(createAiEditSuccessResponseFixture(request));
    });
}

async function openAndGenerateCandidate(editor: HTMLElement) {
  selectEditorText("対象");
  dispatchKey(editor, "k", { ctrlKey: true, keyCode: 75 });
  const input = await screen.findByRole("textbox", { name: "編集の指示" });
  fireEvent.change(input, { target: { value: "自然に" } });
  fireEvent.click(screen.getByRole("button", { name: "生成" }));
  await screen.findByText("2件の候補を受信しました。");
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  installTestLockManager();
  workspaceEditorObservation.current = null;
});

describe("workspace persistence session", () => {
  it("protects all work-setting drafts on unload and saves them through Ctrl+S without replacing the editor", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("本文") }));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor(); openWorkspaceSettings();
    fireEvent.change(screen.getByLabelText(/作品名/u), { target: { value: "保存する作品名" } });
    fireEvent.change(screen.getByLabelText(/共通プロンプト/u), { target: { value: "比喩を控える" } });
    fireEvent.change(screen.getByLabelText(/手動文体設定/u), { target: { value: "短い文" } });
    const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, keyCode: 83 });
    await screen.findByText("本文と作品メモリを保存しました。");
    const saved = await loadWorkspace(); expect(saved?.project).toMatchObject({ title: "保存する作品名", commonPrompt: "比喩を控える" }); expect(saved?.styleProfile.manualInstructions).toBe("短い文");
    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    const complete = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(complete); expect(complete.defaultPrevented).toBe(false);
  });
  it("keeps a work-setting draft and Preview when switching or deletion is cancelled", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("前対象後") })); installSuccessfulAiFetch();
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor(); await openAndGenerateCandidate(editor);
    openWorkspaceSettings(); fireEvent.change(screen.getByLabelText(/作品名/u), { target: { value: "未保存の題名" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "新規作品" })); await screen.findByText("作品の切替を取り消しました。");
    expect(screen.getByLabelText(/作品名/u)).toHaveValue("未保存の題名"); expect(screen.getByRole("button", { name: "採用" })).toBeEnabled();
    // The first confirmation concerns moving to trash; the second protects the draft.
    confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "ローカルデータを削除" })); await screen.findByText("削除を取り消しました。");
    expect(screen.getByRole("button", { name: "採用" })).toBeEnabled(); expect(editor).toHaveTextContent("前対象後");
  });
  it("retains work-setting drafts after a failed normal save and retries the same values", async () => {
    await seedWorkspace(); render(<WorkspaceApp />); await waitForEditableEditor(); openWorkspaceSettings();
    const title = screen.getByLabelText(/作品名/u); fireEvent.change(title, { target: { value: "再試行する作品" } });
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findAllByText("設定を保存できませんでした。入力内容はこの画面に保持されています。");
    expect(title).toHaveValue("再試行する作品"); const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存" })); await screen.findByText("本文と作品メモリを保存しました。"); expect((await loadWorkspace())?.project.title).toBe("再試行する作品");
  });
  it("restores a work from trash with no history, including its manuscript and memory", async () => {
    const original = createWorkspaceFixture({ body: bodyWithText("復元する原稿😀") }); original.project.storyMemory.characterNotes = "登場人物の記録";
    await seedWorkspace(original); render(<WorkspaceApp />); await waitForEditableEditor(); openWorkspaceSettings(); vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "ファイルとバックアップ" }));
    fireEvent.click(screen.getByRole("button", { name: "ごみ箱・削除の復元" })); await screen.findByText("ごみ箱は空です。");
    openWorkspaceSettings();
    fireEvent.click(screen.getByRole("button", { name: "ローカルデータを削除" })); await screen.findByText(/ごみ箱から復元できます/u);
    const trashToggle = screen.getByRole("button", { name: "ごみ箱・削除の復元" });
    if (trashToggle.getAttribute("aria-expanded") !== "true") fireEvent.click(trashToggle);
    fireEvent.click(await screen.findByRole("button", { name: `作品：${original.project.title}を復元` }));
    expect(await waitForEditableEditor()).toHaveTextContent("復元する原稿😀"); expect((await loadWorkspace())?.project.storyMemory.characterNotes).toBe("登場人物の記録");
  });
  it("retains unsaved AI connection settings when a work is deleted and a new one is created", async () => {
    await seedWorkspace();
    const current = createPublicConnectionStateFixture();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(current));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />);
    await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    const model = await screen.findByRole("textbox", { name: "ローカルLLMの接続モデルID" });
    fireEvent.change(model, { target: { value: "unsaved-local-model" } });
    openWorkspaceSettings();
    fireEvent.click(screen.getByRole("button", { name: "ローカルデータを削除" }));
    await screen.findByText(/ごみ箱から復元できます/u);
    fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    expect(screen.getByRole("textbox", { name: "ローカルLLMの接続モデルID" })).toBe(model);
    expect(model).toHaveValue("unsaved-local-model");
    fireEvent.click(screen.getByRole("button", { name: "新規作品" }));
    await waitForEditableEditor();
    expect(screen.getByRole("textbox", { name: "ローカルLLMの接続モデルID" })).toBe(model);
    expect(model).toHaveValue("unsaved-local-model");
    const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });
  it("invalidates generation on connection save and discards an abort-ignoring old response", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("前対象後") })); const current = createPublicConnectionStateFixture(); const pending = createDeferred<Response>(); let sent: RequestInit | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/connections")) {
        if (!init?.body) return Response.json(current);
        const action = connectionActionSchema.parse(JSON.parse(String(init.body))); if (action.action !== "save") throw new Error("Unexpected action");
        return Response.json({ ...current, revision: crypto.randomUUID(), settings: action.settings });
      }
      sent = init; return pending.promise;
    });
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor();
    selectEditorText("対象"); dispatchKey(editor, "k", { ctrlKey: true, keyCode: 75 });
    fireEvent.change(await screen.findByRole("textbox", { name: "編集の指示" }), { target: { value: "自然に" } }); fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("候補を生成しています。本文編集は続けられます。");
    fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" })); await screen.findByRole("combobox", { name: "主に使うAI" });
    expect(sent?.signal?.aborted).toBe(false); // Merely opening the settings preserves the current request.
    fireEvent.change(screen.getByRole("textbox", { name: "ローカルLLMの接続モデルID" }), { target: { value: "next-model" } });
    fireEvent.click(screen.getByRole("button", { name: "AI接続設定を保存" })); await screen.findByText("AI接続設定を保存しました。次の生成から反映されます。");
    expect(sent?.signal?.aborted).toBe(true); pending.resolve(Response.json(createAiEditSuccessResponseFixture(parseAiRequest(sent))));
    await waitFor(() => expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument()); expect(editor).toHaveTextContent("前対象後");
  });
  it("saves the manuscript and work drafts even when saving AI connection settings fails", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: emptyPersistedDocument })); const current = createPublicConnectionStateFixture();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => init?.body
      ? Response.json({ error: "接続設定を保存できませんでした。" }, { status: 503 }) : Response.json(current));
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    const model = await screen.findByRole("textbox", { name: "ローカルLLMの接続モデルID" });
    fireEvent.change(model, { target: { value: "next-model" } }); openWorkspaceSettings(); fireEvent.change(screen.getByLabelText(/作品名/u), { target: { value: "先に保存する作品" } });
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" })); fireEvent.change(screen.getByRole("textbox", { name: /登場人物メモ/u }), { target: { value: "先に保存するメモ" } });
    dispatchPaste(editor, { "text/plain": "AI設定の失敗でも保存する原稿" }); fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("本文・作品設定・メモは保存しましたが、AI接続設定を保存できませんでした。接続設定の入力は保持しています。");
    const saved = await loadWorkspace(); expect(saved?.chapter.body).toEqual(bodyWithText("AI設定の失敗でも保存する原稿")); expect(saved?.project).toMatchObject({ title: "先に保存する作品", storyMemory: { characterNotes: "先に保存するメモ" } });
    expect(model).toHaveValue("next-model"); expect(editor).toHaveAttribute("contenteditable", "true"); const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
  });
  it("persists a workspace that existed only in memory after the initial save failed", async () => {
    const save = vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    render(<WorkspaceApp />); await screen.findByText("保存失敗");
    expect(await loadWorkspace()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("本文と作品メモリを保存しました。");
    expect(save).toHaveBeenCalledTimes(2); expect(await loadWorkspace()).not.toBeNull();
    await screen.findByText("保存済み");
  });
  it("does not abandon an unpersisted initial workspace when the save before switching also fails", async () => {
    const save = vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    render(<WorkspaceApp />); await screen.findByText("保存失敗");
    const editor = await screen.findByRole("textbox", { name: "小説本文" });
    fireEvent.click(screen.getByRole("button", { name: "新規作品" }));
    await screen.findByText("保存または読み込みに失敗したため、作品を切り替えませんでした。現在の本文はこの画面に保持されています。");
    expect(save).toHaveBeenCalledTimes(2); expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    expect(screen.getAllByRole("tab")).toHaveLength(1); expect(await loadWorkspace()).toBeNull();
  });
  it("warns before leaving with unsaved memory and clears the warning after Cmd/Ctrl + S saves it", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("原稿") }));
    render(<WorkspaceApp />); await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    fireEvent.change(screen.getByRole("textbox", { name: /設定メモ/u }), { target: { value: "保存前のメモ" } });
    const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, keyCode: 83 });
    await screen.findByText("本文と作品メモリを保存しました。");
    expect((await loadWorkspace())?.project.storyMemory.settingNotes).toBe("保存前のメモ");
    const saved = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(saved); expect(saved.defaultPrevented).toBe(false);
  });
  it("cancels backup replacement when the unsaved-memory confirmation is refused", async () => {
    const original = await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("元の原稿") }));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    const field = screen.getByRole("textbox", { name: /背景メモ/u }); fireEvent.change(field, { target: { value: "失いたくないメモ" } });
    openWorkspaceSettings(); const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true).mockReturnValueOnce(false);
    fireEvent.change(screen.getByLabelText(/JSONバックアップを取り込む/u), { target: { files: [new File([JSON.stringify(createWorkspaceFixture({ identity: "replacement" }))], "restore.json")] } });
    await screen.findByText("バックアップの取り込みを取り消しました。"); expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("保存していない作品メモリ"));
    expect(field).toHaveValue("失いたくないメモ"); expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    expect(await loadWorkspace()).toEqual(original);
  });
  it("cancels creation without invalidating a pending AI session when memory discard is refused", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("前対象後") }));
    const pending = createDeferred<Response>(); const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor();
    selectEditorText("対象"); dispatchKey(editor, "k", { ctrlKey: true, keyCode: 75 });
    fireEvent.change(await screen.findByRole("textbox", { name: "編集の指示" }), { target: { value: "自然に" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" })); await screen.findByText("候補を生成しています。本文編集は続けられます。");
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    fireEvent.change(screen.getByRole("textbox", { name: /設定メモ/u }), { target: { value: "草稿メモ" } });
    vi.spyOn(window, "confirm").mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: "新規作品" }));
    await screen.findByText("作品の切替を取り消しました。");
    const sent = fetch.mock.calls[0]?.[1]; if (!sent) throw new Error("Expected request"); expect(sent.signal?.aborted).toBe(false);
    pending.resolve(Response.json(createAiEditSuccessResponseFixture(parseAiRequest(sent))));
    await screen.findByText("2件の候補を受信しました。"); expect(editor).toHaveTextContent("前対象後");
    expect(screen.getByRole("textbox", { name: /設定メモ/u })).toHaveValue("草稿メモ");
  });
  it("saves before switching works and reopens closed tabs without deleting data", async () => {
    const original = await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("第一作品") }));
    render(<WorkspaceApp />); const firstEditor = await waitForEditableEditor(); dispatchPaste(firstEditor, { "text/plain": "追記" });
    fireEvent.click(screen.getByRole("button", { name: "新規作品" })); await screen.findByText("新しい作品を作成しました。");
    const secondEditor = screen.getByRole("textbox", { name: "小説本文" }); expect(secondEditor).not.toBe(firstEditor); expect(secondEditor.textContent).toBe("");
    dispatchPaste(secondEditor, { "text/plain": "第二作品" });
    fireEvent.click(screen.getByRole("tab", { name: original.project.title })); await screen.findByText("作品を開きました。");
    expect(screen.getByRole("textbox", { name: "小説本文" })).toHaveTextContent("追記第一作品");
    fireEvent.click(screen.getByRole("button", { name: "無題の作品のタブを閉じる" })); await screen.findByText("タブを閉じました。保存済み一覧から開き直せます。");
    expect(screen.queryByRole("tab", { name: "無題の作品" })).not.toBeInTheDocument();
    const database = await openWorkspaceDatabase(); const files = await new WorkspaceRepository(database).listFiles(); database.close();
    expect(files).toHaveLength(2); const other = files.find((file) => file.projectId !== original.project.id); if (!other) throw new Error("Expected second work");
    fireEvent.change(screen.getByRole("combobox", { name: "保存済み作品を開く" }), { target: { value: other.projectId } });
    await screen.findByText("作品を開きました。"); expect(screen.getByRole("textbox", { name: "小説本文" })).toHaveTextContent("第二作品");
    expect(screen.getByRole("tab", { name: "無題の作品" })).toHaveAttribute("aria-selected", "true");
  });
  it.each(["save", "activateFile"] as const)("retains the current editor and draft when %s fails during a switch", async (method) => {
    const original = await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("残す本文") }));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    vi.spyOn(WorkspaceRepository.prototype, method).mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    dispatchPaste(editor, { "text/plain": "最新" }); fireEvent.click(screen.getByRole("button", { name: "新規作品" }));
    await screen.findByText("保存または読み込みに失敗したため、作品を切り替えませんでした。現在の本文はこの画面に保持されています。");
    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor); expect(editor).toHaveTextContent("最新残す本文"); expect(editor).toHaveAttribute("contenteditable", "true");
    expect((await loadWorkspace())?.project.id).toBe(original.project.id);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });
  it("discards an abort-ignoring AI response after a file switch", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("前対象後") }));
    const pending = createDeferred<Response>(); const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor();
    selectEditorText("対象"); dispatchKey(editor, "k", { ctrlKey: true, keyCode: 75 });
    fireEvent.change(await screen.findByRole("textbox", { name: "編集の指示" }), { target: { value: "自然に" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" })); await screen.findByText("候補を生成しています。本文編集は続けられます。");
    const sent = fetch.mock.calls[0]?.[1]; if (!sent) throw new Error("Expected request");
    fireEvent.click(screen.getByRole("button", { name: "新規作品" })); await screen.findByText("新しい作品を作成しました。");
    expect(sent.signal?.aborted).toBe(true); pending.resolve(Response.json(createAiEditSuccessResponseFixture(parseAiRequest(sent))));
    await waitFor(() => expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "小説本文" }).textContent).toBe("");
  });
  it("saves and reloads memory without changing manuscript, editor instance or Undo history", async () => {
    const workspace = createWorkspaceFixture({ body: bodyWithText("前対象後") }); await seedWorkspace(workspace);
    const view = render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor();
    const instance = workspaceEditorObservation.current; if (!instance) throw new Error("Expected editor");
    const before = instance.state.doc.toJSON(); const history = undoDepth(instance.state);
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    fireEvent.change(screen.getByRole("textbox", { name: /設定メモ/u }), { target: { value: "魔法はない" } });
    fireEvent.change(screen.getByRole("textbox", { name: /背景メモ/u }), { target: { value: "海辺" } });
    fireEvent.change(screen.getByRole("textbox", { name: /登場人物メモ/u }), { target: { value: "葵：慎重" } });
    fireEvent.click(screen.getByRole("button", { name: "メモリを保存" })); await screen.findByText("作品メモリを保存しました。");
    expect(workspaceEditorObservation.current).toBe(instance); expect(instance.state.doc.toJSON()).toEqual(before); expect(undoDepth(instance.state)).toBe(history);
    const saved = await loadWorkspace(); expect(saved?.project).toMatchObject({ contextRevision: 1, storyMemory: { settingNotes: "魔法はない", backgroundNotes: "海辺", characterNotes: "葵：慎重" } });
    expect(saved?.chapter.body).toEqual(workspace.chapter.body);
    expect(saved?.chapter.contentRevision).toBe(workspace.chapter.contentRevision);
    expect(editor.textContent).toBe("前対象後");
    view.unmount(); await new Promise<void>((resolve) => queueMicrotask(resolve)); render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" })); expect(screen.getByRole("textbox", { name: /登場人物メモ/u })).toHaveValue("葵：慎重");
  });
  it("immediately invalidates a generating session on memory save, even when fetch ignores abort", async () => {
    const workspace = createWorkspaceFixture({ body: bodyWithText("前対象後") }); await seedWorkspace(workspace);
    const pending = createDeferred<Response>(); const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor();
    selectEditorText("対象"); dispatchKey(editor, "k", { ctrlKey: true, keyCode: 75 });
    fireEvent.change(await screen.findByRole("textbox", { name: "編集の指示" }), { target: { value: "自然に" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" })); await screen.findByText("候補を生成しています。本文編集は続けられます。");
    const sent = fetch.mock.calls[0]?.[1]; if (!sent) throw new Error("Expected request");
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    fireEvent.change(screen.getByRole("textbox", { name: /登場人物メモ/u }), { target: { value: "新しい人物メモ" } });
    fireEvent.click(screen.getByRole("button", { name: "メモリを保存" })); await screen.findByText(/AI参照設定が変更されたため/u);
    expect(sent.signal?.aborted).toBe(true); pending.resolve(Response.json(createAiEditSuccessResponseFixture(parseAiRequest(sent))));
    await screen.findByText("作品メモリを保存しました。"); expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument(); expect(editor).toHaveTextContent("前対象後");
  });
  it("retries a failed memory save with the same values without falsely reporting success or changing revision again", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("本文") }));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    const field = screen.getByRole("textbox", { name: /設定メモ/u }); fireEvent.change(field, { target: { value: "保存を再試行するメモ" } });
    fireEvent.click(screen.getByRole("button", { name: "メモリを保存" }));
    await screen.findByText("設定を保存できませんでした。入力内容はこの画面に保持されています。");
    expect(field).toHaveValue("保存を再試行するメモ"); expect((await loadWorkspace())?.project.storyMemory.settingNotes).toBe("");
    expect(screen.queryByText("作品メモリを保存しました。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "メモリを保存" })); await screen.findByText("作品メモリを保存しました。");
    expect((await loadWorkspace())?.project).toMatchObject({ contextRevision: 1, storyMemory: { settingNotes: "保存を再試行するメモ" } });
    expect(editor).toHaveTextContent("本文");
  });
  it("keeps API connections OFF on mount and resets opt-in without changing manuscript or saved settings", async () => {
    const workspace = createWorkspaceFixture({ body: multilinePersistedDocument });
    await seedWorkspace(workspace);
    const view = render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    const editor = await waitForEditableEditor(); const originalText = editor.textContent;
    openWorkspaceSettings();
    const toggle = screen.getByRole("checkbox", { name: "サブスクとは別料金のAPI接続を有効にする" });
    expect(toggle).not.toBeChecked(); fireEvent.click(toggle); expect(toggle).toBeChecked();
    expect(editor.textContent).toBe(originalText); expect(await loadWorkspace()).toEqual(workspace);
    view.unmount(); await new Promise<void>((resolve) => queueMicrotask(resolve));
    render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />); await waitForEditableEditor(); openWorkspaceSettings();
    expect(screen.getByRole("checkbox", { name: "サブスクとは別料金のAPI接続を有効にする" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "小説本文" }).textContent).toBe(originalText);
  });
  it("waits for hydration before creating the default editable workspace", async () => {
    render(<WorkspaceApp />);

    expect(screen.queryByRole("textbox", { name: "小説本文" })).toBeNull();
    expect(screen.getByText("読み込み中")).toBeInTheDocument();

    const editor = await waitForEditableEditor();
    expect(editor.querySelectorAll("p")).toHaveLength(1);
    expect(await loadWorkspace()).not.toBeNull();

    openWorkspaceSettings();
    expect(screen.getByLabelText(/作品名/u)).toHaveValue("無題の作品");
    expect(screen.getByLabelText(/共通プロンプト/u)).toHaveValue("");
    expect(screen.getByLabelText(/手動文体設定/u)).toHaveValue("");
  });

  it("hydrates blank paragraphs and trailing newlines exactly once", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: multilinePersistedDocument }),
    );
    const view = render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();

    expect(
      [...editor.querySelectorAll("p")].map((paragraph) =>
        paragraph.textContent ?? "",
      ),
    ).toEqual(["冒頭🙂", "", "結び", ""]);

    dispatchPaste(editor, { "text/plain": "追記" });
    view.rerender(<WorkspaceApp />);

    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    expect(editor).toHaveTextContent("追記冒頭🙂");
  });

  it("distinguishes a valid empty manuscript from a missing workspace", async () => {
    const saved = await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );

    const editor = await waitForEditableEditorAfterRender();
    expect(editor.querySelectorAll("p")).toHaveLength(1);
    expect(editor).toHaveTextContent("");
    expect((await loadWorkspace())?.project.id).toBe(saved.project.id);
  });

  it("does not schedule persistence for selection-only transactions", async () => {
    const { NovelEditor } = await import(
      "../../src/features/editor/NovelEditor"
    );
    const onDocumentChange = vi.fn();
    const editorRef: { current: Editor | null } = { current: null };
    render(
      <NovelEditor
        initialText="選択だけ"
        onDocumentChange={onDocumentChange}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
      />,
    );
    await screen.findByRole("textbox", { name: "小説本文" });
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    editorRef.current?.commands.setTextSelection({ from: 1, to: 2 });
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onDocumentChange).not.toHaveBeenCalled();

    editorRef.current?.commands.insertContent("変更");
    expect(onDocumentChange).toHaveBeenCalledOnce();
  });


  it("flushes on background/pagehide without claiming success before the write or losing text on failure", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: emptyPersistedDocument }));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    await screen.findByText("保存済み", { exact: true });
    const held = createDeferred<never>();
    const save = vi.spyOn(WorkspaceRepository.prototype, "save").mockImplementationOnce(() => held.promise);
    dispatchPaste(editor, { "text/plain": "背景化しても保持" });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(screen.queryByText("保存済み", { exact: true })).not.toBeInTheDocument();
    held.reject(new DOMException("quota", "QuotaExceededError"));
    await screen.findByText("保存失敗", { exact: true });
    expect(editor).toHaveTextContent("背景化しても保持");
    fireEvent(window, new Event("pagehide"));
    await screen.findByText("保存済み", { exact: true });
    const saved = await loadWorkspace();
    expect(saved?.chapter.body).toEqual(bodyWithText("背景化しても保持"));
    expect(saved?.schemaVersion).toBe(6);
  });

  it("keeps PM content on quota failure and saves a later edit", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );

    dispatchPaste(editor, { "text/plain": "失敗後も残る" });
    await screen.findByText("保存失敗", {}, { timeout: 2_000 });

    expect(editor).toHaveTextContent("失敗後も残る");
    expect(
      screen.getByText("保存できませんでした。本文はこの画面に保持されています。"),
    ).toBeInTheDocument();

    await editAndWaitForSave(editor, "再試行");

    expect(editor).toHaveTextContent("失敗後も残る再試行");
    const recovered = await loadWorkspace();
    expect(recovered).toMatchObject({
      schemaVersion: 6,
      storageVersion: 1,
    });
    expect(recovered?.chapter.body).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "失敗後も残る再試行" }],
        },
      ],
    });
  });

  it("retains the in-memory manuscript and becomes read-only on conflict", async () => {
    const initial = await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();
    const competingDatabase = await openWorkspaceDatabase();
    const competingRepository = new WorkspaceRepository(competingDatabase);
    const competing = await competingRepository.save({
      ...initial,
      chapter: { ...initial.chapter, contentRevision: 99 },
    });

    dispatchPaste(editor, { "text/plain": "競合しても残る" });

    expect(
      await screen.findByText("保存先が更新されたため読み取り専用", {}, {
        timeout: 2_000,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(editor).toHaveAttribute("contenteditable", "false"),
    );
    expect(editor).toHaveTextContent("競合しても残る");
    expect(await competingRepository.load()).toEqual(competing);
    competingDatabase.close();
  });

  it("keeps undo history across autosave and persists the undo", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();

    await editAndWaitForSave(editor, "保存後に戻す");
    dispatchKey(editor, "z", { ctrlKey: true, keyCode: 90 });
    await screen.findByText("未保存");
    expect(editor).not.toHaveTextContent("保存後に戻す");
    await screen.findByText("保存済み", {}, { timeout: 2_000 });

    expect((await loadWorkspace())?.chapter.body).toEqual(
      emptyPersistedDocument,
    );
  });

  it("serializes an accepted candidate behind an active manuscript save", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    installSuccessfulAiFetch();
    const saveStarted = createDeferred<void>();
    const releaseSave = createDeferred<void>();
    const originalSave = WorkspaceRepository.prototype.save;
    vi.spyOn(WorkspaceRepository.prototype, "save").mockImplementationOnce(
      async function (this: WorkspaceRepository, snapshot) {
        saveStarted.resolve();
        await releaseSave.promise;
        return originalSave.call(this, snapshot);
      },
    );
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />);
    const editor = await waitForEditableEditor();

    dispatchPaste(editor, { "text/plain": "前対象後" });
    await saveStarted.promise;
    await openAndGenerateCandidate(editor);
    fireEvent.click(screen.getByRole("button", { name: "採用" }));

    expect(editor).toHaveTextContent("前対象【デモ候補1】後");
    releaseSave.resolve();
    await screen.findByText("保存済み", {}, { timeout: 2_000 });

    const stored = await loadWorkspace();
    expect(stored?.chapter.body).toEqual(bodyWithText("前対象【デモ候補1】後"));
    expect(stored?.storageVersion).toBe(2);
  });

  it("keeps Preview applicable across an unrelated autosave failure", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    installSuccessfulAiFetch();
    const saveStarted = createDeferred<void>();
    const releaseFailure = createDeferred<void>();
    vi.spyOn(WorkspaceRepository.prototype, "save").mockImplementationOnce(
      async () => {
        saveStarted.resolve();
        await releaseFailure.promise;
        throw new DOMException("quota", "QuotaExceededError");
      },
    );
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />);
    const editor = await waitForEditableEditor();

    dispatchPaste(editor, { "text/plain": "前対象後" });
    await saveStarted.promise;
    await openAndGenerateCandidate(editor);
    releaseFailure.resolve();

    expect(await screen.findByText("保存失敗")).toBeInTheDocument();
    expect(screen.getByText("2件の候補を受信しました。")).toBeInTheDocument();
    expect(editor).toHaveTextContent("前対象後");

    fireEvent.click(screen.getByRole("button", { name: "採用" }));
    await screen.findByText("保存済み", {}, { timeout: 2_000 });
    expect((await loadWorkspace())?.chapter.body).toEqual(
      bodyWithText("前対象【デモ候補1】後"),
    );
  });

  it("keeps an accepted candidate in memory after immediate save failure and recovers", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: bodyWithText("前対象後") }),
    );
    installSuccessfulAiFetch();
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />);
    const editor = await waitForEditableEditor();
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );

    await openAndGenerateCandidate(editor);
    fireEvent.click(screen.getByRole("button", { name: "採用" }));

    expect(await screen.findByText("保存失敗")).toBeInTheDocument();
    expect(editor).toHaveTextContent("前対象【デモ候補1】後");
    expect((await loadWorkspace())?.chapter.body).toEqual(
      bodyWithText("前対象後"),
    );

    workspaceEditorObservation.current?.commands.insertContent("追");
    await screen.findByText("保存済み", {}, { timeout: 2_000 });
    expect((await loadWorkspace())?.chapter.body).toEqual(
      bodyWithText("前対象【デモ候補1】追後"),
    );
  });

  it("aborts an in-flight AI session when import replaces the editor", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: bodyWithText("前対象後") }),
    );
    const pending = createDeferred<Response>();
    const observation: {
      request?: AiEditRequest;
      signal?: AbortSignal;
    } = {};
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      observation.request = parseAiRequest(init);

      if (init?.signal instanceof AbortSignal) {
        observation.signal = init.signal;
      }

      return pending.promise;
    });
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />);
    const oldEditor = await waitForEditableEditor();
    selectEditorText("対象");
    dispatchKey(oldEditor, "k", { ctrlKey: true, keyCode: 75 });
    fireEvent.change(
      await screen.findByRole("textbox", { name: "編集の指示" }),
      { target: { value: "自然に" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    await screen.findByText("候補を生成しています。本文編集は続けられます。");

    openWorkspaceSettings();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const replacement = createWorkspaceFixture({ identity: "replacement" });
    fireEvent.change(
      screen.getByLabelText(/JSONバックアップを取り込む/u),
      {
        target: {
          files: [
            new File([JSON.stringify(replacement)], "replacement.json", {
              type: "application/json",
            }),
          ],
        },
      },
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "小説本文" })).not.toBe(
        oldEditor,
      ),
    );
    expect(observation.signal?.aborted).toBe(true);

    if (observation.request === undefined) {
      throw new Error("AI request was not captured");
    }

    pending.resolve(
      Response.json(createAiEditSuccessResponseFixture(observation.request)),
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(screen.queryByText("2件の候補を受信しました。")).toBeNull();
    expect(screen.getByRole("textbox", { name: "小説本文" })).toHaveTextContent(
      "冒頭🙂結び",
    );
    expect((await loadWorkspace())?.project.id).toBe(replacement.project.id);
  });

  it("does not create an editor or overwrite malformed stored data", async () => {
    const database = await openWorkspaceDatabase();
    const snapshot = createWorkspaceFixture();
    const malformed = {
      ...snapshot,
      project: { ...snapshot.project, aiModelPreference: "" },
    };
    await database.put(
      WORKSPACES_STORE_NAME,
      malformed,
      snapshot.project.id,
    );
    database.close();

    render(<WorkspaceApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存データを読み込めませんでした",
    );
    expect(screen.queryByRole("textbox", { name: "小説本文" })).toBeNull();

    const verificationDatabase = await openWorkspaceDatabase();
    await expect(
      verificationDatabase.get(WORKSPACES_STORE_NAME, snapshot.project.id),
    ).resolves.toEqual(malformed);
    verificationDatabase.close();
  });

  it("hydrates persistent content read-only when Web Locks is unsupported", async () => {
    await seedWorkspace();
    removeTestLockManager();
    render(<WorkspaceApp />);

    const editor = await screen.findByRole("textbox", { name: "小説本文" });
    expect(
      screen.getByText("Web Locksを利用できないため読み取り専用"),
    ).toBeInTheDocument();
    expect(editor).toHaveAttribute("contenteditable", "false");

    openWorkspaceSettings();
    expect(screen.getByLabelText(/作品名/u)).toBeDisabled();
    expect(
      screen.getByLabelText(/JSONバックアップを取り込む/u),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "ローカルデータを削除" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "JSONバックアップを書き出す" }),
    ).toBeEnabled();
  });

  it("persists basic settings without reconstructing the editor or history", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();
    dispatchPaste(editor, { "text/plain": "履歴を保持" });
    openWorkspaceSettings();

    const titleInput = screen.getByLabelText(/作品名/u);
    const commonPromptInput = screen.getByLabelText(/共通プロンプト/u);
    const manualStyleInput = screen.getByLabelText(/手動文体設定/u);
    expect(titleInput).toHaveValue("星明かりの物語");
    expect(commonPromptInput).toHaveValue("余韻を保つ");
    expect(manualStyleInput).toHaveValue("静かな文体");

    fireEvent.change(titleInput, {
      target: { value: "新しい作品名" },
    });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
    await waitFor(async () => {
      const titleOnly = await loadWorkspace();
      expect(titleOnly?.project).toMatchObject({
        contextRevision: 0,
        title: "新しい作品名",
      });
      expect(titleOnly?.styleProfile.revision).toBe(0);
    });

    fireEvent.change(commonPromptInput, {
      target: { value: "固有名詞を維持する" },
    });
    fireEvent.change(manualStyleInput, {
      target: { value: "簡潔な文体" },
    });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    expect(await screen.findByText("設定を保存しました。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    const saved = await loadWorkspace();
    expect(saved?.project).toMatchObject({
      commonPrompt: "固有名詞を維持する",
      contextRevision: 1,
      title: "新しい作品名",
    });
    expect(saved?.styleProfile).toMatchObject({
      manualInstructions: "簡潔な文体",
      revision: 1,
    });
    expect(saved?.chapter.contentRevision).toBe(1);

    dispatchKey(editor, "z", { ctrlKey: true, keyCode: 90 });
    expect(editor).not.toHaveTextContent("履歴を保持");
  });

  it("persists provider consent, restores it after reload, and persists revocation", async () => {
    await seedWorkspace();
    const view = render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    await waitForEditableEditor();
    openWorkspaceSettings();
    const settings = document.getElementById("workspace-panel-settings");

    if (settings === null) {
      throw new Error("settings region was not found");
    }

    const checkbox = within(settings).getByRole("checkbox", {
      name: "上記のデータがOpenAIへ送信されることに同意します",
    });
    const grant = within(settings).getByRole("button", {
      name: "同意を保存",
    });
    expect(checkbox).not.toBeChecked();
    expect(grant).toBeDisabled();
    fireEvent.click(checkbox);
    fireEvent.click(grant);

    expect(
      await within(settings).findByText(
        "外部送信への同意を保存しました。新しいAI編集から有効です。",
      ),
    ).toBeInTheDocument();
    await waitFor(async () => {
      expect((await loadWorkspace())?.project).toMatchObject({
        aiConsent: {
          policyVersion: 1,
          providerId: "openai",
        },
        contextRevision: 1,
      });
    });

    view.unmount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    await waitForEditableEditor();
    openWorkspaceSettings();
    expect(await screen.findByText("同意済み")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "上記のデータがOpenAIへ送信されることに同意します",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "同意を撤回" }));
    await waitFor(async () => {
      expect((await loadWorkspace())?.project).toMatchObject({
        aiConsent: null,
        contextRevision: 2,
      });
    });
    expect(await screen.findByText("未同意")).toBeInTheDocument();
  });

  it("lists every supported OpenAI model and persists a workspace selection without revoking consent", async () => {
    const workspace = createWorkspaceFixture();
    await seedWorkspace({
      ...workspace,
      project: {
        ...workspace.project,
        aiConsent: {
          grantedAt: "2026-09-20T00:00:00.000Z",
          policyVersion: 1,
          providerId: "openai",
        },
        contextRevision: 4,
      },
    });
    const view = render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    await waitForEditableEditor();
    openWorkspaceSettings();

    const selector = screen.getByRole("combobox", { name: "使用モデル" });
    expect(selector).toHaveAccessibleDescription(
      /モデルは作品ごとに保存されます/u,
    );
    expect(
      within(selector).getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "自動（サーバー既定：GPT-5.6 Terra）",
      "GPT-6 Astra",
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "GPT-5.6 Luna",
    ]);
    expect(screen.getByText(/高難度の処理向け/u)).toBeInTheDocument();
    expect(screen.getByText(/複雑な専門作業向け/u)).toBeInTheDocument();
    expect(screen.getByText(/性能とコストのバランス/u)).toBeInTheDocument();
    expect(screen.getByText(/低コスト・高頻度利用向け/u)).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "gpt-6-astra" } });
    fireEvent.click(
      screen.getByRole("button", { name: "モデル設定を保存" }),
    );

    expect(
      await screen.findByText(
        "AIモデル設定を保存しました。新しいAI編集から有効です。",
      ),
    ).toBeInTheDocument();
    await waitFor(async () => {
      expect((await loadWorkspace())?.project).toMatchObject({
        aiConsent: { policyVersion: 1, providerId: "openai" },
        aiModelPreference: "gpt-6-astra",
        contextRevision: 5,
      });
    });
    expect(screen.getByLabelText("AI実行環境")).toHaveTextContent(
      "AI：GPT-6 Astra（外部送信あり）",
    );

    view.unmount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    await waitForEditableEditor();
    openWorkspaceSettings();
    expect(screen.getByRole("combobox", { name: "使用モデル" })).toHaveValue(
      "gpt-6-astra",
    );
    expect(screen.getByText("同意済み")).toBeInTheDocument();
  });

  it("shows an explicit saved model as unavailable without falling back", async () => {
    const workspace = createWorkspaceFixture();
    await seedWorkspace({
      ...workspace,
      project: {
        ...workspace.project,
        aiModelPreference: "gpt-retired-model",
      },
    });
    render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    await waitForEditableEditor();

    expect(screen.getByLabelText("AI実行環境")).toHaveTextContent(
      "AI：選択モデル利用不可（gpt-retired-model）",
    );
    openWorkspaceSettings();
    expect(screen.getByRole("combobox", { name: "使用モデル" })).toHaveValue(
      "gpt-retired-model",
    );
    expect(
      screen.getByText(/保存済みモデル「gpt-retired-model」は現在利用できません/u),
    ).toHaveAttribute("role", "alert");
  });

  it("does not lose consent when it is granted during an active manuscript save", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: emptyPersistedDocument }));
    const saveStarted = createDeferred<void>();
    const releaseSave = createDeferred<void>();
    const originalSave = WorkspaceRepository.prototype.save;
    vi.spyOn(WorkspaceRepository.prototype, "save").mockImplementationOnce(
      async function (this: WorkspaceRepository, snapshot) {
        saveStarted.resolve();
        await releaseSave.promise;
        return originalSave.call(this, snapshot);
      },
    );
    render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    const editor = await waitForEditableEditor();
    dispatchPaste(editor, { "text/plain": "保存中の本文" });
    await saveStarted.promise;
    openWorkspaceSettings();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "上記のデータがOpenAIへ送信されることに同意します",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "同意を保存" }));
    releaseSave.resolve();

    expect(
      await screen.findByText(
        "外部送信への同意を保存しました。新しいAI編集から有効です。",
      ),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const saved = await loadWorkspace();
      expect(saved?.project.aiConsent).toMatchObject({
        policyVersion: 1,
        providerId: "openai",
      });
      expect(saved?.project.contextRevision).toBe(1);
      expect(saved?.chapter.body).toEqual({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "保存中の本文" }],
          },
        ],
      });
    });
  });

  it("allows stored consent to be revoked while AI is disabled without prompting for new consent", async () => {
    const workspace = createWorkspaceFixture();
    await seedWorkspace({
      ...workspace,
      project: {
        ...workspace.project,
        aiConsent: {
          grantedAt: "2026-09-20T00:00:00.000Z",
          policyVersion: 1,
          providerId: "openai",
        },
      },
    });
    render(<WorkspaceApp />);
    await waitForEditableEditor();
    openWorkspaceSettings();

    expect(screen.getByText("AIは現在無効です。外部送信は行われません。")).toBeInTheDocument();
    expect(screen.getByText("OpenAI（現在は使用しません）", { exact: false })).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "上記のデータがOpenAIへ送信されることに同意します",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "同意を撤回" }));

    await waitFor(async () => {
      expect((await loadWorkspace())?.project).toMatchObject({
        aiConsent: null,
        contextRevision: 1,
      });
    });
  });

  it("keeps external sending disabled when consent persistence fails", async () => {
    await seedWorkspace();
    render(<WorkspaceApp aiRuntime={OPENAI_RUNTIME} />);
    const editor = await waitForEditableEditor();
    openWorkspaceSettings();
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "上記のデータがOpenAIへ送信されることに同意します",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "同意を保存" }));

    expect(
      await screen.findByText(
        "同意を保存できなかったため、外部送信は有効になっていません。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("未同意")).toBeInTheDocument();
    expect((await loadWorkspace())?.project).toMatchObject({
      aiConsent: null,
      contextRevision: 0,
    });

    await editAndWaitForSave(editor, "失敗後の本文");
    expect((await loadWorkspace())?.project.aiConsent).toBeNull();
  });

  it("rejects invalid settings without changing persisted data", async () => {
    const original = await seedWorkspace();
    render(<WorkspaceApp />);
    await waitForEditableEditor();
    openWorkspaceSettings();

    fireEvent.change(screen.getByLabelText(/作品名/u), {
      target: { value: "🙂".repeat(121) },
    });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    expect(
      await screen.findByText("作品名は1〜120文字、共通プロンプトは2,000文字、文体設定は1,000文字以内にしてください。"),
    ).toBeInTheDocument();
    expect(await loadWorkspace()).toEqual(original);
  });

  it("keeps the current workspace after repository replacement failure", async () => {
    const original = await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();
    openWorkspaceSettings();
    vi.spyOn(WorkspaceRepository.prototype, "replace").mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const replacement = createWorkspaceFixture({ identity: "replacement" });

    fireEvent.change(
      screen.getByLabelText(/JSONバックアップを取り込む/u),
      {
        target: {
          files: [
            new File([JSON.stringify(replacement)], "restore.json", {
              type: "application/json",
            }),
          ],
        },
      },
    );

    expect(
      await screen.findByText(
        "バックアップを保存できませんでした。現在の作品は変更されていません。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    expect(await loadWorkspace()).toEqual(original);

    await editAndWaitForSave(editor, "失敗後も編集可能");
    expect((await loadWorkspace())?.chapter.body).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "失敗後も編集可能" }],
        },
      ],
    });
  });

  it("imports safely when initial creation existed only in memory", async () => {
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(
      new DOMException("quota", "QuotaExceededError"),
    );
    render(<WorkspaceApp />);
    await screen.findByText("保存失敗");
    openWorkspaceSettings();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const replacement = createWorkspaceFixture({ identity: "replacement" });

    fireEvent.change(
      screen.getByLabelText(/JSONバックアップを取り込む/u),
      {
        target: {
          files: [
            new File([JSON.stringify(replacement)], "restore.json", {
              type: "application/json",
            }),
          ],
        },
      },
    );

    await waitFor(async () => {
      const stored = await loadWorkspace();
      expect(stored?.project.id).toBe(replacement.project.id);
      expect(stored?.storageVersion).toBe(0);
    });
    expect(screen.getByRole("textbox", { name: "小説本文" })).toHaveTextContent(
      "冒頭🙂",
    );
  });

  it("atomically imports a validated backup, resets consent, and replaces the editor session", async () => {
    await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const oldEditor = await waitForEditableEditor();
    dispatchPaste(oldEditor, { "text/plain": "取り込まれない未保存本文" });
    openWorkspaceSettings();
    const replacement = createWorkspaceFixture({ identity: "replacement" });
    const consented = {
      ...replacement,
      project: {
        ...replacement.project,
        aiConsent: {
          providerId: "provider",
          policyVersion: 1 as const,
          grantedAt: "2026-09-19T00:00:00.000Z",
        },
      },
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const file = new File([JSON.stringify(consented)], "restore.json", {
      type: "application/json",
    });

    fireEvent.change(
      screen.getByLabelText(/JSONバックアップを取り込む/u),
      { target: { files: [file] } },
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "小説本文" })).not.toBe(
        oldEditor,
      ),
    );
    const restoredEditor = screen.getByRole("textbox", {
      name: "小説本文",
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(
      [...restoredEditor.querySelectorAll("p")].map(
        (paragraph) => paragraph.textContent ?? "",
      ),
    ).toEqual(["冒頭🙂", "", "結び", ""]);
    dispatchKey(restoredEditor, "z", { ctrlKey: true, keyCode: 90 });
    expect(restoredEditor).toHaveTextContent("冒頭🙂");

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const stored = await loadWorkspace();
    expect(stored).toMatchObject({
      project: {
        aiConsent: null,
        contextRevision: 1,
        id: replacement.project.id,
      },
      storageVersion: 1,
    });
    expect(JSON.stringify(stored?.chapter.body)).not.toContain(
      "取り込まれない未保存本文",
    );
  });

  it("rejects invalid backup before confirmation without changing current data", async () => {
    const original = await seedWorkspace(
      createWorkspaceFixture({ body: emptyPersistedDocument }),
    );
    render(<WorkspaceApp />);
    const editor = await waitForEditableEditor();
    openWorkspaceSettings();
    const confirm = vi.spyOn(window, "confirm");

    fireEvent.change(
      screen.getByLabelText(/JSONバックアップを取り込む/u),
      {
        target: {
          files: [
            new File(["{"], "invalid.json", {
              type: "application/json",
            }),
          ],
        },
      },
    );

    expect(
      await screen.findByText(
        "JSONとして読み込めません。現在の作品は変更されていません。",
      ),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    expect(await loadWorkspace()).toEqual(original);
  });

  it("requires confirmation before deleting local data", async () => {
    const original = await seedWorkspace();
    render(<WorkspaceApp />);
    await waitForEditableEditor();
    openWorkspaceSettings();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const deleteButton = screen.getByRole("button", {
      name: "ローカルデータを削除",
    });

    fireEvent.click(deleteButton);
    expect(await loadWorkspace()).toEqual(original);

    fireEvent.click(deleteButton);
    expect(await screen.findByText("ローカルデータを削除しました。", {
      exact: false,
    })).toBeInTheDocument();
    expect(await loadWorkspace()).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("textbox", { name: "小説本文" })).toBeNull();
  });
  it("retains each live PM editor, selection and Undo across work and chapter switches", async () => {
    const original = await seedWorkspace(createWorkspaceFixture({ body: emptyPersistedDocument }));
    render(<WorkspaceApp />); const first = await waitForEditableEditor();
    dispatchPaste(first, { "text/plain": "原稿😀" });
    const pm = workspaceEditorObservation.current; if (!pm) throw new Error("Missing editor"); setTextSelection(pm, 3);
    fireEvent.click(screen.getByRole("button", { name: "新規作品" })); await screen.findByText("新しい作品を作成しました。");
    fireEvent.click(screen.getByRole("tab", { name: original.project.title })); await screen.findByText("作品を開きました。");
    expect(workspaceEditorObservation.current).toBe(pm); expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(first);
    expect(pm.state.selection.anchor).toBe(3); expect(undoDepth(pm.state)).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "章とアウトライン" }));
    fireEvent.click(screen.getByRole("button", { name: "章を追加" })); await screen.findByRole("button", { name: "第2章" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "小説本文" })).toHaveTextContent(""));
    fireEvent.click(screen.getByRole("button", { name: "第一章" })); await waitFor(() => expect(workspaceEditorObservation.current).toBe(pm));
    expect(pm.state.selection.anchor).toBe(3); dispatchKey(first, "z", { ctrlKey: true, keyCode: 90 }); expect(first.textContent).toBe("");
    dispatchKey(first, "z", { ctrlKey: true, shiftKey: true, keyCode: 90 }); expect(first).toHaveTextContent("原稿😀");
  });
  it("protects outline drafts and saves them with the normal save command", async () => {
    await seedWorkspace(); render(<WorkspaceApp />); await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "章とアウトライン" }));
    fireEvent.change(screen.getByRole("textbox", { name: "章タイトル" }), { target: { value: "旅立ち" } });
    fireEvent.change(screen.getByRole("textbox", { name: "章のアウトライン" }), { target: { value: "町を出る\n友と別れる" } });
    const before = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(before); expect(before.defaultPrevented).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: "新規作品" }));
    await screen.findByText("作品の切替を取り消しました。"); expect(screen.getByRole("textbox", { name: "章タイトル" })).toHaveValue("旅立ち");
    fireEvent.click(screen.getByRole("button", { name: "保存" })); await screen.findByText("本文と作品メモリを保存しました。");
    expect((await loadWorkspace())?.chapter).toMatchObject({ title: "旅立ち", outlineNotes: "町を出る\n友と別れる" });
    const after = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
  });
  it("keeps the source editor and an outline draft after a chapter write fails", async () => {
    await seedWorkspace(); render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "章とアウトライン" }));
    fireEvent.change(screen.getByRole("textbox", { name: "章のアウトライン" }), { target: { value: "未保存" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(WorkspaceRepository.prototype, "save").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    fireEvent.click(screen.getByRole("button", { name: "章を追加" }));
    await screen.findByText("保存に失敗したため変更しませんでした。現在の本文は保持されています。");
    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor); expect(editor).toHaveAttribute("contenteditable", "true");
    expect(screen.getByRole("textbox", { name: "章のアウトライン" })).toHaveValue("未保存"); expect((await loadWorkspace())?.document.chapterIds).toHaveLength(1);
  });
  it("previews, cancels and restores manuscript and memory with a pre-restore checkpoint", async () => {
    const original = createWorkspaceFixture({ body: bodyWithText("初稿") }); original.project.storyMemory.characterNotes = "初期人物";
    await seedWorkspace(original); render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    fireEvent.click(screen.getByRole("button", { name: "保存履歴・復元" }));
    fireEvent.change(screen.getByRole("textbox", { name: "履歴の名前" }), { target: { value: "最初の稿" } });
    fireEvent.click(screen.getByRole("button", { name: "現在の状態を履歴に保存" })); await screen.findByRole("button", { name: /^最初の稿/u });
    const pm = workspaceEditorObservation.current; if (!pm) throw new Error("Missing editor"); setTextSelection(pm, 1, 3); dispatchPaste(editor, { "text/plain": "改稿" });
    fireEvent.click(screen.getByRole("button", { name: "作品メモリ" }));
    fireEvent.change(screen.getByRole("textbox", { name: /登場人物メモ/u }), { target: { value: "後期人物" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" })); await screen.findByText("本文と作品メモリを保存しました。");
    fireEvent.click(screen.getByRole("button", { name: "保存履歴・復元" }));
    fireEvent.click(screen.getByRole("button", { name: /^最初の稿/u })); await screen.findByLabelText("履歴の復元プレビュー");
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "確認してこの履歴を復元" })); expect(editor).toHaveTextContent("改稿");
    fireEvent.click(screen.getByRole("button", { name: "確認してこの履歴を復元" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "小説本文" })).toHaveTextContent("初稿"));
    expect((await loadWorkspace())?.project.storyMemory.characterNotes).toBe("初期人物");
    await screen.findByRole("button", { name: /^復元前の状態/u });
  });
  it("discards an abort-ignoring AI response after switching chapters and returning to the same PM editor", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("前対象後") }));
    const pending = createDeferred<Response>(); const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    render(<WorkspaceApp aiRuntime={MOCK_RUNTIME} />); const editor = await waitForEditableEditor(); const first = workspaceEditorObservation.current;
    selectEditorText("対象"); dispatchKey(editor, "k", { ctrlKey: true, keyCode: 75 });
    fireEvent.change(await screen.findByRole("textbox", { name: "編集の指示" }), { target: { value: "自然に" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" })); await screen.findByText("候補を生成しています。本文編集は続けられます。");
    const init = fetch.mock.calls[0]?.[1]; if (!init) throw new Error("Missing request");
    fireEvent.click(screen.getByRole("button", { name: "章とアウトライン" }));
    fireEvent.click(screen.getByRole("button", { name: "章を追加" })); await screen.findByRole("button", { name: "第2章" });
    fireEvent.click(screen.getByRole("button", { name: "第一章" })); await waitFor(() => expect(workspaceEditorObservation.current).toBe(first));
    expect(init.signal?.aborted).toBe(true); pending.resolve(Response.json(createAiEditSuccessResponseFixture(parseAiRequest(init))));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument(); expect(editor).toHaveTextContent("前対象後");
  });

  it("starts automatic history OFF, then records prior text only after explicit opt-in", async () => {
    await seedWorkspace(createWorkspaceFixture({ body: bodyWithText("初稿") }));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    await editAndWaitForSave(editor, "前");
    let database = await openWorkspaceDatabase(); expect(await database.count("workspace-history")).toBe(0); database.close();
    fireEvent.click(screen.getByRole("button", { name: "保存履歴・復元" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /自動保存前の状態を履歴に残す/u }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /自動保存前の状態を履歴に残す/u })).toBeChecked());
    await screen.findByText("履歴を更新しました。");
    await editAndWaitForSave(editor, "後");
    database = await openWorkspaceDatabase();
    const history = await new WritingHistoryRepository(database).list((await loadWorkspace())?.project.id ?? ""); database.close();
    expect(history).toHaveLength(1); expect(history[0].snapshot.chapter.body).toEqual(bodyWithText("前初稿"));
  });
  it("saves the manuscript despite automatic history quota failure and reports the missing history", async () => {
    const original = createWorkspaceFixture({ body: bodyWithText("本文") }); original.project.autoHistoryEnabled = true;
    await seedWorkspace(original); vi.spyOn(WritingHistoryRepository.prototype, "add").mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    render(<WorkspaceApp />); const editor = await waitForEditableEditor(); await editAndWaitForSave(editor, "最新");
    await screen.findByText("本文は保存されましたが、保存履歴を記録できませんでした。");
    expect((await loadWorkspace())?.chapter.body).toEqual(bodyWithText("最新本文")); expect(editor).toHaveAttribute("contenteditable", "true");
  });

  it("serializes a slow checkpoint against file switching and resumes editing afterwards", async () => {
    await seedWorkspace(); render(<WorkspaceApp />); const editor = await waitForEditableEditor();
    const pending = createDeferred<void>(); const add = vi.spyOn(WritingHistoryRepository.prototype, "add").mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "保存履歴・復元" }));
    fireEvent.click(screen.getByRole("button", { name: "現在の状態を履歴に保存" }));
    await screen.findByText("履歴・バックアップ処理中");
    expect(editor).toHaveAttribute("contenteditable", "false"); expect(screen.getByRole("button", { name: "新規作品" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "新規作品" })); expect(screen.getAllByRole("tab")).toHaveLength(1);
    pending.resolve(); await screen.findByText("履歴を更新しました。");
    expect(editor).toHaveAttribute("contenteditable", "true"); expect(add).toHaveBeenCalledOnce();
  });

});

async function waitForEditableEditorAfterRender() {
  render(<WorkspaceApp />);
  return waitForEditableEditor();
}
