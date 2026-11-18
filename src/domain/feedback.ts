import { z } from "zod";
import { aiEditRequestSchema, aiEditSuccessResponseSchema } from "./ai-edit";

export const FEEDBACK_TEXT_LIMIT = 6_000;
const boundedText = (maximum: number) => z.string().refine((value) => value.isWellFormed() && Array.from(value).length <= maximum);
export const FEEDBACK_FOCUSES = [
  { id: "general", label: "総合" },
  { id: "typos", label: "誤字脱字" },
  { id: "naturalness", label: "日本語の自然さ" },
] as const;
export type FeedbackFocus = typeof FEEDBACK_FOCUSES[number]["id"];
export const feedbackFocusSchema = z.enum(["general", "typos", "naturalness"]);
export const feedbackRequestSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.uuid(), text: boundedText(FEEDBACK_TEXT_LIMIT).refine((value) => value.trim().length > 0),
  focus: feedbackFocusSchema.optional(),
  consent: aiEditRequestSchema.shape.consent, modelId: aiEditRequestSchema.shape.modelId,
  allowPaidApi: aiEditRequestSchema.shape.allowPaidApi, connectionId: aiEditRequestSchema.shape.connectionId,
}).strict();
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export const feedbackWireSchema = z.object({ candidates: z.array(z.object({
  replacementText: boundedText(1_200).refine((value) => value.trim().length > 0),
  explanation: boundedText(160), riskNotes: z.array(boundedText(120)).max(3),
}).strict()).min(1).max(3) }).strict();
export const feedbackResponseSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.uuid(), provider: aiEditSuccessResponseSchema.shape.provider,
  comments: z.array(z.object({ id: z.uuid(), quote: boundedText(160), comment: boundedText(1_200), cautions: z.array(boundedText(120)).max(3) }).strict()).min(1).max(3),
}).strict();
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;

/** Anchor only within the original, unchanged source, never relocate an old result. */
export function uniqueQuoteRange(text: string, quote: string): { from: number; to: number } | null {
  if (!quote) return null;
  const from = text.indexOf(quote);
  return from < 0 || text.indexOf(quote, from + 1) >= 0 ? null : { from, to: from + quote.length };
}
