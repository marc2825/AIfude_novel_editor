import { z } from "zod";
import { orderedChapters } from "./chapters";
import { AI_MODEL_PREFERENCE_AUTOMATIC } from "./ai-models";
import { workspaceSnapshotSchema, parseWorkspaceSnapshot, type WorkspaceSnapshot } from "./workspace";
type HistorySource = { id: string; createdAt: string; label: string; reason: "manual" | "autosave" | "before-restore"; snapshot: WorkspaceSnapshot };

export const MAX_SYNC_BYTES = 10 * 1024 * 1024;
const revision = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const portableWorkspaceSchema = z.object({
  schemaVersion: z.literal(6),
  project: workspaceSnapshotSchema.shape.project.omit({ aiConsent: true, aiModelPreference: true }),
  document: workspaceSnapshotSchema.shape.document,
  chapters: z.array(workspaceSnapshotSchema.shape.chapter).min(1).max(200),
  styleProfile: workspaceSnapshotSchema.shape.styleProfile,
}).strict().superRefine((value, context) => {
  if (!workspaceSnapshotSchema.safeParse({ schemaVersion: 6, storageVersion: 0,
    project: { ...value.project, aiConsent: null, aiModelPreference: AI_MODEL_PREFERENCE_AUTOMATIC },
    document: value.document, chapter: value.chapters[0], additionalChapters: value.chapters.slice(1), styleProfile: value.styleProfile,
  }).success || value.chapters.some((chapter, index) => chapter.orderIndex !== index)) context.addIssue({ code: "custom", message: "同期原稿の参照が不正です。" });
});
const portableHistorySchema = z.object({ id: z.uuid(), createdAt: z.iso.datetime(), label: z.string().min(1).max(120),
  reason: z.enum(["manual", "autosave", "before-restore"]), snapshot: portableWorkspaceSchema }).strict();
export const syncPayloadSchema = z.object({ version: z.literal(1), workspace: portableWorkspaceSchema, history: z.array(portableHistorySchema).max(50) }).strict()
  .superRefine((value, context) => {
    if (new Set(value.history.map((entry) => entry.id)).size !== value.history.length || value.history.some((entry) => entry.snapshot.project.id !== value.workspace.project.id)) context.addIssue({ code: "custom", message: "同期履歴の参照が不正です。" });
  });
export type SyncPayload = z.infer<typeof syncPayloadSchema>;
export function parseSyncPayload(value: unknown): SyncPayload {
  assertSyncSize(value); return syncPayloadSchema.parse(value);
}
export function assertSyncSize(value: unknown): void {
  const text = JSON.stringify(value);
  if (text === undefined || new TextEncoder().encode(text).byteLength > MAX_SYNC_BYTES) throw new Error("同期データは10MiB以下にしてください。章や履歴は自動で削減しません。");
}
function portableWorkspace(value: WorkspaceSnapshot): SyncPayload["workspace"] {
  const snapshot = parseWorkspaceSnapshot(value);
  const { aiConsent: _consent, aiModelPreference: _model, ...project } = snapshot.project; void _consent; void _model;
  return portableWorkspaceSchema.parse({ schemaVersion: 6, project, document: snapshot.document, chapters: orderedChapters(snapshot), styleProfile: snapshot.styleProfile });
}
export function createSyncPayload(snapshot: WorkspaceSnapshot, history: readonly HistorySource[]): SyncPayload {
  return parseSyncPayload({ version: 1, workspace: portableWorkspace(snapshot), history: history.map((value) => {
    const entry = value;
    return { id: entry.id, createdAt: entry.createdAt, label: entry.label, reason: entry.reason, snapshot: portableWorkspace(entry.snapshot) };
  }).sort((a, b) => a.id.localeCompare(b.id)) });
}
export function workspaceFromSync(value: SyncPayload["workspace"]): WorkspaceSnapshot {
  return workspaceSnapshotSchema.parse({ schemaVersion: 6, storageVersion: 0, project: { ...value.project, aiConsent: null, aiModelPreference: AI_MODEL_PREFERENCE_AUTOMATIC },
    document: value.document, chapter: value.chapters[0], additionalChapters: value.chapters.slice(1), styleProfile: value.styleProfile });
}
export function historyFromSync(payload: SyncPayload): (HistorySource & { schemaVersion: 1; projectId: string })[] {
  return payload.history.map((entry) => ({ ...entry, schemaVersion: 1, projectId: payload.workspace.project.id, snapshot: workspaceFromSync(entry.snapshot) }));
}
export const syncRequestSchema = z.object({ version: z.literal(1), operationId: z.uuid(), deviceId: z.uuid(), projectId: z.uuid(), baseRevision: revision, payload: syncPayloadSchema }).strict()
  .refine((value) => value.projectId === value.payload.workspace.project.id, "同期作品IDが一致しません。");
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export function parseSyncRequest(value: unknown): SyncRequest { assertSyncSize(value); return syncRequestSchema.parse(value); }
export const syncResponseSchema = z.discriminatedUnion("status", [
  z.object({ version: z.literal(1), status: z.literal("applied"), operationId: z.uuid(), projectId: z.uuid(), revision: revision.positive() }).strict(),
  z.object({ version: z.literal(1), status: z.literal("conflict"), operationId: z.uuid(), projectId: z.uuid(), revision: revision.positive(), payload: syncPayloadSchema }).strict(),
]);
export type SyncResponse = z.infer<typeof syncResponseSchema>;
export function parseSyncResponse(value: unknown): SyncResponse { assertSyncSize(value); return syncResponseSchema.parse(value); }
export const remoteSyncSchema = z.object({ version: z.literal(1), revision: revision.positive(), payload: syncPayloadSchema }).strict();
export type RemoteSync = z.infer<typeof remoteSyncSchema>;
export const syncCopySchema = z.object({ id: z.uuid(), createdAt: z.iso.datetime(), revision, source: z.enum(["local-conflict", "remote-conflict", "remote"]), payload: syncPayloadSchema }).strict();
export const syncStateSchema = z.object({ version: z.literal(1), projectId: z.uuid(), deviceId: z.uuid(), enabled: z.boolean(), sequence: revision,
  remoteRevision: revision, pending: syncRequestSchema.nullable(), lastUploaded: syncPayloadSchema.nullable(),
  conflict: z.boolean(), copies: z.array(syncCopySchema).max(20), lastError: z.enum(["offline", "auth", "network", "invalid", "limit", "unconfigured"]).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.pending && (value.pending.projectId !== value.projectId || value.pending.deviceId !== value.deviceId)) ||
    (value.lastUploaded && value.lastUploaded.workspace.project.id !== value.projectId) || value.copies.some((copy) => copy.payload.workspace.project.id !== value.projectId) ||
    new Set(value.copies.map((copy) => copy.id)).size !== value.copies.length) context.addIssue({ code: "custom", message: "同期状態の参照が不正です。" });
});
export type SyncState = z.infer<typeof syncStateSchema>;
export function emptySyncState(projectId: string): SyncState {
  return syncStateSchema.parse({ version: 1, projectId, deviceId: crypto.randomUUID(), enabled: false, sequence: 0, remoteRevision: 0, pending: null,
    lastUploaded: null, conflict: false, copies: [], lastError: null });
}
