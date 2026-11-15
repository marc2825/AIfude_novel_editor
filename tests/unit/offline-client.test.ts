import { afterEach, expect, it, vi } from "vitest";
import { postAiEditRequest } from "../../src/features/ai-edit/client";
import { postAiComparisonRequest } from "../../src/features/ai-edit/comparison-client";
import { requestFeedback } from "../../src/features/feedback/feedback-client";
import { createAiEditRequestFixture } from "../fixtures/candidates";
afterEach(() => vi.unstubAllGlobals());
it("does not send edits, dictionary generation, comparisons or feedback while offline", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const request = createAiEditRequestFixture(); const signal = new AbortController().signal;
  expect((await postAiEditRequest(request, signal)).status).toBe("error");
  expect((await postAiComparisonRequest({ request, targets: [{ providerId: "mock" }, { providerId: "local" }], consent: true }, signal)).status).toBe("error");
  await expect(requestFeedback({ schemaVersion: 1, requestId: request.requestId, text: "原稿。", consent: null, modelId: null }, signal)).rejects.toThrow("接続");
  window.dispatchEvent(new Event("online")); expect(fetch).not.toHaveBeenCalled();
});
