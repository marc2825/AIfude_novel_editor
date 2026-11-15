import { z } from "zod";

// Public status only. Credentials never cross this boundary.
export const chatGptConnectionStatusSchema = z.object({
  connected: z.boolean(),
  connectionId: z.uuid().nullable(),
  email: z.string().max(320).nullable(),
  welcomePending: z.boolean(),
  signInFailed: z.boolean().optional(),
}).strict().refine((value) => value.connected === (value.connectionId !== null), { message: "接続状態が不整合です" });
export type ChatGptConnectionStatus = z.infer<typeof chatGptConnectionStatusSchema>;
