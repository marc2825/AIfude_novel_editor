import { z } from "zod";
import { manuscriptDocumentSchema } from "./typography";
import { authoringProfileSchema, emptyAuthoringProfile } from "./authoring-profile";

import { AI_MODEL_PREFERENCE_AUTOMATIC } from "./ai-models";
import { AI_EXTERNAL_CONSENT_POLICY_VERSION } from "./limits";
import { EMPTY_STORY_MEMORY, storyMemorySchema } from "./story-memory";

export const WORKSPACE_SCHEMA_VERSION = 6 as const;

const uuidSchema = z.uuid();
const timestampSchema = z.iso.datetime();
const versionSchema = z.int().nonnegative();

function codePointString(minimum: number, maximum: number) {
  return z.string().refine(
    (value) => {
      const length = Array.from(value).length;
      return length >= minimum && length <= maximum;
    },
    { message: `${minimum}〜${maximum}コードポイントで入力してください` },
  );
}

const pmTextNodeSchema = z
  .object({
    type: z.literal("text"),
    text: z
      .string()
      .min(1)
      .refine((value) => !/[\r\n]/u.test(value), {
        message: "改行はparagraph境界として保存してください",
      }),
  })
  .strict();

const emptyParagraphSchema = z
  .object({
    type: z.literal("paragraph"),
  })
  .strict();

const textParagraphSchema = z
  .object({
    type: z.literal("paragraph"),
    content: z.tuple([pmTextNodeSchema]),
  })
  .strict();

const legacyPersistedDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z
      .array(z.union([emptyParagraphSchema, textParagraphSchema]))
      .min(1),
  })
  .strict();

export const aiConsentSchema = z
  .object({
    providerId: z.string(),
    policyVersion: z.literal(AI_EXTERNAL_CONSENT_POLICY_VERSION),
    grantedAt: timestampSchema,
  })
  .strict();

export const aiModelPreferenceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9.-]*$/u, {
    message: "model preferenceはcanonical IDで指定してください",
  });

const projectV1Schema = z
  .object({
    id: uuidSchema,
    title: codePointString(1, 120),
    commonPrompt: codePointString(0, 2_000),
    styleProfileId: uuidSchema,
    contextRevision: versionSchema,
    aiConsent: aiConsentSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const projectV2Schema = projectV1Schema
  .extend({
    aiModelPreference: aiModelPreferenceSchema,
  })
  .strict();

const projectV3Schema = projectV2Schema.extend({ storyMemory: storyMemorySchema }).strict();
const projectV4Schema = projectV3Schema.extend({
  writingGoal: z.int().min(0).max(10_000_000),
  autoHistoryEnabled: z.boolean(),
}).strict();

const projectSchema = projectV4Schema.extend({ authoringProfile: authoringProfileSchema }).strict();

const legacyWritingDocumentSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    title: codePointString(1, 120),
    chapterIds: z.tuple([uuidSchema]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const legacyChapterSchema = z
  .object({
    id: uuidSchema,
    documentId: uuidSchema,
    title: codePointString(1, 120),
    orderIndex: z.literal(0),
    body: legacyPersistedDocumentSchema,
    contentRevision: versionSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const writingDocumentSchema = legacyWritingDocumentSchema.extend({
  chapterIds: z.array(uuidSchema).min(1).max(200),
}).strict();
const chapterSchema = legacyChapterSchema.extend({
  orderIndex: z.int().min(0).max(199),
  outlineNotes: codePointString(0, 2_000),
}).strict();

const styleProfileSchema = z
  .object({
    id: uuidSchema,
    projectId: uuidSchema,
    source: z.literal("manual"),
    manualInstructions: codePointString(0, 1_000),
    revision: versionSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const workspaceSettingsInputSchema = z
  .object({
    title: codePointString(1, 120),
    commonPrompt: codePointString(0, 2_000),
    manualInstructions: codePointString(0, 1_000),
    storyMemory: storyMemorySchema.optional(),
    authoringProfile: authoringProfileSchema.optional(),
  })
  .strict();

function referenceChecks(snapshot: {
  chapter: { documentId: string; id: string };
  document: { chapterIds: readonly [string]; id: string; projectId: string };
  project: { id: string; styleProfileId: string };
  styleProfile: { id: string; projectId: string };
}) {
  return [
    [
      snapshot.document.projectId === snapshot.project.id,
      ["document", "projectId"],
    ],
    [
      snapshot.chapter.documentId === snapshot.document.id,
      ["chapter", "documentId"],
    ],
    [
      snapshot.document.chapterIds[0] === snapshot.chapter.id,
      ["document", "chapterIds", 0],
    ],
    [
      snapshot.project.styleProfileId === snapshot.styleProfile.id,
      ["project", "styleProfileId"],
    ],
    [
      snapshot.styleProfile.projectId === snapshot.project.id,
      ["styleProfile", "projectId"],
    ],
  ] as const;
}

const workspaceSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    storageVersion: versionSchema,
    project: projectV1Schema,
    document: legacyWritingDocumentSchema,
    chapter: legacyChapterSchema,
    styleProfile: styleProfileSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [matches, path] of referenceChecks(snapshot)) {
      if (!matches) {
        context.addIssue({
          code: "custom",
          message: "参照IDが一致しません",
          path: [...path],
        });
      }
    }
  });

const workspaceSnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(2), storageVersion: versionSchema,
    project: projectV2Schema, document: legacyWritingDocumentSchema,
    chapter: legacyChapterSchema, styleProfile: styleProfileSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [matches, path] of referenceChecks(snapshot)) {
      if (!matches) context.addIssue({ code: "custom", message: "参照IDが一致しません", path: [...path] });
    }
  });

const workspaceSnapshotV3Schema = z.object({
  schemaVersion: z.literal(3), storageVersion: versionSchema,
  project: projectV3Schema, document: legacyWritingDocumentSchema,
  chapter: legacyChapterSchema, styleProfile: styleProfileSchema,
}).strict().superRefine((snapshot, context) => {
  for (const [matches, path] of referenceChecks(snapshot)) {
    if (!matches) context.addIssue({ code: "custom", message: "参照IDが一致しません", path: [...path] });
  }
});

const workspaceSnapshotV4Base = z.object({
  schemaVersion: z.literal(4), storageVersion: versionSchema,
  project: projectV4Schema, document: writingDocumentSchema, chapter: chapterSchema,
  additionalChapters: z.array(chapterSchema).max(199), styleProfile: styleProfileSchema,
}).strict();
type ChapterReferences = Pick<z.infer<typeof chapterSchema>, "id" | "documentId" | "orderIndex">;
function checkWorkspaceReferences(snapshot: Omit<z.infer<typeof workspaceSnapshotV4Base>, "schemaVersion" | "chapter" | "additionalChapters"> & { chapter: ChapterReferences; additionalChapters: ChapterReferences[] }, context: z.RefinementCtx) {
  const chapters = [snapshot.chapter, ...snapshot.additionalChapters];
  const ids = new Set(chapters.map((chapter) => chapter.id));
  if (snapshot.document.projectId !== snapshot.project.id ||
      snapshot.styleProfile.projectId !== snapshot.project.id ||
      snapshot.project.styleProfileId !== snapshot.styleProfile.id ||
      ids.size !== chapters.length || chapters.length !== snapshot.document.chapterIds.length ||
      chapters.some((chapter) => chapter.documentId !== snapshot.document.id || snapshot.document.chapterIds[chapter.orderIndex] !== chapter.id)) {
    context.addIssue({ code: "custom", message: "章または作品の参照が一致しません" });
  }
}
const workspaceSnapshotV4Schema = workspaceSnapshotV4Base.superRefine(checkWorkspaceReferences);
const workspaceSnapshotV5Schema = workspaceSnapshotV4Base.extend({ schemaVersion: z.literal(5), project: projectSchema }).superRefine(checkWorkspaceReferences);
export const persistedDocumentSchema = manuscriptDocumentSchema;
const annotatedChapterSchema = chapterSchema.extend({ body: persistedDocumentSchema });
export const workspaceSnapshotSchema = workspaceSnapshotV4Base.extend({
  schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION), project: projectSchema, chapter: annotatedChapterSchema, additionalChapters: z.array(annotatedChapterSchema).max(199),
}).superRefine(checkWorkspaceReferences);

export type PersistedDocument = z.infer<typeof persistedDocumentSchema>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export type Project = WorkspaceSnapshot["project"];
export type WritingDocument = WorkspaceSnapshot["document"];
export type Chapter = WorkspaceSnapshot["chapter"];
export type StyleProfile = WorkspaceSnapshot["styleProfile"];
export type AiConsent = NonNullable<Project["aiConsent"]>;
export type AiModelPreference = Project["aiModelPreference"];
export type WorkspaceSettingsInput = z.infer<
  typeof workspaceSettingsInputSchema
>;

export class InvalidWorkspaceSnapshotError extends Error {
  constructor() {
    super("保存データがWorkspaceSnapshot schemaに適合しません。");
    this.name = "InvalidWorkspaceSnapshotError";
  }
}

export class UnsupportedWorkspaceSchemaVersionError extends Error {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    super(`未対応のWorkspaceSnapshot schema versionです: ${schemaVersion}`);
    this.name = "UnsupportedWorkspaceSchemaVersionError";
    this.schemaVersion = schemaVersion;
  }
}

function storedSchemaVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  if (!("schemaVersion" in value)) {
    return null;
  }

  return typeof value.schemaVersion === "number" &&
    Number.isSafeInteger(value.schemaVersion) &&
    value.schemaVersion >= 0
    ? value.schemaVersion
    : null;
}

export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const schemaVersion = storedSchemaVersion(value);

  if (schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3) {
    const legacy = schemaVersion === 1 ? workspaceSnapshotV1Schema.safeParse(value)
      : schemaVersion === 2 ? workspaceSnapshotV2Schema.safeParse(value)
      : workspaceSnapshotV3Schema.safeParse(value);
    if (!legacy.success) throw new InvalidWorkspaceSnapshotError();
    return workspaceSnapshotSchema.parse({
      ...legacy.data, schemaVersion: WORKSPACE_SCHEMA_VERSION,
      project: {
        aiModelPreference: AI_MODEL_PREFERENCE_AUTOMATIC, storyMemory: EMPTY_STORY_MEMORY,
        ...legacy.data.project, writingGoal: 0, autoHistoryEnabled: false, authoringProfile: emptyAuthoringProfile(),
      },
      chapter: { ...legacy.data.chapter, outlineNotes: "" }, additionalChapters: [],
    });
  }

  if (schemaVersion === 4) {
    const legacy = workspaceSnapshotV4Schema.safeParse(value);
    if (!legacy.success) throw new InvalidWorkspaceSnapshotError();
    return workspaceSnapshotSchema.parse({ ...legacy.data, schemaVersion: WORKSPACE_SCHEMA_VERSION,
      project: { ...legacy.data.project, authoringProfile: emptyAuthoringProfile() } });
  }

  if (schemaVersion === 5) {
    const legacy = workspaceSnapshotV5Schema.safeParse(value);
    if (!legacy.success) throw new InvalidWorkspaceSnapshotError();
    return workspaceSnapshotSchema.parse({ ...legacy.data, schemaVersion: WORKSPACE_SCHEMA_VERSION });
  }

  if (schemaVersion !== null && schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new UnsupportedWorkspaceSchemaVersionError(schemaVersion);
  }

  const result = workspaceSnapshotSchema.safeParse(value);

  if (!result.success) {
    throw new InvalidWorkspaceSnapshotError();
  }

  return result.data;
}
