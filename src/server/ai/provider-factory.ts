import "server-only";

import type { AiServerConfigResult } from "./config";
import { createMockEditingProvider } from "./mock-provider";
import { createLocalEditingProvider } from "./local-provider";
import { createOpenAiEditingProvider } from "./openai-provider";
import type { EditingProvider } from "./provider";
import { createChatGptEditingProvider } from "./chatgpt/provider";
import { getChatGptAuth } from "./chatgpt/runtime";
import { createClaudeCliEditingProvider } from "./claude-cli-provider";
import { createCloudApiEditingProvider } from "./cloud-api-provider";

export function createConfiguredEditingProvider(
  configResult: AiServerConfigResult,
): EditingProvider | null {
  if (!configResult.success) {
    return null;
  }

  const provider = configResult.config.provider;

  switch (provider.mode) {
    case "disabled":
      return null;
    case "mock":
      return createMockEditingProvider();
    case "local":
      return createLocalEditingProvider(provider);
    case "chatgpt":
      return createChatGptEditingProvider(provider, getChatGptAuth(provider.authDirectory));
    case "claude":
      return createClaudeCliEditingProvider(provider);
    case "anthropic":
    case "gemini":
    case "xai":
    case "deepseek":
      return createCloudApiEditingProvider(provider);
    case "openai":
      return createOpenAiEditingProvider({
        apiKey: provider.apiKey,
        defaultModelId: provider.defaultModelId,
      });
  }
}
