import "server-only";
import { dictionaryGenerationRequest, dictionaryRequestSchema } from "../../domain/dictionary";
import { createAiEditService } from "../ai/edit-service";
import { AI_EDIT_RESPONSE_HEADERS, type AiEditHandlerDependencies } from "./ai-edit-handler";
import { createAiEditHttpError, type AiEditErrorCode } from "./errors";
import { guardAiEditHttpRequest } from "./guard";

function errorResponse(code: AiEditErrorCode, requestId: string | null): Response {
  const error = createAiEditHttpError(code, requestId);
  return Response.json(error.body, { status: error.status, headers: AI_EDIT_RESPONSE_HEADERS });
}

export async function handleDictionaryPost(request: Request, dependencies: AiEditHandlerDependencies): Promise<Response> {
  try {
    if (!dependencies.config.success) return errorResponse("AI_UNAVAILABLE", null);
    const guarded = await guardAiEditHttpRequest(request, dependencies.config.config.appOrigin);
    if (!guarded.success) return errorResponse(guarded.code, null);
    const parsed = dictionaryRequestSchema.safeParse(guarded.data.value);
    if (!parsed.success) return errorResponse("INVALID_REQUEST", null);
    const service = createAiEditService({
      provider: dependencies.config.config.provider.mode === "disabled" ? null : dependencies.provider,
      rateLimiter: dependencies.rateLimiter,
    });
    const result = await service.generate(dictionaryGenerationRequest(parsed.data), request.signal);
    return result.success
      ? Response.json(result.data, { headers: AI_EDIT_RESPONSE_HEADERS })
      : errorResponse(result.code, result.requestId);
  } catch {
    return errorResponse("PROVIDER_FAILURE", null);
  }
}
