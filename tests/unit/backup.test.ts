import { withChapters } from "../../src/domain/chapters";
import { describe, expect, it, vi } from "vitest";

import {
  InvalidWorkspaceSnapshotError,
  parseWorkspaceSnapshot,
  UnsupportedWorkspaceSchemaVersionError,
} from "../../src/domain/workspace";
import {
  createJsonWorkspaceDownload,
  createTextWorkspaceDownload,
  downloadWorkspaceFile,
  InvalidWorkspaceBackupJsonError,
  MAX_WORKSPACE_BACKUP_BYTES,
  parseWorkspaceBackup,
  prepareWorkspaceImport,
  readWorkspaceBackup,
  WorkspaceBackupTooLargeError,
} from "../../src/features/workspace/backup";
import {
  createWorkspaceFixture,
  createWorkspaceV1Fixture,
  multilinePersistedDocument,
} from "../fixtures/workspace";

describe("workspace backup", () => {
  it("exports canonical JSON and exact plain text", () => {
    const snapshot = createWorkspaceFixture({
      body: multilinePersistedDocument,
    });
    const json = createJsonWorkspaceDownload(snapshot);
    const text = createTextWorkspaceDownload(snapshot);

    expect(json).toMatchObject({
      filename: "星明かりの物語-backup.json",
      mimeType: "application/json;charset=utf-8",
    });
    expect(parseWorkspaceSnapshot(JSON.parse(json.contents) as unknown)).toEqual(
      snapshot,
    );
    expect(json.contents).not.toContain("selection");
    expect(json.contents).not.toContain("history");
    expect(text).toEqual({
      contents: "冒頭🙂\n\n結び\n",
      filename: "星明かりの物語.txt",
      mimeType: "text/plain;charset=utf-8",
    });
  });

  it("sanitizes unsafe filename characters without changing workspace data", () => {
    const snapshot = createWorkspaceFixture();
    const titled = {
      ...snapshot,
      project: { ...snapshot.project, title: '  星 / 夜:*?  ' },
    };

    expect(createJsonWorkspaceDownload(titled).filename).toBe(
      "星-夜-backup.json",
    );
    expect(titled.project.title).toBe('  星 / 夜:*?  ');
  });

  it("round trips a valid canonical snapshot", () => {
    const base = createWorkspaceFixture();
    const snapshot = parseWorkspaceSnapshot({
      ...base,
      project: { ...base.project, aiModelPreference: "gpt-5.6-luna", storyMemory: {
        settingNotes: "世界のルール\n魔法はない。", backgroundNotes: "百年前の出来事。", characterNotes: "主人公：葵😀",
      } },
    });
    const download = createJsonWorkspaceDownload(snapshot);
    const byteLength = new TextEncoder().encode(download.contents).byteLength;

    expect(parseWorkspaceBackup(download.contents, byteLength)).toEqual(
      snapshot,
    );
  });

  it("imports a V1 backup as Automatic without changing its manuscript", () => {
    const legacy = createWorkspaceV1Fixture();
    const contents = JSON.stringify(legacy);
    const parsed = parseWorkspaceBackup(
      contents,
      new TextEncoder().encode(contents).byteLength,
    );

    expect(parsed).toMatchObject({
      chapter: legacy.chapter,
      project: { aiModelPreference: "automatic" },
      schemaVersion: 6,
    });
  });

  it("rejects malformed JSON, invalid schema, unsupported versions, and oversized input", () => {
    const snapshot = createWorkspaceFixture();

    expect(() => parseWorkspaceBackup("{", 1)).toThrow(
      InvalidWorkspaceBackupJsonError,
    );
    expect(() =>
      parseWorkspaceBackup(JSON.stringify({ schemaVersion: 1 }), 20),
    ).toThrow(InvalidWorkspaceSnapshotError);
    expect(() =>
      parseWorkspaceBackup(
        JSON.stringify({ ...snapshot, schemaVersion: 7 }),
        20,
      ),
    ).toThrow(UnsupportedWorkspaceSchemaVersionError);
    expect(() =>
      parseWorkspaceBackup("{}", MAX_WORKSPACE_BACKUP_BYTES + 1),
    ).toThrow(WorkspaceBackupTooLargeError);
  });

  it("rejects an oversized file before reading it", async () => {
    const text = vi.fn(async () => "{}");
    const file = {
      size: MAX_WORKSPACE_BACKUP_BYTES + 1,
      text,
    } as Pick<File, "size" | "text"> as File;

    await expect(readWorkspaceBackup(file)).rejects.toBeInstanceOf(
      WorkspaceBackupTooLargeError,
    );
    expect(text).not.toHaveBeenCalled();
  });

  it("resets imported AI consent while preserving content and revisions", () => {
    const snapshot = createWorkspaceFixture({ storageVersion: 42 });
    const consented = parseWorkspaceSnapshot({
      ...snapshot,
      project: {
        ...snapshot.project,
        aiConsent: {
          providerId: "provider",
          policyVersion: 1,
          grantedAt: "2026-09-19T00:00:00.000Z",
        },
        contextRevision: 7,
      },
    });

    const imported = prepareWorkspaceImport(consented);

    expect(imported.project.aiConsent).toBeNull();
    expect(imported.project.aiModelPreference).toBe(
      consented.project.aiModelPreference,
    );
    expect(imported.project.contextRevision).toBe(8);
    expect(imported.storageVersion).toBe(42);
    expect(imported.chapter).toEqual(consented.chapter);
  });

  it("revokes the temporary object URL after starting a download", () => {
    const createObjectURL = vi.fn(() => "blob:workspace");
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    downloadWorkspaceFile({
      contents: "本文",
      filename: "作品.txt",
      mimeType: "text/plain;charset=utf-8",
    });

    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workspace");
    expect(document.querySelector('a[download="作品.txt"]')).toBeNull();
  });
  it("exports all chapters in manuscript order as text and JSON", () => {
    const first = createWorkspaceFixture();
    const second = { ...first.chapter, id: crypto.randomUUID(), title: "第二章", outlineNotes: "終わり" };
    const workspace = withChapters(first, [second, first.chapter], first.chapter.id);
    expect(createTextWorkspaceDownload(workspace).contents).toBe("第二章\n\n冒頭🙂\n\n結び\n\n\n第一章\n\n冒頭🙂\n\n結び\n");
    expect(JSON.parse(createJsonWorkspaceDownload(workspace).contents).additionalChapters).toHaveLength(1);
  });

});
