import { describe, expect, it } from "vitest";
import { dictionaryGenerationRequest, dictionaryQuerySchema, dictionaryRequestSchema, dictionarySearchUrl } from "../../src/domain/dictionary";
import { validateAiEditRequest } from "../../src/domain/ai-edit";
import { isRequiredPromptWithinBudget } from "../../src/features/ai-edit/prompt";

export const dictionaryFixture = { schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", query: "余韻", consent: null, modelId: null };

describe("dictionary contract", () => {
  it.each(["余韻", "a".repeat(100), "🙂".repeat(100), '"'.repeat(100), "\\".repeat(100)])("accepts bounded Unicode and creates a valid prompt-only request", (query) => {
    const dictionary = dictionaryRequestSchema.parse({ ...dictionaryFixture, query });
    const request = dictionaryGenerationRequest(dictionary);
    expect(validateAiEditRequest(request).success).toBe(true);
    expect(isRequiredPromptWithinBudget(request)).toBe(true);
    expect(request).toMatchObject({ operation: "insert", candidateCount: 1, selectionText: "", beforeText: "", afterText: "", globalContext: { commonPrompt: "", manualStyle: "" } });
    expect(request).not.toHaveProperty("storyMemory");
    expect(request.instruction).toContain(JSON.stringify({ query }));
  });

  it.each(["", " \n ", "語".repeat(101), "\ud800", "単\u0000語", "二\n行"])('rejects invalid queries', (query) => {
    expect(dictionaryQuerySchema.safeParse(query).success).toBe(false);
    expect(dictionarySearchUrl(query)).toBeNull();
  });

  it("rejects manuscript, memory and arbitrary instructions at the API boundary", () => {
    for (const extra of [{ beforeText: "原稿" }, { storyMemory: {} }, { instruction: "命令" }, { operation: "replace" }]) {
      expect(dictionaryRequestSchema.safeParse({ ...dictionaryFixture, ...extra }).success).toBe(false);
    }
  });

  it("normalizes only the lookup query and encodes search data into a fixed origin", () => {
    expect(dictionaryQuerySchema.parse("  余韻\r\n")).toBe("余韻");
    const query = '<script>&q=秘密 #?"';
    const href = dictionarySearchUrl(query);
    expect(href).not.toBeNull();
    const url = new URL(href ?? "");
    expect(url.origin + url.pathname).toBe("https://www.google.com/search");
    expect(url.searchParams.get("q")).toBe(`${query} 意味`);
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.hash).toBe("");
  });
});
