import "server-only";

import { AI_EDIT_LIMITS } from "../../domain/limits";
import type { LoopbackAppOrigin } from "../ai/config";
import type { AiEditErrorCode } from "./errors";

export type AiEditHttpGuardSuccess = Readonly<{
  byteLength: number;
  value: unknown;
}>;

export type AiEditHttpGuardResult =
  | Readonly<{
      data: AiEditHttpGuardSuccess;
      success: true;
    }>
  | Readonly<{
      code: AiEditErrorCode;
      success: false;
    }>;

function rejected(code: AiEditErrorCode): AiEditHttpGuardResult {
  return { code, success: false };
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const parts = value.split(";").map((part) => part.trim());
  const mediaType = parts[0]?.toLowerCase();

  if (mediaType !== "application/json" || parts.length > 2) {
    return false;
  }

  if (parts.length === 1) {
    return true;
  }

  return /^charset\s*=\s*utf-8$/iu.test(parts[1] ?? "");
}

function declaredBodyIsTooLarge(
  contentLength: string | null,
  maximumBytes: number,
): boolean {
  if (contentLength === null || !/^\d+$/u.test(contentLength)) {
    return false;
  }

  try {
    return BigInt(contentLength) > BigInt(maximumBytes);
  } catch {
    return false;
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The request has already been rejected. A stream cancellation failure is
    // intentionally not exposed to the client.
  }
}

async function readBoundedBody(
  request: Request,
): Promise<
  | Readonly<{ bytes: Uint8Array; success: true }>
  | Readonly<{
      code: "BODY_TOO_LARGE" | "INVALID_REQUEST";
      success: false;
    }>
> {
  if (request.body === null) {
    return { code: "INVALID_REQUEST", success: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      byteLength += chunk.value.byteLength;

      if (byteLength > AI_EDIT_LIMITS.requestBodyBytes) {
        await cancelReader(reader);
        return { code: "BODY_TOO_LARGE", success: false };
      }

      chunks.push(chunk.value);
    }
  } catch {
    return { code: "INVALID_REQUEST", success: false };
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0) {
    return { code: "INVALID_REQUEST", success: false };
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes, success: true };
}

export async function guardAiEditHttpRequest(
  request: Request,
  appOrigin: LoopbackAppOrigin,
): Promise<AiEditHttpGuardResult> {
  if (
    request.headers.get("origin") !== appOrigin.origin ||
    request.headers.get("host") !== appOrigin.host ||
    (request.headers.has("sec-fetch-site") &&
      request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    return rejected("FORBIDDEN_ORIGIN");
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return rejected("UNSUPPORTED_MEDIA_TYPE");
  }

  if (
    declaredBodyIsTooLarge(
      request.headers.get("content-length"),
      AI_EDIT_LIMITS.requestBodyBytes,
    )
  ) {
    return rejected("BODY_TOO_LARGE");
  }

  const body = await readBoundedBody(request);

  if (!body.success) {
    return rejected(body.code);
  }

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
  } catch {
    return rejected("INVALID_REQUEST");
  }

  let value: unknown;

  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return rejected("INVALID_REQUEST");
  }

  return {
    data: Object.freeze({
      byteLength: body.bytes.byteLength,
      value,
    }),
    success: true,
  };
}
