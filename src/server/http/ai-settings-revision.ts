import "server-only";
import { createAiEditHttpError } from "./errors";
export function aiSettingsChangedResponse(): Response {
  const error = createAiEditHttpError("AI_UNAVAILABLE", null);
  return Response.json(error.body, { status: error.status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function matchesAiSettingsRevision(request: Request, revision: string): boolean {
  return revision !== "invalid" && (request.headers.get("x-novel-ai-settings-revision") ?? "environment") === revision;
}
