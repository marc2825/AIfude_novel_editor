import { describe, expect, it } from "vitest";
import { createWritingWorkspace, readWritingFile, WritingFileError } from "../../src/features/workspace/workspace-files";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { createTextWorkspaceDownload, MAX_WORKSPACE_BACKUP_BYTES } from "../../src/features/workspace/backup";

describe("writing files", () => {
  it("opens UTF-8 text with exact blank lines and emoji, normalizing line endings", async () => {
    const file = new File(["先頭😀\r\n\r\n末尾\r"], "短編.txt");
    const opened = await readWritingFile(file);
    expect(opened.project.title).toBe("短編");
    expect(createTextWorkspaceDownload(opened).contents).toBe("先頭😀\n\n末尾\n");
  });
  it("opens JSON as a distinct work, preserving content and notes without consent or revisions", async () => {
    const base = createWorkspaceFixture();
    const source = { ...base, project: { ...base.project, storyMemory: { settingNotes: "設定", backgroundNotes: "背景", characterNotes: "人物" },
      aiConsent: { providerId: "openai", policyVersion: 1 as const, grantedAt: base.project.createdAt }, contextRevision: 8 } };
    const opened = await readWritingFile(new File([JSON.stringify(source)], "story.json"));
    expect(opened.chapter.body).toEqual(source.chapter.body); expect(opened.project.storyMemory).toEqual(source.project.storyMemory);
    expect(opened.project.id).not.toBe(source.project.id); expect(opened.document.id).not.toBe(source.document.id);
    expect(opened.project.aiConsent).toBeNull(); expect(opened.storageVersion).toBe(0); expect(opened.project.contextRevision).toBe(0);
    expect(createWritingWorkspace().project.storyMemory.characterNotes).toBe("");
  });
  it("rejects malformed JSON, invalid UTF-8, unsupported extensions and oversized files", async () => {
    await expect(readWritingFile(new File(["{"], "bad.json"))).rejects.toBeDefined();
    await expect(readWritingFile(new File([new Uint8Array([0xff])], "bad.txt"))).rejects.toBeInstanceOf(WritingFileError);
    await expect(readWritingFile(new File(["text"], "bad.html"))).rejects.toBeInstanceOf(WritingFileError);
    await expect(readWritingFile(new File([new Uint8Array(MAX_WORKSPACE_BACKUP_BYTES + 1)], "large.txt"))).rejects.toBeInstanceOf(WritingFileError);
  });
});
