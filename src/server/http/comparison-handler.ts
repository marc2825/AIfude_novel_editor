import "server-only";
import { aiComparisonRequestSchema, aiComparisonResponseSchema } from "../../domain/ai-comparison";
import { AI_EDIT_LIMITS, AI_EXTERNAL_CONSENT_POLICY_VERSION } from "../../domain/limits";
import type { AiServerConfigResult } from "../ai/config";
import type { EditingProvider } from "../ai/provider";
import { createAiEditService } from "../ai/edit-service";
import { guardAiEditHttpRequest } from "./guard";
import { createAiRateLimiter } from "./rate-limit";
import { isPaidApiProvider } from "../../domain/ai-models";

export type ComparisonDependencies = Readonly<{
  config: AiServerConfigResult;
  providers: readonly EditingProvider[];
  rateLimiters: ReadonlyMap<string, ReturnType<typeof createAiRateLimiter>>;
}>;
export async function handleComparisonPost(request: Request, dependencies: ComparisonDependencies): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (!dependencies.config.success) return json({ error: "AI比較は利用できません。" }, 503);
  const guarded = await guardAiEditHttpRequest(request, dependencies.config.config.appOrigin);
  if (!guarded.success) return json({ error: "リクエストを検証できませんでした。" }, guarded.code === "FORBIDDEN_ORIGIN" ? 403 : 400);
  const parsed = aiComparisonRequestSchema.safeParse(guarded.data.value);
  if (!parsed.success) return json({ error: "比較対象・同意・入力を確認してください。" }, 400);
  const input = parsed.data;
  if (input.request.allowPaidApi !== true && input.targets.some((target) => isPaidApiProvider(target.providerId))) return json({ error: "設定でAPI接続を有効にしてください。" }, 400);
  const targets = input.targets.map((target) => ({
    ...target, provider: dependencies.providers.find((provider) => provider.providerId === target.providerId),
    limiter: dependencies.rateLimiters.get(target.providerId),
  }));
  if (targets.some((target) => !target.provider || !target.limiter)) return json({ error: "比較対象が利用できません。" }, 400);
  const results = await Promise.allSettled(targets.map(async (target) => {
    const provider = target.provider; const rateLimiter = target.limiter;
    if (!provider || !rateLimiter) throw new Error("Unavailable target");
    const childRequest = { ...input.request, modelId: null, connectionId: target.connectionId,
      consent: provider.externalDataTransfer ? { providerId: provider.providerId, policyVersion: AI_EXTERNAL_CONSENT_POLICY_VERSION } : null };
    const result = await createAiEditService({ provider, rateLimiter }).generate(childRequest, request.signal);
    return result.success ? { success: true, providerId: provider.providerId, data: result.data } : { success: false, providerId: provider.providerId, code: result.code };
  }));
  const output = aiComparisonResponseSchema.safeParse({ requestId: input.request.requestId,
    results: results.map((result, index) => result.status === "fulfilled" ? result.value : { success: false, providerId: input.targets[index]?.providerId, code: "PROVIDER_FAILURE" }) });
  if (!output.success || new TextEncoder().encode(JSON.stringify(output.data)).byteLength > AI_EDIT_LIMITS.responseBodyBytes) return json({ error: "比較結果を検証できませんでした。" }, 502);
  return json(output.data);
}
