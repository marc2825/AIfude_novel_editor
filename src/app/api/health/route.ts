export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  // This public identifier proves readiness to the local launcher; it is not an auth token.
  const id = process.env.NOVEL_EDITOR_LAUNCH_ID;
  const launchId = id && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id) ? id : null;
  return Response.json({ app: "novel-ai-editor", launchId }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
