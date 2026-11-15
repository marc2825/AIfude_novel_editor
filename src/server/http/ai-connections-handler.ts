import "server-only";
import { connectionActionSchema, type PublicConnectionState } from "../../domain/ai-connections";
import { isPaidApiProvider } from "../../domain/ai-models";
import { parseLoopbackAppOrigin } from "../ai/config";
import { applyConnectionSettings, publicConnectionState, validateActiveConnections, AiSettingsConflictError, type AiEnvironment, type AiSettingsStore } from "../ai/connection-settings";
import { configForDiagnostic, diagnoseConnection, type DiagnosticDependencies } from "../ai/connection-diagnostics";
import { guardAiEditHttpRequest } from "./guard";
import { getProviderRateLimiter } from "./rate-limit";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function handleAiConnections(request: Request, dependencies: Readonly<{ environment: AiEnvironment; store: AiSettingsStore; diagnostic?: DiagnosticDependencies }>): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { headers, status });
  const origin = parseLoopbackAppOrigin(dependencies.environment.APP_ORIGIN);
  if (!origin || request.headers.get("host") !== origin.host || (request.headers.has("origin") && request.headers.get("origin") !== origin.origin) ||
      (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return json({ error: "この送信元からAI設定を利用できません。" }, 403);
  try {
    const record = await dependencies.store.read();
    const publicState = (): PublicConnectionState => publicConnectionState(dependencies.environment, record);
    if (request.method === "GET") return json(publicState());
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const guarded = await guardAiEditHttpRequest(request, origin);
    if (!guarded.success) return json({ error: "AI設定リクエストを検証できませんでした。" }, guarded.code === "FORBIDDEN_ORIGIN" ? 403 : 400);
    const parsed = connectionActionSchema.safeParse(guarded.data.value);
    if (!parsed.success) return json({ error: "AI設定の入力内容を確認してください。" }, 400);
    const input = parsed.data;
    if (input.expectedRevision !== (record?.revision ?? null)) return json({ error: "別の画面でAI設定が変更されました。AI設定を再読み込みしてください。" }, 409);
    if (input.action === "diagnose") {
      if (isPaidApiProvider(input.mode) && (!publicState().paidApiAllowed || !input.allowPaidApi)) return json({ requestId: input.requestId, revision: input.expectedRevision, mode: input.mode, status: "api-disabled" });
      const effective = record ? applyConnectionSettings(dependencies.environment, record.settings) : dependencies.environment;
      const config = configForDiagnostic(effective, input.mode);
      const limiter = input.mode === "disabled" ? null : getProviderRateLimiter(input.mode).acquire(input.mode === "mock" ? "mock" : "external");
      if (limiter && !limiter.success) return json({ requestId: input.requestId, revision: input.expectedRevision, mode: input.mode, status: "rate-limited" });
      try {
        const status = await diagnoseConnection(config, request.signal, input.allowPaidApi, dependencies.diagnostic);
        const latest = await dependencies.store.read();
        if ((latest?.revision ?? null) !== input.expectedRevision) return json({ error: "診断中に接続設定が変更されました。再診断してください。" }, 409);
        return json({ requestId: input.requestId, revision: input.expectedRevision, mode: input.mode, status });
      } finally { if (limiter?.success) limiter.permit.release(); }
    }
    if (input.action === "save") validateActiveConnections(dependencies.environment, input.settings);
    const saved = await dependencies.store.update(input.expectedRevision, input.action === "save" ? input.settings : null);
    return json(publicConnectionState(dependencies.environment, saved));
  } catch (error: unknown) {
    return json({ error: error instanceof AiSettingsConflictError ? "別の画面でAI設定が変更されました。再読み込みしてください。" : "AI設定を保存・確認できませんでした。接続先のモデル、サーバーの認証設定と保存先を確認してください。" }, error instanceof AiSettingsConflictError ? 409 : 503);
  }
}
