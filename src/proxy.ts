import { NextResponse, type NextRequest } from "next/server";
import { parseLoopbackAppOrigin } from "./server/ai/config";

export function proxy(request: NextRequest) {
  const origin = parseLoopbackAppOrigin(
    process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
  );
  if (origin === null || request.headers.get("host") !== origin.host) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

// Include framework routes and static assets in the Host check.
export const config = { matcher: "/:path*" };
