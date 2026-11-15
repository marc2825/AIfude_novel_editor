import { remapAuthoringSources } from "./authoring-profile";
import { parseWorkspaceSnapshot, type Chapter, type WorkspaceSnapshot } from "./workspace";

export function orderedChapters(workspace: WorkspaceSnapshot): Chapter[] {
  return [workspace.chapter, ...workspace.additionalChapters].sort((a, b) => a.orderIndex - b.orderIndex);
}

export function withChapters(workspace: WorkspaceSnapshot, chapters: readonly Chapter[], activeId = workspace.chapter.id): WorkspaceSnapshot {
  const ordered = chapters.map((chapter, orderIndex) => ({ ...chapter, orderIndex }));
  const active = ordered.find((chapter) => chapter.id === activeId);
  if (!active) throw new Error("現在の章がありません。");
  return parseWorkspaceSnapshot({
    ...workspace, chapter: active, additionalChapters: ordered.filter((chapter) => chapter.id !== activeId),
    document: { ...workspace.document, chapterIds: ordered.map((chapter) => chapter.id), updatedAt: new Date().toISOString() },
  });
}

export function countDocumentCharacters(body: Chapter["body"]): number {
  return body.content.reduce((sum, paragraph) => sum + ("content" in paragraph ? paragraph.content.reduce((count, node) => count + Array.from(node.text).length, 0) : 0), 0);
}

export function cloneWorkspace(source: WorkspaceSnapshot, identities = new Map<string, string>()): WorkspaceSnapshot {
  function identity(id: string): string {
    const existing = identities.get(id);
    if (existing) return existing;
    const next = crypto.randomUUID(); identities.set(id, next); return next;
  }
  const projectId = identity(source.project.id);
  const documentId = identity(source.document.id);
  const styleProfileId = identity(source.styleProfile.id);
  const chapters = orderedChapters(source).map((chapter) => ({ ...chapter, id: identity(chapter.id), documentId, contentRevision: 0 }));
  const active = chapters[source.chapter.orderIndex];
  return parseWorkspaceSnapshot({
    ...source, storageVersion: 0,
    project: { ...source.project, authoringProfile: remapAuthoringSources(source.project.authoringProfile, identity), id: projectId, styleProfileId, aiConsent: null, contextRevision: 0 },
    document: { ...source.document, id: documentId, projectId, chapterIds: chapters.map((chapter) => chapter.id) },
    chapter: active, additionalChapters: chapters.filter((chapter) => chapter.id !== active.id),
    styleProfile: { ...source.styleProfile, id: styleProfileId, projectId, revision: 0 },
  });
}
