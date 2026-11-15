import { describe, expect, it } from "vitest";
import { authoringProfileSchema, authoringReferenceMemory, changedPreservedTerms, characterStyleWarnings, snapshotAuthoringProfile, emptyAuthoringProfile } from "../../src/domain/authoring-profile";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { cloneWorkspace } from "../../src/domain/chapters";
import { createWorkspaceFixture, createWorkspaceV1Fixture, createWorkspaceV2Fixture } from "../fixtures/workspace";
import { authoringFixture } from "../fixtures/authoring";

describe("authoring profiles and migration", () => {
  it("defaults references OFF and sends only explicitly selected data", () => {
    const profile = authoringFixture();
    expect(authoringReferenceMemory(profile, undefined)).toBeUndefined();
    expect(authoringReferenceMemory(profile, {})).toBeUndefined();
    const selected = authoringReferenceMemory(profile, { characterIds: [profile.characters[0].id] });
    expect(selected?.characterNotes).toContain("僕");
    expect(selected?.backgroundNotes).toBe("");
    expect(authoringReferenceMemory(profile, { preservation: true })?.backgroundNotes).toContain("新しい人物");
  });
  it("freezes snapshots and validates duplicates and unsupported data", () => {
    const profile = authoringFixture(); const snapshot = snapshotAuthoringProfile(profile);
    profile.characters[0].name = "変更";
    expect(snapshot.characters[0].name).toBe("葵"); expect(Object.isFrozen(snapshot.characters[0].source)).toBe(true);
    expect(authoringProfileSchema.safeParse({ ...profile, characters: [...profile.characters, ...profile.characters] }).success).toBe(false);
    expect(authoringProfileSchema.safeParse({ ...profile, apiKey: "never-import" }).success).toBe(false);
    expect(authoringProfileSchema.safeParse({ ...profile, preservationNote: "x".repeat(401) }).success).toBe(false);
  });
  it("distinguishes literal enforcement from speaker observations", () => {
    const profile = authoringFixture();
    expect(changedPreservedTerms("葵が葵を呼ぶ", "葵が凪を呼ぶ", profile)).toEqual(["葵"]);
    expect(changedPreservedTerms("", "葵が来た", profile)).toEqual([]);
    expect(characterStyleWarnings("俺は行くぜ、だぜ", profile, [profile.characters[0].id])).toHaveLength(2);
    expect(characterStyleWarnings("僕は行く", profile, [profile.characters[0].id])).toEqual([]);
  });
  it("migrates strict V1–V4 without modifying originals and round-trips V6", () => {
    const current = createWorkspaceFixture();
    const { authoringProfile: _profile, ...project } = current.project; void _profile;
    const v4 = { ...current, schemaVersion: 4, project };
    const { writingGoal: _goal, autoHistoryEnabled: _history, ...v3Project } = project; void _goal; void _history;
    const { additionalChapters: _chapters, chapter, ...base } = v4; void _chapters;
    const { outlineNotes: _outline, ...v3Chapter } = chapter; void _outline;
    const v3 = { ...base, schemaVersion: 3, project: v3Project, chapter: v3Chapter };
    for (const legacy of [createWorkspaceV1Fixture(), createWorkspaceV2Fixture(), v3, v4]) {
      const original = JSON.stringify(legacy); const migrated = parseWorkspaceSnapshot(legacy);
      expect(migrated.schemaVersion).toBe(6); expect(migrated.project.authoringProfile).toEqual(emptyAuthoringProfile());
      expect(migrated.chapter.body).toEqual(current.chapter.body); expect(JSON.stringify(legacy)).toBe(original);
      expect(parseWorkspaceSnapshot(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    }
    expect(() => parseWorkspaceSnapshot({ ...v4, project: { ...project, unknown: true } })).toThrow();
    current.project.authoringProfile = authoringFixture();
    expect(parseWorkspaceSnapshot(JSON.parse(JSON.stringify(current)))).toEqual(current);
  });
  it("keeps character sources linked to the copied chapter and clears consent", () => {
    const original = createWorkspaceFixture(); original.project.authoringProfile = authoringFixture();
    const copy = cloneWorkspace(original);
    expect(copy.project.authoringProfile.characters[0].source?.chapterId).toBe(copy.chapter.id);
    expect(copy.project.authoringProfile.characters[0].id).not.toBe(original.project.authoringProfile.characters[0].id);
    expect(copy.project.authoringProfile.characters[0].examples).toBe("僕は待つよ。");
    expect(copy.project.aiConsent).toBeNull();
  });
});
