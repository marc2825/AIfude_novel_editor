import { emptyAuthoringProfile } from "../../domain/authoring-profile";
import { cloneWorkspace } from "../../domain/chapters";
import { AI_MODEL_PREFERENCE_AUTOMATIC } from "../../domain/ai-models";
import { EMPTY_STORY_MEMORY } from "../../domain/story-memory";
import { parseWorkspaceSnapshot, WORKSPACE_SCHEMA_VERSION, type WorkspaceSnapshot } from "../../domain/workspace";
import { plainTextToDocument } from "../editor/plain-text";
import { plainTextSchema } from "../editor/extensions/plain-text-schema";
import { MAX_WORKSPACE_BACKUP_BYTES, readWorkspaceBackup } from "./backup";

export class WritingFileError extends Error {}

export function createWritingWorkspace(title = "無題の作品", text = "", source?: WorkspaceSnapshot): WorkspaceSnapshot {
  if (source) return cloneWorkspace(source);
  const projectId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const chapterId = crypto.randomUUID();
  const styleProfileId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  return parseWorkspaceSnapshot({
    schemaVersion: WORKSPACE_SCHEMA_VERSION, storageVersion: 0,
    project: {
      id: projectId, title, aiModelPreference: AI_MODEL_PREFERENCE_AUTOMATIC,
      commonPrompt: "", authoringProfile: emptyAuthoringProfile(), storyMemory: EMPTY_STORY_MEMORY,
      writingGoal: 0, autoHistoryEnabled: false, styleProfileId, contextRevision: 0, aiConsent: null, createdAt: timestamp, updatedAt: timestamp,
    },
    document: { id: documentId, projectId, title: "本文", chapterIds: [chapterId], createdAt: timestamp, updatedAt: timestamp },
    additionalChapters: [],
    chapter: { id: chapterId, documentId, title: "第一章", orderIndex: 0, outlineNotes: "",
      body: plainTextToDocument(plainTextSchema, text).toJSON(),
      contentRevision: 0, createdAt: timestamp, updatedAt: timestamp },
    styleProfile: { id: styleProfileId, projectId, source: "manual", manualInstructions: "", revision: 0, updatedAt: timestamp },
  });
}

export async function readWritingFile(file: File): Promise<WorkspaceSnapshot> {
  if (file.size > MAX_WORKSPACE_BACKUP_BYTES) throw new WritingFileError("ファイルは10MiB以下にしてください。");
  if (/\.json$/iu.test(file.name)) {
    const source = await readWorkspaceBackup(file);
    return createWritingWorkspace(source.project.title, "", source);
  }
  if (!/\.txt$/iu.test(file.name)) throw new WritingFileError("JSONバックアップまたはUTF-8の.txtファイルを選んでください。");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new WritingFileError("UTF-8のテキストファイルとして読み込めません。"); }
  const title = Array.from(file.name.replace(/\.txt$/iu, "").trim()).slice(0, 120).join("") || "読み込んだ作品";
  return createWritingWorkspace(title, text);
}
