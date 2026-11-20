import { z } from "zod";
import { emptyAuthoringProfile } from "./authoring-profile";
import { EMPTY_STORY_MEMORY } from "./story-memory";
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from "./workspace";
import type { SealedRecord } from "./sealed-record";

/**
 * A secret work is stored as a "shell": the normal snapshot structure (IDs, order, versions,
 * timestamps, consent) with every piece of writing replaced by placeholders, plus the writing
 * itself sealed in `secret`. Existing storage code keeps working on shells; only opening and
 * sealing need the key.
 */
export const SECRET_TITLE = "シークレット作品";
const SECRET_CHAPTER_TITLE = "シークレット";
const EMPTY_BODY = { type: "doc" as const, content: [{ type: "paragraph" as const }] };

const chapterContentSchema = z.object({ title: z.string(), body: z.unknown(), outlineNotes: z.string() }).strict();
export const secretPayloadSchema = z.object({
  schemaVersion: z.literal(1), projectTitle: z.string(), commonPrompt: z.string(), storyMemory: z.unknown(), authoringProfile: z.unknown(),
  documentTitle: z.string(), styleInstructions: z.string(), chapters: z.record(z.uuid(), chapterContentSchema),
}).strict();
export type SecretPayload = z.infer<typeof secretPayloadSchema>;

export function isSecretShell(snapshot: WorkspaceSnapshot): boolean { return snapshot.secret !== undefined; }

/** The writing of a plain snapshot, as sealed into a shell. */
export function secretPayload(snapshot: WorkspaceSnapshot): SecretPayload {
  if (snapshot.secret) throw new Error("既に暗号化された作品です。");
  const chapters: SecretPayload["chapters"] = {};
  for (const chapter of [snapshot.chapter, ...snapshot.additionalChapters]) chapters[chapter.id] = { title: chapter.title, body: chapter.body, outlineNotes: chapter.outlineNotes };
  return { schemaVersion: 1, projectTitle: snapshot.project.title, commonPrompt: snapshot.project.commonPrompt, storyMemory: snapshot.project.storyMemory,
    authoringProfile: snapshot.project.authoringProfile, documentTitle: snapshot.document.title, styleInstructions: snapshot.styleProfile.manualInstructions, chapters };
}

/** Replace the writing with placeholders and attach the sealed record. */
export function secretShell(snapshot: WorkspaceSnapshot, sealed: SealedRecord): WorkspaceSnapshot {
  if (sealed.kind !== "workspace" || sealed.meta.projectId !== snapshot.project.id || sealed.meta.documentId !== snapshot.document.id) throw new Error("暗号化データが作品と一致しません。");
  const blank = <T extends WorkspaceSnapshot["chapter"]>(chapter: T): T => ({ ...chapter, title: SECRET_CHAPTER_TITLE, body: EMPTY_BODY, outlineNotes: "" });
  return parseWorkspaceSnapshot({
    ...snapshot, secret: sealed,
    project: { ...snapshot.project, title: SECRET_TITLE, commonPrompt: "", storyMemory: EMPTY_STORY_MEMORY, authoringProfile: emptyAuthoringProfile() },
    document: { ...snapshot.document, title: SECRET_TITLE }, styleProfile: { ...snapshot.styleProfile, manualInstructions: "" },
    chapter: blank(snapshot.chapter), additionalChapters: snapshot.additionalChapters.map(blank),
  });
}

/** Put the decrypted writing back into a shell. Structure and metadata always come from the shell. */
export function applySecretPayload(shell: WorkspaceSnapshot, payloadValue: unknown): WorkspaceSnapshot {
  if (!shell.secret) throw new Error("暗号化された作品ではありません。");
  const payload = secretPayloadSchema.parse(payloadValue);
  const fill = <T extends WorkspaceSnapshot["chapter"]>(chapter: T): T => {
    const content = payload.chapters[chapter.id];
    if (!content) throw new Error("暗号化データに章がありません。");
    return { ...chapter, title: content.title, body: content.body as T["body"], outlineNotes: content.outlineNotes };
  };
  const { secret: _sealed, ...plain } = shell;
  void _sealed;
  return parseWorkspaceSnapshot({
    ...plain,
    project: { ...plain.project, title: payload.projectTitle, commonPrompt: payload.commonPrompt, storyMemory: payload.storyMemory, authoringProfile: payload.authoringProfile },
    document: { ...plain.document, title: payload.documentTitle }, styleProfile: { ...plain.styleProfile, manualInstructions: payload.styleInstructions },
    chapter: fill(plain.chapter), additionalChapters: plain.additionalChapters.map(fill),
  });
}
