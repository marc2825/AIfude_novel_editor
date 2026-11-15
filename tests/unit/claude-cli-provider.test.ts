// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { LLM_CANDIDATES_SCHEMA } from "../../contracts/llm-candidates.schema";
import { CONFIGURED_CLOUD_MODELS } from "../../src/domain/ai-models";
import { claudeCliEnvironment, createClaudeCliEditingProvider, runClaudeCli, type ClaudeCliRunner } from "../../src/server/ai/claude-cli-provider";
import type { EditingProviderInput } from "../../src/server/ai/provider";
import { createCandidateWireResponse } from "../fixtures/candidates";
import { createDeferred } from "../helpers/deferred";

const config = { executable: "claude", authDirectory: "/tmp/unused-cli-auth", model: "claude-sonnet-5", paidApiAllowed: false };
function input(signal = new AbortController().signal): EditingProviderInput {
  const model = CONFIGURED_CLOUD_MODELS.find((model) => model.providerId === "claude");
  if (!model) throw new Error("Missing model");
  return { model, signal, outputTokenLimit: 8192, responseSchema: LLM_CANDIDATES_SCHEMA,
    prompt: { systemInstruction: "固定指示", inputDataJson: '{"selectionText":"秘密の本文"}' } };
}
function success() { return { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, modelUsage: { [config.model]: {} }, result: JSON.stringify(createCandidateWireResponse()) }) }; }
function runner() { return vi.fn<ClaudeCliRunner>().mockResolvedValueOnce({ code: 0, stdout: '{"authMethod":"claude.ai"}' }).mockResolvedValue(success()); }

describe("Claude subscription through the official CLI", () => {
  it("checks subscription authentication first and sends private input through stdin with tools and persistence disabled", async () => {
    const run = runner(); const request = input();
    expect(await createClaudeCliEditingProvider(config, run).generateCandidates(request)).toEqual({ status: "completed", output: createCandidateWireResponse(), modelId: config.model, usage: null });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ args: ["auth", "status"], stdin: "" });
    const call = run.mock.calls[1]?.[0];
    expect(call?.stdin).toBe(request.prompt.inputDataJson);
    expect(call?.args).toContain("--no-session-persistence"); expect(call?.args).toContain("--safe-mode"); expect(call?.args).toContain("--restricted");
    expect(call?.args).toEqual(expect.arrayContaining(["--tools", "", "--max-turns", "1", "--model", config.model]));
    expect(JSON.stringify(call?.args)).not.toContain("秘密の本文");
    expect(call?.env).toMatchObject({ CLAUDE_CODE_MAX_RETRIES: "0", CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8192" });
    expect(call?.cwd).not.toBe(process.cwd());
  });
  it("never forces a login method on the CLI", async () => {
    const run = runner(); await createClaudeCliEditingProvider(config, run).generateCandidates(input());
    const args = run.mock.calls[1]?.[0].args ?? [];
    const settings: unknown = JSON.parse(args[args.indexOf("--settings") + 1] ?? "null");
    expect(settings).toMatchObject({ disableAllHooks: true }); expect(settings).not.toHaveProperty("forceLoginMethod");
  });
  it.each([
    ["the CLI is not signed in", { code: 0, stdout: '{"authMethod":"none"}' }],
    ["the status command fails", { code: 1, stdout: '{"authMethod":"claude.ai"}' }],
    ["the status output is unreadable", { code: 0, stdout: "not JSON" }],
  ])("stops before sending the prompt when %s", async (_label, status) => {
    const run = vi.fn<ClaudeCliRunner>().mockResolvedValue(status);
    expect(await createClaudeCliEditingProvider({ ...config, paidApiAllowed: true }, run).generateCandidates(input())).toEqual({ status: "failed", reason: "auth-required" }); expect(run).toHaveBeenCalledOnce();
  });
  it.each(["api_key", "api_key_helper", "third_party", "unknown_future_method"])("uses %s login only with the paid API opt-in because it bills the user's own account", async (authMethod) => {
    const blocked = vi.fn<ClaudeCliRunner>().mockResolvedValue({ code: 0, stdout: JSON.stringify({ authMethod }) });
    expect(await createClaudeCliEditingProvider(config, blocked).generateCandidates(input())).toEqual({ status: "failed", reason: "auth-required" }); expect(blocked).toHaveBeenCalledOnce();
    const allowed = vi.fn<ClaudeCliRunner>().mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ authMethod }) }).mockResolvedValue(success());
    expect(await createClaudeCliEditingProvider({ ...config, paidApiAllowed: true }, allowed).generateCandidates(input())).toEqual({ status: "completed", output: createCandidateWireResponse(), modelId: config.model, usage: null });
    expect(allowed).toHaveBeenCalledTimes(2);
  });
  it("strips inherited API keys, gateways, debug and infinite retry configuration", () => {
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_RETRY_WATCHDOG", "CLAUDE_CODE_DEBUG", "NODE_OPTIONS"]) vi.stubEnv(key, "unsafe");
    const env = claudeCliEnvironment(config.authDirectory, 8192);
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_RETRY_WATCHDOG", "CLAUDE_CODE_DEBUG", "NODE_OPTIONS"]) expect(env[key]).toBeUndefined();
    expect(env.HOME).toBe(process.env.HOME); vi.unstubAllEnvs();
  });
  it("rejects invalid JSON without a second generation and discards an abort-ignoring CLI", async () => {
    const run = runner();
    run.mockResolvedValue({ code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, modelUsage: { [config.model]: {} }, result: "not JSON" }) });
    expect(await createClaudeCliEditingProvider(config, run).generateCandidates(input())).toMatchObject({ status: "completed", output: null });
    expect(run).toHaveBeenCalledTimes(2);
    const pending = createDeferred<Awaited<ReturnType<ClaudeCliRunner>>>(); const lateRun = vi.fn<ClaudeCliRunner>().mockResolvedValueOnce({ code: 0, stdout: '{"authMethod":"claude.ai"}' }).mockImplementation(() => pending.promise);
    const abort = new AbortController(); const result = createClaudeCliEditingProvider(config, lateRun).generateCandidates(input(abort.signal));
    await vi.waitFor(() => expect(lateRun).toHaveBeenCalledTimes(2)); abort.abort(); pending.resolve(success());
    expect(await result).toEqual({ status: "failed", reason: "failure" });
  });
  it("bounds child output, decodes split Unicode, and terminates a process on abort", async () => {
    const base = { executable: process.execPath, cwd: tmpdir(), env: claudeCliEnvironment(config.authDirectory, 8192), stdin: "", signal: new AbortController().signal };
    expect(await runClaudeCli({ ...base, args: ["-e", "for (const byte of Buffer.from('日本語😀')) process.stdout.write(Buffer.from([byte]));"] })).toEqual({ code: 0, stdout: "日本語😀" });
    expect(await runClaudeCli({ ...base, args: ["-e", "process.stdout.write('x'.repeat(300000));"] })).toEqual({ code: null, stdout: "" });
    const abort = new AbortController(); const result = runClaudeCli({ ...base, signal: abort.signal, args: ["-e", "setInterval(() => {}, 1000);"] }); abort.abort();
    expect(await result).toEqual({ code: null, stdout: "" });
  });
  it("rejects a result generated by a different or additional model", async () => {
    for (const modelUsage of [{ "different-model": {} }, { [config.model]: {}, "different-model": {} }]) {
      const run = runner(); run.mockResolvedValue({ ...success(), stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, modelUsage, result: JSON.stringify(createCandidateWireResponse()) }) });
      expect(await createClaudeCliEditingProvider(config, run).generateCandidates(input())).toEqual({ status: "failed", reason: "failure" });
      expect(run).toHaveBeenCalledTimes(2);
    }
  });
});
