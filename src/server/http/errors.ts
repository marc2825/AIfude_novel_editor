import "server-only";

import {
  AI_EDIT_ERROR_CODES,
  type AiEditErrorResponse,
} from "../../domain/ai-edit";

export type AiEditErrorCode = (typeof AI_EDIT_ERROR_CODES)[number];

type SafeErrorDefinition = Readonly<{
  message: string;
  retryable: boolean;
  status: number;
}>;

const errorDefinitions = Object.freeze({
  AUTH_REQUIRED: { message: "ChatGPTへの接続を確認し、再認証してください。", retryable: false, status: 401 },
  SUBSCRIPTION_LIMIT: { message: "ChatGPTの利用枠を確認してください。別providerへの自動切替は行いません。", retryable: false, status: 429 },
  INVALID_REQUEST: {
    message: "リクエストが無効です。",
    retryable: false,
    status: 400,
  },
  CONSENT_REQUIRED: {
    message: "AIへの外部送信には同意が必要です。",
    retryable: false,
    status: 403,
  },
  FORBIDDEN_ORIGIN: {
    message: "この送信元からAI機能は利用できません。",
    retryable: false,
    status: 403,
  },
  BODY_TOO_LARGE: {
    message: "リクエスト本文が大きすぎます。",
    retryable: false,
    status: 413,
  },
  UNSUPPORTED_MEDIA_TYPE: {
    message: "Content-Typeはapplication/jsonを指定してください。",
    retryable: false,
    status: 415,
  },
  RATE_LIMITED: {
    message: "AIの利用上限に達しました。しばらく待って再試行してください。",
    retryable: true,
    status: 429,
  },
  AI_UNAVAILABLE: {
    message: "AI機能は現在利用できません。",
    retryable: false,
    status: 503,
  },
  PROVIDER_TIMEOUT: {
    message: "AIの応答が時間内に完了しませんでした。",
    retryable: true,
    status: 504,
  },
  PROVIDER_REFUSAL: {
    message: "AIがこの編集リクエストを処理できませんでした。",
    retryable: false,
    status: 422,
  },
  INVALID_OUTPUT: {
    message: "AIの応答を安全に検証できませんでした。",
    retryable: true,
    status: 502,
  },
  INCOMPLETE_OUTPUT: {
    message: "AIの応答が途中で終了しました。",
    retryable: true,
    status: 502,
  },
  PROVIDER_FAILURE: {
    message: "AIの処理に失敗しました。",
    retryable: true,
    status: 502,
  },
} as const satisfies Readonly<Record<AiEditErrorCode, SafeErrorDefinition>>);

export type AiEditHttpError = Readonly<{
  body: AiEditErrorResponse;
  status: number;
}>;

export function createAiEditHttpError(
  code: AiEditErrorCode,
  requestId: string | null,
): AiEditHttpError {
  const definition = errorDefinitions[code];

  return Object.freeze({
    body: Object.freeze({
      error: Object.freeze({
        code,
        message: definition.message,
        requestId,
        retryable: definition.retryable,
      }),
    }),
    status: definition.status,
  });
}
