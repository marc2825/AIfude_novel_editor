// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("environment-specific browser security headers", () => {
  it.each(["development", "production", "test", undefined])("limits eval to development (%s)", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    if (!config.headers) throw new Error("Missing security headers");
    const rules = await config.headers();
    const headers = rules.find((rule) => rule.source === "/:path*")?.headers;
    const csp = headers?.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp?.includes("'unsafe-eval'")).toBe(environment === "development");
  });
});
