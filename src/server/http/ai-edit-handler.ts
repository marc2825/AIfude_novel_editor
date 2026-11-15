import "server-only";

import type { AiServerConfigResult } from "../ai/config";
import { createAiEditService } from "../ai/edit-service";
import type { EditingProvider } from "../ai/provider";
import {
  createAiEditHttpError,
  type AiEditErrorCode,
} from "./errors";
import { guardAiEditHttpRequest } from "./guard";
import type { AiRateLimiter } from "./rate-limit";

export const AI_EDIT_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

export type AiEditHandlerDependencies = Readonly<{
  config: AiServerConfigResult;
  provider: EditingProvider | null;
  rateLimiter: AiRateLimiter;
}>;

function jsonResponse(
  body: unknown,
  status: number,
): Response {
  return Response.json(body, {
    headers: AI_EDIT_RESPONSE_HEADERS,
    status,
  });
}

function errorResponse(
  code: AiEditErrorCode,
  requestId: string | null,
): Response {
  const error = createAiEditHttpError(code, requestId);

  return jsonResponse(error.body, error.status);
}

export async function handleAiEditPost(
  request: Request,
  dependencies: AiEditHandlerDependencies,
): Promise<Response> {
  try {
    if (!dependencies.config.success) {
      return errorResponse("AI_UNAVAILABLE", null);
    }

    const guarded = await guardAiEditHttpRequest(
      request,
      dependencies.config.config.appOrigin,
    );

    if (!guarded.success) {
      return errorResponse(guarded.code, null);
    }

    const configuredProvider =
      dependencies.config.config.provider.mode === "disabled"
        ? null
        : dependencies.provider;
    const service = createAiEditService({
      provider: configuredProvider,
      rateLimiter: dependencies.rateLimiter,
    });
    const result = await service.generate(
      guarded.data.value,
      request.signal,
    );

    if (!result.success) {
      return errorResponse(result.code, result.requestId);
    }

    return jsonResponse(result.data, 200);
  } catch {
    return errorResponse("PROVIDER_FAILURE", null);
  }
}
