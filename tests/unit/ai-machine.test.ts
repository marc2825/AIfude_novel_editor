import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_EDIT_CLIENT_DEADLINE_MILLISECONDS,
  postAiEditRequest,
} from "../../src/features/ai-edit/client";
import {
  beginAiEditGeneration,
  completeAiEditGeneration,
  failAiEditGeneration,
  openAiEditCommand,
  selectAiEditCandidate,
  staleAiEditSession,
  updateAiEditCommandInput,
} from "../../src/features/ai-edit/machine";
import {
  captureSelection,
  type SelectionCaptureContext,
  type SelectionSnapshot,
} from "../../src/features/editor/selection";
import {
  createAiEditRequestFixture,
  createAiEditSuccessResponseFixture,
} from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";
import { createTestEditor, setTextSelection } from "../helpers/editor";

const SESSION_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_REQUEST_ID = "10000000-0000-4000-8000-000000000002";
const context: SelectionCaptureContext = {
  chapterId: "chapter",
  commonPrompt: "設定を増やさない",
  contextRevision: 0,
  documentId: "document",
  editable: true,
  manualStyle: "静かな文体",
  projectId: "project",
};

function createSnapshot(): Readonly<{
  destroy: () => void;
  snapshot: SelectionSnapshot;
}> {
  const editor = createTestEditor("前対象後");
  setTextSelection(editor.editor, 2, 4);
  const captured = captureSelection(editor.editor, context);

  if (captured.status !== "captured") {
    editor.destroy();
    throw new Error(`selection was not captured: ${captured.reason}`);
  }

  return { destroy: editor.destroy, snapshot: captured.snapshot };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AI edit state machine", () => {
  it("keeps one immutable snapshot through command, generating, and preview", () => {
    const captured = createSnapshot();
    const command = updateAiEditCommandInput(
      openAiEditCommand(captured.snapshot, SESSION_ID),
      { candidateCount: 2, instruction: "自然に", presetId: "polish" },
    );
    const generating = beginAiEditGeneration(command, REQUEST_ID);

    expect(generating).not.toBeNull();
    expect(beginAiEditGeneration(generating!, OTHER_REQUEST_ID)).toBeNull();

    const request = createAiEditRequestFixture({ requestId: REQUEST_ID });
    const response = createAiEditSuccessResponseFixture(request);
    const ignored = completeAiEditGeneration(
      generating!,
      SESSION_ID,
      OTHER_REQUEST_ID,
      response,
    );
    const preview = completeAiEditGeneration(
      ignored,
      SESSION_ID,
      REQUEST_ID,
      response,
    );

    expect(ignored).toBe(generating);
    expect(preview).toMatchObject({
      activeCandidateId: response.candidates[0]?.id,
      applyError: null,
      kind: "preview",
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
    });
    if (preview.kind !== "closed") {
      expect(preview.snapshot).toBe(captured.snapshot);
    }

    const secondCandidateId = response.candidates[1]?.id;

    if (preview.kind !== "preview" || secondCandidateId === undefined) {
      throw new Error("preview candidate was not created");
    }

    const selected = selectAiEditCandidate(preview, secondCandidateId);
    expect(selected).toMatchObject({
      activeCandidateId: secondCandidateId,
      kind: "preview",
      response,
    });
    expect(selectAiEditCandidate(selected, "unknown-candidate")).toBe(selected);

    const edited = updateAiEditCommandInput(selected, {
      candidateCount: 3,
      instruction: "短く",
      presetId: "shorten",
    });
    expect(edited).toMatchObject({ kind: "command" });
    expect(edited).not.toHaveProperty("response");
    captured.destroy();
  });

  it("rejects late success and error after a session becomes stale", () => {
    const captured = createSnapshot();
    const command = updateAiEditCommandInput(
      openAiEditCommand(captured.snapshot, SESSION_ID),
      { candidateCount: 2, instruction: "自然に", presetId: null },
    );
    const generating = beginAiEditGeneration(command, REQUEST_ID);

    if (generating === null) {
      throw new Error("generation did not start");
    }

    const stale = staleAiEditSession(generating, "document-changed");
    const response = createAiEditSuccessResponseFixture(
      createAiEditRequestFixture({ requestId: REQUEST_ID }),
    );

    expect(
      completeAiEditGeneration(stale, SESSION_ID, REQUEST_ID, response),
    ).toBe(stale);
    expect(
      failAiEditGeneration(stale, SESSION_ID, REQUEST_ID, {
        kind: "transport",
        retryable: true,
      }),
    ).toBe(stale);
    captured.destroy();
  });

  it("permits a retryable error to start only with a new request ID", () => {
    const captured = createSnapshot();
    const command = updateAiEditCommandInput(
      openAiEditCommand(captured.snapshot, SESSION_ID),
      { candidateCount: 2, instruction: "自然に", presetId: null },
    );
    const first = beginAiEditGeneration(command, REQUEST_ID);

    if (first === null) {
      throw new Error("generation did not start");
    }

    const error = failAiEditGeneration(first, SESSION_ID, REQUEST_ID, {
      kind: "transport",
      retryable: true,
    });
    const retry = beginAiEditGeneration(error, OTHER_REQUEST_ID);

    expect(retry).toMatchObject({
      kind: "generating",
      requestId: OTHER_REQUEST_ID,
    });
    captured.destroy();
  });

  it("does not let an old session's success or error alter a newer session", () => {
    const firstCapture = createSnapshot();
    const secondCapture = createSnapshot();
    const first = beginAiEditGeneration(
      updateAiEditCommandInput(
        openAiEditCommand(firstCapture.snapshot, SESSION_ID),
        { candidateCount: 2, instruction: "自然に", presetId: null },
      ),
      REQUEST_ID,
    );
    const secondSessionId = "30000000-0000-4000-8000-000000000002";
    const second = beginAiEditGeneration(
      updateAiEditCommandInput(
        openAiEditCommand(secondCapture.snapshot, secondSessionId),
        { candidateCount: 2, instruction: "短く", presetId: "shorten" },
      ),
      OTHER_REQUEST_ID,
    );

    if (first === null || second === null) {
      throw new Error("generation did not start");
    }

    const response = createAiEditSuccessResponseFixture(
      createAiEditRequestFixture({ requestId: REQUEST_ID }),
    );
    expect(
      completeAiEditGeneration(second, SESSION_ID, REQUEST_ID, response),
    ).toBe(second);
    expect(
      failAiEditGeneration(second, SESSION_ID, REQUEST_ID, {
        kind: "transport",
        retryable: true,
      }),
    ).toBe(second);
    firstCapture.destroy();
    secondCapture.destroy();
  });
});

describe("AI edit HTTP client", () => {
  it("posts canonical JSON and validates the correlated business response", async () => {
    const request = createAiEditRequestFixture();
    const response = createAiEditSuccessResponseFixture(request);
    const fetchImplementation = vi.fn(async () => Response.json(response));

    const result = await postAiEditRequest(
      request,
      new AbortController().signal,
      fetchImplementation,
    );

    expect(result.status).toBe("success");
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/ai/edits",
      expect.objectContaining({
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  });

  it.each([
    ["malformed JSON", async () => new Response("<html>failure</html>")],
    [
      "mismatched request ID",
      async () => {
        const request = createAiEditRequestFixture();
        return Response.json({
          ...createAiEditSuccessResponseFixture(request),
          requestId: OTHER_REQUEST_ID,
        });
      },
    ],
    [
      "duplicate candidate",
      async () => {
        const request = createAiEditRequestFixture();
        const response = createAiEditSuccessResponseFixture(request);
        return Response.json({
          ...response,
          candidates: response.candidates.map((candidate, index) => ({
            ...candidate,
            replacementText: response.candidates[0]?.replacementText,
            index,
          })),
        });
      },
    ],
    [
      "wrong candidate count",
      async () => {
        const request = createAiEditRequestFixture();
        const response = createAiEditSuccessResponseFixture(request);
        return Response.json({
          ...response,
          candidates: response.candidates.slice(0, 1),
        });
      },
    ],
    [
      "blank candidate",
      async () => {
        const request = createAiEditRequestFixture();
        const response = createAiEditSuccessResponseFixture(request);
        return Response.json({
          ...response,
          candidates: response.candidates.map((candidate, index) =>
            index === 0 ? { ...candidate, replacementText: "　 " } : candidate,
          ),
        });
      },
    ],
    [
      "wrong error shape",
      async () => Response.json({ error: { code: "PROVIDER_FAILURE" } }),
    ],
  ])("rejects %s without creating candidate state", async (_name, createResponse) => {
    const request = createAiEditRequestFixture();
    const result = await postAiEditRequest(
      request,
      new AbortController().signal,
      createResponse,
    );

    expect(result).toEqual({
      error: { kind: "invalid-response", retryable: true },
      status: "error",
    });
  });

  it.each([
    ["AI_UNAVAILABLE", false],
    ["RATE_LIMITED", true],
    ["PROVIDER_TIMEOUT", true],
    ["PROVIDER_FAILURE", true],
    ["INVALID_OUTPUT", true],
    ["CONSENT_REQUIRED", false],
  ] as const)("preserves canonical %s error semantics", async (code, retryable) => {
    const request = createAiEditRequestFixture();
    const result = await postAiEditRequest(
      request,
      new AbortController().signal,
      async () =>
        Response.json({
          error: {
            code,
            message: "safe but not used as UI copy",
            requestId: request.requestId,
            retryable,
          },
        }),
    );

    expect(result).toEqual({
      error: { code, kind: "server", retryable },
      status: "error",
    });
  });

  it("maps a fetch rejection to a local transport error", async () => {
    const result = await postAiEditRequest(
      createAiEditRequestFixture(),
      new AbortController().signal,
      async () => {
        throw new TypeError("network details must not escape");
      },
    );

    expect(result).toEqual({
      error: { kind: "transport", retryable: true },
      status: "error",
    });
  });

  it("returns the documented client timeout even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    const pending = createDeferred<Response>();
    const resultPromise = postAiEditRequest(
      createAiEditRequestFixture(),
      new AbortController().signal,
      () => pending.promise,
    );

    await vi.advanceTimersByTimeAsync(AI_EDIT_CLIENT_DEADLINE_MILLISECONDS);

    await expect(resultPromise).resolves.toEqual({
      error: { kind: "client-timeout", retryable: true },
      status: "error",
    });
    pending.resolve(new Response());
  });

  it("treats caller cancellation as expected even when fetch ignores abort", async () => {
    const pending = createDeferred<Response>();
    const abortController = new AbortController();
    const resultPromise = postAiEditRequest(
      createAiEditRequestFixture(),
      abortController.signal,
      () => pending.promise,
    );

    abortController.abort();

    await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
    pending.resolve(new Response());
  });
});
