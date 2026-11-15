import { orderedChapters } from "../../domain/chapters";
import {
  InvalidWorkspaceSnapshotError,
  parseWorkspaceSnapshot,
  UnsupportedWorkspaceSchemaVersionError,
  type WorkspaceSnapshot,
} from "../../domain/workspace";
import { plainTextSchema } from "../editor/extensions/plain-text-schema";
import { documentToPlainText } from "../editor/plain-text";

export const MAX_WORKSPACE_BACKUP_BYTES = 10 * 1024 * 1024;

export type WorkspaceDownload = Readonly<{
  contents: string;
  filename: string;
  mimeType: string;
}>;

export class WorkspaceBackupTooLargeError extends Error {
  constructor() {
    super("JSONバックアップは10MiB以下にしてください。");
    this.name = "WorkspaceBackupTooLargeError";
  }
}

export class InvalidWorkspaceBackupJsonError extends Error {
  constructor() {
    super("JSONバックアップを解析できません。");
    this.name = "InvalidWorkspaceBackupJsonError";
  }
}

export class WorkspaceBackupReadError extends Error {
  constructor() {
    super("JSONバックアップを読み込めませんでした。");
    this.name = "WorkspaceBackupReadError";
  }
}

function safeFilenameBase(title: string): string {
  const replaced = Array.from(title)
    .map((character) =>
      /[<>:"/\\|?*\u0000-\u001f]/u.test(character) ? "-" : character,
    )
    .join("")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[.\s-]+|[.\s-]+$/gu, "");
  const limited = Array.from(replaced).slice(0, 80).join("");

  return limited.length === 0 ? "novel" : limited;
}

export function createTextWorkspaceDownload(
  snapshotValue: WorkspaceSnapshot,
): WorkspaceDownload {
  const snapshot = parseWorkspaceSnapshot(snapshotValue);
  const document = plainTextSchema.nodeFromJSON(snapshot.chapter.body);

  return {
    contents: snapshot.document.chapterIds.length === 1 ? documentToPlainText(document)
      : orderedChapters(snapshot).map((chapter) => `${chapter.title}\n\n${documentToPlainText(plainTextSchema.nodeFromJSON(chapter.body))}`).join("\n\n"),
    filename: `${safeFilenameBase(snapshot.project.title)}.txt`,
    mimeType: "text/plain;charset=utf-8",
  };
}

export function createJsonWorkspaceDownload(
  snapshotValue: WorkspaceSnapshot,
): WorkspaceDownload {
  const snapshot = parseWorkspaceSnapshot(snapshotValue);

  return {
    contents: `${JSON.stringify(snapshot, null, 2)}\n`,
    filename: `${safeFilenameBase(snapshot.project.title)}-backup.json`,
    mimeType: "application/json;charset=utf-8",
  };
}

export function parseWorkspaceBackup(
  contents: string,
  byteLength: number,
): WorkspaceSnapshot {
  if (byteLength > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new WorkspaceBackupTooLargeError();
  }

  let value: unknown;

  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw new InvalidWorkspaceBackupJsonError();
  }

  return parseWorkspaceSnapshot(value);
}

export async function readWorkspaceBackup(
  file: File,
): Promise<WorkspaceSnapshot> {
  if (file.size > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new WorkspaceBackupTooLargeError();
  }

  let contents: string;

  try {
    contents = await file.text();
  } catch {
    throw new WorkspaceBackupReadError();
  }

  return parseWorkspaceBackup(contents, file.size);
}

export function prepareWorkspaceImport(
  snapshotValue: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const snapshot = parseWorkspaceSnapshot(snapshotValue);
  const contextRevision =
    snapshot.project.aiConsent === null
      ? snapshot.project.contextRevision
      : snapshot.project.contextRevision + 1;

  return parseWorkspaceSnapshot({
    ...snapshot,
    project: {
      ...snapshot.project,
      aiConsent: null,
      contextRevision,
    },
  });
}

export function workspaceBackupErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceBackupTooLargeError) {
    return error.message;
  }

  if (error instanceof InvalidWorkspaceBackupJsonError) {
    return "JSONとして読み込めません。現在の作品は変更されていません。";
  }

  if (error instanceof UnsupportedWorkspaceSchemaVersionError) {
    return `未対応のバックアップversionです（schemaVersion: ${error.schemaVersion}）。現在の作品は変更されていません。`;
  }

  if (error instanceof InvalidWorkspaceSnapshotError) {
    return "バックアップの形式または参照関係が不正です。現在の作品は変更されていません。";
  }

  if (error instanceof WorkspaceBackupReadError) {
    return "ファイルを読み込めませんでした。現在の作品は変更されていません。";
  }

  return "バックアップを処理できませんでした。現在の作品は変更されていません。";
}

export function downloadWorkspaceFile(download: WorkspaceDownload): void {
  const blob = new Blob([download.contents], { type: download.mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = download.filename;
  anchor.href = objectUrl;

  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
