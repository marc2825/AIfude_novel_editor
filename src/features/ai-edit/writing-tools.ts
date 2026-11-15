import type { AiEditPresetId } from "../../domain/ai-edit";
import { getPresetDefaultInstruction } from "./intent";
import { isCompletionOperation, type CompletionOperation } from "../../domain/completion";

export const WRITING_TOOLS = [
  { id: "rewrite", label: "書き直し", english: "Rewrite", description: "意味と文体を保ち、自然な表現に整えます。" },
  { id: "transform", label: "文体変換", english: "Transform", description: "雰囲気と強さを指定して、文体を変えます。" },
  { id: "expand", label: "膨らませる", english: "Expand", description: "新しい事実を加えず、原文の描写を詳しくします。" },
  { id: "condense", label: "短くする", english: "Condense", description: "要点を保ち、冗長な表現を減らします。" },
  { id: "custom", label: "自由指示", english: "Custom", description: "出来事・人物・視点・事実を保つ範囲で、自由に指示します。" },
  { id: "dictionary", label: "辞書", english: "Dictionary", description: "語句の意味をLLMで調べるか、検索サイトを開きます。本文は変更しません。" },
  { id: "infill", label: "中間補完", english: "Infill", description: "空白だけを選択するか途中の空段落にカーソルを置き、前後をつなぐ文章を作ります。" },
  { id: "continue", label: "続きを書く", english: "Continue", description: "現在の章の末尾にカーソルを置き、直前の文章に続く候補を作ります。" },
  { id: "context-insert", label: "文脈で挿入", english: "Context Insert", description: "挿入位置にカーソルを置き、書きたい内容と前後の文脈に沿った文章を作ります。" },
  { id: "describe", label: "五感の描写", english: "Describe", description: "五感・比喩・内面の描写を2案から比較し、カーソル位置への挿入を確認します。" },
  { id: "guided-write", label: "展開を指定", english: "Guided Write", description: "次に起こすことと長さを指定して2案以上を比較します。自動で物語は進めません。" },
] as const;
export type WritingToolId = typeof WRITING_TOOLS[number]["id"];

export function writingToolOperation(tool: WritingToolId): CompletionOperation | undefined {
  return tool === "describe" || tool === "guided-write" ? "context-insert" : isCompletionOperation(tool) ? tool : undefined;
}
export function writingToolInput(tool: Exclude<WritingToolId, "dictionary">): Readonly<{ instruction: string; presetId: AiEditPresetId | null; candidateCount?: 2 }> {
  if (tool === "describe" || tool === "guided-write") return { presetId: null, instruction: "", candidateCount: 2 };
  if (tool === "context-insert") return { presetId: null, instruction: "" };
  if (tool === "infill") return { presetId: null, instruction: "前後の文章を自然につなぐように、空白部分だけを補完してください。" };
  if (tool === "continue") return { presetId: null, instruction: "直前の文章の文体と視点に合わせて、物語の続きを書いてください。" };
  const presetId = writingToolPreset(tool);
  return { presetId, instruction: tool === "rewrite" || tool === "custom" || tool === "transform" ? "" : getPresetDefaultInstruction(presetId ?? "polish") };
}

export function writingToolPreset(tool: Exclude<WritingToolId, "dictionary">): AiEditPresetId | null {
  switch (tool) {
    case "describe":
    case "guided-write":
    case "context-insert":
    case "infill":
    case "continue":
    case "rewrite": return null;
    case "transform": return "transform";
    case "expand": return "expand";
    case "condense": return "shorten";
    case "custom": return "freeform";
  }
}

export const DESCRIPTION_FOCUSES = ["視覚", "聴覚", "嗅覚", "味覚", "触覚", "比喩", "内面"] as const;
export type DescriptionFocus = typeof DESCRIPTION_FOCUSES[number];
export function creativeInstruction(tool: "describe" | "guided-write", brief: string, focuses: readonly DescriptionFocus[], allowNewFacts: boolean): string {
  if (!brief.trim() || (tool === "describe" && !focuses.length)) return "";
  return `${tool === "describe" ? `描写の焦点：${focuses.join("・")}。` : "作者が指定した場面・展開の短い候補を作成。"}\n内容：${brief}\n${allowNewFacts ? "指定内容に必要な追加の描写・小さな事実の創作を許可する。ただし人物・時系列・世界設定の変更は避ける。" : "新しい人物・場所・出来事・設定を追加しない。与えられた内容と前後の文脈にある事実の範囲で表現する。"}\n前後の本文の視点・時制・口調を保ち、挿入する部分だけを提案する。`;
}

export const TRANSFORM_STRENGTHS = ["控えめ", "標準", "強め"] as const;
export type TransformStrength = typeof TRANSFORM_STRENGTHS[number];
export function transformInstruction(concept: string, strength: TransformStrength): string {
  return concept.trim() === "" ? "" : `${getPresetDefaultInstruction("transform")}\n雰囲気・概念：${concept}\n変換の強さ：${strength}`;
}
