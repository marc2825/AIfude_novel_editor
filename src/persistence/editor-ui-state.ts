import { z } from "zod";

const KEY = "novel-editor-ui-v1";
const schema = z.object({ version: z.literal(1), closedProjectIds: z.array(z.uuid()).max(1_000),
  positions: z.record(z.string().max(200), z.object({ anchor: z.int().nonnegative(), head: z.int().nonnegative(), revision: z.int().nonnegative() }).strict()),
}).strict();
type UiState = z.infer<typeof schema>;
export class EditorUiStateStore {
  private value: UiState | null = null;
  constructor(private readonly onError?: () => void) {}
  private read(): UiState {
    if (this.value) return this.value;
    try {
      const stored = localStorage.getItem(KEY);
      this.value = stored === null ? { version: 1, closedProjectIds: [], positions: {} } : schema.parse(JSON.parse(stored));
    } catch { this.onError?.(); this.value = { version: 1, closedProjectIds: [], positions: {} }; }
    return this.value;
  }
  private write(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.value)); } catch { this.onError?.(); }
  }
  closedProjects(): readonly string[] { return this.read().closedProjectIds; }
  setClosedProjects(ids: readonly string[]): void { this.read().closedProjectIds = [...new Set(ids)].slice(-1_000); this.write(); }
  position(key: string): UiState["positions"][string] | undefined { return this.read().positions[key]; }
  setPosition(key: string, position: UiState["positions"][string]): void {
    const state = this.read();
    delete state.positions[key]; state.positions[key] = position;
    const keys = Object.keys(state.positions);
    for (const old of keys.slice(0, Math.max(0, keys.length - 1_000))) delete state.positions[old];
    this.write();
  }
}
