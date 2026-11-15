import { readAiServerConfig, readComparisonConfigs } from "../../../../server/ai/config";
import { readEffectiveAiEnvironment } from "../../../../server/ai/connection-settings";
import { getChatGptAuth } from "../../../../server/ai/chatgpt/runtime";
import { handleChatGptConnection } from "../../../../server/http/chatgpt-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const { environment } = await readEffectiveAiEnvironment();
  const primary = readAiServerConfig(environment);
  const config = primary.success && primary.config.provider.mode === "chatgpt" ? primary :
    readComparisonConfigs(environment).find((result) => result.success && result.config.provider.mode === "chatgpt") ?? primary;
  const auth = config.success && config.config.provider.mode === "chatgpt"
    ? getChatGptAuth(config.config.provider.authDirectory) : null;
  return handleChatGptConnection(request, config, auth);
}
export const GET = handle;
export const POST = handle;
