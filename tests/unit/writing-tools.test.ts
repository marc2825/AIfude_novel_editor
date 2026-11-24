import { describe, expect, it } from "vitest";
import {
  DEFAULT_WRITING_TOOL_MEMORY, WRITING_TOOLS, rememberWritingTool, resolveWritingTool, writingToolGroup,
  writingToolInput, writingToolOperation, writingToolPreset, writingToolsFor,
} from "../../src/features/ai-edit/writing-tools";

describe("writing tool selection", () => {
  it("lets the selection decide the kind of tool and reuses the last tool of that kind", () => {
    expect(resolveWritingTool("text", DEFAULT_WRITING_TOOL_MEMORY)).toBe("rewrite");
    expect(resolveWritingTool("caret", DEFAULT_WRITING_TOOL_MEMORY)).toBe("prompt-insert");
    expect(resolveWritingTool("blank", DEFAULT_WRITING_TOOL_MEMORY)).toBe("infill");
    const memory = rememberWritingTool(rememberWritingTool(DEFAULT_WRITING_TOOL_MEMORY, "condense"), "continue");
    expect(memory).toEqual({ revise: "condense", write: "continue" });
    expect(resolveWritingTool("text", memory)).toBe("condense");
    expect(resolveWritingTool("caret", memory)).toBe("continue");
    // A blank gap can only be filled, whatever was used before.
    expect(resolveWritingTool("blank", memory)).toBe("infill");
  });

  it("never remembers the dictionary and recovers from an inconsistent memory", () => {
    expect(rememberWritingTool(DEFAULT_WRITING_TOOL_MEMORY, "dictionary")).toBe(DEFAULT_WRITING_TOOL_MEMORY);
    expect(resolveWritingTool("text", { revise: "continue", write: "rewrite" })).toBe("rewrite");
    expect(resolveWritingTool("caret", { revise: "continue", write: "rewrite" })).toBe("prompt-insert");
  });

  it("offers revising tools and the dictionary for text, and only writing tools for a caret", () => {
    expect(writingToolsFor("text").map((tool) => tool.id)).toEqual(["rewrite", "transform", "expand", "condense", "custom", "dictionary"]);
    expect(writingToolsFor("caret").map((tool) => tool.id)).toEqual(["prompt-insert", "infill", "continue", "context-insert", "describe", "guided-write"]);
    expect(writingToolsFor("blank")).toEqual(writingToolsFor("caret"));
    for (const tool of WRITING_TOOLS) expect(["revise", "write", "lookup"]).toContain(writingToolGroup(tool.id));
  });

  it("treats prompt-only writing as a tool without a preset, a default instruction or manuscript context", () => {
    expect(writingToolOperation("prompt-insert")).toBeUndefined();
    expect(writingToolPreset("prompt-insert")).toBeNull();
    expect(writingToolInput("prompt-insert")).toEqual({ presetId: null, instruction: "" });
  });
});
