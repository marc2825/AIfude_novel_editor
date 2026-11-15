// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";

afterEach(() => vi.unstubAllEnvs());

describe("Host guard for every route", () => {
  it.each(["/", "/api/health", "/_next/image?url=/icons/icon-192.png&w=64&q=75", "/_next/static/app.js", "/sw.js", "/offline"])(
    "rejects a rebinding Host on %s even with a trusted forwarded Host", (path) => {
      vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3100");
      const request = new NextRequest(`http://127.0.0.1:3100${path}`, {
        headers: { host: "attacker.example:3100", "x-forwarded-host": "127.0.0.1:3100" },
      });
      expect(proxy(request).status).toBe(403);
      expect(proxy(request).headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each([null, "localhost:3100", "127.0.0.1:3101", "127.0.0.1:3100.attacker.example", "127.0.0.1:3100,attacker.example"])(
    "rejects missing, alternate, or ambiguous Host %s", (host) => {
      vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3100");
      const request = new NextRequest("http://127.0.0.1:3100/");
      if (host !== null) request.headers.set("host", host);
      expect(proxy(request).status).toBe(403);
    },
  );

  it.each(["http://127.0.0.1:3100", "http://localhost:3100", "http://[::1]:3100"])(
    "allows only the configured loopback authority %s", (origin) => {
      vi.stubEnv("APP_ORIGIN", origin);
      const response = proxy(new NextRequest(origin, { headers: { host: new URL(origin).host } }));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("keeps the default editor available without AI configuration", () => {
    vi.stubEnv("APP_ORIGIN", undefined);
    expect(proxy(new NextRequest("http://127.0.0.1:3000/", {
      headers: { host: "127.0.0.1:3000" },
    })).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["", "https://attacker.example", "http://127.0.0.1:3100/path"])(
    "fails closed with an invalid APP_ORIGIN %s", (origin) => {
      vi.stubEnv("APP_ORIGIN", origin);
      expect(proxy(new NextRequest("http://127.0.0.1:3100/", {
        headers: { host: "127.0.0.1:3100" },
      })).status).toBe(403);
    },
  );
});
