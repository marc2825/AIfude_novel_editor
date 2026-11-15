import { aiSettingsFilename, createAiSettingsStore } from "../../../../server/ai/connection-settings";
import { handleAiConnections } from "../../../../server/http/ai-connections-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request): Promise<Response> {
  try { return await handleAiConnections(request, { environment: process.env, store: createAiSettingsStore(aiSettingsFilename()) }); }
  catch { return Response.json({ error: "AI設定の保存先を確認してください。" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export const GET = handle;
export const POST = handle;
