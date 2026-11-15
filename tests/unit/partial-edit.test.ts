import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { composePartialEdit, createPartialEditPlan, partialEditSentences } from "../../src/domain/partial-edit";

describe("partial candidate composition", () => {
  it("selects independent clauses without changing unselected text or graphemes", () => {
    const before = "空は青い。風は弱い。👨‍👩‍👧‍👦";
    const after = "空は赤い。風は強い。👨‍👩‍👧‍👦";
    expect(createPartialEditPlan(before, after).reason).toBeNull();
    expect(partialEditSentences(before, createPartialEditPlan(before, after)).map((sentence) => sentence.ids)).toEqual([[0], [1]]);
    expect(composePartialEdit(before, after, [0])).toBe("空は赤い。風は弱い。👨‍👩‍👧‍👦");
    expect(composePartialEdit(before, after, [1])).toBe("空は青い。風は強い。👨‍👩‍👧‍👦");
    expect(composePartialEdit(before, after, [])).toBe(before);
    expect(composePartialEdit(before, after, [0, 1])).toBe(after);
  });
  it("refuses ambiguous positions, malformed indices and excessive work", () => {
    expect(createPartialEditPlan("ああ", "あ").reason).toBe("ambiguous");
    for (const ids of [[-1], [0.5], [3], [0, 0]]) expect(composePartialEdit("青", "赤", ids)).toBeNull();
    expect(createPartialEditPlan("a".repeat(6001), "b").reason).toBe("too-complex");
    expect(createPartialEditPlan("\ud800", "a").reason).toBe("too-complex");
  });
  it("reconstructs both endpoints for every accepted plan", () => {
    const text = fc.array(fc.constantFrom("雨", "空", "。", "\n", "が", "🙂", "👨‍👩‍👧‍👦"), { maxLength: 25 }).map((letters) => letters.join(""));
    fc.assert(fc.property(text, text, (before, after) => {
      const plan = createPartialEditPlan(before, after);
      if (plan.reason) return;
      expect(composePartialEdit(before, after, [])).toBe(before);
      expect(composePartialEdit(before, after, plan.hunks.map((_, index) => index))).toBe(after);
      for (const hunk of plan.hunks) expect(before.slice(hunk.from, hunk.to)).toBe(hunk.original);
    }), { numRuns: 200 });
  });
});
