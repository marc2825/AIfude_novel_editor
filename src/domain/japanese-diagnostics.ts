import { z } from "zod";

export const DIAGNOSTIC_LIMIT = 1_000;
export const DIAGNOSTIC_TEXT_LIMIT = 1_000_000;
export const diagnosticIssueSchema = z.object({
  id: z.string(), rule: z.string(), key: z.string(), from: z.int().nonnegative(), to: z.int().positive(),
  title: z.string(), evidence: z.string(), suggestion: z.string(),
}).strict();
export type DiagnosticIssue = z.infer<typeof diagnosticIssueSchema>;
export const diagnosticAnalysisSchema = z.object({
  issues: z.array(diagnosticIssueSchema).max(DIAGNOSTIC_LIMIT), truncated: z.boolean(),
  stats: z.object({ characters: z.int(), sentences: z.int(), averageLength: z.number(),
    longestSentence: z.int(), shortSentences: z.int(), longSentences: z.int(), dialogueRatio: z.number(),
    kanjiRatio: z.number(), hiraganaRatio: z.number(), commas: z.int(), periods: z.int(),
  }).strict(),
}).strict();
export type DiagnosticAnalysis = z.infer<typeof diagnosticAnalysisSchema>;

const sentences = new Intl.Segmenter("ja", { granularity: "sentence" });
const words = new Intl.Segmenter("ja", { granularity: "word" });
const particles = new Set(["の", "に", "を", "が", "で", "と", "は", "も", "へ"]);
const stopWords = new Set([...particles, "た", "だ", "です", "ます", "する", "いる", "ある", "し", "て", "ない", "こと", "よう", "それ", "これ"]);
const redundant = ["頭痛が痛い", "一番最初", "まず最初", "後で後悔", "過半数を超える", "違和感を感じる"];
const spellings = [["出来る", "できる"], ["分かる", "わかる"], ["下さい", "ください"], ["すべて", "全て"]];
const connectors = ["しかし", "そして", "だから", "それから", "けれど", "だが", "つまり"];

/** UTF-16 offsets into the exact input. Nothing is normalized or corrected. */
export function analyzeJapanese(text: string): DiagnosticAnalysis {
  if (!text.isWellFormed() || text.length > DIAGNOSTIC_TEXT_LIMIT) throw new Error("解析する章は100万UTF-16文字以内にしてください。");
  const issues: DiagnosticIssue[] = [];
  let truncated = false;
  function add(rule: string, key: string, from: number, to: number, title: string, evidence: string, suggestion: string) {
    if (issues.length >= DIAGNOSTIC_LIMIT) { truncated = true; return; }
    if (to <= from) return;
    issues.push({ id: `${rule}:${from}:${to}`, rule, key, from, to, title, evidence, suggestion });
  }
  let count = 0, total = 0, longest = 0, short = 0, long = 0;
  let previousEnding = "", endingRun = 0, previousConnector = "";
  const recentWords = new Map<string, number[]>();
  const seenSpellings = new Map<string, number>();
  for (const sentence of sentences.segment(text)) {
    const trimmed = sentence.segment.trim();
    if (!trimmed) continue;
    const length = Array.from(trimmed).length;
    count++; total += length; longest = Math.max(longest, length);
    if (length <= 20) short++;
    if (length >= 80) {
      long++;
      add("length", "80", sentence.index, sentence.index + sentence.segment.trimEnd().length,
        "長い文の確認", `${length}文字（目安80文字以上）`, "息継ぎや焦点を確認し、必要なら文を分けてください。");
    }
    const ending = trimmed.replace(/[。！？!?」』）\s]+$/u, "").match(/(でした|ました|ません|だった|である|です|ます|ない|た|だ)$/u)?.[0] ?? "";
    endingRun = ending && ending === previousEnding ? endingRun + 1 : 1;
    if (ending && endingRun >= 3) add("ending", ending, sentence.index, sentence.index + sentence.segment.trimEnd().length,
      "語尾の連続", `「${ending}」が${endingRun}文連続（目安3文）`, "意図したリズムなら無視できます。意味を保って文末の変化を検討してください。");
    previousEnding = ending;
    const connector = connectors.find((value) => trimmed.replace(/^[「『]/u, "").startsWith(value)) ?? "";
    if (connector && connector === previousConnector) add("connector", connector, sentence.index, sentence.index + sentence.segment.trimEnd().length,
      "接続表現の反復", `隣接する文が「${connector}」で始まります`, "つながりが明らかな箇所で省略できるか確認してください。");
    previousConnector = connector;
    const particleCount = new Map<string, number>();
    const tokens = [...words.segment(sentence.segment)].filter((token) => token.isWordLike);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const from = sentence.index + token.index;
      seenSpellings.set(token.segment, from);
      if (particles.has(token.segment)) particleCount.set(token.segment, (particleCount.get(token.segment) ?? 0) + 1);
      const previous = tokens[index - 1];
      if (previous && previous.segment === token.segment && previous.index + previous.segment.length === token.index &&
          Array.from(token.segment).length >= 2 && /\p{Script=Han}/u.test(token.segment)) add("typo", token.segment, sentence.index + previous.index, from + token.segment.length,
        "誤字の候補", `「${token.segment}」が続けて2回あります`, "入力の重複でないか確認してください。意図した反復なら無視できます。");
      if (Array.from(token.segment).length < 2 || stopWords.has(token.segment)) continue;
      const keys = [token.segment];
      const next = tokens[index + 1];
      if (next && !stopWords.has(next.segment) && next.index === token.index + token.segment.length) keys.push(token.segment + next.segment);
      for (const key of keys) {
        const recent = (recentWords.get(key) ?? []).filter((offset) => from - offset <= 200);
        recent.push(from); recentWords.set(key, recent);
        if (recent.length === 3) add("repetition", key, from, from + key.length, "語・表現の反復",
          `「${key}」が200 UTF-16文字以内に3回。語境界はIntl.Segmenterによる推定`, "台詞・固有名詞・意図した反復を含みます。必要な場合だけ言い換えを検討してください。");
      }
    }
    for (const [particle, occurrences] of particleCount) if (occurrences >= 4) add("particle", particle, sentence.index, sentence.index + sentence.segment.trimEnd().length,
      "助詞候補の反復", `区切られた「${particle}」が1文に${occurrences}回（品詞の確定ではありません）`, "修飾関係と読みやすさを確認してください。");
  }
  for (const expression of redundant) for (const match of text.matchAll(new RegExp(expression, "gu"))) add("redundancy", expression, match.index, match.index + expression.length,
    "冗長表現の確認", `登録表現「${expression}」に一致`, "強調や台詞の意図を確認し、必要な場合だけ簡潔にしてください。");
  for (const variants of spellings) if (variants.every((variant) => seenSpellings.has(variant))) {
    for (const variant of variants) {
      const from = seenSpellings.get(variant);
      if (from === undefined) continue;
      add("spelling", variants.join("/"), from, from + variant.length, "表記ゆれの確認", `「${variants.join(" / ")}」が同じ章にあります`, "文脈や話者による使い分けなら維持してください。");
    }
  }
  const pairs: Record<string, string> = { "「": "」", "『": "』", "（": "）", "(": ")", "【": "】", "［": "］" };
  const closing = new Set(Object.values(pairs));
  const stack: { character: string; offset: number }[] = [];
  let dialogue = 0, dialogueDepth = 0, offset = 0;
  for (const character of text) {
    if (character === "「" || character === "『") dialogueDepth++;
    if (dialogueDepth > 0) dialogue++;
    if (character === "」" || character === "』") dialogueDepth = Math.max(0, dialogueDepth - 1);
    if (pairs[character]) stack.push({ character, offset });
    else if (closing.has(character)) {
      const opening = stack.at(-1);
      if (opening && pairs[opening.character] === character) stack.pop();
      else add("bracket", character, offset, offset + character.length, "括弧の対応を確認", `閉じ括弧「${character}」に対応する開き括弧がありません`, "章をまたぐ台詞など意図した省略なら無視できます。");
    }
    offset += character.length;
  }
  for (const opening of stack) add("bracket", opening.character, opening.offset, opening.offset + 1, "括弧の対応を確認", `「${opening.character}」が閉じられていません`, "章をまたぐ台詞など意図した省略なら無視できます。");
  for (const match of text.matchAll(/をを|がが|にに|でで/gu)) add("typo", match[0], match.index, match.index + match[0].length, "誤字の候補",
    `助詞「${match[0].slice(0, 1)}」が続いています`, "入力の重複でないか確認してください。語の一部や意図した表現なら無視できます。");
  for (const match of text.matchAll(/[、。]{2,}/gu)) add("punctuation", match[0], match.index, match.index + match[0].length, "句読点の連続", `「${match[0]}」が連続しています`, "間や余韻の表現なら維持してください。");
  const characters = Array.from(text).length;
  return { issues: issues.sort((a, b) => a.from - b.from || a.rule.localeCompare(b.rule)), truncated,
    stats: { characters, sentences: count, averageLength: count ? total / count : 0, longestSentence: longest,
      shortSentences: short, longSentences: long, dialogueRatio: characters ? dialogue / characters : 0,
      kanjiRatio: characters ? (text.match(/\p{Script=Han}/gu)?.length ?? 0) / characters : 0,
      hiraganaRatio: characters ? (text.match(/\p{Script=Hiragana}/gu)?.length ?? 0) / characters : 0,
      commas: (text.match(/、/gu)?.length ?? 0), periods: (text.match(/。/gu)?.length ?? 0) } };
}
