import "server-only";

import { z } from "zod";
import type { AiServerConfigResult } from "../ai/config";
import type { ChatGptAuthService } from "../ai/chatgpt/auth";
import { guardAiEditHttpRequest } from "./guard";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const actionSchema = z.object({ action: z.enum(["sign-in", "disconnect", "acknowledge"]) }).strict();

export async function handleChatGptConnection(request: Request, config: AiServerConfigResult, auth: ChatGptAuthService | null): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { headers, status });
  if (!config.success || config.config.provider.mode !== "chatgpt" || auth === null) return json({ error: "ChatGPT連携は現在無効です。" }, 503);
  const origin = config.config.appOrigin;
  if (request.headers.get("host") !== origin.host ||
    (request.headers.has("origin") && request.headers.get("origin") !== origin.origin) ||
    (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    return json({ error: "この送信元からは接続を変更できません。" }, 403);
  }
  try {
    if (request.method === "GET") return json(await auth.status());
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const guarded = await guardAiEditHttpRequest(request, origin);
    if (!guarded.success) return json({ error: "接続リクエストを検証できませんでした。" }, guarded.code === "FORBIDDEN_ORIGIN" ? 403 : 400);
    const parsed = actionSchema.safeParse(guarded.data.value);
    if (!parsed.success) return json({ error: "接続リクエストが無効です。" }, 400);
    switch (parsed.data.action) {
      case "sign-in": return json({ authorizationUrl: await auth.signIn() });
      case "disconnect": return json({ revocationConfirmed: await auth.disconnect() });
      case "acknowledge": await auth.acknowledgeWelcome(); return json({ ok: true });
    }
  } catch { return json({ error: "ChatGPTへの接続を確認できませんでした。再度接続してください。" }, 503); }
}
