import "server-only";
import type { AiProviderId } from "../../domain/ai-models";

export const AI_RATE_LIMIT_POLICY = Object.freeze({
  concurrentRequests: 1,
  requestsPerDay: 100,
  requestsPerMinute: 6,
});

const minuteMilliseconds = 60_000;
const dayMilliseconds = 24 * 60 * 60 * 1_000;

export type RateLimitedProviderKind = "external" | "mock";
export type AiRateLimitReason = "concurrency" | "daily" | "minute";

export type AiRateLimitPermit = Readonly<{
  release: () => void;
}>;

export type AiRateLimitResult =
  | Readonly<{
      permit: AiRateLimitPermit;
      success: true;
    }>
  | Readonly<{
      reason: AiRateLimitReason;
      success: false;
    }>;

export type AiRateLimiter = Readonly<{
  acquire: (providerKind: RateLimitedProviderKind) => AiRateLimitResult;
}>;

declare global {
  // A provider shares its quota across Next route bundles (single and comparison).
  var novelEditorAiRateLimiters: Map<AiProviderId, AiRateLimiter> | undefined;
}

export function getProviderRateLimiter(providerId: AiProviderId): AiRateLimiter {
  const limiters = globalThis.novelEditorAiRateLimiters ??= new Map();
  let limiter = limiters.get(providerId);
  if (!limiter) { limiter = createAiRateLimiter(); limiters.set(providerId, limiter); }
  return limiter;
}

type Clock = () => number;

function pruneExpired(
  timestamps: number[],
  threshold: number,
): void {
  let expired = 0;

  while (
    expired < timestamps.length &&
    (timestamps[expired] ?? Number.POSITIVE_INFINITY) <= threshold
  ) {
    expired += 1;
  }

  if (expired > 0) {
    timestamps.splice(0, expired);
  }
}

const mockPermit = Object.freeze({ release() {} });

export function createAiRateLimiter(
  now: Clock = Date.now,
): AiRateLimiter {
  const minuteRequests: number[] = [];
  const dailyRequests: number[] = [];
  let activeRequests = 0;

  return Object.freeze({
    acquire(providerKind): AiRateLimitResult {
      if (providerKind === "mock") {
        return { permit: mockPermit, success: true };
      }

      const timestamp = now();

      if (!Number.isFinite(timestamp)) {
        throw new RangeError("rate limiterの時刻は有限値である必要があります。");
      }

      pruneExpired(minuteRequests, timestamp - minuteMilliseconds);
      pruneExpired(dailyRequests, timestamp - dayMilliseconds);

      if (activeRequests >= AI_RATE_LIMIT_POLICY.concurrentRequests) {
        return { reason: "concurrency", success: false };
      }

      if (minuteRequests.length >= AI_RATE_LIMIT_POLICY.requestsPerMinute) {
        return { reason: "minute", success: false };
      }

      if (dailyRequests.length >= AI_RATE_LIMIT_POLICY.requestsPerDay) {
        return { reason: "daily", success: false };
      }

      minuteRequests.push(timestamp);
      dailyRequests.push(timestamp);
      activeRequests += 1;
      let released = false;

      const permit = Object.freeze({
        release() {
          if (released) {
            return;
          }

          released = true;
          activeRequests -= 1;
        },
      });

      return { permit, success: true };
    },
  });
}
