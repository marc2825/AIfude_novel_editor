import { z } from "zod";
import { applySecretPayload, secretPayload, secretShell } from "../domain/secret";
import { base64Schema, SEALED_IV_BYTES, sealedMetaSchema, sealedRecordSchema, type SealedKind, type SealedMeta, type SealedRecord } from "../domain/sealed-record";
import type { WorkspaceSnapshot } from "../domain/workspace";

/**
 * Keys and sealing for secret works (docs/roadmap/ADR_SECRET_WORKS.md).
 * A random AES-GCM data key (DEK) encrypts records. Only the DEK wrapped by a
 * password-derived key (PBKDF2-SHA-256) is stored, so a password change re-wraps
 * the DEK without touching sealed records. Nothing here stores or logs secrets.
 */
export const SECRET_VAULT_SCHEMA_VERSION = 1;
export const SECRET_PBKDF2_ITERATIONS = 600_000;
export const SECRET_PASSWORD_MIN_LENGTH = 8;
export const SECRET_PASSWORD_MAX_LENGTH = 256;
const SALT_BYTES = 16;
const IV_BYTES = SEALED_IV_BYTES;

export const secretVaultRecordSchema = z.object({
  schemaVersion: z.literal(SECRET_VAULT_SCHEMA_VERSION),
  kdf: z.object({ name: z.literal("PBKDF2"), hash: z.literal("SHA-256"), iterations: z.int().min(100_000).max(10_000_000), salt: base64Schema(SALT_BYTES) }).strict(),
  wrappedKey: z.object({ iv: base64Schema(IV_BYTES), data: base64Schema() }).strict(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
export type SecretVaultRecord = z.infer<typeof secretVaultRecordSchema>;
export { sealedMetaSchema, sealedRecordSchema, type SealedKind, type SealedMeta, type SealedRecord };

export class SecretPasswordError extends Error {}

export function isSealedRecord(value: unknown): value is SealedRecord {
  return typeof value === "object" && value !== null && (value as { sealed?: unknown }).sealed === 1;
}

/** Returns an error message for an unusable password, or null. Length is counted in code points after NFC. */
export function secretPasswordProblem(password: string): string | null {
  const length = Array.from(password.normalize("NFC")).length;
  if (!password.isWellFormed()) return "使えない文字が含まれています。";
  if (length < SECRET_PASSWORD_MIN_LENGTH) return `パスワードは${SECRET_PASSWORD_MIN_LENGTH}文字以上にしてください。`;
  if (length > SECRET_PASSWORD_MAX_LENGTH) return `パスワードは${SECRET_PASSWORD_MAX_LENGTH}文字以内にしてください。`;
  return null;
}

export async function createSecretVault(password: string, options: { now?: Date; iterations?: number } = {}): Promise<{ record: SecretVaultRecord; key: CryptoKey }> {
  const problem = secretPasswordProblem(password);
  if (problem) throw new SecretPasswordError(problem);
  const iterations = options.iterations ?? SECRET_PBKDF2_ITERATIONS;
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(password, salt, iterations);
  const exportable = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey("raw", exportable, kek, { name: "AES-GCM", iv });
  const now = (options.now ?? new Date()).toISOString();
  const record = secretVaultRecordSchema.parse({
    schemaVersion: SECRET_VAULT_SCHEMA_VERSION, kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: encodeBase64(salt) },
    wrappedKey: { iv: encodeBase64(iv), data: encodeBase64(new Uint8Array(wrapped)) }, createdAt: now, updatedAt: now,
  });
  // Hand out a non-extractable copy; the exportable key is dropped here.
  const key = await unwrapDek(record, kek, false);
  if (!key) throw new Error("鍵を作成できませんでした。");
  return { record, key };
}

/** The data key for a correct password, otherwise null. */
export async function unlockSecretVault(value: SecretVaultRecord, password: string): Promise<CryptoKey | null> {
  const record = secretVaultRecordSchema.parse(value);
  if (!password.isWellFormed()) return null;
  const kek = await deriveKek(password, decodeRequired(record.kdf.salt), record.kdf.iterations);
  return unwrapDek(record, kek, false);
}

/** Re-wrap the data key with a new password. Sealed records stay valid. Null when the current password is wrong. */
export async function changeSecretPassword(value: SecretVaultRecord, currentPassword: string, nextPassword: string, options: { now?: Date; iterations?: number } = {}): Promise<SecretVaultRecord | null> {
  const record = secretVaultRecordSchema.parse(value);
  const problem = secretPasswordProblem(nextPassword);
  if (problem) throw new SecretPasswordError(problem);
  if (!currentPassword.isWellFormed()) return null;
  const currentKek = await deriveKek(currentPassword, decodeRequired(record.kdf.salt), record.kdf.iterations);
  const exportable = await unwrapDek(record, currentKek, true);
  if (!exportable) return null;
  const iterations = options.iterations ?? record.kdf.iterations;
  const salt = randomBytes(SALT_BYTES);
  const nextKek = await deriveKek(nextPassword, salt, iterations);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey("raw", exportable, nextKek, { name: "AES-GCM", iv });
  return secretVaultRecordSchema.parse({
    ...record, kdf: { ...record.kdf, iterations, salt: encodeBase64(salt) },
    wrappedKey: { iv: encodeBase64(iv), data: encodeBase64(new Uint8Array(wrapped)) }, updatedAt: (options.now ?? new Date()).toISOString(),
  });
}

export async function sealJson(key: CryptoKey, kind: SealedKind, meta: SealedMeta, value: unknown): Promise<SealedRecord> {
  const checkedMeta = sealedMetaSchema.parse(meta);
  const iv = randomBytes(IV_BYTES);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData(kind, checkedMeta) }, key, plain);
  return sealedRecordSchema.parse({ sealed: 1, kind, meta: checkedMeta, iv: encodeBase64(iv), data: encodeBase64(new Uint8Array(data)) });
}

/** Decrypts and parses JSON. Throws for a wrong key, edited data or edited metadata. */
export async function openJson(key: CryptoKey, value: SealedRecord): Promise<unknown> {
  const record = sealedRecordSchema.parse(value);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeRequired(record.iv), additionalData: associatedData(record.kind, record.meta) }, key, decodeRequired(record.data));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)) as unknown;
}

function associatedData(kind: SealedKind, meta: SealedMeta): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(["aifude-sealed-v1", kind, meta.projectId, meta.documentId ?? null, meta.storageVersion ?? null, meta.entryId ?? null]));
}

async function deriveKek(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

async function unwrapDek(record: SecretVaultRecord, kek: CryptoKey, extractable: boolean): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.unwrapKey("raw", decodeRequired(record.wrappedKey.data), kek, { name: "AES-GCM", iv: decodeRequired(record.wrappedKey.iv) },
      { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
  } catch { return null; }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> { return crypto.getRandomValues(new Uint8Array(length)); }

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); return bytes; }
  catch { return null; }
}
function decodeRequired(value: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase64(value); if (!bytes) throw new Error("暗号化データが壊れています。"); return bytes;
}

/** Seal the writing of a plain snapshot into a storable shell. */
export async function sealWorkspace(key: CryptoKey, snapshot: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const sealed = await sealJson(key, "workspace", { projectId: snapshot.project.id, documentId: snapshot.document.id }, secretPayload(snapshot));
  return secretShell(snapshot, sealed);
}
/** Decrypt a shell back into a plain snapshot. Throws for a wrong key or edited data. */
export async function openWorkspace(key: CryptoKey, shell: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  if (!shell.secret) return shell;
  if (shell.secret.meta.projectId !== shell.project.id || shell.secret.meta.documentId !== shell.document.id) throw new Error("暗号化データが作品と一致しません。");
  return applySecretPayload(shell, await openJson(key, shell.secret));
}
