// File: contracts/llm-candidates.schema.ts

/**
 * Provider-facing JSON Schema.
 *
 * Candidate count, text length, duplicate detection, and semantic review
 * are application-level responsibilities.
 */
export const LLM_CANDIDATES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          replacementText: {
            type: "string",
          },
          explanation: {
            type: "string",
          },
          riskNotes: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: [
          "replacementText",
          "explanation",
          "riskNotes",
        ],
      },
    },
  },
  required: [
    "candidates",
  ],
} as const;
