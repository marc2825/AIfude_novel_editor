import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { rubyAttributesSchema, manuscriptDocumentSchema } from "../../domain/typography";
import { documentToPlainText } from "./plain-text";
import { validateSelectionSnapshot, type SelectionCaptureContext, type SelectionSnapshot } from "./selection";

export function hasAnnotationsInRange(document: Node, from: number, to: number): boolean {
  let found = false;
  if (from === to) {
    const point = document.resolve(from);
    // At a boundary, a plain insertion cannot inherit an annotation. Inside it, the base would split.
    return point.parent.isTextblock && point.parentOffset > 0 && point.parentOffset < point.parent.content.size &&
      !!point.nodeBefore?.marks.some((mark) => point.nodeAfter?.marks.some((other) => mark.eq(other)));
  }
  document.nodesBetween(from, to, (node) => { if (node.isText && node.marks.length) found = true; });
  return found;
}
export function applyAnnotation(editor: Editor | null, snapshot: SelectionSnapshot, context: SelectionCaptureContext,
  kind: "ruby" | "emphasis" | "remove", reading = ""): { ok: boolean; message: string } {
  if (!editor || validateSelectionSnapshot(editor, snapshot, context).status !== "valid") return { ok: false, message: "本文・選択・設定が変わったか変換中です。対象を取り直してください。" };
  const from = editor.state.doc.resolve(snapshot.from), to = editor.state.doc.resolve(snapshot.to);
  const boundaries = new Set([0, from.parent.textContent.length, ...Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(from.parent.textContent), (segment) => segment.index)]);
  if (snapshot.from === snapshot.to || !from.sameParent(to) || !boundaries.has(from.parentOffset) || !boundaries.has(to.parentOffset)) return { ok: false, message: "同じ段落の文字を、文字の途中で切らずに選択してください。" };
  const ruby = rubyAttributesSchema.safeParse({ base: snapshot.originalText, reading });
  if (kind === "ruby" && !ruby.success) return { ok: false, message: "親文字と読みは改行を含まない1〜80文字にしてください。" };
  const transaction = closeHistory(editor.state.tr).removeMark(snapshot.from, snapshot.to);
  if (kind === "ruby" && ruby.success) transaction.addMark(snapshot.from, snapshot.to, editor.schema.marks.ruby.create(ruby.data));
  if (kind === "emphasis") transaction.addMark(snapshot.from, snapshot.to, editor.schema.marks.emphasis.create());
  if (documentToPlainText(transaction.doc) !== documentToPlainText(editor.state.doc) || !manuscriptDocumentSchema.safeParse(transaction.doc.toJSON()).success) return { ok: false, message: "注釈を安全に適用できませんでした。" };
  if (transaction.doc.eq(editor.state.doc)) return { ok: false, message: "注釈の変更はありません。" };
  editor.view.dispatch(transaction); editor.view.dispatch(closeHistory(editor.state.tr));
  return { ok: true, message: "注釈を適用しました。1回のUndoで戻せます。" };
}
