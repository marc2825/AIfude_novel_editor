import "server-only";

import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const token = z.string().min(1).max(32_768);
const registrationSchema = z.object({
  clientId: z.string().min(1).max(256).refine((value) => value !== "dynamic_agent_client"),
  email: z.string().max(320).nullable(),
  subject: z.string().min(1).max(256),
}).strict();
const sessionSchema = z.object({
  accessToken: token,
  connectionId: z.uuid(),
  expiresAt: z.number().int().positive(),
  idToken: token,
  refreshToken: token,
  scopes: z.array(z.string().max(128)).max(20),
  welcomePending: z.boolean(),
}).strict();
const recordSchema = z.object({
  hostId: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/u),
  registration: registrationSchema.nullable(),
  session: sessionSchema.nullable(),
  version: z.literal(1),
}).strict().refine((record) => record.session === null || record.registration !== null, { message: "Missing registration" });

export type ChatGptRecord = z.infer<typeof recordSchema>;
export type ChatGptStore = Readonly<{
  read: () => Promise<ChatGptRecord | null>;
  update: <T>(operation: (record: ChatGptRecord) => Promise<Readonly<{ record: ChatGptRecord; value: T }>>, signal?: AbortSignal) => Promise<T>;
}>;

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createChatGptStore(directory: string): ChatGptStore {
  const filename = join(directory, "connection.json");
  async function read(): Promise<ChatGptRecord | null> {
    let file;
    try {
      file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error: unknown) {
      if (missing(error)) return null;
      throw error;
    }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 131_072 || (info.mode & 0o077) !== 0) {
        throw new Error("Unprotected credentials");
      }
      const value: unknown = JSON.parse(await file.readFile("utf8"));
      return recordSchema.parse(value);
    } finally {
      await file.close();
    }
  }

  return {
    read,
    async update(operation, signal) {
      await mkdir(directory, { mode: 0o700, recursive: true });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid credential directory");
      await chmod(directory, 0o700);
      const lockPath = join(directory, "connection.lock");
      const deadline = Date.now() + 10_000;
      let lock;
      while (lock === undefined) {
        signal?.throwIfAborted();
        try {
          lock = await open(lockPath, "wx", 0o600);
        } catch (error: unknown) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST") || Date.now() >= deadline) throw error;
          await delay(50, undefined, { signal });
        }
      }
      const temporary = join(directory, `${randomUUID()}.tmp`);
      try {
        const current = await read() ?? { hostId: `urn:uuid:${randomUUID()}`, registration: null, session: null, version: 1 };
        const result = await operation(current);
        signal?.throwIfAborted();
        const data = recordSchema.parse(result.record);
        const output = await open(temporary, "wx", 0o600);
        try {
          await output.writeFile(JSON.stringify(data));
          await output.sync();
        } finally {
          await output.close();
        }
        await rename(temporary, filename);
        return result.value;
      } finally {
        await unlink(temporary).catch(() => undefined);
        await lock.close();
        await unlink(lockPath);
      }
    },
  };
}
