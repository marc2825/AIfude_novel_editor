import { hasAnnotationsInRange } from "./annotations";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { documentToPlainText, normalizeLineEndings, plainTextToSlice } from "./plain-text";
import { getEditGuardState } from "./plugins/edit-guard";

export type SearchMatch = Readonly<{ from: number; to: number }>;
export type SearchSnapshot = Readonly<{ document: Node; revision: number; instanceId: string; query: string; matches: readonly SearchMatch[] }>;
function assertText(value: string, maximum: number): void {
  if (Array.from(value).length > maximum || !value.isWellFormed()) throw new Error("検索は500文字、置換は3,000文字以内の文字列にしてください。");
}
export function plainTextOffsetToPosition(document: Node, offset: number): number {
  let textOffset = 0; let nodeOffset = 0; let position: number | null = null;
  document.forEach((paragraph) => {
    if (position === null && offset >= textOffset && offset <= textOffset + paragraph.textContent.length) position = nodeOffset + 1 + offset - textOffset;
    textOffset += paragraph.textContent.length + 1; nodeOffset += paragraph.nodeSize;
  });
  if (position === null) throw new Error("検索範囲が不正です。");
  return position;
}
export function findSearchMatches(document: Node, query: string, caseSensitive: boolean): SearchMatch[] {
  assertText(query, 500);
  query = normalizeLineEndings(query);
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "gu" : "giu");
  const text = documentToPlainText(document);
  const matches: SearchMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (matches.length >= 10_000) throw new Error("一致が10,000件を超えました。検索語を絞ってください。");
    matches.push({ from: plainTextOffsetToPosition(document, match.index), to: plainTextOffsetToPosition(document, match.index + match[0].length) });
  }
  return matches;
}
export function captureSearch(editor: Editor, query: string, caseSensitive: boolean): SearchSnapshot {
  const guard = getEditGuardState(editor.state);
  if (!guard) throw new Error("エディタを利用できません。");
  return { document: editor.state.doc, instanceId: guard.editorInstanceId, revision: guard.contentRevision, query, matches: findSearchMatches(editor.state.doc, query, caseSensitive) };
}
export function isSearchCurrent(editor: Editor, search: SearchSnapshot): boolean {
  const guard = getEditGuardState(editor.state);
  return !editor.isDestroyed && guard?.editorInstanceId === search.instanceId && guard.contentRevision === search.revision && editor.state.doc.eq(search.document);
}
export function applySearchReplacement(editor: Editor, search: SearchSnapshot, replacement: string, index: number | "all"): boolean {
  assertText(replacement, 3_000);
  if (!editor.isEditable || editor.view.composing || !isSearchCurrent(editor, search)) return false;
  const matches = index === "all" ? search.matches : search.matches.slice(index, index + 1);
  if (matches.length === 0) return false;
  if (matches.some((match) => hasAnnotationsInRange(editor.state.doc, match.from, match.to))) throw new Error("置換範囲にルビ・傍点があります。注釈を確認して解除してから置換してください。");
  const transaction = closeHistory(editor.state.tr);
  for (const match of [...matches].reverse()) transaction.replace(match.from, match.to, plainTextToSlice(editor.schema, replacement));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}
