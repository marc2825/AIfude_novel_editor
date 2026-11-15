import { z } from "zod";
import { codePointLength, hasInvalidUnicodeSurrogate, normalizeContractLineEndings } from "./limits";

export const STORY_MEMORY_FIELD_LIMIT = 2_000;
export const STORY_MEMORY_FIELDS = [
  { key: "settingNotes", label: "設定メモ" },
  { key: "backgroundNotes", label: "背景メモ" },
  { key: "characterNotes", label: "登場人物メモ" },
] as const;

const noteSchema = z.string()
  .refine((value) => !hasInvalidUnicodeSurrogate(value), "不正なUnicodeを含めないでください")
  .refine((value) => codePointLength(value) <= STORY_MEMORY_FIELD_LIMIT, "各メモは2,000文字以内にしてください");

export const storyMemorySchema = z.object({
  settingNotes: noteSchema,
  backgroundNotes: noteSchema,
  characterNotes: noteSchema,
}).strict();

export type StoryMemory = Readonly<z.infer<typeof storyMemorySchema>>;
export type StoryMemoryField = keyof StoryMemory;
export const EMPTY_STORY_MEMORY: StoryMemory = Object.freeze({ settingNotes: "", backgroundNotes: "", characterNotes: "" });

export function hasStoryMemory(memory: StoryMemory | undefined): boolean {
  return memory !== undefined && STORY_MEMORY_FIELDS.some(({ key }) => memory[key].length > 0);
}

export function selectStoryMemory(
  memory: StoryMemory | undefined,
  fields?: readonly StoryMemoryField[],
): StoryMemory | undefined {
  if (memory === undefined) return undefined;
  const included = (key: StoryMemoryField) => fields === undefined || fields.includes(key);
  const selected = Object.freeze({
    settingNotes: included("settingNotes") ? memory.settingNotes : "",
    backgroundNotes: included("backgroundNotes") ? memory.backgroundNotes : "",
    characterNotes: included("characterNotes") ? memory.characterNotes : "",
  });
  return hasStoryMemory(selected) ? selected : undefined;
}

export function storyMemoriesEqual(first: StoryMemory | undefined, second: StoryMemory | undefined): boolean {
  return STORY_MEMORY_FIELDS.every(({ key }) => (first?.[key] ?? "") === (second?.[key] ?? ""));
}

export function storyMemoryCodePoints(memory: StoryMemory) {
  return Object.freeze({
    settingNotes: codePointLength(normalizeContractLineEndings(memory.settingNotes)),
    backgroundNotes: codePointLength(normalizeContractLineEndings(memory.backgroundNotes)),
    characterNotes: codePointLength(normalizeContractLineEndings(memory.characterNotes)),
  });
}
