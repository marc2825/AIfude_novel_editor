import { diffArrays } from "diff";

import type { DiffPart } from "./protocol";

const graphemeSegmenter = new Intl.Segmenter("ja", {
  granularity: "grapheme",
});

export function segmentGraphemes(text: string): readonly string[] {
  return Object.freeze(
    Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment),
  );
}

export function createGraphemeDiff(
  originalText: string,
  candidateText: string,
): readonly DiffPart[] {
  const changes = diffArrays(
    [...segmentGraphemes(originalText)],
    [...segmentGraphemes(candidateText)],
  );

  return Object.freeze(
    changes.map((change): DiffPart =>
      Object.freeze({
        kind: change.added ? "insert" : change.removed ? "delete" : "equal",
        text: change.value.join(""),
      }),
    ),
  );
}
