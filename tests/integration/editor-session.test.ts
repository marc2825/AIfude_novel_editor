import { describe, expect, it, vi } from "vitest";
import { redo, undo, undoDepth } from "@tiptap/pm/history";

import { validateAiEditRequest, type AiEditRequest } from "../../src/domain/ai-edit";
import { AI_MODEL_PREFERENCE_AUTOMATIC } from "../../src/domain/ai-models";
import type {
  AiEditClientResult,
  SendAiEditRequest,
} from "../../src/features/ai-edit/client";
import { createAiEditController } from "../../src/features/ai-edit/controller";
import {
  AI_REPLACEMENT_META_KEY,
  replaceCapturedSelection,
} from "../../src/features/editor/replace-selection";
import { documentToPlainText } from "../../src/features/editor/plain-text";
import {
  captureSelection,
  validateSelectionSnapshot,
  type SelectionCaptureContext,
} from "../../src/features/editor/selection";
import { SaveCoordinator } from "../../src/persistence/save-coordinator";
import { createAiEditSuccessResponseFixture } from "../fixtures/candidates";
import {
  MOCK_AI_RUNTIME,
  LOCAL_AI_RUNTIME,
  OPENAI_AI_RUNTIME,
} from "../fixtures/ai-runtime";
import { createDeferred } from "../helpers/deferred";
import {
  createTestEditor,
  setTextSelection,
} from "../helpers/editor";

const context: SelectionCaptureContext = {
  chapterId: "chapter",
  commonPrompt: "",
  contextRevision: 0,
  documentId: "document",
  editable: true,
  manualStyle: "",
  projectId: "project",
};

describe("editor session identity", () => {
  it("rejects a capture after import-style editor reconstruction", () => {
    const original = createTestEditor("同じ本文", 5);
    setTextSelection(original.editor, 1, 5);
    const capture = captureSelection(original.editor, context);

    if (capture.status !== "captured") {
      throw new Error(`selection was not captured: ${capture.reason}`);
    }

    const restored = createTestEditor("同じ本文", 5);
    setTextSelection(restored.editor, 1, 5);

    expect(
      validateSelectionSnapshot(restored.editor, capture.snapshot, context),
    ).toEqual({
      reason: "editor-instance-changed",
      status: "stale",
    });
    expect(
      replaceCapturedSelection(
        restored.editor,
        capture.snapshot,
        "置換",
        context,
      ),
    ).toEqual({
      reason: "editor-instance-changed",
      status: "stale",
    });
    expect(restored.getPlainText()).toBe("同じ本文");

    original.destroy();
    restored.destroy();
  });

  it("rejects a capture after its editor session is disposed", () => {
    const session = createTestEditor("破棄対象");
    setTextSelection(session.editor, 1, 5);
    const capture = captureSelection(session.editor, context);

    if (capture.status !== "captured") {
      throw new Error(`selection was not captured: ${capture.reason}`);
    }

    session.destroy();
    expect(
      validateSelectionSnapshot(session.editor, capture.snapshot, context),
    ).toEqual({ reason: "editor-destroyed", status: "stale" });
    expect(
      replaceCapturedSelection(
        session.editor,
        capture.snapshot,
        "置換",
        context,
      ),
    ).toEqual({ reason: "editor-destroyed", status: "stale" });
  });

  it("routes only a successful replacement through the normal autosave signal", async () => {
    const applied = createTestEditor("前対象後");
    setTextSelection(applied.editor, 2, 4);
    const appliedCapture = captureSelection(applied.editor, context);

    if (appliedCapture.status !== "captured") {
      throw new Error(`selection was not captured: ${appliedCapture.reason}`);
    }

    const save = vi.fn(async () => undefined);
    const coordinator = new SaveCoordinator({
      onStateChange: () => undefined,
      save,
    });
    applied.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) {
        coordinator.markDirty();
      }
    });

    expect(
      replaceCapturedSelection(
        applied.editor,
        appliedCapture.snapshot,
        "置換",
        context,
      ),
    ).toMatchObject({ status: "applied" });
    expect(coordinator.state).toMatchObject({
      dirtySequence: 1,
      status: "dirty",
    });
    await coordinator.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(coordinator.state).toMatchObject({
      dirtySequence: 1,
      savedSequence: 1,
      status: "saved",
    });
    await coordinator.dispose();
    applied.destroy();

    const unchanged = createTestEditor("前対象後");
    setTextSelection(unchanged.editor, 2, 4);
    const unchangedCapture = captureSelection(unchanged.editor, context);

    if (unchangedCapture.status !== "captured") {
      throw new Error(`selection was not captured: ${unchangedCapture.reason}`);
    }

    const unchangedCoordinator = new SaveCoordinator({
      onStateChange: () => undefined,
      save: vi.fn(async () => undefined),
    });
    unchanged.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) {
        unchangedCoordinator.markDirty();
      }
    });

    expect(
      replaceCapturedSelection(
        unchanged.editor,
        unchangedCapture.snapshot,
        "対象",
        context,
      ),
    ).toEqual({ status: "no-change" });
    expect(
      replaceCapturedSelection(
        unchanged.editor,
        unchangedCapture.snapshot,
        "",
        context,
      ),
    ).toEqual({ reason: "empty", status: "invalid-replacement" });
    expect(unchangedCoordinator.state.dirtySequence).toBe(0);
    await unchangedCoordinator.dispose();
    unchanged.destroy();

    const stale = createTestEditor("前対象後");
    setTextSelection(stale.editor, 2, 4);
    const staleCapture = captureSelection(stale.editor, context);

    if (staleCapture.status !== "captured") {
      throw new Error(`selection was not captured: ${staleCapture.reason}`);
    }

    stale.editor.view.dispatch(stale.editor.state.tr.insertText("追", 1));
    const staleCoordinator = new SaveCoordinator({
      onStateChange: () => undefined,
      save: vi.fn(async () => undefined),
    });
    stale.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) {
        staleCoordinator.markDirty();
      }
    });

    expect(
      replaceCapturedSelection(
        stale.editor,
        staleCapture.snapshot,
        "置換",
        context,
      ),
    ).toEqual({ reason: "document-changed", status: "stale" });
    expect(staleCoordinator.state.dirtySequence).toBe(0);
    await staleCoordinator.dispose();
    stale.destroy();
  });
});

describe("asynchronous AI edit controller", () => {
  it("keeps local generation active past the cloud timeout and previews a validated response", async () => {
    vi.useFakeTimers();
    const editor = createTestEditor("前対象後");
    setTextSelection(editor.editor, 2, 4);
    const captured = captureSelection(editor.editor, context);
    if (captured.status !== "captured") {
      throw new Error("selection was not captured");
    }
    const pending = createDeferred<Response>();
    const fetch = vi.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    const controller = createAiEditController({
      getCaptureContext: () => context,
      getConsent: () => null,
      getEditor: () => editor.editor,
      getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
      getRuntime: () => LOCAL_AI_RUNTIME,
      onStateChange: () => undefined,
    });

    try {
      controller.open(captured.snapshot);
      controller.updateInput({ candidateCount: 2, instruction: "自然に", presetId: null });
      const submission = controller.submit();
      await vi.advanceTimersByTimeAsync(36_000);
      expect(controller.getState().kind).toBe("generating");
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      const body = fetch.mock.calls[0]?.[1]?.body;
      if (typeof body !== "string") {
        throw new Error("request body must be JSON");
      }
      const request: unknown = JSON.parse(body);
      const parsed = validateAiEditRequest(request);
      if (!parsed.success) {
        throw new Error("expected a valid local request");
      }
      const response = createAiEditSuccessResponseFixture(parsed.data);
      pending.resolve(Response.json({
        ...response,
        candidates: response.candidates.map((candidate) => ({ ...candidate, model: "test-local-model", providerId: "local" })),
        provider: { model: "test-local-model", providerId: "local" },
      }));
      await submission;
      expect(controller.getState().kind).toBe("preview");
      expect(editor.getPlainText()).toBe("前対象後");
    } finally {
      controller.dispose();
      editor.destroy();
      vi.useRealTimers();
    }
  });
  it("blocks an external request locally until matching consent is available", async () => {
    const editor = createTestEditor("前対象後");
    setTextSelection(editor.editor, 2, 4);
    const captured = captureSelection(editor.editor, context);

    if (captured.status !== "captured") {
      throw new Error(`selection was not captured: ${captured.reason}`);
    }

    const sendRequest = vi.fn<SendAiEditRequest>();
    const controller = createAiEditController({
      getCaptureContext: () => context,
      getConsent: () => null,
      getEditor: () => editor.editor,
      getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
      getRuntime: () => OPENAI_AI_RUNTIME,
      onStateChange: () => undefined,
      sendRequest,
    });
    controller.open(captured.snapshot);
    controller.updateInput({
      candidateCount: 2,
      instruction: "自然に",
      presetId: null,
    });

    expect(controller.canSubmit()).toBe(false);
    await controller.submit();
    expect(sendRequest).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ kind: "command" });
    expect(editor.getPlainText()).toBe("前対象後");

    controller.dispose();
    editor.destroy();
  });

  it("applies only the selected canonical candidate once and keeps normal history", async () => {
    const editor = createTestEditor("前対象後");
    setTextSelection(editor.editor, 2, 4);
    const captured = captureSelection(editor.editor, context);

    if (captured.status !== "captured") {
      throw new Error(`selection was not captured: ${captured.reason}`);
    }

    const requestId = "10000000-0000-4000-8000-000000000001";
    const sessionId = "30000000-0000-4000-8000-000000000001";
    const identities: unknown[] = [];
    let documentTransactions = 0;
    editor.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) {
        documentTransactions += 1;
        identities.push(transaction.getMeta(AI_REPLACEMENT_META_KEY));
      }
    });
    const controller = createAiEditController({
      createUuid: vi
        .fn<() => string>()
        .mockReturnValueOnce(sessionId)
        .mockReturnValueOnce(requestId),
      getCaptureContext: () => context,
      getConsent: () => null,
      getEditor: () => editor.editor,
      getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
      getRuntime: () => MOCK_AI_RUNTIME,
      onStateChange: () => undefined,
      sendRequest: async (request) => ({
        data: createAiEditSuccessResponseFixture(request),
        status: "success",
      }),
    });
    controller.open(captured.snapshot);
    controller.updateInput({
      candidateCount: 2,
      instruction: "自然に",
      presetId: null,
    });
    await controller.submit();
    const preview = controller.getState();

    if (preview.kind !== "preview") {
      throw new Error("preview was not created");
    }

    const chosen = preview.response.candidates[1];

    if (chosen === undefined) {
      throw new Error("second candidate was not created");
    }

    controller.selectCandidate(chosen.id);
    expect(editor.getPlainText()).toBe("前対象後");
    expect(undoDepth(editor.editor.state)).toBe(0);

    expect(controller.accept()).toMatchObject({ status: "applied" });
    expect(editor.getPlainText()).toBe(`前${chosen.replacementText}後`);
    expect(controller.getState()).toEqual({ kind: "closed" });
    expect(documentTransactions).toBe(1);
    expect(identities).toEqual([
      { candidateId: chosen.id, requestId, sessionId },
    ]);
    expect(undoDepth(editor.editor.state)).toBe(1);

    const acceptedText = editor.getPlainText();
    expect(controller.accept()).toBeNull();
    expect(editor.getPlainText()).toBe(acceptedText);
    expect(documentTransactions).toBe(1);

    editor.editor.view.dispatch(
      editor.editor.state.tr.insertText(
        "追記",
        editor.editor.state.doc.content.size - 1,
      ),
    );
    expect(editor.getPlainText()).toBe(`${acceptedText}追記`);
    expect(undo(editor.editor.state, editor.editor.view.dispatch)).toBe(true);
    expect(editor.getPlainText()).toBe(acceptedText);
    expect(undo(editor.editor.state, editor.editor.view.dispatch)).toBe(true);
    expect(editor.getPlainText()).toBe("前対象後");
    expect(redo(editor.editor.state, editor.editor.view.dispatch)).toBe(true);
    expect(editor.getPlainText()).toBe(acceptedText);
    expect(redo(editor.editor.state, editor.editor.view.dispatch)).toBe(true);
    expect(editor.getPlainText()).toBe(`${acceptedText}追記`);
    controller.dispose();
    editor.destroy();
  });

  it.each([
    ["document edit", "document-changed"],
    ["selection move", "selection-changed"],
    ["context change", "context-changed"],
    ["editor recreation", "editor-instance-changed"],
    ["read-only transition", "editor-read-only"],
  ] as const)(
    "refuses Accept after %s using the final safe replacement guard",
    async (change, expectedReason) => {
      const original = createTestEditor("前対象後");
      let activeEditor = original.editor;
      let activeContext: SelectionCaptureContext = context;
      let replacementEditor: ReturnType<typeof createTestEditor> | null = null;
      setTextSelection(original.editor, 2, 4);
      const captured = captureSelection(original.editor, context);

      if (captured.status !== "captured") {
        throw new Error(`selection was not captured: ${captured.reason}`);
      }

      const controller = createAiEditController({
        createUuid: vi
          .fn<() => string>()
          .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
          .mockReturnValueOnce("10000000-0000-4000-8000-000000000001"),
        getCaptureContext: () => activeContext,
        getConsent: () => null,
        getEditor: () => activeEditor,
        getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
        getRuntime: () => MOCK_AI_RUNTIME,
        onStateChange: () => undefined,
        sendRequest: async (request) => ({
          data: createAiEditSuccessResponseFixture(request),
          status: "success",
        }),
      });
      controller.open(captured.snapshot);
      controller.updateInput({
        candidateCount: 2,
        instruction: "自然に",
        presetId: null,
      });
      await controller.submit();
      expect(controller.getState()).toMatchObject({ kind: "preview" });

      switch (change) {
        case "document edit":
          original.editor.view.dispatch(
            original.editor.state.tr.insertText("追", 1),
          );
          break;
        case "selection move":
          setTextSelection(original.editor, 1, 1);
          break;
        case "context change":
          activeContext = {
            ...context,
            commonPrompt: "変更後",
            contextRevision: 1,
          };
          break;
        case "editor recreation":
          replacementEditor = createTestEditor("前対象後");
          setTextSelection(replacementEditor.editor, 2, 4);
          activeEditor = replacementEditor.editor;
          break;
        case "read-only transition":
          activeContext = { ...context, editable: false };
          original.editor.setEditable(false);
          break;
      }

      const textBeforeAccept = documentToPlainText(activeEditor.state.doc);
      expect(controller.accept()).toEqual({
        reason: expectedReason,
        status: "stale",
      });
      expect(controller.getState()).toMatchObject({
        kind: "stale",
        reason: expectedReason,
      });
      expect(documentToPlainText(activeEditor.state.doc)).toBe(textBeforeAccept);
      expect(textBeforeAccept).not.toContain("【デモ候補");

      controller.dispose();
      replacementEditor?.destroy();
      original.destroy();
    },
  );

  it("discards a cancelled session's late success and error after a new session opens", async () => {
    const editor = createTestEditor("春の風と夏の雨");
    setTextSelection(editor.editor, 1, 5);
    const firstCapture = captureSelection(editor.editor, context);

    if (firstCapture.status !== "captured") {
      throw new Error(`selection was not captured: ${firstCapture.reason}`);
    }

    const firstPending = createDeferred<AiEditClientResult>();
    const secondPending = createDeferred<AiEditClientResult>();
    const sentRequests: Array<{
      request: AiEditRequest;
      signal: AbortSignal;
    }> = [];
    const sendRequest = vi.fn((request, signal: AbortSignal) => {
      sentRequests.push({ request, signal });
      return sentRequests.length === 1
        ? firstPending.promise
        : secondPending.promise;
    });
    const ids = [
      "30000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000002",
    ];
    const controller = createAiEditController({
      createUuid: () => ids.shift() ?? "unexpected-id",
      getCaptureContext: () => context,
      getConsent: () => null,
      getEditor: () => editor.editor,
      getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
      getRuntime: () => MOCK_AI_RUNTIME,
      onStateChange: () => undefined,
      sendRequest,
    });

    expect(controller.open(firstCapture.snapshot)).toBe(true);
    controller.updateInput({
      candidateCount: 2,
      instruction: "自然に",
      presetId: null,
    });
    const firstSubmission = controller.submit();
    expect(sendRequest).toHaveBeenCalledOnce();

    controller.close();
    expect(sentRequests[0]?.signal.aborted).toBe(true);

    setTextSelection(editor.editor, 5, 8);
    const secondCapture = captureSelection(editor.editor, context);

    if (secondCapture.status !== "captured") {
      throw new Error(`selection was not captured: ${secondCapture.reason}`);
    }

    expect(controller.open(secondCapture.snapshot)).toBe(true);
    controller.updateInput({
      candidateCount: 2,
      instruction: "短く",
      presetId: "shorten",
    });
    const secondSubmission = controller.submit();
    expect(sendRequest).toHaveBeenCalledTimes(2);

    const firstRequest = sentRequests[0]?.request;
    const secondRequest = sentRequests[1]?.request;

    if (firstRequest === undefined || secondRequest === undefined) {
      throw new Error("requests were not captured");
    }

    firstPending.resolve({
      data: createAiEditSuccessResponseFixture(firstRequest),
      status: "success",
    });
    await firstSubmission;
    expect(controller.getState()).toMatchObject({
      kind: "generating",
      requestId: secondRequest.requestId,
    });

    secondPending.resolve({
      data: createAiEditSuccessResponseFixture(secondRequest),
      status: "success",
    });
    await secondSubmission;

    const state = controller.getState();
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId);
    expect(state).toMatchObject({
      kind: "preview",
      requestId: secondRequest.requestId,
      response: { requestId: secondRequest.requestId },
    });
    if (state.kind !== "closed") {
      expect(state.snapshot).toBe(secondCapture.snapshot);
    }
    expect(editor.getPlainText()).toBe("春の風と夏の雨");
    controller.dispose();
    editor.destroy();
  });

  it("runs the final guard before request ID creation and refuses rapid duplicate submit", async () => {
    const editor = createTestEditor("前対象後");
    setTextSelection(editor.editor, 2, 4);
    const captured = captureSelection(editor.editor, context);

    if (captured.status !== "captured") {
      throw new Error(`selection was not captured: ${captured.reason}`);
    }

    const createUuid = vi
      .fn<() => string>()
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000001");
    const pending = createDeferred<AiEditClientResult>();
    const sendRequest = vi.fn<SendAiEditRequest>(() => pending.promise);
    const controller = createAiEditController({
      createUuid,
      getCaptureContext: () => context,
      getConsent: () => null,
      getEditor: () => editor.editor,
      getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
      getRuntime: () => MOCK_AI_RUNTIME,
      onStateChange: () => undefined,
      sendRequest,
    });
    controller.open(captured.snapshot);
    controller.updateInput({
      candidateCount: 2,
      instruction: "自然に",
      presetId: null,
    });
    const first = controller.submit();
    const duplicate = controller.submit();

    expect(sendRequest).toHaveBeenCalledOnce();
    expect(createUuid).toHaveBeenCalledTimes(2);
    await duplicate;

    const request = sendRequest.mock.calls[0]?.[0];

    if (request === undefined) {
      throw new Error("request was not captured");
    }

    pending.resolve({
      data: createAiEditSuccessResponseFixture(request),
      status: "success",
    });
    await first;
    expect(controller.getState()).toMatchObject({ kind: "preview" });
    expect(editor.getPlainText()).toBe("前対象後");

    controller.close();
    setTextSelection(editor.editor, 2, 4);
    const staleCapture = captureSelection(editor.editor, context);

    if (staleCapture.status !== "captured") {
      throw new Error(`selection was not captured: ${staleCapture.reason}`);
    }

    controller.open(staleCapture.snapshot);
    controller.updateInput({
      candidateCount: 2,
      instruction: "自然に",
      presetId: null,
    });
    editor.editor.view.dispatch(editor.editor.state.tr.insertText("追", 1));
    const callsBeforeStaleSubmit = createUuid.mock.calls.length;
    await controller.submit();

    expect(controller.getState()).toMatchObject({
      kind: "stale",
      reason: "document-changed",
    });
    expect(sendRequest).toHaveBeenCalledOnce();
    expect(createUuid).toHaveBeenCalledTimes(callsBeforeStaleSubmit);
    controller.dispose();
    editor.destroy();
  });

  it("aborts and rejects a delayed response after document changes during generation", async () => {
    const editor = createTestEditor("前対象後");
    setTextSelection(editor.editor, 2, 4);
    const captured = captureSelection(editor.editor, context);

    if (captured.status !== "captured") {
      throw new Error(`selection was not captured: ${captured.reason}`);
    }

    const pending = createDeferred<AiEditClientResult>();
    const requestObservation: {
      request: AiEditRequest | null;
      signal: AbortSignal | null;
    } = { request: null, signal: null };
    const controller = createAiEditController({
      createUuid: vi
        .fn<() => string>()
        .mockReturnValueOnce("30000000-0000-4000-8000-000000000001")
        .mockReturnValueOnce("10000000-0000-4000-8000-000000000001"),
      getCaptureContext: () => context,
      getConsent: () => null,
      getEditor: () => editor.editor,
      getModelPreference: () => AI_MODEL_PREFERENCE_AUTOMATIC,
      getRuntime: () => MOCK_AI_RUNTIME,
      onStateChange: () => undefined,
      sendRequest: (request, signal) => {
        requestObservation.request = request;
        requestObservation.signal = signal;
        return pending.promise;
      },
    });
    controller.open(captured.snapshot);
    controller.updateInput({
      candidateCount: 2,
      instruction: "自然に",
      presetId: null,
    });
    const submission = controller.submit();

    editor.editor.view.dispatch(editor.editor.state.tr.insertText("追", 1));
    controller.revalidate(editor.editor);

    expect(controller.getState()).toMatchObject({
      kind: "stale",
      reason: "document-changed",
    });
    expect(requestObservation.signal?.aborted).toBe(true);

    if (requestObservation.request === null) {
      throw new Error("request was not captured");
    }

    pending.resolve({
      data: createAiEditSuccessResponseFixture(requestObservation.request),
      status: "success",
    });
    await submission;
    expect(controller.getState()).toMatchObject({ kind: "stale" });
    expect(editor.getPlainText()).toBe("追前対象後");
    controller.dispose();
    editor.destroy();
  });
});
