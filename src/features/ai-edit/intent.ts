import type { AiTextOperation } from "../../domain/completion";
import {
  EDIT_INTENT_ALLOWED_BY_KIND,
  EDIT_INTENT_LENGTH_BY_KIND,
  EDIT_INTENT_PRESERVE,
  validateAiEditRequest,
  type AiEditPresetId,
  type AiEditRequest,
  type AiEditRequestDraft,
  type EditIntent,
  type EditIntentKind,
} from "../../domain/ai-edit";
import { normalizeContractLineEndings } from "../../domain/limits";

export const EDIT_PRESET_DEFAULT_INSTRUCTIONS = Object.freeze({
  polish: "自然に",
  shorten: "短く",
  dialogue: "台詞を自然に",
  connection: "前後との接続を改善する",
  transform: "出来事・人物・視点・事実を保ち、指定した雰囲気に文体を変換してください。",
  expand: "出来事・人物・視点・事実を保ち、原文にある描写を丁寧に言葉にして、選択範囲を膨らませてください。新しい設定や出来事は追加しないでください。",
  freeform: "出来事・人物・視点・事実を保ち、指定した表現に変換してください。",
} as const satisfies Readonly<Record<AiEditPresetId, string>>);

const intentNotes = Object.freeze({
  polish: "意味を保ちながら、自然で読みやすい表現に整えます。",
  shorten: "意味を保ちながら、冗長な表現を減らします。",
  dialogue: "台詞の意味を保ちながら、語彙・語順・口調を整えます。",
  connection: "意味を保ちながら、前後の接続と局所的な文構造を整えます。",
  custom: "固定の保持条件内で、保守的に表現を整えます。",
  transform: "出来事・人物・視点・事実を保ち、指定した雰囲気へ文体を変換します。",
  expand: "新しい事実を加えず、原文の描写や表現を丁寧に膨らませます。",
  freeform: "出来事・人物・視点・事実を保ち、自由指示に応じて表現や長さを調整します。",
} as const satisfies Readonly<Record<EditIntentKind, string>>);

const exactInstructionRules: ReadonlyArray<
  readonly [instruction: string, kind: AiEditPresetId]
> = Object.freeze([
  ["自然に", "polish"],
  ["もっと自然に", "polish"],
  ["元の意味を変えず洗練する", "polish"],
  ["短く", "shorten"],
  ["少し短く", "shorten"],
  ["冗長な箇所を削る", "shorten"],
  ["台詞を自然に", "dialogue"],
  ["前後との接続を改善する", "connection"],
]);

export type EditIntentInput = Readonly<{
  instruction: string;
  presetId: AiEditPresetId | null;
}>;

function exactInstructionKind(instruction: string): AiEditPresetId | null {
  const normalizedInstruction = normalizeContractLineEndings(instruction);

  return (
    exactInstructionRules.find(
      ([registeredInstruction]) =>
        registeredInstruction === normalizedInstruction,
    )?.[1] ?? null
  );
}

export function createEditIntent(input: EditIntentInput): EditIntent {
  const exactKind = exactInstructionKind(input.instruction);
  const kind = input.presetId ?? exactKind ?? "custom";
  const inferredFrom =
    input.presetId !== null
      ? "preset"
      : exactKind !== null
        ? "exact-rule"
        : "conservative-default";

  return Object.freeze({
    allowedChanges: Object.freeze([
      ...EDIT_INTENT_ALLOWED_BY_KIND[kind],
    ]),
    inferredFrom,
    kind,
    lengthTarget: EDIT_INTENT_LENGTH_BY_KIND[kind],
    note: intentNotes[kind],
    preserve: Object.freeze([...EDIT_INTENT_PRESERVE]),
  });
}

export function getPresetDefaultInstruction(
  presetId: AiEditPresetId,
): string {
  return EDIT_PRESET_DEFAULT_INSTRUCTIONS[presetId];
}

export type AiEditLocalControl = Readonly<{
  consent: AiEditRequest["consent"];
  presetId: AiEditRequest["presetId"];
  requestId: string;
}>;

export type AiEditModelInput = Readonly<{
  storyMemory?: AiEditRequest["storyMemory"];
  operation?: AiTextOperation;
  targetCharacters?: number;
  afterText: string;
  beforeText: string;
  candidateCount: AiEditRequest["candidateCount"];
  editIntent: EditIntent;
  globalContext: AiEditRequest["globalContext"];
  selectionText: string;
  taskInstruction: string;
}>;

export type AiEditRequestContract = Readonly<{
  control: AiEditLocalControl;
  modelInput: AiEditModelInput;
}>;

export type AiEditRequestContractResult =
  | Readonly<{ data: AiEditRequestContract; success: true }>
  | Readonly<{ reason: "invalid-request"; success: false }>;

function freezeConsent(
  consent: AiEditRequest["consent"],
): AiEditRequest["consent"] {
  return consent === null ? null : Object.freeze({ ...consent });
}

export function createAiEditRequestContract(
  value: unknown,
): AiEditRequestContractResult {
  const validation = validateAiEditRequest(value);

  if (!validation.success) {
    return validation;
  }

  const request = validation.data;
  const control = Object.freeze({
    consent: freezeConsent(request.consent),
    presetId: request.presetId,
    requestId: request.requestId,
  });
  const modelInput = createAiEditModelInput(request);

  return {
    data: Object.freeze({ control, modelInput }),
    success: true,
  };
}

export function createAiEditModelInput(request: AiEditRequestDraft): AiEditModelInput {
  return Object.freeze({
    ...(request.storyMemory === undefined ? {} : { storyMemory: Object.freeze({ ...request.storyMemory }) }),
    ...(request.operation === undefined ? {} : { operation: request.operation }),
    ...(request.targetCharacters === undefined ? {} : { targetCharacters: request.targetCharacters }),
    afterText: request.afterText,
    beforeText: request.beforeText,
    candidateCount: request.candidateCount,
    editIntent: createEditIntent({ instruction: request.instruction, presetId: request.presetId }),
    globalContext: Object.freeze({ ...request.globalContext }),
    selectionText: request.selectionText,
    taskInstruction: request.instruction,
  });
}
