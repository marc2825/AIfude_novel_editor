"use client";

import type { WRITING_TOOLS, WritingToolId } from "./writing-tools";
import styles from "./AiEdit.module.css";

type Tool = (typeof WRITING_TOOLS)[number];

/**
 * Chooses the AI tool after the target is selected. Native radios keep the standard
 * arrow-key behaviour; picking a tool never sends anything.
 */
export function AiToolPicker({ tools, value, disabled, onChange }: Readonly<{
  tools: readonly Tool[];
  value: WritingToolId;
  disabled: boolean;
  onChange: (tool: WritingToolId) => void;
}>) {
  if (tools.length < 2) return null;
  return (
    <fieldset className={styles.toolPicker} disabled={disabled}>
      <legend>AIツール</legend>
      <div>
        {tools.map((tool) => (
          <label key={tool.id}>
            <input type="radio" name="ai-tool" value={tool.id} checked={tool.id === value}
              aria-describedby={tool.id === value ? "ai-tool-description" : undefined}
              onChange={() => onChange(tool.id)} />
            <span>{tool.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
