import { emptyAuthoringProfile } from "../../src/domain/authoring-profile";
import type {
  PersistedDocument,
  WorkspaceSnapshot,
} from "../../src/domain/workspace";
import { AI_MODEL_PREFERENCE_AUTOMATIC } from "../../src/domain/ai-models";
import { WORKSPACE_SCHEMA_VERSION } from "../../src/domain/workspace";
import { EMPTY_STORY_MEMORY } from "../../src/domain/story-memory";

const identities = {
  primary: {
    projectId: "10000000-0000-4000-8000-000000000001",
    documentId: "10000000-0000-4000-8000-000000000002",
    chapterId: "10000000-0000-4000-8000-000000000003",
    styleProfileId: "10000000-0000-4000-8000-000000000004",
  },
  replacement: {
    projectId: "20000000-0000-4000-8000-000000000001",
    documentId: "20000000-0000-4000-8000-000000000002",
    chapterId: "20000000-0000-4000-8000-000000000003",
    styleProfileId: "20000000-0000-4000-8000-000000000004",
  },
} as const;

type WorkspaceFixtureOptions = Readonly<{
  body?: PersistedDocument;
  identity?: keyof typeof identities;
  storageVersion?: number;
}>;

export const emptyPersistedDocument: PersistedDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export const multilinePersistedDocument: PersistedDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "冒頭🙂" }],
    },
    { type: "paragraph" },
    {
      type: "paragraph",
      content: [{ type: "text", text: "結び" }],
    },
    { type: "paragraph" },
  ],
};

export function createWorkspaceFixture(
  options: WorkspaceFixtureOptions = {},
): WorkspaceSnapshot {
  const identity = identities[options.identity ?? "primary"];
  const timestamp = "2026-09-18T00:00:00.000Z";

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    storageVersion: options.storageVersion ?? 0,
    project: {
      id: identity.projectId,
      aiModelPreference: AI_MODEL_PREFERENCE_AUTOMATIC,
      title: "星明かりの物語",
      commonPrompt: "余韻を保つ",
      authoringProfile: emptyAuthoringProfile(),
      writingGoal: 0, autoHistoryEnabled: false,
      storyMemory: { ...EMPTY_STORY_MEMORY },
      styleProfileId: identity.styleProfileId,
      contextRevision: 0,
      aiConsent: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    document: {
      id: identity.documentId,
      projectId: identity.projectId,
      title: "第一稿",
      chapterIds: [identity.chapterId],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    additionalChapters: [],
    chapter: {
      id: identity.chapterId,
      documentId: identity.documentId,
      title: "第一章",
      orderIndex: 0, outlineNotes: "",
      body: options.body ?? multilinePersistedDocument,
      contentRevision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    styleProfile: {
      id: identity.styleProfileId,
      projectId: identity.projectId,
      source: "manual",
      manualInstructions: "静かな文体",
      revision: 0,
      updatedAt: timestamp,
    },
  };
}

export function createWorkspaceV1Fixture() {
  const snapshot = createWorkspaceFixture();
  const project = {
    aiConsent: snapshot.project.aiConsent,
    commonPrompt: snapshot.project.commonPrompt,
    contextRevision: snapshot.project.contextRevision,
    createdAt: snapshot.project.createdAt,
    id: snapshot.project.id,
    styleProfileId: snapshot.project.styleProfileId,
    title: snapshot.project.title,
    updatedAt: snapshot.project.updatedAt,
  };

  const { additionalChapters: _additional, chapter, ...base } = snapshot;
  const { outlineNotes: _outline, ...legacyChapter } = chapter;
  void _additional; void _outline;
  return {
    ...base, chapter: legacyChapter,
    project,
    schemaVersion: 1 as const,
  };
}

export function createWorkspaceV2Fixture() {
  const legacy = createWorkspaceV1Fixture();
  return { ...legacy, schemaVersion: 2 as const, project: { ...legacy.project, aiModelPreference: "gpt-5.6-luna" } };
}
