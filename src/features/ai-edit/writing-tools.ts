import type { AiEditPresetId } from "../../domain/ai-edit";
import { getPresetDefaultInstruction } from "./intent";
import { isCompletionOperation, type CompletionOperation } from "../../domain/completion";

export const WRITING_TOOL_GROUPS = [
  { id: "revise", label: "選択範囲を直す" },
  { id: "write", label: "カーソル位置に書く" },
  { id: "lookup", label: "語句を調べる" },
] as const;
export type WritingToolGroupId = typeof WRITING_TOOL_GROUPS[number]["id"];

export const WRITING_TOOLS = [
  { id: "rewrite", group: "revise", label: "書き直し", english: "Rewrite", description: "意味と文体を保ち、自然な表現に整えます。" },
  { id: "transform", group: "revise", label: "文体変換", english: "Transform", description: "雰囲気と強さを指定して、文体を変えます。" },
  { id: "expand", group: "revise", label: "膨らませる", english: "Expand", description: "新しい事実を加えず、原文の描写を詳しくします。" },
  { id: "condense", group: "revise", label: "短くする", english: "Condense", description: "要点を保ち、冗長な表現を減らします。" },
  { id: "custom", group: "revise", label: "自由指示", english: "Custom", description: "出来事・人物・視点・事実を保つ範囲で、自由に指示します。" },
  { id: "prompt-insert", group: "write", label: "指示から書く", english: "Prompt", description: "入力した指示だけから文章を作ります。本文・前後の文脈は送りません。" },
  { id: "infill", group: "write", label: "中間補完", english: "Infill", description: "空白だけを選択するか途中の空段落にカーソルを置き、前後をつなぐ文章を作ります。" },
  { id: "continue", group: "write", label: "続きを書く", english: "Continue", description: "現在の章の末尾にカーソルを置き、直前の文章に続く候補を作ります。" },
  { id: "context-insert", group: "write", label: "文脈で挿入", english: "Context Insert", description: "挿入位置にカーソルを置き、書きたい内容と前後の文脈に沿った文章を作ります。" },
  { id: "describe", group: "write", label: "描写を足す", english: "Describe", description: "カーソル位置に入れる五感（視覚・聴覚など）・比喩・内面の描写を、2案以上から比べて選びます。" },
  { id: "guided-write", group: "write", label: "展開を指定", english: "Guided Write", description: "次に起こすことと長さを指定して2案以上を比較します。自動で物語は進めません。" },
  { id: "dictionary", group: "lookup", label: "辞書", english: "Dictionary", description: "語句の意味をLLMで調べるか、検索サイトを開きます。本文は変更しません。" },
] as const satisfies readonly Readonly<{ id: string; group: WritingToolGroupId; label: string; english: string; description: string }>[];
export type WritingToolId = typeof WRITING_TOOLS[number]["id"];

export function writingToolOperation(tool: WritingToolId): CompletionOperation | undefined {
  return tool === "describe" || tool === "guided-write" ? "context-insert" : isCompletionOperation(tool) ? tool : undefined;
}
/** How the manuscript selection looks when an AI tool is requested. */
export type WritingToolTarget = "text" | "blank" | "caret";
export type WritingToolMemory = Readonly<{ revise: WritingToolId; write: WritingToolId }>;
export const DEFAULT_WRITING_TOOL_MEMORY: WritingToolMemory = Object.freeze({ revise: "rewrite", write: "prompt-insert" });

export function writingToolGroup(tool: WritingToolId): WritingToolGroupId {
  return WRITING_TOOLS.find((entry) => entry.id === tool)?.group ?? "revise";
}

/** Tools offered for a target: revising needs selected text, writing needs a caret or a blank gap. */
export function writingToolsFor(target: WritingToolTarget): readonly (typeof WRITING_TOOLS)[number][] {
  return WRITING_TOOLS.filter((tool) => target === "text" ? tool.group !== "write" : tool.group === "write");
}

/** The tool a new session starts with. The selection decides the group; the last tool of that group is reused. */
export function resolveWritingTool(target: WritingToolTarget, memory: WritingToolMemory): WritingToolId {
  if (target === "text") return writingToolGroup(memory.revise) === "revise" ? memory.revise : DEFAULT_WRITING_TOOL_MEMORY.revise;
  if (target === "blank") return "infill";
  return writingToolGroup(memory.write) === "write" ? memory.write : DEFAULT_WRITING_TOOL_MEMORY.write;
}

export function rememberWritingTool(memory: WritingToolMemory, tool: WritingToolId): WritingToolMemory {
  const group = writingToolGroup(tool);
  return group === "revise" ? { ...memory, revise: tool } : group === "write" ? { ...memory, write: tool } : memory;
}

export function writingToolInput(tool: Exclude<WritingToolId, "dictionary">): Readonly<{ instruction: string; presetId: AiEditPresetId | null; candidateCount?: 2 }> {
  if (tool === "describe" || tool === "guided-write") return { presetId: null, instruction: "", candidateCount: 2 };
  if (tool === "context-insert" || tool === "prompt-insert") return { presetId: null, instruction: "" };
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
    case "prompt-insert":
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
