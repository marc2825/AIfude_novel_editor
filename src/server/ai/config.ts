import "server-only";

import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  findAiModelDefinition,
  isAiEditCompatibleModel,
  isSelectableAiModelId,
  OPENAI_PROVIDER_ID,
  isPaidApiProvider,
  type SelectableAiModelId,
} from "../../domain/ai-models";

export const AI_PROVIDER_MODES = Object.freeze([
  "disabled",
  "mock",
  "local",
  "openai",
  "chatgpt",
  "claude",
  "anthropic",
  "gemini",
  "xai",
  "deepseek",
] as const);

export type AiProviderMode = (typeof AI_PROVIDER_MODES)[number];

export type OpenAiSupportedModel = SelectableAiModelId;

export type LoopbackAppOrigin = Readonly<{
  host: string;
  origin: string;
}>;

export type AiServerConfig = Readonly<{
  appOrigin: LoopbackAppOrigin;
  provider:
    | Readonly<{ mode: "disabled" | "mock" }>
    | Readonly<{ authDirectory: string; mode: "chatgpt"; model: string }>
    | Readonly<{ authDirectory: string; executable: string; mode: "claude"; model: string; paidApiAllowed: boolean }>
    | Readonly<{ apiKey: string; mode: "anthropic" | "gemini" | "xai" | "deepseek"; model: string }>
    | Readonly<{
        apiKey: string | null;
        baseUrl: string;
        mode: "local";
        model: string;
      }>
    | Readonly<{
        apiKey: string;
        defaultModelId: OpenAiSupportedModel;
        mode: "openai";
      }>;
}>;

export type AiServerConfigFailureReason =
  | "invalid-app-origin"
  | "invalid-openai-config"
  | "invalid-local-config"
  | "invalid-chatgpt-config"
  | "invalid-claude-config"
  | "invalid-api-config"
  | "paid-api-disabled"
  | "unsupported-provider";

export type AiServerConfigResult =
  | Readonly<{
      config: AiServerConfig;
      success: true;
    }>
  | Readonly<{
      reason: AiServerConfigFailureReason;
      success: false;
    }>;

type ServerEnvironment = Readonly<
  Record<string, string | undefined>
>;

const loopbackHostnames = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

export function parseLoopbackAppOrigin(
  value: string | undefined,
): LoopbackAppOrigin | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !loopbackHostnames.has(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (value !== url.origin && value !== `${url.origin}/`)
  ) {
    return null;
  }

  return Object.freeze({
    host: url.host,
    origin: url.origin,
  });
}

function parseProviderMode(value: string | undefined): AiProviderMode | null {
  const mode = value ?? "disabled";

  return AI_PROVIDER_MODES.find((candidate) => candidate === mode) ?? null;
}

function isValidOpenAiApiKey(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.trim() === value &&
    !/\s/u.test(value)
  );
}

export function parseLocalLlmBaseUrl(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      parseLoopbackAppOrigin(url.origin) === null ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (value !== `${url.origin}/v1` && value !== `${url.origin}/v1/`)
    ) {
      return null;
    }

    return `${url.origin}/v1`;
  } catch {
    return null;
  }
}

export function isSupportedOpenAiModel(
  value: string | undefined,
): value is OpenAiSupportedModel {
  if (!isSelectableAiModelId(value)) {
    return false;
  }

  const model = findAiModelDefinition(value);

  return (
    model !== null &&
    model.providerId === OPENAI_PROVIDER_ID &&
    isAiEditCompatibleModel(model)
  );
}

export function readAiServerConfig(
  environment: ServerEnvironment = process.env,
): AiServerConfigResult {
  const appOrigin = parseLoopbackAppOrigin(environment.APP_ORIGIN);

  if (appOrigin === null) {
    return { reason: "invalid-app-origin", success: false };
  }

  const providerMode = parseProviderMode(environment.AI_PROVIDER);

  if (providerMode === null) {
    return { reason: "unsupported-provider", success: false };
  }

  if (isPaidApiProvider(providerMode) && environment.AI_ENABLE_PAID_API !== "true") {
    return { reason: "paid-api-disabled", success: false };
  }
  if (providerMode === "claude") {
    const model = environment.CLAUDE_MODEL;
    const executable = environment.CLAUDE_CLI_PATH ?? "claude";
    const authDirectory = environment.CLAUDE_AUTH_DIR ?? join(homedir(), ".local", "share", "novel-ai-editor", "claude");
    const directory = relative(process.cwd(), authDirectory);
    const outside = isAbsolute(directory) || directory === ".." || directory.startsWith(`..${sep}`);
    if (!model || !/^claude-[A-Za-z0-9._-]{1,120}$/u.test(model) ||
      !isAbsolute(authDirectory) || authDirectory.includes("\u0000") || !outside ||
      (executable !== "claude" && !isAbsolute(executable)) || /[\p{Cc}]/u.test(executable)) {
      return { reason: "invalid-claude-config", success: false };
    }
    // A non-subscription CLI login is billed like the API providers and follows the same server opt-in.
    const paidApiAllowed = environment.AI_ENABLE_PAID_API === "true";
    return { success: true, config: Object.freeze({ appOrigin, provider: Object.freeze({ mode: providerMode, executable, authDirectory, model, paidApiAllowed }) }) };
  }
  if (providerMode === "anthropic" || providerMode === "gemini" || providerMode === "xai" || providerMode === "deepseek") {
    const prefix = { anthropic: "ANTHROPIC", gemini: "GEMINI", xai: "XAI", deepseek: "DEEPSEEK" }[providerMode];
    const apiKey = environment[`${prefix}_API_KEY`];
    const model = environment[`${prefix}_MODEL`];
    if (!isValidOpenAiApiKey(apiKey) || !model || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(model)) {
      return { reason: "invalid-api-config", success: false };
    }
    return { success: true, config: Object.freeze({ appOrigin, provider: Object.freeze({ mode: providerMode, apiKey, model }) }) };
  }

  if (providerMode === "chatgpt") {
    const model = environment.CHATGPT_MODEL;
    const authDirectory = environment.CHATGPT_AUTH_DIR ?? join(homedir(), ".local", "share", "novel-ai-editor", "chatgpt");
    if (!isAbsolute(authDirectory) || authDirectory.includes("\u0000")) return { reason: "invalid-chatgpt-config", success: false };
    const relativeDirectory = relative(process.cwd(), authDirectory);
    const outsideRepository = isAbsolute(relativeDirectory) || relativeDirectory === ".." || relativeDirectory.startsWith(`..${sep}`);
    if (!model || model.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(model) || !outsideRepository) {
      return { reason: "invalid-chatgpt-config", success: false };
    }
    return { success: true, config: Object.freeze({ appOrigin, provider: Object.freeze({ mode: providerMode, model, authDirectory }) }) };
  }

  if (providerMode === "local") {
    const baseUrl = parseLocalLlmBaseUrl(environment.LOCAL_LLM_BASE_URL);
    const model = environment.LOCAL_LLM_MODEL;
    const apiKey = environment.LOCAL_LLM_API_KEY || null;

    if (
      baseUrl === null ||
      model === undefined ||
      model.length === 0 ||
      model.length > 256 ||
      model.trim() !== model ||
      /[\s\p{Cc}]/u.test(model) ||
      (apiKey !== null && !isValidOpenAiApiKey(apiKey))
    ) {
      return { reason: "invalid-local-config", success: false };
    }

    return {
      config: Object.freeze({
        appOrigin,
        provider: Object.freeze({ apiKey, baseUrl, mode: providerMode, model }),
      }),
      success: true,
    };
  }

  if (providerMode === "openai") {
    if (
      !isValidOpenAiApiKey(environment.OPENAI_API_KEY) ||
      !isSupportedOpenAiModel(environment.OPENAI_MODEL)
    ) {
      return { reason: "invalid-openai-config", success: false };
    }

    return {
      config: Object.freeze({
        appOrigin,
        provider: Object.freeze({
          apiKey: environment.OPENAI_API_KEY,
          defaultModelId: environment.OPENAI_MODEL,
          mode: providerMode,
        }),
      }),
      success: true,
    };
  }

  return {
    config: Object.freeze({
      appOrigin,
      provider: Object.freeze({ mode: providerMode }),
    }),
    success: true,
  };
}

// Comparison is explicit opt-in. Invalid auxiliary settings disable comparison,
// while the primary provider and manuscript editor remain available.
export function readComparisonConfigs(environment: ServerEnvironment = process.env): readonly AiServerConfigResult[] {
  if (!environment.AI_COMPARE_PROVIDERS) return [];
  const modes = environment.AI_COMPARE_PROVIDERS.split(",").map((mode) => mode.trim());
  if (modes.length < 2 || modes.length > 9 || new Set(modes).size !== modes.length || modes.some((mode) => mode === "disabled")) return [];
  const enabledModes = modes.filter((mode) => !isPaidApiProvider(mode) || environment.AI_ENABLE_PAID_API === "true");
  const results = enabledModes.map((mode) => readAiServerConfig({ ...environment, AI_PROVIDER: mode }));
  return results.every((result) => result.success) ? results : [];
}
