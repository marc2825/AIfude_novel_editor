import fc from "fast-check";
import { redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it } from "vitest";

import { getEditGuardState } from "../../src/features/editor/plugins/edit-guard";
import { plainTextToSlice } from "../../src/features/editor/plain-text";
import {
  replaceCapturedSelection,
  validateExactReplacementTransaction,
} from "../../src/features/editor/replace-selection";
import {
  captureSelection,
  plainTextOffsetToProseMirrorPosition,
  type SelectionCaptureContext,
  type SelectionSnapshot,
} from "../../src/features/editor/selection";
import {
  createTestEditor,
  dispatchComposition,
  setTextSelection,
} from "../helpers/editor";

const context: SelectionCaptureContext = {
  chapterId: "chapter",
  commonPrompt: "余韻を保つ",
  contextRevision: 4,
  documentId: "document",
  editable: true,
  manualStyle: "静かな文体",
  projectId: "project",
};

const activeEditors: ReturnType<typeof createTestEditor>[] = [];

function testEditor(initialText: string, initialContentRevision = 0) {
  const editor = createTestEditor(initialText, initialContentRevision);
  activeEditors.push(editor);
  return editor;
}

function capturePlainTextRange(
  initialText: string,
  plainTextFrom: number,
  plainTextTo: number,
  initialContentRevision = 0,
) {
  const session = testEditor(initialText, initialContentRevision);
  const from = plainTextOffsetToProseMirrorPosition(
    session.editor.state.doc,
    plainTextFrom,
  );
  const to = plainTextOffsetToProseMirrorPosition(
    session.editor.state.doc,
    plainTextTo,
  );

  if (from === null || to === null) {
    throw new Error("test range did not map to ProseMirror positions");
  }

  setTextSelection(session.editor, from, to);
  const capture = captureSelection(session.editor, context);

  if (capture.status !== "captured") {
    throw new Error(`selection was not captured: ${capture.reason}`);
  }

  return { ...session, snapshot: capture.snapshot };
}

function captureParts(
  beforeText: string,
  originalText: string,
  afterText: string,
  initialContentRevision = 0,
) {
  return capturePlainTextRange(
    beforeText + originalText + afterText,
    beforeText.length,
    beforeText.length + originalText.length,
    initialContentRevision,
  );
}

function expectFailedAttemptIsAtomic(
  session: ReturnType<typeof capturePlainTextRange>,
  result: ReturnType<typeof replaceCapturedSelection>,
  before: Readonly<{
    document: unknown;
    redoDepth: number;
    selection: SelectionSnapshot["originalSelection"];
    undoDepth: number;
  }>,
) {
  expect(result.status).not.toBe("applied");
  expect(session.editor.state.doc.toJSON()).toEqual(before.document);
  expect(session.editor.state.selection.eq(before.selection)).toBe(true);
  expect(undoDepth(session.editor.state)).toBe(before.undoDepth);
  expect(redoDepth(session.editor.state)).toBe(before.redoDepth);
}

afterEach(() => {
  for (const editor of activeEditors.splice(0)) {
    editor.destroy();
  }
});

describe("safe exact-range replacement", () => {
  it.each([
    {
      after: "後",
      before: "前",
      label: "same paragraph",
      original: "対象",
      replacement: "置換",
      normalizedReplacement: "置換",
    },
    {
      after: "後続",
      before: "",
      label: "document beginning",
      original: "冒頭",
      replacement: "先頭",
      normalizedReplacement: "先頭",
    },
    {
      after: "",
      before: "",
      label: "the complete visible manuscript",
      original: "第一\n\n末尾",
      replacement: "\n新本文\n",
      normalizedReplacement: "\n新本文\n",
    },
    {
      after: "\n後段",
      before: "前段\n",
      label: "paragraph content boundaries",
      original: "対象",
      replacement: "境界",
      normalizedReplacement: "境界",
    },
    {
      after: "後段",
      before: "前段",
      label: "selection across empty paragraphs",
      original: "甲\n\n乙",
      replacement: "一\n二\n三",
      normalizedReplacement: "一\n二\n三",
    },
    {
      after: "  後",
      before: "前  ",
      label: "Japanese emoji and significant spaces",
      original: "旧🙂",
      replacement: "  日本語🙂　 ",
      normalizedReplacement: "  日本語🙂　 ",
    },
    {
      after: "後",
      before: "前",
      label: "combining characters without Unicode normalization",
      original: "旧",
      replacement: "がé",
      normalizedReplacement: "がé",
    },
    {
      after: "後",
      before: "前",
      label: "HTML-like text as literal plain text",
      original: "旧",
      replacement: "<strong>本文</strong>",
      normalizedReplacement: "<strong>本文</strong>",
    },
    {
      after: "後",
      before: "前",
      label: "leading, repeated, and trailing LF",
      original: "旧\n段落",
      replacement: "\n先頭\n\n末尾\n",
      normalizedReplacement: "\n先頭\n\n末尾\n",
    },
    {
      after: "後",
      before: "前",
      label: "CRLF and CR normalization",
      original: "旧",
      replacement: "新\r\n\r末",
      normalizedReplacement: "新\n\n末",
    },
  ])(
    "replaces $label without changing either outside segment",
    ({
      after,
      before,
      original,
      replacement,
      normalizedReplacement,
    }) => {
      const session = captureParts(before, original, after);

      const result = replaceCapturedSelection(
        session.editor,
        session.snapshot,
        replacement,
        context,
      );

      expect(result.status).toBe("applied");
      expect(session.getPlainText()).toBe(
        before + normalizedReplacement + after,
      );
      expect(session.getPlainText().slice(0, before.length)).toBe(before);
      expect(
        session
          .getPlainText()
          .slice(before.length + normalizedReplacement.length),
      ).toBe(after);
      session.editor.state.doc.check();
      session.editor.state.doc.descendants((node) => {
        expect(["doc", "paragraph", "text"]).toContain(node.type.name);
      });
    },
  );

  it("uses one document-changing transaction, advances one revision, and puts the caret at the mapped insertion end", () => {
    const session = captureParts("前", "対象\n二段", "後", 9);
    const revisionBefore = getEditGuardState(
      session.editor.state,
    )?.contentRevision;
    const transactions: boolean[] = [];
    session.editor.on("transaction", ({ transaction }) => {
      transactions.push(transaction.docChanged);
    });

    const result = replaceCapturedSelection(
      session.editor,
      session.snapshot,
      "新🙂\n\n末",
      context,
    );

    expect(result).toMatchObject({ status: "applied" });
    expect(transactions).toEqual([true, false]);
    expect(getEditGuardState(session.editor.state)?.contentRevision).toBe(
      revisionBefore === undefined ? undefined : revisionBefore + 1,
    );
    expect(session.editor.state.selection.empty).toBe(true);
    expect(session.editor.state.selection.from).toBe(
      result.status === "applied" ? result.to : -1,
    );
    expect(
      plainTextOffsetToProseMirrorPosition(
        session.editor.state.doc,
        session.snapshot.beforeText.length + "新🙂\n\n末".length,
      ),
    ).toBe(session.editor.state.selection.from);
  });

  it.each([
    ["empty", "", "empty"],
    ["ASCII whitespace", " \t\n", "whitespace-only"],
    ["full-width whitespace", "　\n　", "whitespace-only"],
    ["unpaired high surrogate", "\ud83d", "invalid-unicode"],
    ["unpaired low surrogate", "\udc00", "invalid-unicode"],
    ["documented length limit", "長".repeat(131), "too-long"],
  ])("rejects %s atomically", (_label, replacement, reason) => {
    const session = captureParts("前", "対", "後");
    const before = {
      document: session.editor.state.doc.toJSON(),
      redoDepth: redoDepth(session.editor.state),
      selection: session.editor.state.selection,
      undoDepth: undoDepth(session.editor.state),
    };
    let transactionCount = 0;
    session.editor.on("transaction", () => {
      transactionCount += 1;
    });

    const result = replaceCapturedSelection(
      session.editor,
      session.snapshot,
      replacement,
      context,
    );

    expect(result).toEqual({ reason, status: "invalid-replacement" });
    expectFailedAttemptIsAtomic(session, result, before);
    expect(transactionCount).toBe(0);
  });

  it("treats a normalized identical replacement as a no-op", () => {
    const session = captureParts("前", "対象\n次", "後");
    const before = {
      document: session.editor.state.doc.toJSON(),
      redoDepth: redoDepth(session.editor.state),
      selection: session.editor.state.selection,
      undoDepth: undoDepth(session.editor.state),
    };
    let transactionCount = 0;
    session.editor.on("transaction", () => {
      transactionCount += 1;
    });

    const result = replaceCapturedSelection(
      session.editor,
      session.snapshot,
      "対象\r\n次",
      context,
    );

    expect(result).toEqual({ status: "no-change" });
    expectFailedAttemptIsAtomic(session, result, before);
    expect(transactionCount).toBe(0);
  });

  it("rejects a misconstructed replacement transaction before dispatch", () => {
    const session = captureParts("前", "対象", "後");
    const originalDocument = session.editor.state.doc.toJSON();
    const incorrectTransaction = session.editor.state.tr.replace(
      session.snapshot.from,
      session.snapshot.to,
      plainTextToSlice(session.editor.state.schema, "誤ったSlice"),
    );

    expect(
      validateExactReplacementTransaction(
        incorrectTransaction,
        session.snapshot,
        "意図した候補",
      ),
    ).toBeNull();
    expect(session.editor.state.doc.toJSON()).toEqual(originalDocument);
    expect(undoDepth(session.editor.state)).toBe(0);
  });

  it("makes a successfully consumed snapshot stale on a second attempt", () => {
    const session = captureParts("前", "対象", "後");

    expect(
      replaceCapturedSelection(
        session.editor,
        session.snapshot,
        "一回目",
        context,
      ),
    ).toMatchObject({ status: "applied" });
    const documentAfterFirstApply = session.editor.state.doc.toJSON();
    let documentTransactions = 0;
    session.editor.on("transaction", ({ transaction }) => {
      documentTransactions += Number(transaction.docChanged);
    });

    expect(
      replaceCapturedSelection(
        session.editor,
        session.snapshot,
        "二回目",
        context,
      ),
    ).toEqual({ reason: "document-changed", status: "stale" });
    expect(session.editor.state.doc.toJSON()).toEqual(documentAfterFirstApply);
    expect(documentTransactions).toBe(0);
  });
});

describe("replacement stale and availability guards", () => {
  it.each([
    ["inside", 2],
    ["before", 1],
    ["after", 5],
  ])("rejects an edit %s the captured target", (_label, position) => {
    const session = captureParts("前", "対象", "後");
    session.editor.view.dispatch(
      session.editor.state.tr.insertText("追", position),
    );
    const documentBeforeAttempt = session.editor.state.doc.toJSON();
    let documentTransactions = 0;
    session.editor.on("transaction", ({ transaction }) => {
      documentTransactions += Number(transaction.docChanged);
    });

    const result = replaceCapturedSelection(
      session.editor,
      session.snapshot,
      "置換",
      context,
    );

    expect(result).toEqual({ reason: "document-changed", status: "stale" });
    expect(session.editor.state.doc.toJSON()).toEqual(documentBeforeAttempt);
    expect(documentTransactions).toBe(0);
  });

  it("rejects selection movement and edit-then-Undo", () => {
    const moved = captureParts("前", "対象", "後");
    setTextSelection(moved.editor, 1);
    expect(
      replaceCapturedSelection(
        moved.editor,
        moved.snapshot,
        "置換",
        context,
      ),
    ).toEqual({ reason: "selection-changed", status: "stale" });

    const undone = captureParts("前", "対象", "後");
    undone.editor.view.dispatch(undone.editor.state.tr.insertText("追", 2));
    expect(undo(undone.editor.state, undone.editor.view.dispatch)).toBe(true);
    expect(undone.getPlainText()).toBe("前対象後");
    expect(
      replaceCapturedSelection(
        undone.editor,
        undone.snapshot,
        "置換",
        context,
      ),
    ).toEqual({ reason: "document-changed", status: "stale" });
  });

  it("rejects context, workspace identity, and read-only changes", () => {
    const changedContext = captureParts("前", "対象", "後");
    expect(
      replaceCapturedSelection(
        changedContext.editor,
        changedContext.snapshot,
        "置換",
        { ...context, contextRevision: context.contextRevision + 1 },
      ),
    ).toEqual({ reason: "context-changed", status: "stale" });

    const changedWorkspace = captureParts("前", "対象", "後");
    expect(
      replaceCapturedSelection(
        changedWorkspace.editor,
        changedWorkspace.snapshot,
        "置換",
        { ...context, projectId: "other-project" },
      ),
    ).toEqual({ reason: "workspace-changed", status: "stale" });

    const readOnly = captureParts("前", "対象", "後");
    readOnly.editor.setEditable(false);
    expect(
      replaceCapturedSelection(
        readOnly.editor,
        readOnly.snapshot,
        "置換",
        context,
      ),
    ).toEqual({ reason: "editor-read-only", status: "stale" });
    expect(readOnly.getPlainText()).toBe("前対象後");
  });

  it("rejects replacement during active IME composition", () => {
    const session = captureParts("前", "対象", "後");
    dispatchComposition(session.editor.view.dom, "compositionstart", "へ");

    expect(
      replaceCapturedSelection(
        session.editor,
        session.snapshot,
        "変更",
        context,
      ),
    ).toEqual({ reason: "editor-composing", status: "unavailable" });
    expect(session.getPlainText()).toBe("前対象後");

    dispatchComposition(session.editor.view.dom, "compositionend", "変更");
  });
});

describe("property-based exact replacement", () => {
  const plainTextPart = fc
    .array(fc.constantFrom("a", "日", "🙂", "é", " ", "　", "\n"), {
      maxLength: 8,
    })
    .map((parts) => parts.join(""));
  const selectedText = fc
    .tuple(plainTextPart, plainTextPart)
    .map(([before, after]) => `${before}対${after}`);
  const replacementText = fc
    .tuple(plainTextPart, plainTextPart)
    .map(([before, after]) => `${before}替${after}`);

  it("preserves the exact canonical equation and PM Undo/Redo", () => {
    fc.assert(
      fc.property(
        plainTextPart,
        selectedText,
        plainTextPart,
        replacementText,
        (before, original, after, replacement) => {
          const session = captureParts(before, original, after);
          const initialText = before + original + after;
          const expectedText = before + replacement + after;

          const result = replaceCapturedSelection(
            session.editor,
            session.snapshot,
            replacement,
            context,
          );

          expect(result.status).toBe("applied");
          expect(session.getPlainText()).toBe(expectedText);
          session.editor.state.doc.check();

          expect(undo(session.editor.state, session.editor.view.dispatch)).toBe(
            true,
          );
          expect(session.getPlainText()).toBe(initialText);
          expect(redo(session.editor.state, session.editor.view.dispatch)).toBe(
            true,
          );
          expect(session.getPlainText()).toBe(expectedText);
        },
      ),
      { numRuns: 100 },
    );
  });
});
