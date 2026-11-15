import { browserIsOffline } from "../offline/connection-state";
import {
  aiEditErrorResponseSchema,
  aiEditSuccessResponseSchema,
  validateLlmCandidateResponse,
  type AiEditRequest,
  type AiEditSuccessResponse,
} from "../../domain/ai-edit";
import type { AiEditOperationError } from "./machine";
import { STORY_MEMORY_FIELDS, storyMemoryCodePoints } from "../../domain/story-memory";

export const AI_EDIT_CLIENT_DEADLINE_MILLISECONDS = 35_000;
export const AI_EDIT_LOCAL_CLIENT_DEADLINE_MILLISECONDS = 185_000;

export type AiEditClientResult =
  | Readonly<{ data: AiEditSuccessResponse; status: "success" }>
  | Readonly<{ error: AiEditOperationError; status: "error" }>
  | Readonly<{ status: "cancelled" }>;

export type SendAiEditRequest = (
  request: AiEditRequest,
  signal: AbortSignal,
) => Promise<AiEditClientResult>;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function invalidResponse(): AiEditClientResult {
  return {
    error: { kind: "invalid-response", retryable: true },
    status: "error",
  };
}

function freezeSuccessResponse(
  response: AiEditSuccessResponse,
): AiEditSuccessResponse {
  return Object.freeze({
    ...response,
    candidates: Object.freeze(
      response.candidates.map((candidate) =>
        Object.freeze({
          ...candidate,
          riskNotes: Object.freeze([...candidate.riskNotes]),
        }),
      ),
    ),
    contextUsage: Object.freeze({
      ...response.contextUsage,
      ...(response.contextUsage.storyMemoryCodePoints === undefined ? {} : { storyMemoryCodePoints: Object.freeze({ ...response.contextUsage.storyMemoryCodePoints }) }),
      omittedFields: Object.freeze([
        ...response.contextUsage.omittedFields,
      ]),
      sentCodePoints: Object.freeze({
        ...response.contextUsage.sentCodePoints,
      }),
    }),
    intent: Object.freeze({
      ...response.intent,
      allowedChanges: Object.freeze([...response.intent.allowedChanges]),
      preserve: Object.freeze([...response.intent.preserve]),
    }),
    provider: Object.freeze({ ...response.provider }),
    usage:
      response.usage === null
        ? null
        : Object.freeze({ ...response.usage }),
  });
}

export function validateAiEditClientSuccess(
  value: unknown,
  request: AiEditRequest,
): AiEditClientResult | null {
  const parsed = aiEditSuccessResponseSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  if (parsed.data.requestId !== request.requestId) {
    return invalidResponse();
  }

  const receivedMemoryCounts = parsed.data.contextUsage.storyMemoryCodePoints;
  if (request.storyMemory === undefined) {
    if (receivedMemoryCounts !== undefined) return invalidResponse();
  } else {
    const expected = storyMemoryCodePoints(request.storyMemory);
    if (!receivedMemoryCounts || STORY_MEMORY_FIELDS.some(({ key }) => receivedMemoryCounts[key] !== expected[key])) return invalidResponse();
  }

  const candidates = validateLlmCandidateResponse(
    {
      candidates: parsed.data.candidates.map((candidate) => ({
        explanation: candidate.explanation,
        replacementText: candidate.replacementText,
        riskNotes: candidate.riskNotes,
      })),
    },
    request.selectionText,
    request.candidateCount,
    request.operation,
  );

  if (!candidates.success) {
    return invalidResponse();
  }

  const responseIsCanonical = candidates.data.candidates.every(
    (candidate, index) => {
      const received = parsed.data.candidates[index];

      return (
        received !== undefined &&
        candidate.replacementText === received.replacementText &&
        candidate.explanation === received.explanation &&
        candidate.riskNotes.length === received.riskNotes.length &&
        candidate.riskNotes.every(
          (note, noteIndex) => note === received.riskNotes[noteIndex],
        )
      );
    },
  );

  if (!responseIsCanonical) {
    return invalidResponse();
  }

  return {
    data: freezeSuccessResponse(parsed.data),
    status: "success",
  };
}

function validateError(
  value: unknown,
  requestId: string,
): AiEditClientResult | null {
  const parsed = aiEditErrorResponseSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  if (
    parsed.data.error.requestId !== null &&
    parsed.data.error.requestId !== requestId
  ) {
    return invalidResponse();
  }

  return {
    error: {
      code: parsed.data.error.code,
      kind: "server",
      retryable: parsed.data.error.retryable,
    },
    status: "error",
  };
}

export async function postAiEditRequest(
  request: AiEditRequest,
  requestSignal: AbortSignal,
  fetchImplementation: FetchImplementation = globalThis.fetch,
  deadlineMilliseconds: number = AI_EDIT_CLIENT_DEADLINE_MILLISECONDS,
  settingsRevision?: string,
): Promise<AiEditClientResult> {
  if (requestSignal.aborted) return { status: "cancelled" };
  if (browserIsOffline()) return { status: "error", error: { kind: "transport", retryable: true } };
  const deadlineController = new AbortController();
  let deadlineExpired = false;
  const deadline = setTimeout(() => {
    deadlineExpired = true;
    deadlineController.abort();
  }, deadlineMilliseconds);
  const signal = AbortSignal.any([
    requestSignal,
    deadlineController.signal,
  ]);
  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("AI edit request aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);

    if (signal.aborted) {
      onAbort();
    }
  });
  const receive = (async () => {
    const response = await fetchImplementation("/api/ai/edits", {
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json", ...(settingsRevision === undefined ? {} : { "x-novel-ai-settings-revision": settingsRevision }) },
      method: "POST",
      signal,
    });

    try {
      return { json: await response.json(), status: "json" } as const;
    } catch {
      return { status: "invalid-json" } as const;
    }
  })();

  try {
    const received = await Promise.race([receive, aborted]);

    if (received.status === "invalid-json") {
      return invalidResponse();
    }

    const success = validateAiEditClientSuccess(received.json, request);

    if (success !== null) {
      return success;
    }

    return validateError(received.json, request.requestId) ?? invalidResponse();
  } catch {
    if (deadlineExpired) {
      return {
        error: { kind: "client-timeout", retryable: true },
        status: "error",
      };
    }

    if (requestSignal.aborted) {
      return { status: "cancelled" };
    }

    return {
      error: { kind: "transport", retryable: true },
      status: "error",
    };
  } finally {
    clearTimeout(deadline);
    removeAbortListener();
  }
}
