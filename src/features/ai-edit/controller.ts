import { composePartialEdit } from "../../domain/partial-edit";
import { authoringReferenceMemory, changedPreservedTerms, hasAuthoringSelection } from "../../domain/authoring-profile";
import type { Editor } from "@tiptap/core";
import { isCompletionOperation } from "../../domain/completion";

import {
  validateAiEditRequest,
  validateAiEditRequestDraft,
  type AiEditRequest,
  type AiEditRequestDraft,
} from "../../domain/ai-edit";
import { AI_EDIT_SCHEMA_VERSION } from "../../domain/limits";
import { isPaidApiProvider } from "../../domain/ai-models";
import { selectStoryMemory } from "../../domain/story-memory";
import { isRequiredPromptWithinBudget } from "./prompt";
import { MAX_COMPARISON_PROVIDERS, type AiComparisonRequest } from "../../domain/ai-comparison";
import { postAiComparisonRequest, type SendAiComparisonRequest } from "./comparison-client";
import type {
  AiConsent,
  AiModelPreference,
} from "../../domain/workspace";
import {
  replaceCapturedSelection,
  type SelectionReplacementResult,
} from "../editor/replace-selection";
import {
  validateSelectionSnapshot,
  type SelectionCaptureContext,
  type SelectionGuardResult,
  type SelectionSnapshot,
} from "../editor/selection";
import {
  AI_EDIT_CLIENT_DEADLINE_MILLISECONDS,
  AI_EDIT_LOCAL_CLIENT_DEADLINE_MILLISECONDS,
  postAiEditRequest,
  type SendAiEditRequest,
} from "./client";
import {
  canUseAiRuntime,
  requestModelIdForRuntime,
  requestConsentForRuntime,
  type PublicAiRuntime,
} from "./consent";
import { extractLocalContext } from "./context";
import {
  beginAiEditGeneration,
  CLOSED_AI_EDIT_STATE,
  completeAiEditGeneration,
  completeAiComparisonGeneration,
  previewCandidates,
  failAiEditApply,
  failAiEditGeneration,
  openAiEditCommand,
  selectAiEditCandidate,
  staleAiEditSession,
  updateAiEditCommandInput,
  type AiEditCommandInput,
  type AiEditCommandState,
  type AiEditErrorState,
  type AiEditMachineState,
  type AiEditOperationError,
  type AiEditPreviewState,
} from "./machine";

export type { PublicAiRuntime } from "./consent";

type ActiveRequest = Readonly<{
  abortController: AbortController;
  requestId: string;
  sessionId: string;
}>;

type AiEditControllerDependencies = Readonly<{
  createUuid?: () => string;
  getCaptureContext: () => SelectionCaptureContext;
  getConsent: () => AiConsent | null;
  getEditor: () => Editor | null;
  getModelPreference: () => AiModelPreference;
  getRuntime: () => PublicAiRuntime;
  onStateChange: (state: AiEditMachineState) => void;
  sendRequest?: SendAiEditRequest;
  sendComparisonRequest?: SendAiComparisonRequest;
}>;

export type AiEditController = Readonly<{
  accept: () => SelectionReplacementResult | null;
  activate: () => void;
  canSubmit: () => boolean;
  close: () => void;
  invalidateContext: () => void;
  dispose: () => void;
  getState: () => AiEditMachineState;
  open: (snapshot: SelectionSnapshot) => boolean;
  revalidate: (editor?: Editor | null) => SelectionGuardResult | null;
  selectCandidate: (candidateId: string) => void;
  selectPartialHunks: (ids: readonly number[] | undefined) => void;
  submit: () => Promise<void>;
  updateInput: (input: AiEditCommandInput) => void;
}>;

export function buildAiEditRequestDraft(
  snapshot: SelectionSnapshot,
  input: AiEditCommandInput,
  consent: AiEditRequest["consent"],
  modelId: AiEditRequest["modelId"],
  connectionId?: string,
  paidApiEnabled?: boolean,
): AiEditRequestDraft {
  const localContext = extractLocalContext({
    afterText: snapshot.afterText,
    beforeText: snapshot.beforeText,
  });
  const storyMemory = authoringReferenceMemory(snapshot.authoringProfile, input.authoringReference, input.useStoryMemory === true
    ? selectStoryMemory(snapshot.storyMemory, input.storyMemoryFields)
    : undefined);

  return {
    ...(storyMemory === undefined ? {} : { storyMemory }),
    ...(paidApiEnabled === true ? { allowPaidApi: true } : {}),
    ...(snapshot.operation === undefined ? {} : { operation: snapshot.operation }),
    ...(isCompletionOperation(snapshot.operation) ? { targetCharacters: input.targetCharacters } : {}),
    ...(connectionId === undefined ? {} : { connectionId }),
    afterText: snapshot.operation === "insert" ? "" : localContext.afterText,
    beforeText: snapshot.operation === "insert" ? "" : localContext.beforeText,
    candidateCount: input.candidateCount,
    consent,
    globalContext: {
      commonPrompt: snapshot.operation === "insert" ? "" : snapshot.commonPrompt,
      manualStyle: snapshot.operation === "insert" ? "" : snapshot.manualStyle,
    },
    instruction: input.instruction,
    modelId,
    presetId: input.presetId,
    schemaVersion: AI_EDIT_SCHEMA_VERSION,
    selectionText: snapshot.originalText,
  };
}

function mayGenerate(
  state: AiEditMachineState,
): state is AiEditCommandState | AiEditErrorState | AiEditPreviewState {
  return (
    state.kind === "command" ||
    state.kind === "preview" ||
    (state.kind === "error" && state.error.retryable)
  );
}

export function createAiEditController(
  dependencies: AiEditControllerDependencies,
): AiEditController {
  const createUuid = dependencies.createUuid ?? (() => crypto.randomUUID());
  const sendRequest: SendAiEditRequest = dependencies.sendRequest ??
    ((request, signal) => postAiEditRequest(
      request,
      signal,
      globalThis.fetch,
      ["local", "chatgpt", "claude"].includes(dependencies.getRuntime().providerId ?? "")
        ? AI_EDIT_LOCAL_CLIENT_DEADLINE_MILLISECONDS
        : AI_EDIT_CLIENT_DEADLINE_MILLISECONDS,
      dependencies.getRuntime().settingsRevision,
    ));
  let activeRequest: ActiveRequest | null = null;
  let applying = false;
  let disposed = false;
  let state: AiEditMachineState = CLOSED_AI_EDIT_STATE;

  function comparisonTargets(runtime: PublicAiRuntime, input: AiEditCommandInput): AiComparisonRequest["targets"] | null {
    const ids = input.compareProviderIds ?? [];
    if (ids.length < 2 || ids.length > MAX_COMPARISON_PROVIDERS || new Set(ids).size !== ids.length || input.compareConsent !== true) return null;
    const providers = ids.map((id) => runtime.comparisonProviders?.find((provider) => provider.providerId === id));
    if (providers.some((provider) => !provider?.available || (isPaidApiProvider(provider.providerId) && runtime.paidApiEnabled !== true) || resolveRuntimeComparisonModel(provider) === null || (provider.providerId === "chatgpt" && !provider.connectionId))) return null;
    return ids.map((providerId, index) => ({ providerId, ...(providers[index]?.connectionId ? { connectionId: providers[index]?.connectionId } : {}) }));
  }
  function resolveRuntimeComparisonModel(runtime: PublicAiRuntime) {
    return runtime.models.find((model) => model.id === runtime.defaultModelId && model.providerId === runtime.providerId) ?? null;
  }

  function emit(next: AiEditMachineState): void {
    state = next;

    if (!disposed) {
      dependencies.onStateChange(next);
    }
  }

  function invalidateActiveRequest(): void {
    const request = activeRequest;
    activeRequest = null;
    request?.abortController.abort();
  }

  function owns(request: ActiveRequest): boolean {
    return (
      !disposed &&
      activeRequest === request &&
      state.kind === "generating" &&
      state.sessionId === request.sessionId &&
      state.requestId === request.requestId
    );
  }

  function markStale(reason: Parameters<typeof staleAiEditSession>[1]): void {
    invalidateActiveRequest();
    emit(staleAiEditSession(state, reason));
  }

  function failBeforeRequest(error: AiEditOperationError): void {
    if (state.kind === "closed") {
      return;
    }

    emit(failAiEditGeneration(state, state.sessionId, null, error));
  }

  function currentDraft(): AiEditRequestDraft | null {
    if (!mayGenerate(state)) {
      return null;
    }
    if (state.input.authoringReference && !hasAuthoringSelection(state.snapshot.authoringProfile, state.input.authoringReference)) return null;
    if (state.input.useStoryMemory === true && selectStoryMemory(state.snapshot.storyMemory, state.input.storyMemoryFields) === undefined) return null;

    const runtime = dependencies.getRuntime();
    const consent = dependencies.getConsent();
    const modelPreference = dependencies.getModelPreference();
    const comparing = (state.input.compareProviderIds?.length ?? 0) > 0;
    const modelId = comparing ? null : requestModelIdForRuntime(runtime, modelPreference);

    if (
      modelId === undefined ||
      (comparing ? comparisonTargets(runtime, state.input) === null : !canUseAiRuntime(runtime, consent, modelPreference))
    ) {
      return null;
    }

    const validation = validateAiEditRequestDraft(
      buildAiEditRequestDraft(
        state.snapshot,
        state.input,
        requestConsentForRuntime(runtime, consent),
        modelId,
        runtime.connectionId,
        runtime.paidApiEnabled,
      ),
    );

    return validation.success && isRequiredPromptWithinBudget(validation.data) ? validation.data : null;
  }

  async function submit(): Promise<void> {
    if (disposed || !mayGenerate(state) || activeRequest !== null) {
      return;
    }

    const startingState = state;
    if (startingState.input.authoringReference && !hasAuthoringSelection(startingState.snapshot.authoringProfile, startingState.input.authoringReference)) {
      failBeforeRequest({ kind: "invalid-input", retryable: false });
      return;
    }
    if (startingState.input.useStoryMemory === true && selectStoryMemory(startingState.snapshot.storyMemory, startingState.input.storyMemoryFields) === undefined) {
      failBeforeRequest({ kind: "invalid-input", retryable: false });
      return;
    }
    const guard = validateSelectionSnapshot(
      dependencies.getEditor(),
      startingState.snapshot,
      dependencies.getCaptureContext(),
    );

    if (guard.status === "stale") {
      markStale(guard.reason);
      return;
    }

    if (guard.status === "unavailable") {
      failBeforeRequest({ kind: "session-unavailable", retryable: true });
      return;
    }

    const runtime = dependencies.getRuntime();

    const comparing = (startingState.input.compareProviderIds?.length ?? 0) > 0;
    const targets = comparing ? comparisonTargets(runtime, startingState.input) : null;
    if (!runtime.available && !comparing) {
      failBeforeRequest({ kind: "ai-unavailable", retryable: false });
      return;
    }

    const consent = dependencies.getConsent();
    const modelPreference = dependencies.getModelPreference();
    const modelId = comparing ? null : requestModelIdForRuntime(runtime, modelPreference);

    if (
      modelId === undefined ||
      (comparing ? targets === null : !canUseAiRuntime(runtime, consent, modelPreference))
    ) {
      return;
    }

    const draftValidation = validateAiEditRequestDraft(
      buildAiEditRequestDraft(
        startingState.snapshot,
        startingState.input,
        requestConsentForRuntime(runtime, consent),
        modelId,
        runtime.connectionId,
        runtime.paidApiEnabled,
      ),
    );

    if (!draftValidation.success || !isRequiredPromptWithinBudget(draftValidation.data)) {
      failBeforeRequest({ kind: "invalid-input", retryable: false });
      return;
    }

    const requestId = createUuid();
    const requestValidation = validateAiEditRequest({
      ...draftValidation.data,
      requestId,
    });

    if (!requestValidation.success) {
      failBeforeRequest({ kind: "invalid-input", retryable: false });
      return;
    }

    const generating = beginAiEditGeneration(startingState, requestId);

    if (generating === null) {
      return;
    }

    const request: AiEditRequest = requestValidation.data;
    const active: ActiveRequest = Object.freeze({
      abortController: new AbortController(),
      requestId,
      sessionId: startingState.sessionId,
    });
    activeRequest = active;
    emit(generating);

    let result;

    try {
      result = targets === null ? await sendRequest(request, active.abortController.signal) :
        await (dependencies.sendComparisonRequest ?? ((request, signal) => postAiComparisonRequest(request, signal, dependencies.getRuntime().settingsRevision)))({ request, targets, consent: true }, active.abortController.signal);
    } catch {
      result = {
        error: { kind: "transport", retryable: true },
        status: "error",
      } as const;
    }

    if (!owns(active)) {
      return;
    }

    const finalGuard = validateSelectionSnapshot(
      dependencies.getEditor(),
      startingState.snapshot,
      dependencies.getCaptureContext(),
    );

    if (finalGuard.status === "stale") {
      markStale(finalGuard.reason);
      return;
    }

    if (finalGuard.status === "unavailable") {
      activeRequest = null;
      emit(
        failAiEditGeneration(
          state,
          active.sessionId,
          active.requestId,
          { kind: "session-unavailable", retryable: true },
        ),
      );
      return;
    }

    activeRequest = null;

    if (result.status === "comparison-success") {
      emit(completeAiComparisonGeneration(state, active.sessionId, active.requestId, result.data));
      return;
    }

    if (result.status === "success") {
      emit(
        completeAiEditGeneration(
          state,
          active.sessionId,
          active.requestId,
          result.data,
        ),
      );
      return;
    }

    if (result.status === "error") {
      emit(
        failAiEditGeneration(
          state,
          active.sessionId,
          active.requestId,
          result.error,
        ),
      );
      return;
    }

    emit(
      failAiEditGeneration(
        state,
        active.sessionId,
        active.requestId,
        { kind: "transport", retryable: true },
      ),
    );
  }

  return Object.freeze({
    selectPartialHunks(ids: readonly number[] | undefined) {
      if (disposed || applying || state.kind !== "preview") return;
      emit(Object.freeze({ ...state, partialHunkIds: ids === undefined ? undefined : Object.freeze([...ids]), applyError: null }));
    },
    accept(): SelectionReplacementResult | null {
      if (disposed || applying || state.kind !== "preview") {
        return null;
      }

      const preview = state;
      const candidate = previewCandidates(preview).find(
        (item) =>
          item.id === preview.activeCandidateId &&
          item.requestId === preview.requestId,
      );

      if (candidate === undefined) {
        return null;
      }

      const replacementText = preview.partialHunkIds === undefined ? candidate.replacementText
        : composePartialEdit(preview.snapshot.originalText, candidate.replacementText, preview.partialHunkIds);
      if (replacementText === null) { emit(failAiEditApply(state, "unsafe-replacement")); return { status: "unsafe-replacement" }; }
      if (changedPreservedTerms(preview.snapshot.originalText, replacementText, preview.snapshot.authoringProfile).length) {
        emit(failAiEditApply(state, "preservation-violation")); return { status: "unsafe-replacement" };
      }
      applying = true;

      try {
        const result = replaceCapturedSelection(
          dependencies.getEditor(),
          preview.snapshot,
          replacementText,
          dependencies.getCaptureContext(),
          {
            candidateId: candidate.id,
            requestId: preview.requestId,
            sessionId: preview.sessionId,
          },
        );

        switch (result.status) {
          case "applied":
            emit(CLOSED_AI_EDIT_STATE);
            break;
          case "stale":
            markStale(result.reason);
            break;
          case "unavailable":
            emit(failAiEditApply(state, result.reason));
            break;
          case "invalid-replacement":
            emit(failAiEditApply(state, "invalid-replacement"));
            break;
          case "no-change":
            emit(failAiEditApply(state, "no-change"));
            break;
          case "unsafe-replacement":
            emit(failAiEditApply(state, "unsafe-replacement"));
            break;
        }

        return result;
      } finally {
        applying = false;
      }
    },
    activate() {
      disposed = false;
    },
    canSubmit() {
      return (
        !disposed &&
        activeRequest === null &&
        currentDraft() !== null
      );
    },
    close() {
      if (disposed) {
        return;
      }

      invalidateActiveRequest();
      emit(CLOSED_AI_EDIT_STATE);
    },
    dispose() {
      invalidateActiveRequest();
      state = CLOSED_AI_EDIT_STATE;
      disposed = true;
    },
    getState() {
      return state;
    },
    invalidateContext() {
      if (state.kind !== "closed" && state.kind !== "stale") markStale("context-changed");
    },
    open(snapshot: SelectionSnapshot) {
      if (disposed || state.kind !== "closed") {
        return false;
      }

      emit(openAiEditCommand(snapshot, createUuid()));
      return true;
    },
    revalidate(editor = dependencies.getEditor()) {
      if (
        disposed ||
        applying ||
        state.kind === "closed" ||
        state.kind === "stale"
      ) {
        return null;
      }

      const result = validateSelectionSnapshot(
        editor,
        state.snapshot,
        dependencies.getCaptureContext(),
      );

      if (result.status === "stale") {
        markStale(result.reason);
      }

      return result;
    },
    selectCandidate(candidateId: string) {
      if (disposed) {
        return;
      }

      emit(selectAiEditCandidate(state, candidateId));
    },
    submit,
    updateInput(input: AiEditCommandInput) {
      if (disposed) {
        return;
      }

      emit(updateAiEditCommandInput(state, input));
    },
  });
}
