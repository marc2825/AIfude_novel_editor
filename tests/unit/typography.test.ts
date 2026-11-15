import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { annotationProblems, manuscriptDocumentSchema, manuscriptPlainText, parsePublicationText, publicationText, japaneseInputSuggestion, type ManuscriptDocument } from "../../src/domain/typography";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { createJsonWorkspaceDownload, parseWorkspaceBackup } from "../../src/features/workspace/backup";

export const annotatedBody: ManuscriptDocument = { type: "doc", content: [{ type: "paragraph", content: [
  { type: "text", text: "前" }, { type: "text", text: "葵", marks: [{ type: "ruby", attrs: { reading: "あおい", base: "葵" } }] },
  { type: "text", text: "後" }, { type: "text", text: "重要", marks: [{ type: "emphasis" }] },
] }, { type: "paragraph" }] };
describe("Japanese structured typography", () => {
  it("preserves exact parent text, ruby and blank paragraphs through JSON and supported publication round trips", () => {
    expect(manuscriptPlainText(annotatedBody)).toBe("前葵後重要\n");
    const published = publicationText(annotatedBody, "kakuyomu"); expect(published).toBe("前｜葵《あおい》後《《重要》》\n");
    expect(parsePublicationText(published, "kakuyomu")).toEqual(annotatedBody);
    const workspace = createWorkspaceFixture({ body: annotatedBody }); const download = createJsonWorkspaceDownload(workspace);
    expect(parseWorkspaceBackup(download.contents, new TextEncoder().encode(download.contents).length)).toEqual(workspace);
  });
  it("does not reinterpret markup-like original text or silently export ambiguous notation", () => {
    const body = manuscriptDocumentSchema.parse({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "｜葵《あおい》" }] }] });
    expect(manuscriptPlainText(body)).toBe("｜葵《あおい》"); expect(() => publicationText(body, "kakuyomu")).toThrow("衝突");
    expect(() => parsePublicationText("《壊れた記法", "kakuyomu")).toThrow();
  });
  it("keeps a stale ruby reading but rejects publication until its base is reconfirmed", () => {
    const body = structuredClone(annotatedBody); const paragraph = body.content[0]; if (!("content" in paragraph)) throw new Error("paragraph"); paragraph.content[1].text = "凪";
    expect(manuscriptDocumentSchema.safeParse(body).success).toBe(true); expect(annotationProblems(body)[0]).toContain("あおい");
    expect(() => publicationText(body, "kakuyomu")).toThrow("付け直し");
  });
  it("refuses unsupported marks, overlapping annotations and unsafe reading attributes", () => {
    for (const marks of [[{ type: "bold" }], [{ type: "emphasis" }, { type: "ruby", attrs: { base: "葵", reading: "あおい" } }], [{ type: "ruby", attrs: { base: "葵", reading: "a\nb" } }]]) {
      expect(manuscriptDocumentSchema.safeParse({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "葵", marks }] }] }).success).toBe(false);
    }
  });
  it("migrates V5 non-destructively and refuses annotated data masquerading as an old format", () => {
    const old = { ...createWorkspaceFixture(), schemaVersion: 5 }; const before = JSON.stringify(old);
    expect(parseWorkspaceSnapshot(old).schemaVersion).toBe(6); expect(JSON.stringify(old)).toBe(before);
    expect(() => parseWorkspaceSnapshot({ ...old, chapter: { ...old.chapter, body: annotatedBody } })).toThrow();
    expect(() => parseWorkspaceSnapshot({ ...old, schemaVersion: 7 })).toThrow();
  });
  it("checks platform-specific bounds and refuses unsupported Narou emphasis", () => {
    expect(() => publicationText(annotatedBody, "narou")).toThrow("傍点");
    const body: ManuscriptDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "字".repeat(11), marks: [{ type: "ruby", attrs: { base: "字".repeat(11), reading: "じ" } }] }] }] };
    expect(() => publicationText(body, "narou")).toThrow("10文字"); expect(publicationText(body, "kakuyomu")).toContain("じ");
  });
  it("round-trips supported Unicode ruby without splitting graphemes", () => {
    const phrase = fc.array(fc.constantFrom("葵", "🙂", "が", "雲"), { minLength: 1, maxLength: 4 }).map((parts) => parts.join(""));
    fc.assert(fc.property(phrase, phrase, (base, reading) => {
      const body: ManuscriptDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: base, marks: [{ type: "ruby", attrs: { base, reading } }] }] }] };
      for (const format of ["kakuyomu", "narou"] as const) expect(parsePublicationText(publicationText(body, format), format)).toEqual(body);
    }), { numRuns: 150 });
  });
  it("only proposes formatting and leaves existing indentation and dialogue unchanged", () => {
    expect(japaneseInputSuggestion("驚く!?...--", "symbols")).toBe("驚く！？……――");
    expect(japaneseInputSuggestion("地の文\n「台詞」\n　字下げ済み\n\n終わり", "indent")).toBe("　地の文\n「台詞」\n　字下げ済み\n\n　終わり");
  });
});
