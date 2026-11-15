import { diffArrays } from "diff";

export type PartialEditHunk = Readonly<{ from: number; to: number; original: string; replacement: string }>;
export type PartialEditPlan = Readonly<{ hunks: readonly PartialEditHunk[]; reason: null | "ambiguous" | "too-complex" | "no-change" }>;
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const segments = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);
function hunks(original: string[], replacement: string[]): PartialEditHunk[] | null {
  const changes = diffArrays(original, replacement, { timeout: 30, maxEditLength: 4_000 });
  if (!changes) return null;
  const result: PartialEditHunk[] = [];
  let offset = 0, pending: { from: number; to: number; original: string; replacement: string } | null = null;
  for (const change of changes) {
    const text = change.value.join("");
    if (!change.added && !change.removed) {
      if (pending) { result.push(pending); pending = null; }
      offset += text.length; continue;
    }
    pending ??= { from: offset, to: offset, original: "", replacement: "" };
    if (change.removed) { pending.original += text; offset += text.length; pending.to = offset; }
    if (change.added) pending.replacement += text;
  }
  if (pending) result.push(pending);
  return result;
}
export function createPartialEditPlan(original: string, replacement: string): PartialEditPlan {
  if (!original.isWellFormed() || !replacement.isWellFormed() || original.length > 6_000 || replacement.length > 6_000) return { hunks: [], reason: "too-complex" };
  const before = segments(original), after = segments(replacement);
  const forward = hunks(before, after);
  if (!forward || forward.length > 64) return { hunks: [], reason: "too-complex" };
  if (!forward.length) return { hunks: [], reason: "no-change" };
  const backward = hunks([...before].reverse(), [...after].reverse());
  if (!backward) return { hunks: [], reason: "too-complex" };
  const reversed = backward.reverse().map((hunk) => ({ from: original.length - hunk.to, to: original.length - hunk.from,
    original: segments(hunk.original).reverse().join(""), replacement: segments(hunk.replacement).reverse().join("") }));
  if (JSON.stringify(forward) !== JSON.stringify(reversed)) return { hunks: [], reason: "ambiguous" };
  return { hunks: forward, reason: null };
}
/** Recomputes from the immutable full candidate; never accepts client coordinates or patches. */
export function composePartialEdit(original: string, replacement: string, selected: readonly number[]): string | null {
  const plan = createPartialEditPlan(original, replacement);
  if (plan.reason || new Set(selected).size !== selected.length || selected.some((id) => !Number.isInteger(id) || id < 0 || id >= plan.hunks.length)) return null;
  let result = "", offset = 0;
  for (const [index, hunk] of plan.hunks.entries()) {
    result += original.slice(offset, hunk.from) + (selected.includes(index) ? hunk.replacement : hunk.original);
    offset = hunk.to;
  }
  return result + original.slice(offset);
}

/** Sentence buttons only select existing verified hunks; they never create new coordinates. */
export function partialEditSentences(original: string, plan: PartialEditPlan): readonly { text: string; ids: number[] }[] {
  if (plan.reason) return [];
  const sentences = Array.from(new Intl.Segmenter("ja", { granularity: "sentence" }).segment(original));
  return sentences.map((sentence, index) => ({ text: sentence.segment, ids: plan.hunks.flatMap((hunk, id) => {
    const end = sentence.index + sentence.segment.length;
    return hunk.from < end && hunk.to > sentence.index ||
      (hunk.from === hunk.to && hunk.from >= sentence.index && (hunk.from < end || index === sentences.length - 1)) ? [id] : [];
  }) })).filter((sentence) => sentence.ids.length > 0);
}
