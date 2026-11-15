import { emptyAuthoringProfile } from "../../src/domain/authoring-profile";
import { describe, expect, it } from "vitest";

import {
  InvalidWorkspaceSnapshotError,
  parseWorkspaceSnapshot,
  UnsupportedWorkspaceSchemaVersionError,
} from "../../src/domain/workspace";
import { plainTextSchema } from "../../src/features/editor/extensions/plain-text-schema";
import { documentToPlainText } from "../../src/features/editor/plain-text";
import {
  createWorkspaceFixture,
  createWorkspaceV1Fixture,
  createWorkspaceV2Fixture,
  emptyPersistedDocument,
} from "../fixtures/workspace";

describe("WorkspaceSnapshot schema", () => {
  it("accepts a valid V0.1 aggregate without changing its representation", () => {
    const snapshot = createWorkspaceFixture();

    expect(parseWorkspaceSnapshot(snapshot)).toEqual(snapshot);
  });

  it("migrates a valid V1 workspace to V6 with Automatic model selection", () => {
    const parsed = parseWorkspaceSnapshot(createWorkspaceV1Fixture());

    expect(parsed.schemaVersion).toBe(6);
    expect(parsed.project.aiModelPreference).toBe("automatic");
    expect(parsed.project.storyMemory).toEqual({ settingNotes: "", backgroundNotes: "", characterNotes: "" });
  });

  it("migrates V2 by adding only empty memory, retaining body, settings and storage version", () => {
    const legacy = createWorkspaceV2Fixture();
    const original = structuredClone(legacy);
    expect(parseWorkspaceSnapshot(legacy)).toEqual({ ...legacy, schemaVersion: 6, additionalChapters: [], chapter: { ...legacy.chapter, outlineNotes: "" }, project: {
      ...legacy.project, authoringProfile: emptyAuthoringProfile(), writingGoal: 0, autoHistoryEnabled: false, storyMemory: { settingNotes: "", backgroundNotes: "", characterNotes: "" },
    } });
    expect(legacy).toEqual(original);
  });

  it("accepts a valid empty manuscript as one empty paragraph", () => {
    const snapshot = createWorkspaceFixture({ body: emptyPersistedDocument });
    const parsed = parseWorkspaceSnapshot(snapshot);

    expect(parsed.chapter.body).toEqual(emptyPersistedDocument);
    expect(
      documentToPlainText(
        plainTextSchema.nodeFromJSON(parsed.chapter.body),
      ),
    ).toBe("");
  });

  it("preserves blank paragraphs and a trailing newline", () => {
    const parsed = parseWorkspaceSnapshot(createWorkspaceFixture());

    expect(
      documentToPlainText(
        plainTextSchema.nodeFromJSON(parsed.chapter.body),
      ),
    ).toBe("冒頭🙂\n\n結び\n");
  });

  it("rejects a missing required aggregate member", () => {
    const snapshot = createWorkspaceFixture();
    const missingChapter = {
      schemaVersion: snapshot.schemaVersion,
      storageVersion: snapshot.storageVersion,
      project: snapshot.project,
      document: snapshot.document,
      styleProfile: snapshot.styleProfile,
    };

    expect(() => parseWorkspaceSnapshot(missingChapter)).toThrow(
      InvalidWorkspaceSnapshotError,
    );
  });

  it.each([
    {
      label: "a malformed model preference",
      value: {
        ...createWorkspaceFixture(),
        project: {
          ...createWorkspaceFixture().project,
          aiModelPreference: "GPT 5.6 Terra",
        },
      },
    },
    {
      label: "a negative storage version",
      value: { ...createWorkspaceFixture(), storageVersion: -1 },
    },
    {
      label: "a non-UTC timestamp",
      value: {
        ...createWorkspaceFixture(),
        project: {
          ...createWorkspaceFixture().project,
          updatedAt: "2026-09-18T09:00:00+09:00",
        },
      },
    },
    {
      label: "a rich-text body node",
      value: {
        ...createWorkspaceFixture(),
        chapter: {
          ...createWorkspaceFixture().chapter,
          body: {
            type: "doc",
            content: [{ type: "heading", attrs: { level: 1 } }],
          },
        },
      },
    },
    {
      label: "a text node containing a raw newline",
      value: {
        ...createWorkspaceFixture(),
        chapter: {
          ...createWorkspaceFixture().chapter,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "一\n二" }],
              },
            ],
          },
        },
      },
    },
    {
      label: "an unexpected field",
      value: { ...createWorkspaceFixture(), unexpected: true },
    },
    {
      label: "an expired AI consent policy",
      value: {
        ...createWorkspaceFixture(),
        project: {
          ...createWorkspaceFixture().project,
          aiConsent: {
            grantedAt: "2026-09-20T00:00:00.000Z",
            policyVersion: 0,
            providerId: "openai",
          },
        },
      },
    },
  ])("rejects malformed data: $label", ({ value }) => {
    expect(() => parseWorkspaceSnapshot(value)).toThrow(
      InvalidWorkspaceSnapshotError,
    );
  });

  it("rejects inconsistent reference IDs", () => {
    const snapshot = createWorkspaceFixture();
    const inconsistent = {
      ...snapshot,
      document: {
        ...snapshot.document,
        projectId: "30000000-0000-4000-8000-000000000001",
      },
    };

    expect(() => parseWorkspaceSnapshot(inconsistent)).toThrow(
      InvalidWorkspaceSnapshotError,
    );
  });

  it("reports an unsupported numeric schema version separately", () => {
    const futureSnapshot = {
      ...createWorkspaceFixture(),
      schemaVersion: 7,
    };

    expect(() => parseWorkspaceSnapshot(futureSnapshot)).toThrow(
      UnsupportedWorkspaceSchemaVersionError,
    );

    try {
      parseWorkspaceSnapshot(futureSnapshot);
    } catch (error) {
      expect(error).toMatchObject({ schemaVersion: 7 });
    }
  });
});
