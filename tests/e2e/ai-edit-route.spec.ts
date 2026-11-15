import { expect, test } from "@playwright/test";

import {
  aiEditSuccessResponseSchema,
} from "../../src/domain/ai-edit";
import { createAiEditRequestFixture } from "../fixtures/candidates";

test("POST /api/ai/edits returns canonical local mock candidates", async ({
  request,
}) => {
  const response = await request.post("/api/ai/edits", {
    data: createAiEditRequestFixture({ candidateCount: 3 }),
    headers: {
      origin: "http://127.0.0.1:3100",
      "sec-fetch-site": "same-origin",
    },
  });
  const body: unknown = await response.json();
  const parsed = aiEditSuccessResponseSchema.safeParse(body);

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["content-type"]).toBe(
    "application/json; charset=utf-8",
  );
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.candidates).toHaveLength(3);
    expect(
      new Set(parsed.data.candidates.map(({ replacementText }) => replacementText)).size,
    ).toBe(3);
    expect(parsed.data.provider).toEqual({
      model: "local-demo",
      providerId: "mock",
    });
    expect(
      parsed.data.candidates.every(
        ({ providerId, requestId }) =>
          providerId === "mock" && requestId === parsed.data.requestId,
      ),
    ).toBe(true);
  }
});
