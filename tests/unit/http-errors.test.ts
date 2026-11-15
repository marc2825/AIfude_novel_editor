import { describe, expect, it } from "vitest";

import {
  AI_EDIT_ERROR_CODES,
  aiEditErrorResponseSchema,
} from "../../src/domain/ai-edit";
import {
  createAiEditHttpError,
  type AiEditErrorCode,
} from "../../src/server/http/errors";

const requestId = "10000000-0000-4000-8000-000000000001";

const expectedMappings = {
  AUTH_REQUIRED: [401, false],
  SUBSCRIPTION_LIMIT: [429, false],
  INVALID_REQUEST: [400, false],
  CONSENT_REQUIRED: [403, false],
  FORBIDDEN_ORIGIN: [403, false],
  BODY_TOO_LARGE: [413, false],
  UNSUPPORTED_MEDIA_TYPE: [415, false],
  RATE_LIMITED: [429, true],
  AI_UNAVAILABLE: [503, false],
  PROVIDER_TIMEOUT: [504, true],
  PROVIDER_REFUSAL: [422, false],
  INVALID_OUTPUT: [502, true],
  INCOMPLETE_OUTPUT: [502, true],
  PROVIDER_FAILURE: [502, true],
} as const satisfies Readonly<
  Record<AiEditErrorCode, readonly [status: number, retryable: boolean]>
>;

describe("AI edit safe HTTP errors", () => {
  it.each(AI_EDIT_ERROR_CODES)(
    "maps %s to the canonical envelope and documented status",
    (code) => {
      const result = createAiEditHttpError(code, requestId);
      const [status, retryable] = expectedMappings[code];

      expect(result.status).toBe(status);
      expect(result.body.error).toMatchObject({
        code,
        requestId,
        retryable,
      });
      expect(result.body.error.message.length).toBeGreaterThan(0);
      expect(aiEditErrorResponseSchema.safeParse(result.body).success).toBe(
        true,
      );
    },
  );

  it("uses the canonical nullable request ID before request validation", () => {
    const result = createAiEditHttpError("INVALID_REQUEST", null);

    expect(result.body.error.requestId).toBeNull();
    expect(aiEditErrorResponseSchema.safeParse(result.body).success).toBe(
      true,
    );
  });

  it("does not include exception, payload, or environment details", () => {
    const serialized = JSON.stringify(
      createAiEditHttpError("PROVIDER_FAILURE", null),
    );

    expect(serialized).not.toContain("秘密の本文");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("stack");
  });
});
