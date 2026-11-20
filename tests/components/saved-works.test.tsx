import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedWorksPanel } from "../../src/features/workspace/SavedWorksPanel";
import { HelpTip } from "../../src/features/ui/HelpTip";

const files = [{ projectId: "a", title: "開いている作品" }, { projectId: "b", title: "別の作品" }];
afterEach(() => vi.restoreAllMocks());

describe("saved works", () => {
  it("moves a saved work to the trash only after confirmation and routes the open work to the existing deletion", async () => {
    const onTrash = vi.fn(async () => ({ ok: true, message: "作品をごみ箱へ移しました。ごみ箱から復元できます。" }));
    const onTrashActive = vi.fn(async () => ({ ok: true }));
    const onOpen = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<SavedWorksPanel activeProjectId="a" disabled={false} files={files} onOpen={onOpen} onTrash={onTrash} onTrashActive={onTrashActive} />);
    expect(screen.getAllByRole("button", { name: "開く" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "別の作品をごみ箱へ移す" }));
    expect(confirm).toHaveBeenCalledTimes(1); expect(onTrash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "別の作品をごみ箱へ移す" }));
    await waitFor(() => expect(onTrash).toHaveBeenCalledWith("b"));
    expect(await screen.findByRole("status")).toHaveTextContent("ごみ箱へ移しました");
    fireEvent.click(screen.getByRole("button", { name: "開いている作品をごみ箱へ移す" }));
    await waitFor(() => expect(onTrashActive).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("b"));
  });
});

describe("help tip", () => {
  it("describes the trigger without opening and shows the text on focus, tap and hover until Escape", () => {
    const onKeyDown = vi.fn();
    render(<div onKeyDown={onKeyDown}><HelpTip label="ファイルを開く">JSONとテキストを開けます。</HelpTip></div>);
    const button = screen.getByRole("button", { name: "ファイルを開くの説明" });
    expect(button).toHaveAccessibleDescription("JSONとテキストを開けます。");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(button); expect(screen.getByRole("tooltip")).toHaveTextContent("JSONとテキストを開けます。");
    fireEvent.keyDown(button, { key: "Escape" }); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(); expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.click(button); expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(document.body); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerEnter(button.parentElement as HTMLElement, { pointerType: "mouse" }); expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(button.parentElement as HTMLElement, { pointerType: "mouse" }); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("closes on the second click even though the click focused it, and follows the button on scroll near the bottom edge", () => {
    render(<HelpTip label="同期">同期は初期OFFです。</HelpTip>);
    const button = screen.getByRole("button", { name: "同期の説明" });
    fireEvent.pointerDown(button); fireEvent.focus(button); fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(button); fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    let top = 740;
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(() => ({ top, bottom: top + 24, left: 100, right: 124, width: 24, height: 24, x: 100, y: top, toJSON: () => ({}) }));
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.getAttribute("role") === "tooltip" ? 100 : 0; });
    fireEvent.pointerDown(button); fireEvent.click(button);
    expect(screen.getByRole("tooltip").style.top).toBe(`${740 - 6 - 100}px`);
    top = 300; fireEvent.scroll(window);
    expect(screen.getByRole("tooltip").style.top).toBe(`${300 + 24 + 6}px`);
    top = -200; fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    height.mockRestore();
  });
});
