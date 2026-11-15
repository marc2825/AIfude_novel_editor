import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DiagnosticIssue } from "../../domain/japanese-diagnostics";
import { isSearchCurrent, plainTextOffsetToPosition, type SearchSnapshot } from "../editor/search-replace";

const key = new PluginKey<DecorationSet>("diagnosticHighlights");
export const DiagnosticHighlights = Extension.create({
  name: "diagnosticHighlights",
  addProseMirrorPlugins: () => [new Plugin<DecorationSet>({
    key, state: { init: () => DecorationSet.empty, apply(transaction, current) {
      if (transaction.docChanged) return DecorationSet.empty;
      const value: unknown = transaction.getMeta(key);
      return value instanceof DecorationSet ? value : current;
    } }, props: { decorations: (state) => key.getState(state) },
  })],
});

export function showDiagnostics(editor: Editor, snapshot: SearchSnapshot, issues: readonly DiagnosticIssue[]): void {
  if (!isSearchCurrent(editor, snapshot)) return;
  const decorations = issues.map((issue) => Decoration.inline(
    plainTextOffsetToPosition(snapshot.document, issue.from), plainTextOffsetToPosition(snapshot.document, issue.to),
    { class: "diagnostic-highlight", title: `${issue.title}：${issue.evidence}` },
  ));
  editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.create(snapshot.document, decorations)).setMeta("addToHistory", false));
}

export function selectDiagnostic(editor: Editor, snapshot: SearchSnapshot, issue: Pick<DiagnosticIssue, "from" | "to">): boolean {
  if (!editor.isEditable || editor.view.composing || !isSearchCurrent(editor, snapshot)) return false;
  const from = plainTextOffsetToPosition(snapshot.document, issue.from);
  const to = plainTextOffsetToPosition(snapshot.document, issue.to);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).scrollIntoView());
  editor.view.focus();
  return true;
}
