import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { EditingProvider, EditingProviderInput, EditingProviderResult } from "./provider";

type ClaudeConfig = Readonly<{ authDirectory: string; executable: string; model: string; paidApiAllowed: boolean }>;
type CliCall = Readonly<{ executable: string; args: readonly string[]; stdin: string; cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }>;
type CliResult = Readonly<{ code: number | null; stdout: string }>;
export type ClaudeCliRunner = (call: CliCall) => Promise<CliResult>;

// Use an allowlist: the server's own API keys, gateways, retry watchdogs and
// debug settings are never forwarded. The CLI uses only what its own login
// stored in the dedicated directory. HOME retains its original OS meaning.
export function claudeCliEnvironment(authDirectory: string, outputTokenLimit: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SystemRoot", "TMPDIR", "XDG_RUNTIME_DIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CLAUDE_CONFIG_DIR: authDirectory, CLAUDE_CODE_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(outputTokenLimit), CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
    DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
  };
}

export const runClaudeCli: ClaudeCliRunner = async (call) => {
  if (call.signal.aborted) return { code: null, stdout: "" };
  return new Promise((resolve) => {
    const child = spawn(call.executable, [...call.args], { cwd: call.cwd, env: call.env, shell: false, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    const chunks: Buffer[] = []; let bytes = 0; let failed = false; let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
    };
    const finish = (code: number | null) => {
      if (settled) return; settled = true;
      clearTimeout(killTimer); call.signal.removeEventListener("abort", abort);
      let stdout = "";
      try { if (!failed) stdout = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); } catch { failed = true; }
      resolve({ code: failed ? null : code, stdout: failed ? "" : stdout });
    };
    const abort = () => { failed = true; kill("SIGTERM"); killTimer ??= setTimeout(() => { kill("SIGKILL"); finish(null); }, 500); };
    child.on("error", () => { failed = true; finish(null); });
    child.on("close", finish);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 256 * 1024) abort(); else if (!failed) chunks.push(chunk);
    });
    // Drain without retaining or logging CLI diagnostics, which may include inputs.
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 256 * 1024) abort(); });
    child.stdin.on("error", () => { /* Exit/abort can close stdin first. */ });
    call.signal.addEventListener("abort", abort, { once: true });
    if (call.signal.aborted) abort();
    child.stdin.end(call.stdin);
  });
};

const authStatusSchema = z.object({ authMethod: z.string().min(1).max(64) });
const subscriptionAuthMethods = new Set(["claude.ai", "oauth_token"]);
export type ClaudeCliAuth = "subscription" | "billed" | "unauthenticated";

// Every login method of the CLI stays usable; the app never forces one. Methods
// other than a Claude subscription (API key, key helper, cloud providers, or an
// unknown value) bill the user's own account, so they need the same server
// opt-in as the paid API providers (AI_ENABLE_PAID_API=true).
export function classifyClaudeCliAuth(result: CliResult): ClaudeCliAuth {
  if (result.code !== 0) return "unauthenticated";
  const status = authStatusSchema.safeParse(parseJson(result.stdout));
  if (!status.success || status.data.authMethod === "none") return "unauthenticated";
  return subscriptionAuthMethods.has(status.data.authMethod) ? "subscription" : "billed";
}

const resultSchema = z.object({ type: z.literal("result"), subtype: z.string(), is_error: z.boolean(), result: z.string().optional(), num_turns: z.number().int().optional(), permission_denials: z.array(z.unknown()).optional(), modelUsage: z.record(z.string(), z.unknown()) });
function parseJson(value: string): unknown { try { return JSON.parse(value) as unknown; } catch { return null; } }

export function createClaudeCliEditingProvider(config: ClaudeConfig, run: ClaudeCliRunner = runClaudeCli): EditingProvider {
  return Object.freeze({
    defaultModelId: "claude-default", providerId: "claude", externalDataTransfer: true,
    async generateCandidates(input: EditingProviderInput): Promise<EditingProviderResult> {
      if (input.signal.aborted || input.model.providerId !== "claude") return { status: "failed", reason: "failure" };
      let cwd: string | undefined;
      try {
        cwd = await mkdtemp(join(tmpdir(), "novel-ai-claude-"));
        const env = claudeCliEnvironment(config.authDirectory, input.outputTokenLimit);
        const authSignal = AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]);
        const auth = classifyClaudeCliAuth(await run({ executable: config.executable, args: ["auth", "status"], stdin: "", cwd, env, signal: authSignal }));
        if (input.signal.aborted) return { status: "failed", reason: "failure" };
        if (auth === "unauthenticated" || (auth === "billed" && !config.paidApiAllowed)) return { status: "failed", reason: "auth-required" };
        const result = await run({ executable: config.executable, cwd, env, signal: input.signal,
          args: ["--print", "--output-format", "json", "--model", config.model, "--max-turns", "1", "--tools", "", "--disallowedTools", "mcp__*",
            "--safe-mode", "--restricted", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--settings", JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false, fallbackModel: [], switchModelsOnFlag: false, availableModels: [config.model] }),
            "--no-session-persistence", "--system-prompt", `${input.prompt.systemInstruction}\nJSON schema: ${JSON.stringify(input.responseSchema)}`],
          stdin: input.prompt.inputDataJson,
        });
        if (input.signal.aborted) return { status: "failed", reason: "failure" };
        const parsed = resultSchema.safeParse(parseJson(result.stdout));
        if (!parsed.success || result.code !== 0 || parsed.data.is_error) return { status: "failed", reason: "failure" };
        const usedModels = Object.keys(parsed.data.modelUsage);
        if (usedModels.length !== 1 || usedModels[0] !== config.model) return { status: "failed", reason: "failure" };
        if (parsed.data.subtype !== "success" || (parsed.data.num_turns ?? 1) !== 1 || parsed.data.permission_denials?.length || !parsed.data.result) return { status: "completed", output: null, usage: null };
        return { status: "completed", output: parseJson(parsed.data.result), modelId: config.model, usage: null };
      } catch { return { status: "failed", reason: "failure" }; }
      finally { if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {}); }
    },
  });
}
