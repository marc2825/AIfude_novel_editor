import { z } from "zod";
import { EMPTY_STORY_MEMORY, type StoryMemory } from "./story-memory";

const text = (maximum: number) => z.string().refine((value) => value.isWellFormed() && Array.from(value).length <= maximum);
const stamp = { id: z.uuid(), revision: z.int().nonnegative(), updatedAt: z.iso.datetime() };
const source = z.object({ chapterId: z.uuid(), contentRevision: z.int().nonnegative(), quote: text(300), chapterTitle: text(120).optional() }).strict().nullable();
export const characterProfileSchema = z.object({
  ...stamp, name: text(80).refine((value) => !!value.trim()), aliases: z.array(text(80)).max(20),
  firstPerson: text(80), secondPerson: text(80), addressTerms: text(300), speechStyle: text(500),
  examples: text(500), avoidedExpressions: text(300), source,
}).strict();
export const authoringProfileSchema = z.object({
  version: z.literal(1), revision: z.int().nonnegative(), characters: z.array(characterProfileSchema).max(50),
  vocabulary: z.array(z.object({ ...stamp, preferred: text(80).refine((value) => !!value.trim()), variants: z.array(text(80)).max(20), note: text(200) }).strict()).max(100),
  entries: z.array(z.object({ ...stamp, kind: z.enum(["world", "relationship", "timeline", "summary"]), title: text(80), content: text(1_000), source }).strict()).max(100),
  preservedTerms: z.array(text(80).refine((value) => !!value.trim())).max(100), preservationNote: text(400),
  styleReference: z.object({ description: text(1_000), source }).strict().nullable(),
  presets: z.array(z.object({ ...stamp, name: text(80).refine((value) => !!value.trim()), instruction: text(500).refine((value) => !!value.trim()) }).strict()).max(50),
}).strict().superRefine((profile, context) => {
  const items = [...profile.characters, ...profile.vocabulary, ...profile.entries, ...profile.presets];
  if (new Set(items.map((item) => item.id)).size !== items.length) context.addIssue({ code: "custom", message: "執筆設定のIDが重複しています" });
  if (new Set(profile.preservedTerms).size !== profile.preservedTerms.length) context.addIssue({ code: "custom", message: "保持する文字列が重複しています" });
});
export type AuthoringProfile = z.infer<typeof authoringProfileSchema>;
export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export function emptyAuthoringProfile(): AuthoringProfile {
  return { version: 1, revision: 0, characters: [], vocabulary: [], entries: [], preservedTerms: [], preservationNote: "", styleReference: null, presets: [] };
}
export function snapshotAuthoringProfile(value: AuthoringProfile): AuthoringProfile {
  const profile = authoringProfileSchema.parse(value);
  function freeze(value: unknown): void {
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  freeze(profile); return profile;
}
export function authoringProfilesEqual(first?: AuthoringProfile, second?: AuthoringProfile): boolean {
  return JSON.stringify(authoringProfileSchema.parse(first ?? emptyAuthoringProfile())) === JSON.stringify(authoringProfileSchema.parse(second ?? emptyAuthoringProfile()));
}
export function remapAuthoringSources(profile: AuthoringProfile, identity: (id: string) => string): AuthoringProfile {
  const remapSource = (value: AuthoringProfile["characters"][number]["source"]) => value ? { ...value, chapterId: identity(value.chapterId), contentRevision: 0 } : null;
  return { ...profile, revision: 0,
    characters: profile.characters.map((item) => ({ ...item, id: identity(item.id), revision: 0, source: remapSource(item.source) })),
    entries: profile.entries.map((item) => ({ ...item, id: identity(item.id), revision: 0, source: remapSource(item.source) })),
    vocabulary: profile.vocabulary.map((item) => ({ ...item, id: identity(item.id), revision: 0 })),
    presets: profile.presets.map((item) => ({ ...item, id: identity(item.id), revision: 0 })),
    styleReference: profile.styleReference ? { ...profile.styleReference, source: remapSource(profile.styleReference.source) } : null,
  };
}
export type AuthoringReferenceSelection = Readonly<{ characterIds?: readonly string[]; entryIds?: readonly string[]; style?: boolean; vocabulary?: boolean; preservation?: boolean }>;
export function authoringReferenceMemory(profile: AuthoringProfile | undefined, selection: AuthoringReferenceSelection | undefined, memory?: StoryMemory): StoryMemory | undefined {
  if (!profile || !selection) return memory;
  const characters = profile.characters.filter((item) => selection.characterIds?.includes(item.id));
  const entries = profile.entries.filter((item) => selection.entryIds?.includes(item.id));
  const vocabulary = selection.vocabulary ? profile.vocabulary : [];
  const style = selection.style ? profile.styleReference : null;
  const preservationNote = selection.preservation ? profile.preservationNote : "";
  if (!characters.length && !entries.length && !vocabulary.length && !style && !preservationNote) return memory;
  const append = (original: string, extra: unknown | null) => extra === null ? original : [original, JSON.stringify(extra)].filter(Boolean).join("\n");
  const base = memory ?? EMPTY_STORY_MEMORY;
  return {
    characterNotes: append(base.characterNotes, characters.length ? { characters } : null),
    settingNotes: append(base.settingNotes, entries.length || vocabulary.length ? { entries, vocabulary } : null),
    backgroundNotes: append(base.backgroundNotes, style || preservationNote ? { style, preservationNote } : null),
  };
}
function occurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0, from = 0;
  while (true) { const index = text.indexOf(term, from); if (index < 0) return count; count++; from = index + term.length; }
}
export function changedPreservedTerms(original: string, replacement: string, profile?: AuthoringProfile): string[] {
  return (profile?.preservedTerms ?? []).filter((term) => occurrences(original, term) > 0 && occurrences(original, term) !== occurrences(replacement, term));
}
export function authoringChangeWarnings(original: string, replacement: string, profile?: AuthoringProfile): string[] {
  const names = profile?.characters.flatMap((character) => [character.name, ...character.aliases]) ?? [];
  const terms = [...new Set([...names, ...(profile?.vocabulary.map((item) => item.preferred) ?? []), "私", "僕", "俺", "彼", "彼女"])];
  const changed = terms.filter((term) => term && occurrences(original, term) !== occurrences(replacement, term));
  const warnings = changed.map((term) => `「${term}」の出現回数が変わります。人物・呼称・視点を確認してください。`);
  if (JSON.stringify(original.match(/[0-9０-９]+/gu) ?? []) !== JSON.stringify(replacement.match(/[0-9０-９]+/gu) ?? [])) warnings.push("数値表記が変わります。数量・時系列を確認してください。");
  return warnings;
}

export function hasAuthoringSelection(profile: AuthoringProfile | undefined, selection: AuthoringReferenceSelection | undefined): boolean {
  return !!profile && !!selection && (profile.characters.some((item) => selection.characterIds?.includes(item.id)) ||
    profile.entries.some((item) => selection.entryIds?.includes(item.id)) ||
    (selection.vocabulary === true && profile.vocabulary.length > 0) ||
    (selection.style === true && profile.styleReference !== null) ||
    (selection.preservation === true && profile.preservationNote.length > 0));
}
export function characterStyleWarnings(text: string, profile?: AuthoringProfile, selected?: readonly string[]): string[] {
  if (!profile || !selected?.length) return [];
  const words = new Set(Array.from(new Intl.Segmenter("ja", { granularity: "word" }).segment(text)).filter((item) => item.isWordLike).map((item) => item.segment));
  const pronouns = ["私", "僕", "俺", "あたし", "わたし", "わたくし", "自分"];
  return profile.characters.filter((item) => selected.includes(item.id)).flatMap((character) => {
    const allowed = character.firstPerson.split(/[、,／/]/u).map((value) => value.trim()).filter(Boolean);
    const warnings = allowed.length ? pronouns.filter((value) => words.has(value) && !allowed.includes(value)).map((value) => `${character.name}の一人称「${character.firstPerson}」と異なる「${value}」があります。話者は自動判定していません。`) : [];
    for (const expression of character.avoidedExpressions.split("\n").filter(Boolean)) if (text.includes(expression)) warnings.push(`${character.name}が避ける表現「${expression}」があります。引用や他の話者でないか確認してください。`);
    return warnings;
  });
}
