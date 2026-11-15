import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WritingHistoryPanel } from "../../src/features/workspace/WritingHistoryPanel";
import type { WritingHistoryEntry } from "../../src/persistence/writing-history";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { createDeferred } from "../helpers/deferred";

it("ignores an older history load after the drawer is closed and reopened", async () => {
  const workspace = createWorkspaceFixture();
  const first = createDeferred<WritingHistoryEntry[]>();
  const second = createDeferred<WritingHistoryEntry[]>();
  const onList = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const action = async () => ({ ok: true });
  const panel = (active: boolean) => <WritingHistoryPanel embedded active={active} workspace={workspace} disabled={false}
    warning={null} getCurrentSnapshot={() => workspace} onList={onList} onCreate={action} onRestore={action} onClear={action} onAutoChange={action} />;
  const view = render(panel(true));
  view.rerender(panel(false));
  view.rerender(panel(true));
  await act(async () => { second.resolve([]); });
  await act(async () => { first.reject(new Error("late old failure")); });
  expect(screen.queryByText("履歴を読み込めませんでした。")).toBeNull();
  expect(screen.getByText("保存履歴はありません。")).toBeVisible();
  expect(onList).toHaveBeenCalledTimes(2);
});
