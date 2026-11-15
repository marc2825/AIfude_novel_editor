import { z } from "zod";
import { AI_PROVIDER_DEFINITIONS, type AiProviderId } from "./ai-models";
import { AI_EDIT_ERROR_CODES, aiEditRequestSchema, aiEditSuccessResponseSchema, type AiEditSuccessResponse, type AiEditErrorCode } from "./ai-edit";

export const MAX_COMPARISON_PROVIDERS = 3;
const providerIdSchema = z.enum(AI_PROVIDER_DEFINITIONS.map((provider) => provider.id));
export const aiComparisonRequestSchema = z.object({
  request: aiEditRequestSchema,
  targets: z.array(z.object({ providerId: providerIdSchema, connectionId: z.uuid().optional() }).strict()).min(2).max(MAX_COMPARISON_PROVIDERS),
  consent: z.literal(true),
}).strict().superRefine((value, context) => {
  if (new Set(value.targets.map((target) => target.providerId)).size !== value.targets.length || value.request.modelId !== null) {
    context.addIssue({ code: "custom", message: "比較対象が重複しているかmodel設定が不正です" });
  }
});

const resultSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), providerId: providerIdSchema, data: aiEditSuccessResponseSchema }).strict(),
  z.object({ success: z.literal(false), providerId: providerIdSchema, code: z.enum(AI_EDIT_ERROR_CODES) }).strict(),
]);
export const aiComparisonResponseSchema = z.object({
  requestId: z.uuid(), results: z.array(resultSchema).min(2).max(MAX_COMPARISON_PROVIDERS),
}).strict().superRefine((value, context) => {
  const ids = value.results.map((result) => result.providerId);
  const candidateIds = value.results.flatMap((result) => result.success ? result.data.candidates.map((candidate) => candidate.id) : []);
  if (new Set(ids).size !== ids.length || new Set(candidateIds).size !== candidateIds.length || value.results.some((result) => result.success &&
    (result.data.provider.providerId !== result.providerId || result.data.requestId !== value.requestId))) {
    context.addIssue({ code: "custom", message: "比較結果のidentityが一致しません" });
  }
});
export type AiComparisonRequest = z.infer<typeof aiComparisonRequestSchema>;
export type AiComparisonResult =
  | Readonly<{ success: true; providerId: AiProviderId; data: AiEditSuccessResponse }>
  | Readonly<{ success: false; providerId: AiProviderId; code: AiEditErrorCode }>;
export type AiComparisonResponse = Readonly<{ requestId: string; results: readonly AiComparisonResult[] }>;
