export const AI_MODEL_PREFERENCE_AUTOMATIC = "automatic" as const;
export const MOCK_PROVIDER_ID = "mock" as const;
export const OPENAI_PROVIDER_ID = "openai" as const;
export const LOCAL_DEMO_MODEL_ID = "local-demo" as const;
export const LOCAL_LLM_PROVIDER_ID = "local" as const;
export const LOCAL_LLM_MODEL_ID = "local-default" as const;
export const CHATGPT_PROVIDER_ID = "chatgpt" as const;
export const CHATGPT_MODEL_ID = "chatgpt-default" as const;

export const PAID_API_PROVIDER_IDS = ["openai", "anthropic", "gemini", "xai", "deepseek"] as const;
export function isPaidApiProvider(providerId: string | null): boolean {
  return PAID_API_PROVIDER_IDS.some((id) => id === providerId);
}

function configuredModel<const Provider extends string>(providerId: Provider, displayName: string) {
  return Object.freeze({
    id: `${providerId}-default` as const, providerId, displayName,
    description: "接続先とモデルはサーバー設定で指定します。返答はアプリで再検証します。",
    selectable: false as const,
    capabilities: Object.freeze({ responsesApi: false as const, structuredOutputs: false as const, textInput: true as const, textOutput: true as const }),
  });
}
export const CONFIGURED_CLOUD_MODELS = Object.freeze([
  configuredModel("claude", "Claudeサブスク（公式CLI・実験的）"),
  configuredModel("anthropic", "Claude API"),
  configuredModel("gemini", "Gemini API"),
  configuredModel("xai", "Grok API"),
  configuredModel("deepseek", "DeepSeek API"),
]);

// Account-specific capabilities are checked by the subscription adapter.
export const CHATGPT_MODEL_DEFINITION: Readonly<{
  capabilities: Readonly<{ responsesApi: true; structuredOutputs: true; textInput: true; textOutput: true }>;
  description: string;
  displayName: string;
  id: typeof CHATGPT_MODEL_ID;
  providerId: typeof CHATGPT_PROVIDER_ID;
  selectable: false;
}> = Object.freeze({
  capabilities: Object.freeze({ responsesApi: true, structuredOutputs: true, textInput: true, textOutput: true }),
  description: "ChatGPTの利用枠を使用します。モデルはサーバー設定とアカウントの利用可否に従います。",
  displayName: "ChatGPTサブスク（実験的）",
  id: CHATGPT_MODEL_ID,
  providerId: CHATGPT_PROVIDER_ID,
  selectable: false,
});

// This is a server-configured connection slot, not a model capability claim.
export const LOCAL_LLM_MODEL_DEFINITION: Readonly<{
  capabilities: Readonly<{
    responsesApi: false;
    structuredOutputs: true;
    textInput: true;
    textOutput: true;
  }>;
  description: string;
  displayName: string;
  id: typeof LOCAL_LLM_MODEL_ID;
  providerId: typeof LOCAL_LLM_PROVIDER_ID;
  selectable: false;
}> = Object.freeze({
  capabilities: Object.freeze({
    responsesApi: false,
    structuredOutputs: true,
    textInput: true,
    textOutput: true,
  }),
  description: "このPCで動くJSON Schema対応サーバーのモデルを使用します。",
  displayName: "ローカルLLM（サーバー設定）",
  id: LOCAL_LLM_MODEL_ID,
  providerId: LOCAL_LLM_PROVIDER_ID,
  selectable: false,
});

export const AI_PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({ displayName: "Claudeサブスク（実験的）", externalDataTransfer: true, id: "claude" }),
  Object.freeze({ displayName: "Claude API", externalDataTransfer: true, id: "anthropic" }),
  Object.freeze({ displayName: "Gemini API", externalDataTransfer: true, id: "gemini" }),
  Object.freeze({ displayName: "Grok API", externalDataTransfer: true, id: "xai" }),
  Object.freeze({ displayName: "DeepSeek API", externalDataTransfer: true, id: "deepseek" }),
  Object.freeze({ displayName: "ChatGPTサブスク（実験的）", externalDataTransfer: true, id: CHATGPT_PROVIDER_ID }),
  Object.freeze({
    displayName: "ローカルLLM",
    externalDataTransfer: false,
    id: LOCAL_LLM_PROVIDER_ID,
  }),
  Object.freeze({
    displayName: "ローカルデモ",
    externalDataTransfer: false,
    id: MOCK_PROVIDER_ID,
  }),
  Object.freeze({
    displayName: "OpenAI",
    externalDataTransfer: true,
    id: OPENAI_PROVIDER_ID,
  }),
] as const);

export const AI_MODEL_DEFINITIONS = Object.freeze([
  ...CONFIGURED_CLOUD_MODELS,
  CHATGPT_MODEL_DEFINITION,
  LOCAL_LLM_MODEL_DEFINITION,
  Object.freeze({
    capabilities: Object.freeze({
      responsesApi: false,
      structuredOutputs: true,
      textInput: true,
      textOutput: true,
    }),
    description: "外部送信を行わない決定的な動作確認用候補です。",
    displayName: "ローカルデモ候補",
    id: LOCAL_DEMO_MODEL_ID,
    providerId: MOCK_PROVIDER_ID,
    selectable: false,
  }),
  Object.freeze({
    capabilities: Object.freeze({
      responsesApi: true,
      structuredOutputs: true,
      textInput: true,
      textOutput: true,
    }),
    description: "OpenAIが高難度の処理向けに位置付ける最上位モデルです。",
    displayName: "GPT-6 Astra",
    id: "gpt-6-astra",
    limits: Object.freeze({
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    }),
    providerId: OPENAI_PROVIDER_ID,
    selectable: true,
  }),
  Object.freeze({
    capabilities: Object.freeze({
      responsesApi: true,
      structuredOutputs: true,
      textInput: true,
      textOutput: true,
    }),
    description: "OpenAIが複雑な専門作業向けのflagshipと位置付けるモデルです。",
    displayName: "GPT-5.6 Sol",
    id: "gpt-5.6-sol",
    limits: Object.freeze({
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    }),
    providerId: OPENAI_PROVIDER_ID,
    selectable: true,
  }),
  Object.freeze({
    capabilities: Object.freeze({
      responsesApi: true,
      structuredOutputs: true,
      textInput: true,
      textOutput: true,
    }),
    description: "OpenAIが性能とコストのバランス向けに位置付けるモデルです。",
    displayName: "GPT-5.6 Terra",
    id: "gpt-5.6-terra",
    limits: Object.freeze({
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    }),
    providerId: OPENAI_PROVIDER_ID,
    selectable: true,
  }),
  Object.freeze({
    capabilities: Object.freeze({
      responsesApi: true,
      structuredOutputs: true,
      textInput: true,
      textOutput: true,
    }),
    description: "OpenAIが低コスト・高頻度利用向けに位置付けるモデルです。",
    displayName: "GPT-5.6 Luna",
    id: "gpt-5.6-luna",
    limits: Object.freeze({
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
    }),
    providerId: OPENAI_PROVIDER_ID,
    selectable: true,
  }),
] as const);

export type AiProviderId = (typeof AI_PROVIDER_DEFINITIONS)[number]["id"];
export type AiModelDefinition = (typeof AI_MODEL_DEFINITIONS)[number];
export type AiModelId = AiModelDefinition["id"];
export type PublicAiRuntime = Readonly<{
  settingsRevision?: string;
  paidApiEnabled?: boolean;
  comparisonProviders?: readonly PublicAiRuntime[];
  connectionId?: string;
  available: boolean;
  defaultModelId: AiModelId | null;
  externalDataTransfer: boolean;
  models: readonly AiModelDefinition[];
  providerId: AiProviderId | null;
}>;

export type SelectableAiModelDefinition = Extract<
  AiModelDefinition,
  { readonly selectable: true }
>;
export type SelectableAiModelId = SelectableAiModelDefinition["id"];
export const AI_EDIT_REQUIRED_MODEL_LIMITS = Object.freeze({
  contextWindowTokens: 64_000,
  maxOutputTokens: 12_288,
});

export function findAiProviderDefinition(
  providerId: string,
): (typeof AI_PROVIDER_DEFINITIONS)[number] | null {
  return (
    AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ??
    null
  );
}

export function findAiModelDefinition(
  modelId: string,
): AiModelDefinition | null {
  return AI_MODEL_DEFINITIONS.find((model) => model.id === modelId) ?? null;
}

export function getAiModelsForProvider(
  providerId: string,
): readonly AiModelDefinition[] {
  return AI_MODEL_DEFINITIONS.filter(
    (model) => model.providerId === providerId,
  );
}

export function getSelectableAiModelsForProvider(
  providerId: string,
): readonly SelectableAiModelDefinition[] {
  return AI_MODEL_DEFINITIONS.filter(
    (model): model is SelectableAiModelDefinition =>
      model.providerId === providerId && model.selectable,
  );
}

export function isSelectableAiModelId(
  value: unknown,
): value is SelectableAiModelId {
  return (
    typeof value === "string" &&
    AI_MODEL_DEFINITIONS.some(
      (model) => model.id === value && model.selectable,
    )
  );
}

export function isAiEditCompatibleModel(
  model: AiModelDefinition,
): model is SelectableAiModelDefinition {
  return hasRequiredAiEditCapabilities(model);
}

function hasRequiredAiEditCapabilities(model: AiModelDefinition): boolean {
  return (
    model.selectable &&
    model.capabilities.responsesApi &&
    model.capabilities.structuredOutputs &&
    model.capabilities.textInput &&
    model.capabilities.textOutput &&
    "limits" in model &&
    model.limits.contextWindowTokens >=
      AI_EDIT_REQUIRED_MODEL_LIMITS.contextWindowTokens &&
    model.limits.maxOutputTokens >=
      AI_EDIT_REQUIRED_MODEL_LIMITS.maxOutputTokens
  );
}

export function validateAiModelRegistry(): readonly string[] {
  const issues: string[] = [];
  const providerIds = new Set<string>();
  const modelIds = new Set<string>();

  for (const provider of AI_PROVIDER_DEFINITIONS) {
    if (providerIds.has(provider.id)) {
      issues.push(`duplicate provider ID: ${provider.id}`);
    }

    providerIds.add(provider.id);
  }

  for (const model of AI_MODEL_DEFINITIONS) {
    if (modelIds.has(model.id)) {
      issues.push(`duplicate model ID: ${model.id}`);
    }

    modelIds.add(model.id);

    if (!providerIds.has(model.providerId)) {
      issues.push(`unknown provider for model: ${model.id}`);
    }

    if (model.selectable && !hasRequiredAiEditCapabilities(model)) {
      issues.push(`incompatible selectable model: ${model.id}`);
    }
  }

  return Object.freeze(issues);
}

const registryIssues = validateAiModelRegistry();

if (registryIssues.length > 0) {
  throw new Error(`AI model registry is invalid: ${registryIssues.join(", ")}`);
}
