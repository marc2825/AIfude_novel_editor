import { describe, expect, it } from "vitest";

import {
  createGraphemeDiff,
  segmentGraphemes,
} from "../../src/features/ai-edit/diff/diff";
import {
  parseDiffWorkerRequest,
  parseDiffWorkerResponse,
  type DiffPart,
} from "../../src/features/ai-edit/diff/protocol";

function reconstructOriginal(parts: readonly DiffPart[]): string {
  return parts
    .filter((part) => part.kind !== "insert")
    .map((part) => part.text)
    .join("");
}

function reconstructCandidate(parts: readonly DiffPart[]): string {
  return parts
    .filter((part) => part.kind !== "delete")
    .map((part) => part.text)
    .join("");
}

function expectReconstruction(original: string, candidate: string): void {
  const parts = createGraphemeDiff(original, candidate);

  expect(reconstructOriginal(parts)).toBe(original);
  expect(reconstructCandidate(parts)).toBe(candidate);
}

describe("grapheme diff", () => {
  it.each([
    ["同じ本文", "同じ本文"],
    ["春の風", "春の強い風"],
    ["春の強い風", "春の風"],
    ["日本語", "日本人"],
    ["甲乙甲乙", "甲丙甲丁"],
    ["本文", "先頭本文"],
    ["本文", "本文末尾"],
    ["先頭本文", "本文"],
    ["本文末尾", "本文"],
    ["前🙂後", "前👩🏽‍💻後"],
    ["か\u3099", "が"],
    ["空 白", "空　白"],
    ["一行\n二行", "一行\n\n　二行\n"],
    ["\n先頭\n末尾\n", "先頭\n\n末尾"],
  ])("reconstructs the exact original and candidate for %j → %j", (original, candidate) => {
    expectReconstruction(original, candidate);
  });

  it("returns one equal part for identical non-empty text", () => {
    expect(createGraphemeDiff("同じ🙂", "同じ🙂")).toEqual([
      { kind: "equal", text: "同じ🙂" },
    ]);
  });

  it("returns no fake changes for two empty strings", () => {
    expect(createGraphemeDiff("", "")).toEqual([]);
  });

  it("uses stable deletion-first tie-breaking for ambiguous minimal diffs", () => {
    const expected = [
      { kind: "delete", text: "A" },
      { kind: "equal", text: "BA" },
      { kind: "insert", text: "B" },
    ];

    expect(createGraphemeDiff("ABA", "BAB")).toEqual(expected);
    expect(createGraphemeDiff("ABA", "BAB")).toEqual(expected);
  });

  it("keeps user-perceived characters in single grapheme tokens", () => {
    expect(segmentGraphemes("日🙂✈️か\u3099𝄞👨‍👩‍👧‍👦")).toEqual([
      "日",
      "🙂",
      "✈️",
      "か\u3099",
      "𝄞",
      "👨‍👩‍👧‍👦",
    ]);
  });

  it("preserves spaces, full-width spaces, blank lines, and edge newlines", () => {
    const original = "  原文　\n\n末尾\n";
    const candidate = "　原文  \n空行\n\n末尾";
    const parts = createGraphemeDiff(original, candidate);

    expectReconstruction(original, candidate);
    expect(parts.some((part) => part.kind === "delete" && /\s/u.test(part.text))).toBe(
      true,
    );
    expect(parts.some((part) => part.kind === "insert" && /\s/u.test(part.text))).toBe(
      true,
    );
  });

  it("returns deeply immutable presentation parts", () => {
    const parts = createGraphemeDiff("旧", "新");

    expect(Object.isFrozen(parts)).toBe(true);
    expect(parts.every(Object.isFrozen)).toBe(true);
  });

  it("handles the documented practical selection and replacement bounds", () => {
    const original = "あ".repeat(2_000);
    const candidate = `${"あ".repeat(1_999)}い${"う".repeat(1_000)}`;

    expectReconstruction(original, candidate);
  });
});

describe("diff worker protocol", () => {
  it("validates requests without changing their text", () => {
    const parsed = parseDiffWorkerRequest({
      candidateId: "candidate",
      candidateText: "\n候補  ",
      originalText: "　原文\n",
      requestId: "request",
      type: "compute",
    });

    expect(parsed).toEqual({
      candidateId: "candidate",
      candidateText: "\n候補  ",
      originalText: "　原文\n",
      requestId: "request",
      type: "compute",
    });
  });

  it("rejects responses for another request or candidate", () => {
    const response = {
      candidateId: "old-candidate",
      parts: [{ kind: "insert", text: "old" }],
      requestId: "old-request",
      type: "result",
    };

    expect(
      parseDiffWorkerResponse(response, "new-request", "old-candidate"),
    ).toBeNull();
    expect(
      parseDiffWorkerResponse(response, "old-request", "new-candidate"),
    ).toBeNull();
  });

  it("copies and freezes a correlated worker response", () => {
    const response = parseDiffWorkerResponse(
      {
        candidateId: "candidate",
        parts: [
          { kind: "delete", text: "旧" },
          { kind: "insert", text: "新" },
        ],
        requestId: "request",
        type: "result",
      },
      "request",
      "candidate",
    );

    expect(response).toMatchObject({ type: "result" });
    expect(response === null || response.type !== "result").toBe(false);
    if (response !== null && response.type === "result") {
      expect(Object.isFrozen(response)).toBe(true);
      expect(Object.isFrozen(response.parts)).toBe(true);
      expect(response.parts.every(Object.isFrozen)).toBe(true);
    }
  });
});
