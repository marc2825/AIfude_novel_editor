import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiEditErrorBoundary } from "../../src/features/ai-edit/AiEditErrorBoundary";

function UnstableAiSurface({ crash }: Readonly<{ crash: boolean }>) {
  if (crash) {
    throw new Error("synthetic AI render failure");
  }

  return <p>AI編集を利用できます</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI edit render isolation", () => {
  it("keeps the manuscript mounted and supports an explicit recovery", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(
      <>
        <textarea aria-label="小説本文" defaultValue="保持する本文" />
        <AiEditErrorBoundary>
          <UnstableAiSurface crash />
        </AiEditErrorBoundary>
      </>,
    );

    const manuscript = screen.getByRole("textbox", { name: "小説本文" });
    expect(manuscript).toHaveValue("保持する本文");
    expect(
      screen.getByRole("alert", { name: "AI編集を表示できませんでした" }),
    ).toHaveTextContent("本文の編集と保存は、このまま継続できます。");

    fireEvent.change(manuscript, { target: { value: "障害後も編集した本文" } });
    view.rerender(
      <>
        <textarea aria-label="小説本文" defaultValue="保持する本文" />
        <AiEditErrorBoundary>
          <UnstableAiSurface crash={false} />
        </AiEditErrorBoundary>
      </>,
    );

    expect(manuscript).toHaveValue("障害後も編集した本文");
    expect(screen.queryByText("AI編集を利用できます")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "AI編集を再開" }));

    expect(screen.getByText("AI編集を利用できます")).toBeInTheDocument();
    expect(manuscript).toHaveValue("障害後も編集した本文");
  });
});
