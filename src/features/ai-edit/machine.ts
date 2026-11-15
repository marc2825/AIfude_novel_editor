import type { AuthoringReferenceSelection } from "../../domain/authoring-profile";
import { DEFAULT_COMPLETION_CHARACTERS, isCompletionOperation } from "../../domain/completion";
import type {
  AiEditErrorCode,
  AiEditPresetId,
  AiEditSuccessResponse,
} from "../../domain/ai-edit";
import type { AiEditCandidateCount } from "../../domain/limits";
import type { AiProviderId } from "../../domain/ai-models";
import type { StoryMemoryField } from "../../domain/story-memory";
import type { AiComparisonResponse } from "../../domain/ai-comparison";
import type {
  SelectionSnapshot,
  SelectionStaleReason,
} from "../editor/selection";

export type AiEditApplyError =
  | "preservation-violation"
  | "editor-composing"
  | "editor-not-ready"
  | "guard-unavailable"
  | "invalid-replacement"
  | "no-change"
  | "unsafe-replacement";

export type AiEditCommandInput = Readonly<{
  authoringReference?: AuthoringReferenceSelection;
  targetCharacters?: number;
  useStoryMemory?: boolean;
  storyMemoryFields?: readonly StoryMemoryField[];
  compareProviderIds?: readonly AiProviderId[];
  compareConsent?: boolean;
  candidateCount: AiEditCandidateCount;
  instruction: string;
  presetId: AiEditPresetId | null;
}>;

export type AiEditOperationError =
  | Readonly<{ kind: "ai-unavailable"; retryable: false }>
  | Readonly<{ kind: "client-timeout"; retryable: true }>
  | Readonly<{ kind: "invalid-input"; retryable: false }>
  | Readonly<{ kind: "invalid-response"; retryable: true }>
  | Readonly<{ kind: "session-unavailable"; retryable: true }>
  | Readonly<{
      code: AiEditErrorCode;
      kind: "server";
      retryable: boolean;
    }>
  | Readonly<{ kind: "transport"; retryable: true }>;

type ActiveState = Readonly<{
  input: AiEditCommandInput;
  sessionId: string;
  snapshot: SelectionSnapshot;
}>;

export type AiEditClosedState = Readonly<{ kind: "closed" }>;
export type AiEditCommandState = ActiveState &
  Readonly<{ kind: "command" }>;
export type AiEditGeneratingState = ActiveState &
  Readonly<{ kind: "generating"; requestId: string }>;
export type AiEditPreviewState = ActiveState &
  Readonly<{
    partialHunkIds?: readonly number[];
    comparisonResults?: AiComparisonResponse["results"];
    activeCandidateId: string;
    applyError: AiEditApplyError | null;
    kind: "preview";
    requestId: string;
    response: AiEditSuccessResponse;
  }>;
export type AiEditErrorState = ActiveState &
  Readonly<{
    comparisonResults?: AiComparisonResponse["results"];
    error: AiEditOperationError;
    kind: "error";
    requestId: string | null;
  }>;
export type AiEditStaleState = ActiveState &
  Readonly<{ kind: "stale"; reason: SelectionStaleReason }>;

export type AiEditActiveState =
  | AiEditCommandState
  | AiEditErrorState
  | AiEditGeneratingState
  | AiEditPreviewState
  | AiEditStaleState;

export type AiEditMachineState = AiEditClosedState | AiEditActiveState;

export const CLOSED_AI_EDIT_STATE: AiEditClosedState = Object.freeze({
  kind: "closed",
});

export const DEFAULT_AI_EDIT_INPUT: AiEditCommandInput = Object.freeze({
  candidateCount: 2,
  instruction: "",
  presetId: null,
});

function activeBase(state: ActiveState) {
  return {
    input: state.input,
    sessionId: state.sessionId,
    snapshot: state.snapshot,
  };
}

export function openAiEditCommand(
  snapshot: SelectionSnapshot,
  sessionId: string,
): AiEditCommandState {
  return Object.freeze({
    input: snapshot.operation === undefined ? DEFAULT_AI_EDIT_INPUT : Object.freeze({ ...DEFAULT_AI_EDIT_INPUT, candidateCount: 1 as const, ...(isCompletionOperation(snapshot.operation) ? { targetCharacters: DEFAULT_COMPLETION_CHARACTERS } : {}) }),
    kind: "command",
    sessionId,
    snapshot,
  });
}

export function updateAiEditCommandInput(
  state: AiEditMachineState,
  input: AiEditCommandInput,
): AiEditMachineState {
  if (state.kind !== "command" && state.kind !== "preview") {
    return state;
  }

  return Object.freeze({
    ...activeBase(state),
    input: Object.freeze({ ...input }),
    kind: "command",
  });
}

export function beginAiEditGeneration(
  state: AiEditMachineState,
  requestId: string,
): AiEditGeneratingState | null {
  if (
    state.kind !== "command" &&
    state.kind !== "preview" &&
    (state.kind !== "error" || !state.error.retryable)
  ) {
    return null;
  }

  return Object.freeze({
    ...activeBase(state),
    kind: "generating",
    requestId,
  });
}

function ownsGeneration(
  state: AiEditMachineState,
  sessionId: string,
  requestId: string,
): state is AiEditGeneratingState {
  return (
    state.kind === "generating" &&
    state.sessionId === sessionId &&
    state.requestId === requestId
  );
}

export function completeAiEditGeneration(
  state: AiEditMachineState,
  sessionId: string,
  requestId: string,
  response: AiEditSuccessResponse,
): AiEditMachineState {
  if (!ownsGeneration(state, sessionId, requestId)) {
    return state;
  }

  const firstCandidate = response.candidates[0];

  if (firstCandidate === undefined) {
    return state;
  }

  return Object.freeze({
    ...activeBase(state),
    activeCandidateId: firstCandidate.id,
    applyError: null,
    kind: "preview",
    requestId,
    response,
  });
}

export function selectAiEditCandidate(
  state: AiEditMachineState,
  candidateId: string,
): AiEditMachineState {
  if (
    state.kind !== "preview" ||
    state.activeCandidateId === candidateId ||
    !previewCandidates(state).some((candidate) => candidate.id === candidateId)
  ) {
    return state;
  }

  return Object.freeze({
    ...state,
    activeCandidateId: candidateId,
    partialHunkIds: undefined,
    applyError: null,
  });
}

export function previewCandidates(state: AiEditPreviewState) {
  return state.comparisonResults === undefined ? state.response.candidates :
    state.comparisonResults.flatMap((result) => result.success ? [...result.data.candidates] : []);
}

export function completeAiComparisonGeneration(state: AiEditMachineState, sessionId: string, requestId: string, response: AiComparisonResponse): AiEditMachineState {
  if (!ownsGeneration(state, sessionId, requestId)) return state;
  const first = response.results.find((result) => result.success);
  if (!first?.success) {
    const failed = failAiEditGeneration(state, sessionId, requestId, { kind: "transport", retryable: true });
    return failed.kind === "error" ? { ...failed, comparisonResults: response.results } : failed;
  }
  const completed = completeAiEditGeneration(state, sessionId, requestId, first.data);
  return completed.kind === "preview" ? { ...completed, comparisonResults: response.results } : completed;
}

export function failAiEditApply(
  state: AiEditMachineState,
  error: AiEditApplyError,
): AiEditMachineState {
  if (state.kind !== "preview") {
    return state;
  }

  return Object.freeze({ ...state, applyError: error });
}

export function failAiEditGeneration(
  state: AiEditMachineState,
  sessionId: string,
  requestId: string | null,
  error: AiEditOperationError,
): AiEditMachineState {
  if (
    requestId !== null &&
    !ownsGeneration(state, sessionId, requestId)
  ) {
    return state;
  }

  if (state.kind === "closed") {
    return state;
  }

  if (
    requestId === null &&
    (state.kind === "generating" || state.sessionId !== sessionId)
  ) {
    return state;
  }

  return Object.freeze({
    ...activeBase(state),
    error,
    kind: "error",
    requestId,
  });
}

export function staleAiEditSession(
  state: AiEditMachineState,
  reason: SelectionStaleReason,
): AiEditMachineState {
  if (state.kind === "closed" || state.kind === "stale") {
    return state;
  }

  return Object.freeze({
    ...activeBase(state),
    kind: "stale",
    reason,
  });
}
