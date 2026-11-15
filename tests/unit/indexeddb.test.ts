import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("IndexedDB browser boundary", () => {
  it("is safe to import without a browser storage global", async () => {
    vi.stubGlobal("indexedDB", undefined);

    const { openWorkspaceDatabase } = await import(
      "../../src/persistence/indexeddb"
    );

    await expect(openWorkspaceDatabase()).rejects.toThrow(
      "この環境ではIndexedDBを利用できません。",
    );
  });
});
