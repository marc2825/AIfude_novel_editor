// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  changeSecretPassword, createSecretVault, isSealedRecord, openJson, sealJson, secretPasswordProblem, secretVaultRecordSchema,
  SecretPasswordError, unlockSecretVault, sealWorkspace, openWorkspace, type SealedRecord,
} from "../../src/persistence/secret-vault";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { SECRET_TITLE } from "../../src/domain/secret";

// Tests use the schema minimum to stay fast; the product default is 600,000.
const fast = { iterations: 100_000 };
const projectId = "10000000-0000-4000-8000-000000000001";
const documentId = "10000000-0000-4000-8000-000000000002";
const manuscript = { title: "見せたくない原稿", body: "雨の夜。🙂\n秘密の章" };

describe("secret vault", () => {
  it("unlocks only with the right password, NFC-normalized, and never stores the password or a raw key", async () => {
    const { record, key } = await createSecretVault("ぱすわーど1234", fast);
    expect(secretVaultRecordSchema.parse(record)).toEqual(record);
    expect(JSON.stringify(record)).not.toContain("ぱすわーど");
    expect(key.extractable).toBe(false);
    expect(await unlockSecretVault(record, "ぱすわーど1234")).not.toBeNull();
    expect(await unlockSecretVault(record, "ぱすわーど1235")).toBeNull();
    expect(await unlockSecretVault(record, "ぱすわーど1234".normalize("NFD"))).not.toBeNull();
  });

  it("round-trips sealed JSON, uses a fresh IV, and fails for edited data, edited metadata or another vault", async () => {
    const { key } = await createSecretVault("correct horse", fast);
    const sealed = await sealJson(key, "workspace", { projectId, documentId, storageVersion: 3 }, manuscript);
    expect(isSealedRecord(sealed)).toBe(true); expect(JSON.stringify(sealed)).not.toContain("秘密");
    expect(await openJson(key, sealed)).toEqual(manuscript);
    const again = await sealJson(key, "workspace", { projectId, documentId, storageVersion: 3 }, manuscript);
    expect(again.iv).not.toBe(sealed.iv); expect(again.data).not.toBe(sealed.data);
    const flip = (value: string) => value.slice(0, 4) + (value[4] === "A" ? "B" : "A") + value.slice(5);
    await expect(openJson(key, { ...sealed, data: flip(sealed.data) })).rejects.toThrow();
    await expect(openJson(key, { ...sealed, meta: { ...sealed.meta, storageVersion: 4 } })).rejects.toThrow();
    await expect(openJson(key, { ...sealed, kind: "history" } as SealedRecord)).rejects.toThrow();
    const other = await createSecretVault("another password", fast);
    await expect(openJson(other.key, sealed)).rejects.toThrow();
  });

  it("changes the password by re-wrapping the same data key so earlier records still open", async () => {
    const { record, key } = await createSecretVault("old password", fast);
    const sealed = await sealJson(key, "history", { projectId, entryId: documentId }, manuscript);
    expect(await changeSecretPassword(record, "wrong password", "new password 1", fast)).toBeNull();
    const changed = await changeSecretPassword(record, "old password", "new password 1", fast);
    if (!changed) throw new Error("password change failed");
    expect(changed.kdf.salt).not.toBe(record.kdf.salt); expect(changed.createdAt).toBe(record.createdAt);
    expect(await unlockSecretVault(changed, "old password")).toBeNull();
    const reopened = await unlockSecretVault(changed, "new password 1");
    if (!reopened) throw new Error("unlock failed");
    expect(await openJson(reopened, sealed)).toEqual(manuscript);
  });

  it("rejects short or malformed passwords and invalid stored records", async () => {
    expect(secretPasswordProblem("短い")).toContain("8文字以上");
    expect(secretPasswordProblem("1234567\ud800")).not.toBeNull();
    expect(secretPasswordProblem("八文字のパスワード")).toBeNull();
    await expect(createSecretVault("short", fast)).rejects.toBeInstanceOf(SecretPasswordError);
    const { record } = await createSecretVault("valid password", fast);
    expect(() => secretVaultRecordSchema.parse({ ...record, kdf: { ...record.kdf, iterations: 1_000 } })).toThrow();
    expect(() => secretVaultRecordSchema.parse({ ...record, wrappedKey: { ...record.wrappedKey, iv: "AAAA" } })).toThrow();
    expect(() => secretVaultRecordSchema.parse({ ...record, extra: true })).toThrow();
    expect(isSealedRecord(manuscript)).toBe(false);
  });
  it("stores a work as a shell without its writing and opens it back exactly", async () => {
    const { key } = await createSecretVault("shell password", fast);
    const fixture = createWorkspaceFixture();
    const plain = parseWorkspaceSnapshot({ ...fixture, project: { ...fixture.project, title: "秘密の物語", commonPrompt: "甘く", storyMemory: { settingNotes: "城", backgroundNotes: "", characterNotes: "葵" } },
      chapter: { ...fixture.chapter, title: "告白", outlineNotes: "夜", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "誰にも見せない本文🙂" }] }] } } });
    const shell = await sealWorkspace(key, plain);
    expect(shell.project.title).toBe(SECRET_TITLE); expect(shell.storageVersion).toBe(plain.storageVersion);
    for (const text of ["秘密の物語", "甘く", "城", "葵", "告白", "誰にも見せない"]) expect(JSON.stringify(shell)).not.toContain(text);
    expect(parseWorkspaceSnapshot(shell)).toEqual(shell);
    const opened = await openWorkspace(key, { ...shell, storageVersion: 9 });
    expect(opened).toEqual({ ...plain, storageVersion: 9 }); expect(opened.secret).toBeUndefined();
    await expect(sealWorkspace(key, shell)).rejects.toThrow();
    const other = createWorkspaceFixture({ identity: "replacement" });
    await expect(openWorkspace(key, { ...other, secret: shell.secret })).rejects.toThrow();
  });
});
