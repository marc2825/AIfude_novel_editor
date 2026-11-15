import { getSchema, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { NovelRuby, NovelEmphasis } from "./novel-annotations";

export const plainTextExtensions: Extensions = [Document, Paragraph, Text, NovelRuby, NovelEmphasis];

export const plainTextSchema = getSchema(plainTextExtensions);
