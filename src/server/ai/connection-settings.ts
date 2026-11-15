import "server-only";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CONNECTION_MODES, MODEL_FIELDS, connectionSettingsSchema, publicConnectionStateSchema, type ConnectionSettings, type PublicConnectionState } from "../../domain/ai-connections";
import { readAiServerConfig, parseLocalLlmBaseUrl } from "./config";

export type AiEnvironment = Readonly<Record<string, string | undefined>>;
export const MODEL_ENVIRONMENT_KEYS = { chatgpt: "CHATGPT_MODEL", claude: "CLAUDE_MODEL", local: "LOCAL_LLM_MODEL", openai: "OPENAI_MODEL", anthropic: "ANTHROPIC_MODEL", gemini: "GEMINI_MODEL", xai: "XAI_MODEL", deepseek: "DEEPSEEK_MODEL" } as const;
const recordSchema = z.object({ version: z.literal(1), revision: z.uuid(), settings: connectionSettingsSchema }).strict();
export type ConnectionRecord = z.infer<typeof recordSchema>;
export class AiSettingsConflictError extends Error {}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
export function aiSettingsFilename(environment: AiEnvironment = process.env): string {
  const filename = environment.NOVEL_AI_SETTINGS_PATH ?? join(homedir(), ".local", "share", "novel-ai-editor", "ai-settings.json");
  const directory = relative(process.cwd(), filename);
  if (!isAbsolute(filename) || filename.includes("\0") || !(isAbsolute(directory) || directory === ".." || directory.startsWith(`..${sep}`))) throw new Error("AI設定の保存場所が不正です。");
  return filename;
}
export function settingsFromEnvironment(environment: AiEnvironment): ConnectionSettings {
  const comparison = connectionSettingsSchema.shape.comparison.safeParse((environment.AI_COMPARE_PROVIDERS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  return connectionSettingsSchema.parse({
    primary: CONNECTION_MODES.find((mode) => mode === environment.AI_PROVIDER) ?? "disabled",
    comparison: comparison.success ? comparison.data : [],
    models: Object.fromEntries(MODEL_FIELDS.map((mode) => {
      const parsed = connectionSettingsSchema.shape.models.shape[mode].safeParse(environment[MODEL_ENVIRONMENT_KEYS[mode]] ?? "");
      return [mode, parsed.success ? parsed.data : ""];
    })),
    localBaseUrl: parseLocalLlmBaseUrl(environment.LOCAL_LLM_BASE_URL) ?? "http://127.0.0.1:11434/v1",
  });
}
export function applyConnectionSettings(environment: AiEnvironment, settings: ConnectionSettings): AiEnvironment {
  const parsed = connectionSettingsSchema.parse(settings);
  if (!parseLocalLlmBaseUrl(parsed.localBaseUrl)) throw new Error("ローカルURLはloopbackの/v1を指定してください。");
  return { ...environment, AI_PROVIDER: parsed.primary, AI_COMPARE_PROVIDERS: parsed.comparison.join(","), LOCAL_LLM_BASE_URL: parsed.localBaseUrl,
    ...Object.fromEntries(MODEL_FIELDS.map((mode) => [MODEL_ENVIRONMENT_KEYS[mode], parsed.models[mode]])),
  };
}
export function validateActiveConnections(environment: AiEnvironment, settings: ConnectionSettings): void {
  const effective = applyConnectionSettings(environment, settings);
  for (const mode of new Set([settings.primary, ...settings.comparison])) {
    if (!readAiServerConfig({ ...effective, AI_PROVIDER: mode }).success) throw new Error("選択したAIのモデル・認証・API許可の設定が未完了です。");
  }
}
export function publicConnectionState(environment: AiEnvironment, record: ConnectionRecord | null): PublicConnectionState {
  const settings = record?.settings ?? settingsFromEnvironment(environment);
  const effective = record ? applyConnectionSettings(environment, settings) : environment;
  return publicConnectionStateSchema.parse({ revision: record?.revision ?? null, settings,
    availableModes: CONNECTION_MODES.filter((mode) => mode !== "disabled" && readAiServerConfig({ ...effective, AI_PROVIDER: mode }).success),
    paidApiAllowed: environment.AI_ENABLE_PAID_API === "true",
    apiKeysConfigured: Object.fromEntries(["openai", "anthropic", "gemini", "xai", "deepseek"].map((mode) => [mode, Boolean(environment[`${mode === "anthropic" ? "ANTHROPIC" : mode.toUpperCase()}_API_KEY`])])),
  });
}
export function createAiSettingsStore(filename: string) {
  async function read(): Promise<ConnectionRecord | null> {
    let file;
    try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error: unknown) { if (missing(error)) return null; throw error; }
    try {
      const info = await file.stat(); if (!info.isFile() || info.size > 32_768 || (info.mode & 0o077) !== 0) throw new Error("AI設定ファイルを安全に読み込めません。");
      return recordSchema.parse(JSON.parse(await file.readFile("utf8")));
    } finally { await file.close(); }
  }
  async function update(expectedRevision: string | null, settings: ConnectionSettings | null): Promise<ConnectionRecord | null> {
    const directory = dirname(filename); await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("AI設定の保存先が不正です。");
    const lockPath = `${filename}.lock`; const lock = await open(lockPath, "wx", 0o600); const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
      const current = await read(); if ((current?.revision ?? null) !== expectedRevision) throw new AiSettingsConflictError("別の画面でAI設定が更新されました。再読み込みしてください。");
      if (settings === null) { if (current) await unlink(filename); return null; }
      const record = recordSchema.parse({ version: 1, revision: randomUUID(), settings });
      const output = await open(temporary, "wx", 0o600);
      try { await output.writeFile(JSON.stringify(record)); await output.sync(); } finally { await output.close(); }
      await rename(temporary, filename); return record;
    } finally { await unlink(temporary).catch(() => undefined); await lock.close(); await unlink(lockPath); }
  }
  return { read, update };
}
export type AiSettingsStore = ReturnType<typeof createAiSettingsStore>;
export async function readEffectiveAiEnvironment(environment: AiEnvironment = process.env): Promise<{ environment: AiEnvironment; revision: string }> {
  try {
    const record = await createAiSettingsStore(aiSettingsFilename(environment)).read();
    return { environment: record ? applyConnectionSettings(environment, record.settings) : environment, revision: record?.revision ?? "environment" };
  } catch { return { environment: { ...environment, AI_PROVIDER: "disabled", AI_COMPARE_PROVIDERS: "" }, revision: "invalid" }; }
}
