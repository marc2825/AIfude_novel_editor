import type { PublicConnectionState } from "../../src/domain/ai-connections";
export function createPublicConnectionStateFixture(): PublicConnectionState {
  return { revision: null, paidApiAllowed: false, availableModes: ["mock", "local", "chatgpt"],
    apiKeysConfigured: { openai: false, anthropic: false, gemini: false, xai: false, deepseek: false },
    settings: { primary: "mock", comparison: [], models: { chatgpt: "test-chatgpt", claude: "claude-test", local: "fixture", openai: "gpt-5.6-luna", anthropic: "claude-test", gemini: "gemini-test", xai: "grok-test", deepseek: "deepseek-test" }, localBaseUrl: "http://127.0.0.1:1234/v1" },
  };
}
