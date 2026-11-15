import { undoDepth } from "@tiptap/pm/history";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiEditSuccessResponseSchema,
  type AiEditSuccessResponse,
} from "../../src/domain/ai-edit";
import { CandidatePreview } from "../../src/features/ai-edit/CandidatePreview";
import { DiffPreview } from "../../src/features/ai-edit/DiffPreview";
import { createGraphemeDiff } from "../../src/features/ai-edit/diff/diff";
import { parseDiffWorkerRequest } from "../../src/features/ai-edit/diff/protocol";
import {
  beginAiEditGeneration,
  completeAiEditGeneration,
  openAiEditCommand,
  selectAiEditCandidate,
  type AiEditPreviewState,
} from "../../src/features/ai-edit/machine";
import {
  captureSelection,
  type SelectionCaptureContext,
} from "../../src/features/editor/selection";
import { getEditGuardState } from "../../src/features/editor/plugins/edit-guard";
import {
  createAiEditRequestFixture,
  createAiEditSuccessResponseFixture,
} from "../fixtures/candidates";
import { createTestEditor, setTextSelection } from "../helpers/editor";
import { FakeDiffWorker } from "../helpers/diff-worker";

const SESSION_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const context: SelectionCaptureContext = {
  chapterId: "chapter",
  commonPrompt: "",
  contextRevision: 0,
  documentId: "document",
  editable: true,
  manualStyle: "",
  projectId: "project",
};

afterEach(() => {
  FakeDiffWorker.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function installFakeWorker(): void {
  FakeDiffWorker.reset();
  vi.stubGlobal("Worker", FakeDiffWorker);
}

function completeDiff(worker: FakeDiffWorker): void {
  const request = parseDiffWorkerRequest(worker.messages[0]);

  if (request === null) {
    throw new Error("diff worker did not receive a valid request");
  }

  act(() => {
    worker.emitMessage({
      candidateId: request.candidateId,
      parts: createGraphemeDiff(request.originalText, request.candidateText),
      requestId: request.requestId,
      type: "result",
    });
  });
}

function createPreview(candidateCount: 2 | 3) {
  const session = createTestEditor("前対象となる長めの本文後");
  setTextSelection(session.editor, 2, 12);
  const capture = captureSelection(session.editor, context);

  if (capture.status !== "captured") {
    session.destroy();
    throw new Error(`selection was not captured: ${capture.reason}`);
  }

  const generating = beginAiEditGeneration(
    openAiEditCommand(capture.snapshot, SESSION_ID),
    REQUEST_ID,
  );

  if (generating === null) {
    session.destroy();
    throw new Error("generation did not start");
  }

  const request = createAiEditRequestFixture({
    candidateCount,
    requestId: REQUEST_ID,
  });
  const response = createAiEditSuccessResponseFixture(request);
  const replacements = [
    '日本語🙂\n\n　<script>alert("x")</script>  ',
    "# Markdown heading\n</div>\\quoted",
    "三番目の候補　\n末尾 ",
  ];
  const customized: AiEditSuccessResponse = {
    ...response,
    candidates: response.candidates.map((candidate, index) => ({
      ...candidate,
      explanation: `説明 ${index + 1}`,
      replacementText: replacements[index] ?? candidate.replacementText,
      riskNotes: index === 0 ? ["意味は完全に保持されています"] : [],
    })),
  };
  const preview = completeAiEditGeneration(
    generating,
    SESSION_ID,
    REQUEST_ID,
    aiEditSuccessResponseSchema.parse(customized),
  );

  if (preview.kind !== "preview") {
    session.destroy();
    throw new Error("preview was not created");
  }

  return { preview, session };
}

it.each([false, true])("copies only on request and preserves the manuscript even if clipboard fails: %s", async (fails) => {
  const { preview, session } = createPreview(2); const writeText = vi.fn();
  if (fails) writeText.mockRejectedValue(new Error("clipboard denied")); else writeText.mockResolvedValue(undefined);
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    render(<CandidatePreview state={preview} onAccept={() => { throw new Error("must not accept"); }} onReject={() => undefined} onRetry={() => undefined} onSelectCandidate={() => undefined} />);
    expect(writeText).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "候補をコピー" }));
    await screen.findByText(fails ? /コピーできませんでした/u : /選んだ候補をコピーしました/u);
    expect(writeText).toHaveBeenCalledWith(preview.response.candidates[0].replacementText);
    expect(session.getPlainText()).toBe("前対象となる長めの本文後"); expect(undoDepth(session.editor.state)).toBe(0);
  } finally { if (previous) Object.defineProperty(navigator, "clipboard", previous); else Reflect.deleteProperty(navigator, "clipboard"); session.destroy(); }
});

function PreviewHarness({
  initialState,
  onAccept = () => undefined,
  onReject = () => undefined,
  onRetry = () => undefined,
  onSelect = () => undefined,
}: Readonly<{
  initialState: AiEditPreviewState;
  onAccept?: () => void;
  onReject?: () => void;
  onRetry?: () => void;
  onSelect?: (candidateId: string) => void;
}>) {
  const [state, setState] = useState(initialState);

  return (
    <CandidatePreview
      onAccept={onAccept}
      onReject={onReject}
      onRetry={onRetry}
      onSelectCandidate={(candidateId) => {
        onSelect(candidateId);
        const next = selectAiEditCandidate(state, candidateId);

        if (next.kind === "preview") {
          setState(next);
        }
      }}
      state={state}
    />
  );
}

describe("candidate preview", () => {
  it.each([2, 3] as const)(
    "renders %i validated candidates in server order as literal text",
    (candidateCount) => {
      const { preview, session } = createPreview(candidateCount);
      const view = render(<PreviewHarness initialState={preview} />);
      const tabs = screen.getAllByRole("tab");

      expect(tabs).toHaveLength(candidateCount);
      expect(tabs.map((tab) => tab.textContent)).toEqual(
        Array.from({ length: candidateCount }, (_, index) =>
          `候補 ${index + 1}`,
        ),
      );
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText(`候補 1 / ${candidateCount}`)).toBeInTheDocument();
      expect(
        screen.getByText("ローカルデモ候補（外部送信なし）"),
      ).toBeInTheDocument();

      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByLabelText("候補本文").textContent).toBe(
        '日本語🙂\n\n　<script>alert("x")</script>  ',
      );
      expect(within(panel).getByText("説明 1")).toBeInTheDocument();
      expect(
        within(panel).getByText("意味は完全に保持されています"),
      ).toBeInTheDocument();
      expect(view.container.querySelector("script")).toBeNull();
      expect(view.container.querySelector("img")).toBeNull();
      expect(view.container.querySelector("h1")).toBeNull();

      session.destroy();
    },
  );

  it("shows the canonical actual model returned by the server", () => {
    const { preview, session } = createPreview(2);
    const openAiPreview: AiEditPreviewState = {
      ...preview,
      response: {
        ...preview.response,
        candidates: preview.response.candidates.map((candidate) => ({
          ...candidate,
          model: "gpt-5.6-luna",
          providerId: "openai",
        })),
        provider: { model: "gpt-5.6-luna", providerId: "openai" },
      },
    };

    render(<PreviewHarness initialState={openAiPreview} />);

    expect(
      screen.getByText("GPT-5.6 Luna / gpt-5.6-luna（openai）"),
    ).toBeInTheDocument();
    session.destroy();
  });

  it("switches candidates with canonical IDs and documented tab keys", async () => {
    const { preview, session } = createPreview(3);
    const onSelect = vi.fn();
    render(<PreviewHarness initialState={preview} onSelect={onSelect} />);
    const tabs = screen.getAllByRole("tab");

    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    await waitFor(() => expect(tabs[1]).toHaveFocus());
    expect(screen.getByText("候補 2 / 3")).toBeInTheDocument();
    expect(
      within(screen.getByRole("tabpanel")).getByLabelText("候補本文")
        .textContent,
    ).toBe(
      "# Markdown heading\n</div>\\quoted",
    );

    fireEvent.keyDown(tabs[1]!, { key: "End" });
    await waitFor(() => expect(tabs[2]).toHaveFocus());
    expect(screen.getByText("候補 3 / 3")).toBeInTheDocument();

    fireEvent.keyDown(tabs[2]!, { key: "Home" });
    await waitFor(() => expect(tabs[0]).toHaveFocus());
    expect(onSelect.mock.calls.map(([candidateId]) => candidateId)).toEqual([
      preview.response.candidates[1]?.id,
      preview.response.candidates[2]?.id,
      preview.response.candidates[0]?.id,
    ]);
    session.destroy();
  });

  it("exposes explicit Accept, Reject, and Retry controls", () => {
    const { preview, session } = createPreview(2);
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onRetry = vi.fn();
    render(
      <PreviewHarness
        initialState={preview}
        onAccept={onAccept}
        onReject={onReject}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "採用" }));
    fireEvent.click(screen.getByRole("button", { name: "却下" }));
    fireEvent.click(screen.getByRole("button", { name: "再生成" }));

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
    session.destroy();
  });

  it("renders escaped grapheme diff parts with textual and semantic meaning", () => {
    installFakeWorker();
    const { preview, session } = createPreview(2);
    const view = render(<PreviewHarness initialState={preview} />);

    expect(FakeDiffWorker.instances).toHaveLength(1);
    completeDiff(FakeDiffWorker.instances[0]!);

    const region = screen.getByRole("region", {
      name: "候補 1 の原文との差分",
    });
    const diffParts = within(region).getByTestId("candidate-diff-parts");
    const deletedText = Array.from(diffParts.querySelectorAll("del"))
      .map((element) => element.textContent)
      .join("");
    const insertedText = Array.from(diffParts.querySelectorAll("ins"))
      .map((element) => element.textContent)
      .join("");

    expect(deletedText.length).toBeGreaterThan(0);
    expect(insertedText).toContain('\n\n　<script>alert("x")</script>  ');
    expect(within(region).getByText(/原文から削る箇所/u)).toBeInTheDocument();
    expect(within(region).getByText(/候補で加える箇所/u)).toBeInTheDocument();
    expect(region.querySelector("script")).toBeNull();
    expect(region.querySelector("h1")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();

    session.destroy();
  });

  it("calculates only the active candidate and switches without editor or network effects", () => {
    installFakeWorker();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { preview, session } = createPreview(3);
    const editor = session.editor;
    const documentBefore = editor.state.doc;
    const selectionBefore = editor.state.selection;
    const guardBefore = getEditGuardState(editor.state);
    const historyBefore = undoDepth(editor.state);
    const onSelect = vi.fn();
    render(<PreviewHarness initialState={preview} onSelect={onSelect} />);

    expect(FakeDiffWorker.instances).toHaveLength(1);
    const firstWorker = FakeDiffWorker.instances[0]!;
    const firstRequest = parseDiffWorkerRequest(firstWorker.messages[0]);
    expect(firstRequest).toMatchObject({
      candidateId: preview.response.candidates[0]?.id,
      candidateText: preview.response.candidates[0]?.replacementText,
      originalText: preview.snapshot.originalText,
      requestId: preview.requestId,
    });
    completeDiff(firstWorker);
    expect(
      screen.getByRole("region", { name: "候補 1 の原文との差分" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "候補 2" }));

    expect(firstWorker.terminated).toBe(true);
    expect(FakeDiffWorker.instances).toHaveLength(2);
    const secondWorker = FakeDiffWorker.instances[1]!;
    const secondRequest = parseDiffWorkerRequest(secondWorker.messages[0]);
    expect(secondRequest).toMatchObject({
      candidateId: preview.response.candidates[1]?.id,
      candidateText: preview.response.candidates[1]?.replacementText,
      originalText: preview.snapshot.originalText,
      requestId: preview.requestId,
    });

    act(() => {
      firstWorker.emitMessage({
        candidateId: firstRequest?.candidateId,
        parts: [{ kind: "insert", text: "遅延した旧候補" }],
        requestId: firstRequest?.requestId,
        type: "result",
      });
    });
    expect(screen.queryByText("遅延した旧候補")).not.toBeInTheDocument();

    completeDiff(secondWorker);
    const secondRegion = screen.getByRole("region", {
      name: "候補 2 の原文との差分",
    });
    expect(
      within(secondRegion)
        .getByTestId("candidate-diff-parts")
        .querySelector("ins")?.textContent,
    ).toBe(preview.response.candidates[1]?.replacementText);
    expect(editor.state.doc).toBe(documentBefore);
    expect(editor.state.selection.eq(selectionBefore)).toBe(true);
    expect(getEditGuardState(editor.state)).toEqual(guardBefore);
    expect(undoDepth(editor.state)).toBe(historyBefore);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();

    session.destroy();
  });

  it("terminates at 150ms, shows exact side-by-side text, and ignores a late result", () => {
    vi.useFakeTimers();
    installFakeWorker();
    const candidateText = "\n候補🙂\n\n末尾  ";
    const originalText = "　原文\n";
    render(
      <DiffPreview
        candidateId="candidate"
        candidatePosition={1}
        candidateText={candidateText}
        originalText={originalText}
        requestId="request"
      />,
    );
    const worker = FakeDiffWorker.instances[0]!;

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.getByText("差分を計算しています。")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(worker.terminated).toBe(true);
    expect(
      screen.getByText(
        "差分計算が150ms以内に完了しなかったため、原文と候補を並べて表示します。",
      ),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("region", { name: "比較する原文" })
        .querySelector("p")?.textContent,
    ).toBe(originalText);
    expect(
      screen
        .getByRole("region", { name: "比較する候補" })
        .querySelector("p")?.textContent,
    ).toBe(candidateText);

    act(() => {
      worker.emitMessage({
        candidateId: "candidate",
        parts: [{ kind: "insert", text: "期限後の結果" }],
        requestId: "request",
        type: "result",
      });
    });
    expect(screen.queryByText("期限後の結果")).not.toBeInTheDocument();
  });
});
