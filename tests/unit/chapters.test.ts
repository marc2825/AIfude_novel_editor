import { describe, expect, it } from "vitest";
import { cloneWorkspace, countDocumentCharacters, orderedChapters, withChapters } from "../../src/domain/chapters";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { createWorkspaceFixture } from "../fixtures/workspace";

describe("chapter aggregate", () => {
  it("orders and activates chapters without discarding either manuscript", () => {
    const original = createWorkspaceFixture(); const second = { ...original.chapter, id: crypto.randomUUID(), title: "第二章", outlineNotes: "再会する", contentRevision: 4 };
    const workspace = withChapters(original, [second, original.chapter], second.id);
    expect(workspace.chapter).toMatchObject({ title: "第二章", orderIndex: 0 });
    expect(orderedChapters(workspace).map((chapter) => chapter.title)).toEqual(["第二章", "第一章"]);
    expect(withChapters(workspace, orderedChapters(workspace), original.chapter.id).chapter.body).toEqual(original.chapter.body);
    expect(cloneWorkspace(workspace).additionalChapters).toHaveLength(1);
  });
  it("rejects missing, duplicated, orphaned and inconsistently ordered chapters", () => {
    const source = createWorkspaceFixture();
    for (const value of [
      { ...source, document: { ...source.document, chapterIds: [] } },
      { ...source, additionalChapters: [source.chapter] },
      { ...source, chapter: { ...source.chapter, orderIndex: 1 } },
      { ...source, chapter: { ...source.chapter, documentId: crypto.randomUUID() } },
    ]) expect(() => parseWorkspaceSnapshot(value)).toThrow();
    expect(() => withChapters(source, [])).toThrow();
  });
  it("migrates schema 3 non-destructively with its notes and revision intact", () => {
    const source = createWorkspaceFixture({ storageVersion: 7 });
    const { additionalChapters: _chapters, ...base } = source;
    const { outlineNotes: _outline, ...chapter } = source.chapter;
    const { writingGoal: _goal, autoHistoryEnabled: _history, authoringProfile: _profile, ...project } = source.project;
    void _chapters; void _outline; void _goal; void _history; void _profile;
    project.storyMemory.characterNotes = "主人公";
    const legacy = { ...base, schemaVersion: 3, chapter, project }; const copy = structuredClone(legacy);
    const migrated = parseWorkspaceSnapshot(legacy);
    expect(migrated.project.storyMemory.characterNotes).toBe("主人公"); expect(migrated.storageVersion).toBe(7);
    expect(migrated.chapter.body).toEqual(chapter.body); expect(migrated.additionalChapters).toEqual([]);
    expect(migrated.project).toMatchObject({ writingGoal: 0, autoHistoryEnabled: false }); expect(legacy).toEqual(copy);
  });
  it("counts Unicode codepoints and spaces, excluding paragraph breaks", () => {
    expect(countDocumentCharacters(createWorkspaceFixture().chapter.body)).toBe(5);
    expect(countDocumentCharacters({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "😀 a" }] }] })).toBe(3);
  });
});
