import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { analyzeJapanese, diagnosticAnalysisSchema, DIAGNOSTIC_TEXT_LIMIT } from "../../src/domain/japanese-diagnostics";
import { uniqueQuoteRange } from "../../src/domain/feedback";

describe("Japanese diagnostic observations", () => {
  it("reports endings, words, connectors and redundancy as check candidates", () => {
    const text = "しかし、東京へ行った。しかし、東京で待った。東京を見た。一番最初に会った。";
    const result = analyzeJapanese(text);
    expect(result.issues.map((issue) => issue.rule)).toEqual(expect.arrayContaining(["ending", "repetition", "connector", "redundancy"]));
    expect(result.issues.find((issue) => issue.rule === "repetition")?.key).toBe("東京");
    expect(result.stats.sentences).toBe(4);
    expect(text).toBe("しかし、東京へ行った。しかし、東京で待った。東京を見た。一番最初に会った。");
  });
  it("does not split repeated substrings inside words or label two repetitions excessive", () => {
    expect(analyzeJapanese("東京で会い、東京へ戻る。").issues.filter((issue) => issue.rule === "repetition")).toHaveLength(0);
    expect(analyzeJapanese("京都。東京都。東京都庁。").issues.filter((issue) => issue.rule === "repetition" && issue.key === "京都")).toHaveLength(0);
  });
  it("records rhythm, dialogue ratio and script proportions without judging style", () => {
    const result = analyzeJapanese("「はい。」\n" + "長い文".repeat(30) + "。");
    expect(result.stats.longSentences).toBe(1); expect(result.stats.shortSentences).toBeGreaterThan(0);
    expect(result.stats.dialogueRatio).toBeGreaterThan(0); expect(result.stats.kanjiRatio).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.rule === "length")).toBe(true);
  });
  it("checks bracket nesting, punctuation and tokenized particle repetition", () => {
    const result = analyzeJapanese("「朝『夜」、、\n私の友の母の家の庭の花。");
    expect(result.issues.map((issue) => issue.rule)).toEqual(expect.arrayContaining(["bracket", "punctuation", "particle"]));
    expect(analyzeJapanese("「朝『夜』」（完）").issues.filter((issue) => issue.rule === "bracket")).toHaveLength(0);
  });
  it("keeps emoji and newline offsets exact and within UTF-16 boundaries", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom("🙂", "が", "。", "「", "」", "東京", "\n", "一番最初"), { maxLength: 100 }), (parts) => {
      const text = parts.join(""); const result = analyzeJapanese(text);
      expect(diagnosticAnalysisSchema.safeParse(result).success).toBe(true);
      for (const issue of result.issues) {
        expect(issue.from).toBeGreaterThanOrEqual(0); expect(issue.to).toBeLessThanOrEqual(text.length);
        expect(text.slice(issue.from, issue.to).isWellFormed()).toBe(true);
      }
    }), { numRuns: 100 });
  });
  it("bounds huge input and results without dropping full-chapter statistics", () => {
    expect(() => analyzeJapanese("あ".repeat(DIAGNOSTIC_TEXT_LIMIT + 1))).toThrow();
    expect(() => analyzeJapanese("\ud800")).toThrow();
    const text = "朝だった。".repeat(20_000);
    const result = analyzeJapanese(text);
    expect(result.truncated).toBe(true); expect(result.issues.length).toBe(1_000);
    expect(result.stats.characters).toBe(text.length); expect(result.stats.sentences).toBe(20_000);
  });
  it("anchors only unique quotes in the unchanged source", () => {
    expect(uniqueQuoteRange("🙂前\n対象\n後", "対象")).toEqual({ from: 4, to: 6 });
    expect(uniqueQuoteRange("対象と対象", "対象")).toBeNull();
    expect(uniqueQuoteRange("原稿", "捏造")).toBeNull(); expect(uniqueQuoteRange("原稿", "")).toBeNull();
  });
});
