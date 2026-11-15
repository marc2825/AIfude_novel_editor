import { describe, expect, it } from "vitest";

import { readAiServerConfig } from "../../src/server/ai/config";
import { createConfiguredEditingProvider } from "../../src/server/ai/provider-factory";

const appOrigin = "http://127.0.0.1:3000";

describe("configured editing provider factory", () => {
  it("creates a subscription provider without reading tokens or connecting", () => {
    const config = readAiServerConfig({ AI_PROVIDER: "chatgpt", APP_ORIGIN: appOrigin, CHATGPT_MODEL: "gpt-6.1-sol", CHATGPT_AUTH_DIR: "/tmp/unused-novel-editor-auth" });
    expect(createConfiguredEditingProvider(config)).toMatchObject({ providerId: "chatgpt", defaultModelId: "chatgpt-default", externalDataTransfer: true });
  });
  it("creates a local provider without requiring OpenAI credentials or connecting", () => {
    const config = readAiServerConfig({
      AI_PROVIDER: "local",
      APP_ORIGIN: appOrigin,
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
      LOCAL_LLM_MODEL: "test-local-model",
    });
    expect(createConfiguredEditingProvider(config)).toMatchObject({
      defaultModelId: "local-default",
      externalDataTransfer: false,
      providerId: "local",
    });
  });
  it("keeps disabled mode unavailable", () => {
    const config = readAiServerConfig({ APP_ORIGIN: appOrigin });

    expect(createConfiguredEditingProvider(config)).toBeNull();
  });

  it("keeps the local mock provider available without OpenAI configuration", () => {
    const config = readAiServerConfig({
      AI_PROVIDER: "mock",
      APP_ORIGIN: appOrigin,
    });

    expect(createConfiguredEditingProvider(config)).toMatchObject({
      externalDataTransfer: false,
      providerId: "mock",
    });
  });

  it("creates a lazy external OpenAI provider from canonical server configuration", () => {
    const config = readAiServerConfig({
      AI_PROVIDER: "openai",
      AI_ENABLE_PAID_API: "true",
      APP_ORIGIN: appOrigin,
      OPENAI_API_KEY: "test-api-key",
      OPENAI_MODEL: "gpt-6-astra",
    });

    expect(createConfiguredEditingProvider(config)).toMatchObject({
      defaultModelId: "gpt-6-astra",
      externalDataTransfer: true,
      providerId: "openai",
    });
  });

  it("does not create a provider from invalid OpenAI configuration", () => {
    const config = readAiServerConfig({
      AI_PROVIDER: "openai",
      AI_ENABLE_PAID_API: "true",
      APP_ORIGIN: appOrigin,
      OPENAI_MODEL: "gpt-6-astra",
    });

    expect(createConfiguredEditingProvider(config)).toBeNull();
  });
});
