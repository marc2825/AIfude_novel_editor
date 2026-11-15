import { describe, expect, it } from "vitest";

import { createAiRateLimiter } from "../../src/server/http/rate-limit";

function releaseAllowed(result: ReturnType<ReturnType<typeof createAiRateLimiter>["acquire"]>): void {
  expect(result.success).toBe(true);

  if (result.success) {
    result.permit.release();
  }
}

describe("process-local AI rate limiter", () => {
  it("permits only one concurrent external provider request", () => {
    const limiter = createAiRateLimiter(() => 0);
    const first = limiter.acquire("external");

    expect(first.success).toBe(true);
    expect(limiter.acquire("external")).toEqual({
      reason: "concurrency",
      success: false,
    });

    if (first.success) {
      first.permit.release();
      first.permit.release();
    }

    expect(limiter.acquire("external").success).toBe(true);
  });

  it("limits external providers to six starts in a rolling minute", () => {
    let now = 0;
    const limiter = createAiRateLimiter(() => now);

    for (let index = 0; index < 6; index += 1) {
      releaseAllowed(limiter.acquire("external"));
    }

    expect(limiter.acquire("external")).toEqual({
      reason: "minute",
      success: false,
    });

    now = 60_000;
    expect(limiter.acquire("external").success).toBe(true);
  });

  it("limits external providers to one hundred starts in a rolling day", () => {
    let now = 0;
    const limiter = createAiRateLimiter(() => now);

    for (let index = 0; index < 100; index += 1) {
      now = index * 60_000;
      releaseAllowed(limiter.acquire("external"));
    }

    now = 100 * 60_000;
    expect(limiter.acquire("external")).toEqual({
      reason: "daily",
      success: false,
    });

    now = 24 * 60 * 60 * 1_000;
    expect(limiter.acquire("external").success).toBe(true);
  });

  it("exempts mock requests from charge and concurrency accounting", () => {
    const limiter = createAiRateLimiter(() => 0);

    for (let index = 0; index < 150; index += 1) {
      expect(limiter.acquire("mock").success).toBe(true);
    }

    expect(limiter.acquire("external").success).toBe(true);
  });

  it("rejects an invalid injected clock instead of weakening limits", () => {
    const limiter = createAiRateLimiter(() => Number.NaN);

    expect(() => limiter.acquire("external")).toThrow(RangeError);
  });
});
