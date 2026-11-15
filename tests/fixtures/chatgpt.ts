import type { ChatGptRecord } from "../../src/server/ai/chatgpt/store";
import type { ChatGptAuthService } from "../../src/server/ai/chatgpt/auth";
import { CHATGPT_MODEL_DEFINITION, CHATGPT_MODEL_ID, CHATGPT_PROVIDER_ID } from "../../src/domain/ai-models";
import type { PublicAiRuntime } from "../../src/features/ai-edit/consent";
import { createCandidateWireResponse } from "./candidates";

export const CHATGPT_CONNECTION_ID = "50000000-0000-4000-8000-000000000001";
export const CHATGPT_MODEL = "gpt-6.1-sol";
export const CHATGPT_RUNTIME: PublicAiRuntime = {
  available: true, connectionId: CHATGPT_CONNECTION_ID, defaultModelId: CHATGPT_MODEL_ID,
  externalDataTransfer: true, models: [CHATGPT_MODEL_DEFINITION], providerId: CHATGPT_PROVIDER_ID,
};
export function chatGptRecord(expiresAt = Date.now() + 3_600_000): ChatGptRecord {
  return {
    version: 1, hostId: "urn:uuid:60000000-0000-4000-8000-000000000001",
    registration: { clientId: "oaiapp_test", email: "writer@example.test", subject: "subject-test" },
    session: {
      accessToken: "test-access-token", connectionId: CHATGPT_CONNECTION_ID, expiresAt,
      idToken: "test-id-token", refreshToken: "test-refresh-token", scopes: ["resource.invoke", "chatgpt.tokens.use.direct"], welcomePending: false,
    },
  };
}
export function chatGptAuthStub(): ChatGptAuthService {
  return {
    async status() { return { connected: true, connectionId: CHATGPT_CONNECTION_ID, email: "writer@example.test", welcomePending: false }; },
    async access() { return "test-access-token"; }, async isCurrent() { return true; },
    async signIn() { return "https://auth.openai.com/api/accounts/authorize?state=test-state"; },
    async disconnect() { return true; }, async acknowledgeWelcome() {},
  };
}
export function chatGptCompleted(output: unknown = createCandidateWireResponse()) {
  return {
    type: "response.completed",
    response: {
      status: "completed", model: CHATGPT_MODEL,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}
export function chatGptStream(events: readonly unknown[], chunkSize = 100_000): Response {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}
