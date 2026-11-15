import { Fragment, Slice, type Node, type Schema } from "@tiptap/pm/model";

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function plainTextToDocument(schema: Schema, text: string): Node {
  const paragraphs = normalizeLineEndings(text)
    .split("\n")
    .map((line) =>
      schema.nodes.paragraph.create(
        null,
        line.length === 0 ? undefined : schema.text(line),
      ),
    );

  return schema.nodes.doc.createChecked(null, Fragment.fromArray(paragraphs));
}

export function documentToPlainText(document: Node): string {
  const paragraphs: string[] = [];

  document.forEach((paragraph) => {
    paragraphs.push(paragraph.textContent);
  });

  return paragraphs.join("\n");
}

export function plainTextToSlice(schema: Schema, text: string): Slice {
  const document = plainTextToDocument(schema, text);

  return new Slice(document.content, 1, 1);
}

export function sliceToPlainText(slice: Slice): string {
  const paragraphs: string[] = [];

  slice.content.forEach((node) => {
    paragraphs.push(node.textContent);
  });

  return paragraphs.join("\n");
}
