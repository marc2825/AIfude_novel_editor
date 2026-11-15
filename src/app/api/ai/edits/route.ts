import { readAiServerConfig } from "../../../../server/ai/config";
import { readEffectiveAiEnvironment } from "../../../../server/ai/connection-settings";
import { createConfiguredEditingProvider } from "../../../../server/ai/provider-factory";
import { handleAiEditPost } from "../../../../server/http/ai-edit-handler";
import { createAiRateLimiter, getProviderRateLimiter } from "../../../../server/http/rate-limit";
import { aiSettingsChangedResponse, matchesAiSettingsRevision } from "../../../../server/http/ai-settings-revision";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const effective = await readEffectiveAiEnvironment();
  if (!matchesAiSettingsRevision(request, effective.revision)) return aiSettingsChangedResponse();
  const config = readAiServerConfig(effective.environment); const provider = createConfiguredEditingProvider(config);
  const response = await handleAiEditPost(request, { config, provider, rateLimiter: provider ? getProviderRateLimiter(provider.providerId) : createAiRateLimiter() });
  return (await readEffectiveAiEnvironment()).revision === effective.revision ? response : aiSettingsChangedResponse();
}
