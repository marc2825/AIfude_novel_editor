import { mkdtemp, readFile, rm, stat, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiSettingsStore, settingsFromEnvironment, validateActiveConnections, readEffectiveAiEnvironment, publicConnectionState, AiSettingsConflictError } from "../../src/server/ai/connection-settings";
import { publicRuntimeForConnections } from "../../src/domain/ai-connections";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "novel-ai-settings-test-")); });
afterEach(async () => rm(directory, { recursive: true, force: true }));
const environment = { APP_ORIGIN: "http://127.0.0.1:3000", AI_PROVIDER: "mock", CHATGPT_MODEL: "test-model", OPENAI_API_KEY: "fixture-key", OPENAI_MODEL: "gpt-5.6-luna" };
describe("server-only AI connection settings", () => {
  it("saves protected nonsecret settings atomically, checks revisions and resets to environment", async () => {
    const filename = join(directory, "settings.json"); const store = createAiSettingsStore(filename); expect(await store.read()).toBeNull();
    const settings = { ...settingsFromEnvironment(environment), primary: "chatgpt" as const, comparison: ["mock", "chatgpt"] as const };
    const record = await store.update(null, { ...settings, comparison: [...settings.comparison] }); if (!record) throw new Error("Missing record");
    expect((await stat(filename)).mode & 0o077).toBe(0); expect(await readFile(filename, "utf8")).not.toContain("fixture-key");
    const effective = await readEffectiveAiEnvironment({ ...environment, NOVEL_AI_SETTINGS_PATH: filename }); expect(effective.environment.AI_PROVIDER).toBe("chatgpt");
    expect(effective.environment.OPENAI_API_KEY).toBe("fixture-key"); expect(effective.revision).toBe(record.revision);
    await expect(store.update(null, record.settings)).rejects.toBeInstanceOf(AiSettingsConflictError);
    await store.update(record.revision, null); expect(await store.read()).toBeNull();
    expect((await readEffectiveAiEnvironment({ ...environment, NOVEL_AI_SETTINGS_PATH: filename })).environment.AI_PROVIDER).toBe("mock");
  });
  it("fails closed without overwriting malformed or unsupported settings and rejects symlinks", async () => {
    const filename = join(directory, "settings.json"); await writeFile(filename, JSON.stringify({ version: 99 }), { mode: 0o600 });
    const store = createAiSettingsStore(filename); await expect(store.read()).rejects.toThrow();
    const effective = await readEffectiveAiEnvironment({ ...environment, NOVEL_AI_SETTINGS_PATH: filename }); expect(effective.environment.AI_PROVIDER).toBe("disabled");
    await expect(store.update(null, settingsFromEnvironment(environment))).rejects.toThrow(); expect(await readFile(filename, "utf8")).toBe('{"version":99}');
    const link = join(directory, "link.json"); await symlink(filename, link); await expect(createAiSettingsStore(link).read()).rejects.toThrow();
  });
  it("keeps API disabled by default and rejects arbitrary local URLs or missing credentials", () => {
    const settings = settingsFromEnvironment(environment);
    expect(() => validateActiveConnections(environment, { ...settings, primary: "openai" })).toThrow();
    expect(() => validateActiveConnections({ ...environment, AI_ENABLE_PAID_API: "true" }, { ...settings, primary: "openai" })).not.toThrow();
    expect(() => validateActiveConnections(environment, { ...settings, primary: "local", localBaseUrl: "https://example.org/v1" })).toThrow();
    expect(() => validateActiveConnections(environment, { ...settings, primary: "gemini" })).toThrow();
    const state = publicConnectionState(environment, null); expect(state.paidApiAllowed).toBe(false); expect(JSON.stringify(state)).not.toContain("fixture-key");
    expect(publicRuntimeForConnections(state).providerId).toBe("mock");
  });
  it("reads settings saved before Meta Muse existed and refuses Meta contributor models", async () => {
    const filename = join(directory, "settings.json");
    const legacyModels: Record<string, string> = { ...settingsFromEnvironment(environment).models }; delete legacyModels.meta;
    await writeFile(filename, JSON.stringify({ version: 1, revision: crypto.randomUUID(), settings: { ...settingsFromEnvironment(environment), models: legacyModels } }), { mode: 0o600 });
    expect((await createAiSettingsStore(filename).read())?.settings.models.meta).toBe("");
    const metaEnvironment = { ...environment, AI_ENABLE_PAID_API: "true", META_API_KEY: "LLM_fixture-key", META_MODEL: "muse-spark-1.3" };
    const settings = settingsFromEnvironment(metaEnvironment); expect(settings.models.meta).toBe("muse-spark-1.3");
    expect(() => validateActiveConnections(metaEnvironment, { ...settings, primary: "meta" })).not.toThrow();
    expect(publicConnectionState(metaEnvironment, null).apiKeysConfigured.meta).toBe(true);
    expect(settingsFromEnvironment({ ...metaEnvironment, META_MODEL: "muse-spark-1.3-contributor" }).models.meta).toBe("");
    expect(() => validateActiveConnections(metaEnvironment, { ...settings, primary: "meta", models: { ...settings.models, meta: "muse-spark-1.3-contributor" } })).toThrow();
  });
  it("preserves the valid primary connection when auxiliary environment configuration is invalid", () => {
    const state = publicConnectionState({ ...environment, AI_COMPARE_PROVIDERS: "invalid" }, null);
    expect(publicRuntimeForConnections(state)).toMatchObject({ available: true, providerId: "mock", comparisonProviders: [] });
    const incomplete = publicConnectionState({ ...environment, AI_COMPARE_PROVIDERS: "mock,chatgpt,local" }, null);
    expect(publicRuntimeForConnections(incomplete)).toMatchObject({ available: true, providerId: "mock", comparisonProviders: [] });
  });
});
