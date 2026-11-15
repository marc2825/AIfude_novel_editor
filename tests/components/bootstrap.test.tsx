import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "../../src/app/page";
import { NovelEditor } from "../../src/features/editor/NovelEditor";
import { WorkspaceApp } from "../../src/features/workspace/WorkspaceApp";
import { dispatchKey, dispatchPaste } from "../helpers/editor";
import { installTestLockManager } from "../helpers/web-locks";
import {
  MOCK_AI_RUNTIME,
  OPENAI_AI_RUNTIME,
} from "../fixtures/ai-runtime";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  installTestLockManager();
  vi.stubEnv("NOVEL_AI_SETTINGS_PATH", `/tmp/novel-ai-bootstrap-${crypto.randomUUID()}/settings.json`);
});

describe("bootstrap page", () => {
  it("displays the product title and save status", async () => {
    render(await Home());

    expect(
      screen.getByRole("heading", { name: "AIFUDE" }),
    ).toBeInTheDocument();
    expect(screen.getByText("読み込み中")).toBeInTheDocument();
    expect(await screen.findByText("保存済み")).toBeInTheDocument();
  });

  it("does not make an AI request on initial render", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(await Home());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("labels mock as local demo output without external transfer", async () => {
    render(
      <WorkspaceApp aiRuntime={MOCK_AI_RUNTIME} />,
    );

    expect(screen.getByLabelText("AI実行環境")).toHaveTextContent(
      "AI：ローカルデモ候補（デモ候補・外部送信なし）",
    );
    expect(await screen.findByText("保存済み")).toBeInTheDocument();
  });

  it("labels configured OpenAI metadata as an external transfer", async () => {
    render(
      <WorkspaceApp aiRuntime={OPENAI_AI_RUNTIME} />,
    );

    expect(screen.getByLabelText("AI実行環境")).toHaveTextContent(
      "AI：GPT-5.6 Terra（外部送信あり）",
    );
    expect(await screen.findByText("保存済み")).toBeInTheDocument();
  });

  it("displays the configured local model without requesting inference or exposing its token", async () => {
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    vi.stubEnv("AI_PROVIDER", "local");
    vi.stubEnv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:1234/v1");
    vi.stubEnv("LOCAL_LLM_MODEL", "test-local-model");
    vi.stubEnv("LOCAL_LLM_API_KEY", "private-local-token");
    const fetch = vi.spyOn(globalThis, "fetch");

    try {
      render(await Home());
      expect(screen.getByLabelText("AI実行環境")).toHaveTextContent(
        "AI：ローカルLLM：test-local-model（外部送信なし）",
      );
      expect(document.body).not.toHaveTextContent("private-local-token");
      expect(fetch).not.toHaveBeenCalled();
      expect(await screen.findByText("保存済み")).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("provides a labelled multiline editor", async () => {
    render(await Home());

    const editor = await screen.findByRole("textbox", { name: "小説本文" });

    expect(editor).toHaveAttribute("aria-multiline", "true");
    expect(editor).toHaveAttribute("contenteditable", "true");
  });

  it("does not replace the document when React rerenders", async () => {
    const view = render(<NovelEditor initialText="初期本文" />);
    const editor = await screen.findByRole("textbox", { name: "小説本文" });
    const textNode = editor.querySelector("p")?.firstChild;

    if (textNode === null || textNode === undefined) {
      throw new Error("Expected the initial paragraph to contain text");
    }

    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    view.rerender(<NovelEditor initialText="別の本文" />);

    expect(screen.getByRole("textbox", { name: "小説本文" })).toBe(editor);
    expect(editor).toHaveTextContent("初期本文");
    expect(editor).not.toHaveTextContent("別の本文");
    expect(window.getSelection()?.anchorNode).toBe(textNode);
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it("preserves undo and redo history when React rerenders", async () => {
    const view = render(<NovelEditor initialText="初期本文" />);
    const editor = await screen.findByRole("textbox", { name: "小説本文" });

    dispatchPaste(editor, { "text/plain": "追記" });
    expect(editor).toHaveTextContent("追記初期本文");

    view.rerender(<NovelEditor initialText="別の本文" />);
    dispatchKey(editor, "z", { ctrlKey: true, keyCode: 90 });

    expect(editor).toHaveTextContent("初期本文");
    expect(editor).not.toHaveTextContent("追記");

    dispatchKey(editor, "z", {
      ctrlKey: true,
      keyCode: 90,
      shiftKey: true,
    });

    expect(editor).toHaveTextContent("追記初期本文");
  });
});
