export const DIFF_TIMEOUT_MS = 150;

export type DiffPartKind = "delete" | "equal" | "insert";

export type DiffPart = Readonly<{
  kind: DiffPartKind;
  text: string;
}>;

export type DiffWorkerRequest = Readonly<{
  candidateId: string;
  candidateText: string;
  originalText: string;
  requestId: string;
  type: "compute";
}>;

export type DiffWorkerResponse =
  | Readonly<{
      candidateId: string;
      parts: readonly DiffPart[];
      requestId: string;
      type: "result";
    }>
  | Readonly<{
      candidateId: string;
      requestId: string;
      type: "failed";
    }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isDiffPart(value: unknown): value is DiffPart {
  return (
    isRecord(value) &&
    (value.kind === "delete" ||
      value.kind === "equal" ||
      value.kind === "insert") &&
    typeof value.text === "string"
  );
}

export function parseDiffWorkerRequest(
  value: unknown,
): DiffWorkerRequest | null {
  if (
    !isRecord(value) ||
    value.type !== "compute" ||
    typeof value.requestId !== "string" ||
    typeof value.candidateId !== "string" ||
    typeof value.originalText !== "string" ||
    typeof value.candidateText !== "string"
  ) {
    return null;
  }

  return Object.freeze({
    candidateId: value.candidateId,
    candidateText: value.candidateText,
    originalText: value.originalText,
    requestId: value.requestId,
    type: "compute",
  });
}

export function parseDiffWorkerResponse(
  value: unknown,
  requestId: string,
  candidateId: string,
): DiffWorkerResponse | null {
  if (
    !isRecord(value) ||
    value.requestId !== requestId ||
    value.candidateId !== candidateId
  ) {
    return null;
  }

  if (value.type === "failed") {
    return Object.freeze({ candidateId, requestId, type: "failed" });
  }

  if (
    value.type !== "result" ||
    !Array.isArray(value.parts) ||
    !value.parts.every(isDiffPart)
  ) {
    return null;
  }

  return Object.freeze({
    candidateId,
    parts: Object.freeze(
      value.parts.map((part) =>
        Object.freeze({ kind: part.kind, text: part.text }),
      ),
    ),
    requestId,
    type: "result",
  });
}
