import { Mark } from "@tiptap/core";
import { rubyAttributesSchema } from "../../../domain/typography";

export const NovelRuby = Mark.create({
  name: "ruby", inclusive: false, excludes: "ruby emphasis", keepOnSplit: false,
  addAttributes: () => ({ reading: { default: "", rendered: false }, base: { default: "", rendered: false } }),
  // Clipboard remains plain text. Only validated JSON and explicit editor commands add annotations.
  parseHTML: () => [],
  renderHTML({ mark }) {
    const attrs = rubyAttributesSchema.parse(mark.attrs);
    return ["span", { "data-novel-ruby": attrs.reading, title: `ルビ：${attrs.reading}` }, 0];
  },
});
export const NovelEmphasis = Mark.create({
  name: "emphasis", inclusive: false, excludes: "emphasis ruby", keepOnSplit: false,
  parseHTML: () => [],
  renderHTML: () => ["span", { "data-novel-emphasis": "", title: "傍点" }, 0],
});
