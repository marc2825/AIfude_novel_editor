import "server-only";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { isPaidApiProvider } from "../../domain/ai-models";
import type { ConnectionDiagnostic } from "../../domain/ai-connections";
import { readAiServerConfig, type AiServerConfigResult } from "./config";
import type { ChatGptAuthService } from "./chatgpt/auth";
import { getChatGptAuth } from "./chatgpt/runtime";
import { readBoundedJson } from "./chatgpt/http";
import { classifyClaudeCliAuth, claudeCliEnvironment, runClaudeCli, type ClaudeCliRunner } from "./claude-cli-provider";

type DiagnosticStatus = ConnectionDiagnostic["status"];
export type DiagnosticDependencies = Readonly<{ fetch?: typeof globalThis.fetch; getAuth?: (directory: string) => ChatGptAuthService; runCli?: ClaudeCliRunner; deadlineMs?: number }>;
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(256) })).max(1_000) });
const chatGptModelsSchema = z.object({ models: z.array(z.object({ slug: z.string().min(1).max(256), visibility: z.string().max(64) })).max(1_000) });
const geminiModelsSchema = z.object({ models: z.array(z.object({ name: z.string().min(1).max(256) })).max(1_000) });

export async function diagnoseConnection(config: AiServerConfigResult, requestSignal: AbortSignal, allowPaidApi: boolean, dependencies: DiagnosticDependencies = {}): Promise<DiagnosticStatus> {
  if (!config.success) return config.reason === "paid-api-disabled" ? "api-disabled" : "invalid-config";
  const provider = config.config.provider;
  if (isPaidApiProvider(provider.mode) && !allowPaidApi) return "api-disabled";
  if (provider.mode === "disabled") return "invalid-config";
  if (provider.mode === "mock") return "ok";
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), dependencies.deadlineMs ?? 10_000);
  const signal = AbortSignal.any([requestSignal, timeout.signal]);
  let remove = () => {};
  const aborted = new Promise<DiagnosticStatus>((resolve) => {
    const abort = () => resolve(timeout.signal.aborted ? "timeout" : "unreachable");
    signal.addEventListener("abort", abort, { once: true }); remove = () => signal.removeEventListener("abort", abort); if (signal.aborted) abort();
  });
  async function inspect(): Promise<DiagnosticStatus> {
    if (signal.aborted) return "unreachable";
    if (provider.mode === "claude") {
      const cwd = await mkdtemp(join(tmpdir(), "novel-ai-diagnostic-"));
      try {
        const response = await (dependencies.runCli ?? runClaudeCli)({ executable: provider.executable, args: ["auth", "status"], stdin: "", cwd, env: claudeCliEnvironment(provider.authDirectory, 1_024), signal });
        signal.throwIfAborted();
        if (response.code === null) return "unreachable";
        const auth = classifyClaudeCliAuth(response);
        if (auth === "subscription") return "auth-only";
        if (auth === "unauthenticated") return "auth-required";
        return provider.paidApiAllowed ? "auth-only-billed" : "billed-auth-disabled";
      } finally { await rm(cwd, { recursive: true, force: true }).catch(() => undefined); }
    }
    let url: string; let model: string; let headers: Record<string, string>;
    if (provider.mode === "chatgpt") {
      const auth = (dependencies.getAuth ?? getChatGptAuth)(provider.authDirectory); const status = await auth.status();
      if (!status.connected || !status.connectionId) return "auth-required";
      const token = await auth.access(status.connectionId, signal); signal.throwIfAborted();
      url = "https://api.openai.com/v1/models"; model = provider.model; headers = { Authorization: `Bearer ${token}` };
    } else if (provider.mode === "local") {
      url = `${provider.baseUrl}/models`; model = provider.model; headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
    } else if (provider.mode === "openai") {
      url = "https://api.openai.com/v1/models"; model = provider.defaultModelId; headers = { Authorization: `Bearer ${provider.apiKey}` };
    } else if (provider.mode === "anthropic" || provider.mode === "gemini" || provider.mode === "xai" || provider.mode === "deepseek") {
      model = provider.model;
      const urls = { anthropic: "https://api.anthropic.com/v1/models", gemini: "https://generativelanguage.googleapis.com/v1beta/models", xai: "https://api.x.ai/v1/models", deepseek: "https://api.deepseek.com/models" };
      url = urls[provider.mode];
      headers = provider.mode === "anthropic" ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
        : provider.mode === "gemini" ? { "x-goog-api-key": provider.apiKey } : { Authorization: `Bearer ${provider.apiKey}` };
    } else return "invalid-config";
    const response = await fetch(url, { method: "GET", headers, signal, cache: "no-store", redirect: "error" });
    if (signal.aborted) { await response.body?.cancel(); return "unreachable"; }
    if (!response.ok) { await response.body?.cancel(); return response.status === 401 || response.status === 403 ? "auth-required" : "unreachable"; }
    const value = await readBoundedJson(response, 262_144, signal); signal.throwIfAborted();
    const ids = provider.mode === "chatgpt" ? chatGptModelsSchema.parse(value).models.filter((item) => item.visibility === "list").map((item) => item.slug)
      : provider.mode === "gemini" ? geminiModelsSchema.parse(value).models.map((item) => item.name.replace(/^models\//u, ""))
      : modelsSchema.parse(value).data.map((item) => item.id);
    return ids.includes(model) ? "ok" : "model-not-listed";
  }
  try { return await Promise.race([inspect().catch((): DiagnosticStatus => timeout.signal.aborted ? "timeout" : "unreachable"), aborted]); }
  finally { clearTimeout(timer); remove(); }
}

export function configForDiagnostic(environment: Readonly<Record<string, string | undefined>>, mode: string): AiServerConfigResult {
  return readAiServerConfig({ ...environment, AI_PROVIDER: mode });
}
