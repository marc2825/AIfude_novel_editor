import { z } from "zod";

const annotationText = z.string().min(1).refine((value) => value.isWellFormed() && !/[\r\n]/u.test(value) && Array.from(value).length <= 80);
export const rubyAttributesSchema = z.object({ reading: annotationText, base: annotationText }).strict();
export const annotationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ruby"), attrs: rubyAttributesSchema }).strict(),
  z.object({ type: z.literal("emphasis") }).strict(),
]);
export const manuscriptTextSchema = z.object({ type: z.literal("text"), text: z.string().min(1).refine((value) => value.isWellFormed() && !/[\r\n]/u.test(value)),
  marks: z.array(annotationSchema).length(1).optional(),
}).strict();
export const manuscriptDocumentSchema = z.object({ type: z.literal("doc"), content: z.array(z.union([
  z.object({ type: z.literal("paragraph") }).strict(),
  z.object({ type: z.literal("paragraph"), content: z.array(manuscriptTextSchema).min(1) }).strict(),
])).min(1) }).strict();
export type ManuscriptDocument = z.infer<typeof manuscriptDocumentSchema>;
export type ManuscriptText = z.infer<typeof manuscriptTextSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type PublicationFormat = "kakuyomu" | "narou" | "pixiv";

export function manuscriptPlainText(body: ManuscriptDocument): string {
  return body.content.map((paragraph) => "content" in paragraph ? paragraph.content.map((node) => node.text).join("") : "").join("\n");
}
/** PM merges equal adjacent marks; normalizing here also makes imported splits deterministic. */
export function paragraphRuns(paragraph: ManuscriptDocument["content"][number]): ManuscriptText[] {
  const result: ManuscriptText[] = [];
  if (!("content" in paragraph)) return result;
  for (const node of paragraph.content) {
    const previous = result.at(-1);
    if (previous && JSON.stringify(previous.marks) === JSON.stringify(node.marks)) previous.text += node.text;
    else result.push({ ...node });
  }
  return result;
}
export function annotationProblems(body: ManuscriptDocument): string[] {
  return body.content.flatMap((paragraph, index) => paragraphRuns(paragraph).flatMap((node) => {
    const mark = node.marks?.[0];
    return mark?.type === "ruby" && mark.attrs.base !== node.text ? [`段落${index + 1}：「${node.text}」の親文字が変わっています。読み「${mark.attrs.reading}」を確認してルビを付け直してください。`] : [];
  }));
}
/** pixiv: only the ruby tag documented in pixiv's 2014-12-24 announcement; readings use kana, kanji or Latin letters. */
// Decomposed kana (か + U+3099) is still kana: test the NFC form and allow combining voiced marks that have no precomposed form.
const PIXIV_READING = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ーA-Za-zＡ-Ｚａ-ｚ\u3099\u309A]+$/u;
export function publicationText(bodyValue: ManuscriptDocument, format: PublicationFormat): string {
  const body = manuscriptDocumentSchema.parse(bodyValue);
  const problems = annotationProblems(body); if (problems.length) throw new Error(problems[0]);
  return body.content.map((paragraph, index) => paragraphRuns(paragraph).map((node) => {
    const mark = node.marks?.[0];
    // No undocumented escape is guessed. Original literals are always preserved in JSON/plain TXT.
    if (/[｜|《》]/u.test(node.text) || (format === "narou" && /[（(]/u.test(node.text)) || (format === "pixiv" && /[[\]]/u.test(node.text))) throw new Error(`段落${index + 1}に投稿記法と衝突する文字があります。本文を変えずに出力できないため、JSON/プレーンテキストを使ってください。`);
    if (mark?.type === "ruby" && format === "pixiv") {
      if (node.text.includes(">") || !PIXIV_READING.test(mark.attrs.reading.normalize("NFC"))) throw new Error(`段落${index + 1}：「${node.text}」のルビはpixivの記法で出力できません。読みはひらがな・カタカナ・漢字・英字だけにし、親文字に「>」を含めないでください。`);
      return `[[rb:${node.text} > ${mark.attrs.reading}]]`;
    }
    if (mark?.type === "ruby") {
      const maximumBase = format === "kakuyomu" ? 20 : 10, maximumReading = format === "kakuyomu" ? 50 : 10;
      if (Array.from(node.text).length > maximumBase || Array.from(mark.attrs.reading).length > maximumReading || /[｜|《》]/u.test(mark.attrs.reading) || (format === "narou" && /[&"<>]/u.test(node.text + mark.attrs.reading))) throw new Error(`段落${index + 1}のルビは${maximumBase}文字の親文字・${maximumReading}文字の読みと、投稿先の記号制限を確認してください。`);
      return `｜${node.text}《${mark.attrs.reading}》`;
    }
    if (mark?.type === "emphasis") {
      if (format === "narou") throw new Error("なろうの傍点記法は未対応です。傍点を含む原稿はJSONで保持し、投稿先の入力補助で設定してください。");
      if (format === "pixiv") throw new Error("pixivの傍点記法は公式資料で確認できないため出力できません。傍点を含む原稿はJSONで保持し、投稿先で設定してください。");
      return `《《${node.text}》》`;
    }
    return node.text;
  }).join("")).join("\n");
}
/** Explicit import of this app's supported publication subset; never used on ordinary text input. */
export function parsePublicationText(text: string, format: PublicationFormat): ManuscriptDocument {
  if (text.length > 1_000_000 || !text.isWellFormed() || text.includes("\r")) throw new Error("変換対象が不正です。");
  const body = manuscriptDocumentSchema.parse({ type: "doc", content: text.split("\n").map((line) => {
    const content: ManuscriptText[] = []; let position = 0;
    while (position < line.length) {
      const rest = line.slice(position);
      const ruby = format === "pixiv" ? /^\[\[rb:([^[\]>]+) > ([^[\]>]+)\]\]/u.exec(rest) : /^｜([^｜|《》]+)《([^｜|《》]+)》/u.exec(rest);
      const emphasis = format === "kakuyomu" ? /^《《([^｜|《》]+)》》/u.exec(rest) : null;
      if (ruby) { content.push({ type: "text", text: ruby[1], marks: [{ type: "ruby", attrs: { base: ruby[1], reading: ruby[2] } }] }); position += ruby[0].length; }
      else if (emphasis) { content.push({ type: "text", text: emphasis[1], marks: [{ type: "emphasis" }] }); position += emphasis[0].length; }
      else {
        const plain = (format === "pixiv" ? /^[^｜|《》[\]]+/u : /^[^｜|《》]+/u).exec(rest); if (!plain) throw new Error("対応していない、または壊れた投稿記法です。");
        content.push({ type: "text", text: plain[0] }); position += plain[0].length;
      }
    }
    return content.length ? { type: "paragraph", content } : { type: "paragraph" };
  }) });
  if (publicationText(body, format) !== text) throw new Error("投稿記法を可逆に読み込めません。");
  return body;
}

export function japaneseInputSuggestion(text: string, mode: "symbols" | "indent"): string {
  if (mode === "symbols") return text.replace(/!/gu, "！").replace(/\?/gu, "？").replace(/\.\.\./gu, "……").replace(/--/gu, "――");
  return text.split("\n").map((line) => line && !/^[\s「『]/u.test(line) ? `　${line}` : line).join("\n");
}
