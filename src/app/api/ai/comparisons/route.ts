import { readAiServerConfig, readComparisonConfigs } from "../../../../server/ai/config";
import { readEffectiveAiEnvironment } from "../../../../server/ai/connection-settings";
import { createConfiguredEditingProvider } from "../../../../server/ai/provider-factory";
import { handleComparisonPost } from "../../../../server/http/comparison-handler";
import { getProviderRateLimiter } from "../../../../server/http/rate-limit";
import { aiSettingsChangedResponse, matchesAiSettingsRevision } from "../../../../server/http/ai-settings-revision";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const effective = await readEffectiveAiEnvironment();
  if (!matchesAiSettingsRevision(request, effective.revision)) return aiSettingsChangedResponse();
  const config = readAiServerConfig(effective.environment);
  const providers = readComparisonConfigs(effective.environment).flatMap((result) => { const provider = createConfiguredEditingProvider(result); return provider ? [provider] : []; });
  const response = await handleComparisonPost(request, { config, providers, rateLimiters: new Map(providers.map((provider) => [provider.providerId, getProviderRateLimiter(provider.providerId)])) });
  return (await readEffectiveAiEnvironment()).revision === effective.revision ? response : aiSettingsChangedResponse();
}
