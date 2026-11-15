import { describe, expect, it } from "vitest";

import {
  isSupportedOpenAiModel,
  parseLoopbackAppOrigin,
  parseLocalLlmBaseUrl,
  readAiServerConfig,
  readComparisonConfigs,
} from "../../src/server/ai/config";

describe("AI server configuration", () => {
  it.each([undefined, "false", "1"])("keeps API connections OFF without an explicit true server setting: %s", (setting) => {
    for (const mode of ["openai", "anthropic", "gemini", "xai", "deepseek"]) {
      expect(readAiServerConfig({ APP_ORIGIN: "http://127.0.0.1:3000", AI_PROVIDER: mode, AI_ENABLE_PAID_API: setting })).toEqual({ success: false, reason: "paid-api-disabled" });
    }
  });
  it("configures Claude with a dedicated directory and rejects model aliases", () => {
    const env = { APP_ORIGIN: "http://127.0.0.1:3000", AI_PROVIDER: "claude", CLAUDE_MODEL: "claude-sonnet-5", CLAUDE_AUTH_DIR: "/tmp/novel-claude-auth" };
    expect(readAiServerConfig(env)).toMatchObject({ success: true, config: { provider: { mode: "claude", model: "claude-sonnet-5", executable: "claude", paidApiAllowed: false } } });
    expect(readAiServerConfig({ ...env, AI_ENABLE_PAID_API: "true" })).toMatchObject({ success: true, config: { provider: { mode: "claude", paidApiAllowed: true } } });
    for (const addition of [{ CLAUDE_MODEL: "sonnet" }, { CLAUDE_AUTH_DIR: process.cwd() }, { CLAUDE_CLI_PATH: "./claude" }]) expect(readAiServerConfig({ ...env, ...addition })).toEqual({ success: false, reason: "invalid-claude-config" });
  });
  it.each(["anthropic", "gemini", "xai", "deepseek"])("validates %s API credentials only with explicit opt-in", (mode) => {
    const prefix = mode === "anthropic" ? "ANTHROPIC" : mode.toUpperCase();
    const env = { APP_ORIGIN: "http://127.0.0.1:3000", AI_PROVIDER: mode, AI_ENABLE_PAID_API: "true", [`${prefix}_API_KEY`]: "server-secret", [`${prefix}_MODEL`]: "configured-model" };
    expect(readAiServerConfig(env)).toMatchObject({ success: true, config: { provider: { mode, model: "configured-model" } } });
    expect(readAiServerConfig({ ...env, [`${prefix}_API_KEY`]: "" })).toEqual({ success: false, reason: "invalid-api-config" });
  });
  it("retains subscriptions when API targets are OFF and fails closed for invalid active comparison settings", () => {
    const env = { APP_ORIGIN: "http://127.0.0.1:3000", AI_COMPARE_PROVIDERS: "chatgpt,claude,gemini", CHATGPT_MODEL: "gpt-6.1-sol", CLAUDE_MODEL: "claude-sonnet-5" };
    expect(readComparisonConfigs(env).map((result) => result.success ? result.config.provider.mode : null)).toEqual(["chatgpt", "claude"]);
    expect(readComparisonConfigs({ ...env, AI_ENABLE_PAID_API: "true" })).toEqual([]);
    expect(readComparisonConfigs({ ...env, AI_COMPARE_PROVIDERS: "chatgpt,chatgpt" })).toEqual([]);
  });
  it("accepts ChatGPT subscription configuration without API credentials", () => {
    expect(readAiServerConfig({ AI_PROVIDER: "chatgpt", APP_ORIGIN: "http://127.0.0.1:3000", CHATGPT_MODEL: "gpt-6.1-sol" }))
      .toMatchObject({ success: true, config: { provider: { mode: "chatgpt", model: "gpt-6.1-sol" } } });
  });
  it.each([undefined, "", " model", "model\n", "x".repeat(129)])("rejects an invalid subscription model without fallback", (model) => {
    expect(readAiServerConfig({ AI_PROVIDER: "chatgpt", APP_ORIGIN: "http://127.0.0.1:3000", CHATGPT_MODEL: model }))
      .toEqual({ success: false, reason: "invalid-chatgpt-config" });
  });
  it("rejects a relative credential directory", () => {
    expect(readAiServerConfig({ AI_PROVIDER: "chatgpt", APP_ORIGIN: "http://127.0.0.1:3000", CHATGPT_MODEL: "gpt-6.1-sol", CHATGPT_AUTH_DIR: "./credentials" }))
      .toEqual({ success: false, reason: "invalid-chatgpt-config" });
  });
  it("keeps credentials outside the repository", () => {
    expect(readAiServerConfig({ AI_PROVIDER: "chatgpt", APP_ORIGIN: "http://127.0.0.1:3000", CHATGPT_MODEL: "gpt-6.1-sol", CHATGPT_AUTH_DIR: process.cwd() }))
      .toEqual({ success: false, reason: "invalid-chatgpt-config" });
  });
  it.each([
    "http://127.0.0.1:1234/v1",
    "http://localhost:11434/v1/",
    "http://[::1]:1234/v1",
  ])("accepts a local OpenAI-compatible endpoint: %s", (baseUrl) => {
    expect(parseLocalLlmBaseUrl(baseUrl)).toBe(baseUrl.replace(/\/$/u, ""));
    expect(readAiServerConfig({
      AI_PROVIDER: "local",
      APP_ORIGIN: "http://127.0.0.1:3000",
      LOCAL_LLM_BASE_URL: baseUrl,
      LOCAL_LLM_MODEL: "local/model:tag",
    })).toMatchObject({
      config: { provider: { apiKey: null, mode: "local", model: "local/model:tag" } },
      success: true,
    });
  });

  it.each([
    undefined, "", "https://example.com/v1", "http://192.168.1.2:1234/v1",
    "http://0.0.0.0:1234/v1", "http://user@127.0.0.1:1234/v1",
    "http://127.0.0.1:1234/v1?key=secret", "http://127.0.0.1:1234/v1#x",
    "http://127.0.0.1:1234/", " http://127.0.0.1:1234/v1",
    "http://2130706433:1234/v1", "http://127.0.0.1:1234/v1/../v1",
  ])("rejects unsafe or incomplete local endpoints: %s", (baseUrl) => {
    expect(parseLocalLlmBaseUrl(baseUrl)).toBeNull();
  });

  it.each([undefined, "", " model", "model\n", "model\u0000", "x".repeat(257)])(
    "fails closed for an invalid local model: %s", (model) => {
      expect(readAiServerConfig({
        AI_PROVIDER: "local",
        APP_ORIGIN: "http://127.0.0.1:3000",
        LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
        LOCAL_LLM_MODEL: model,
      })).toEqual({ reason: "invalid-local-config", success: false });
    },
  );

  it("validates an optional local authentication key without cloud fallback", () => {
    const environment = {
      AI_PROVIDER: "local",
      APP_ORIGIN: "http://127.0.0.1:3000",
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
      LOCAL_LLM_MODEL: "local-model",
      OPENAI_API_KEY: "unused-cloud-key",
      OPENAI_MODEL: "gpt-6-astra",
    };
    expect(readAiServerConfig({ ...environment, LOCAL_LLM_API_KEY: "local-token" }))
      .toMatchObject({ config: { provider: { apiKey: "local-token", mode: "local" } }, success: true });
    expect(readAiServerConfig({ ...environment, LOCAL_LLM_API_KEY: "bad token" }))
      .toEqual({ reason: "invalid-local-config", success: false });
    expect(readAiServerConfig({ ...environment, LOCAL_LLM_BASE_URL: "https://example.com/v1" }))
      .toEqual({ reason: "invalid-local-config", success: false });
  });
  it.each([
    ["http://127.0.0.1:3000", "127.0.0.1:3000"],
    ["http://localhost:3000", "localhost:3000"],
    ["http://[::1]:3000", "[::1]:3000"],
    ["https://127.0.0.1", "127.0.0.1"],
    ["http://127.0.0.1:3000/", "127.0.0.1:3000"],
  ] as const)("accepts the loopback origin %s", (origin, host) => {
    expect(parseLoopbackAppOrigin(origin)).toEqual({ host, origin: origin.replace(/\/$/u, "") });
  });

  it.each([
    undefined,
    "",
    " http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
    "http://127.0.0.2:3000",
    "http://192.168.1.2:3000",
    "https://example.com",
    "ftp://127.0.0.1:3000",
    "http://user@127.0.0.1:3000",
    "http://127.0.0.1:3000/path",
    "http://127.0.0.1:3000/?mode=mock",
    "http://127.0.0.1:3000/#fragment",
  ])("rejects a non-origin or non-loopback APP_ORIGIN: %s", (origin) => {
    expect(parseLoopbackAppOrigin(origin)).toBeNull();
  });

  it("defaults an unset provider to disabled without requiring a secret", () => {
    expect(
      readAiServerConfig({ APP_ORIGIN: "http://127.0.0.1:3000" }),
    ).toEqual({
      config: {
        appOrigin: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
        provider: { mode: "disabled" },
      },
      success: true,
    });
  });

  it("accepts only the explicit local mock mode in addition to disabled", () => {
    const result = readAiServerConfig({
      AI_PROVIDER: "mock",
      APP_ORIGIN: "http://localhost:4100",
    });

    expect(result).toEqual({
      config: {
        appOrigin: {
          host: "localhost:4100",
          origin: "http://localhost:4100",
        },
        provider: { mode: "mock" },
      },
      success: true,
    });
  });

  it("accepts a complete OpenAI configuration without exposing it publicly", () => {
    expect(
      readAiServerConfig({
        AI_PROVIDER: "openai",
        AI_ENABLE_PAID_API: "true",
        APP_ORIGIN: "http://127.0.0.1:3000",
        OPENAI_API_KEY: "test-api-key",
        OPENAI_MODEL: "gpt-5.6-terra",
      }),
    ).toEqual({
      config: {
        appOrigin: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
        provider: {
          apiKey: "test-api-key",
          defaultModelId: "gpt-5.6-terra",
          mode: "openai",
        },
      },
      success: true,
    });
  });

  it.each([
    {},
    { OPENAI_API_KEY: "" },
    { OPENAI_API_KEY: " key-with-whitespace" },
    { OPENAI_API_KEY: "test-api-key", OPENAI_MODEL: "" },
    { OPENAI_API_KEY: "test-api-key", OPENAI_MODEL: "not a model" },
    { OPENAI_API_KEY: "test-api-key", OPENAI_MODEL: "gpt-4o-mini" },
    { OPENAI_API_KEY: "test-api-key", OPENAI_MODEL: "x".repeat(129) },
  ])("fails closed for incomplete or malformed OpenAI configuration", (addition) => {
    expect(
      readAiServerConfig({
        AI_PROVIDER: "openai",
        AI_ENABLE_PAID_API: "true",
        APP_ORIGIN: "http://127.0.0.1:3000",
        ...addition,
      }),
    ).toEqual({ reason: "invalid-openai-config", success: false });
  });

  it.each(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
    "accepts a currently supported configured model ID: %s",
    (model) => {
      expect(isSupportedOpenAiModel(model)).toBe(true);
    },
  );

  it("fails closed for an unsupported provider without exposing its value", () => {
    expect(
      readAiServerConfig({
        AI_PROVIDER: "openai-with-secret-in-name",
        APP_ORIGIN: "http://127.0.0.1:3000",
      }),
    ).toEqual({ reason: "unsupported-provider", success: false });
  });

  it("returns a safe failure when APP_ORIGIN is missing or invalid", () => {
    expect(readAiServerConfig({ AI_PROVIDER: "disabled" })).toEqual({
      reason: "invalid-app-origin",
      success: false,
    });
  });
});
