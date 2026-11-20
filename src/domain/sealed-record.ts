import { z } from "zod";

/** Encrypted content of a secret work. Only IDs are kept as plain, authenticated metadata (see ADR_SECRET_WORKS.md). */
const MAX_SEALED_BASE64 = 150_000_000;
export function base64Bytes(value: string): number | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) return null;
  return value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}
const base64 = (bytes?: number) => z.string().max(MAX_SEALED_BASE64).refine((value) => {
  const length = base64Bytes(value);
  return length !== null && (bytes === undefined || length === bytes);
});
export const SEALED_IV_BYTES = 12;
export const sealedMetaSchema = z.object({
  projectId: z.uuid(), documentId: z.uuid().optional(), storageVersion: z.int().nonnegative().optional(), entryId: z.uuid().optional(),
}).strict();
export type SealedMeta = z.infer<typeof sealedMetaSchema>;
export const sealedRecordSchema = z.object({
  sealed: z.literal(1), kind: z.enum(["workspace", "history", "trash"]), meta: sealedMetaSchema, iv: base64(SEALED_IV_BYTES), data: base64(),
}).strict();
export type SealedRecord = z.infer<typeof sealedRecordSchema>;
export type SealedKind = SealedRecord["kind"];
export const base64Schema = base64;
