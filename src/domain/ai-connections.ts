import { z } from "zod";
import { AI_MODEL_DEFINITIONS, AI_PROVIDER_DEFINITIONS, CHATGPT_MODEL_DEFINITION, CONFIGURED_CLOUD_MODELS, LOCAL_LLM_MODEL_DEFINITION, getAiModelsForProvider, isPaidApiProvider, type PublicAiRuntime } from "./ai-models";

export const CONNECTION_MODES = ["disabled", "mock", "chatgpt", "claude", "local", "openai", "anthropic", "gemini", "xai", "deepseek"] as const;
export const connectionModeSchema = z.enum(CONNECTION_MODES);
export type ConnectionMode = z.infer<typeof connectionModeSchema>;
export const MODEL_FIELDS = ["chatgpt", "claude", "local", "openai", "anthropic", "gemini", "xai", "deepseek"] as const;
const model = z.string().max(256).regex(/^[A-Za-z0-9._:/-]*$/u);
export const connectionSettingsSchema = z.object({
  primary: connectionModeSchema,
  comparison: z.array(connectionModeSchema.exclude(["disabled"])).max(9).refine((ids) => ids.length !== 1 && new Set(ids).size === ids.length),
  models: z.object({ chatgpt: model, claude: model, local: model, openai: model, anthropic: model, gemini: model, xai: model, deepseek: model }).strict(),
  localBaseUrl: z.string().max(256),
}).strict();
export type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;
export const publicConnectionStateSchema = z.object({
  revision: z.uuid().nullable(), settings: connectionSettingsSchema, availableModes: z.array(connectionModeSchema).max(10),
  paidApiAllowed: z.boolean(), apiKeysConfigured: z.object({ openai: z.boolean(), anthropic: z.boolean(), gemini: z.boolean(), xai: z.boolean(), deepseek: z.boolean() }).strict(),
}).strict();
export type PublicConnectionState = z.infer<typeof publicConnectionStateSchema>;
export const connectionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedRevision: z.uuid().nullable(), settings: connectionSettingsSchema }).strict(),
  z.object({ action: z.literal("reset"), expectedRevision: z.uuid().nullable() }).strict(),
  z.object({ action: z.literal("diagnose"), requestId: z.uuid(), expectedRevision: z.uuid().nullable(), mode: connectionModeSchema, allowPaidApi: z.boolean() }).strict(),
]);
export const diagnosticSchema = z.object({ requestId: z.uuid(), revision: z.uuid().nullable(), mode: connectionModeSchema,
  status: z.enum(["ok", "auth-only", "auth-only-billed", "billed-auth-disabled", "auth-required", "model-not-listed", "invalid-config", "timeout", "unreachable", "api-disabled", "rate-limited"]),
}).strict();
export type ConnectionDiagnostic = z.infer<typeof diagnosticSchema>;
export const DIAGNOSTIC_MESSAGES: Readonly<Record<ConnectionDiagnostic["status"], string>> = {
  ok: "接続と設定モデルの一覧掲載を確認しました。生成可否・文章品質・残量は未確認です。",
  "auth-only": "サブスク認証を確認しました。設定モデルの生成可否・残量は未確認です。",
  "auth-only-billed": "Claude CLIのサブスク以外（APIキー等）の認証を確認しました。利用分はご自身の契約で従量課金されます。設定モデルの生成可否は未確認です。",
  "billed-auth-disabled": "Claude CLIがサブスク以外（APIキー等）で認証されています。従量課金で使う場合はサーバーでAI_ENABLE_PAID_API=trueを設定してください。",
  "auth-required": "認証を確認できません。ログインまたはサーバーのキー設定を確認してください。",
  "model-not-listed": "接続できましたが、取得した一覧に設定モデルがありません。別名・ページ分割もあり、生成可否は未確認です。",
  "invalid-config": "接続設定が未完了です。モデル・ローカルURL・サーバーの認証設定を確認してください。",
  timeout: "接続診断が時間内に完了しませんでした。", unreachable: "接続を確認できませんでした。サーバーの起動・通信状態を確認してください。",
  "api-disabled": "API診断にはサーバー設定と画面のAPI許可が必要です。", "rate-limited": "診断の利用上限です。しばらく待って再試行してください。",
};
export function connectionLabel(mode: ConnectionMode): string {
  return mode === "disabled" ? "AIを使わない" : AI_PROVIDER_DEFINITIONS.find((item) => item.id === mode)?.displayName ?? mode;
}
export function publicRuntimeForConnections(state: PublicConnectionState): PublicAiRuntime {
  function runtime(mode: ConnectionMode): PublicAiRuntime {
    const revision = state.revision ?? "environment";
    if (mode === "disabled" || !state.availableModes.includes(mode)) return { settingsRevision: revision, available: false, defaultModelId: null, providerId: null, models: [], externalDataTransfer: false };
    const slot = mode === "chatgpt" ? CHATGPT_MODEL_DEFINITION : mode === "local" ? LOCAL_LLM_MODEL_DEFINITION : CONFIGURED_CLOUD_MODELS.find((item) => item.providerId === mode);
    const models = slot ? [{ ...slot, displayName: `${connectionLabel(mode)}：${state.settings.models[mode === "chatgpt" || mode === "local" || mode === "claude" || mode === "anthropic" || mode === "gemini" || mode === "xai" || mode === "deepseek" ? mode : "openai"]}` }] : getAiModelsForProvider(mode);
    const defaultModel = mode === "openai" ? AI_MODEL_DEFINITIONS.find((item) => item.id === state.settings.models.openai && item.providerId === "openai") : models[0];
    return { settingsRevision: revision, available: defaultModel !== undefined, defaultModelId: defaultModel?.id ?? null, providerId: mode, models, externalDataTransfer: mode !== "mock" && mode !== "local" };
  }
  const comparison = state.settings.comparison.filter((mode) => !isPaidApiProvider(mode) || state.paidApiAllowed);
  return { ...runtime(state.settings.primary), comparisonProviders: comparison.every((mode) => state.availableModes.includes(mode)) ? comparison.map(runtime) : [] };
}
