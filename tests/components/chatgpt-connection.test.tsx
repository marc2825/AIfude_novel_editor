import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChatGptConnection } from "../../src/features/ai-edit/use-chatgpt-connection";
import { ChatGptConnectionPanel } from "../../src/features/ai-edit/ChatGptConnectionPanel";
import { CHATGPT_CONNECTION_ID } from "../fixtures/chatgpt";
import { createDeferred } from "../helpers/deferred";

const disconnected = { connected: false, connectionId: null, email: null, welcomePending: false };
const connected = { connected: true, connectionId: CHATGPT_CONNECTION_ID, email: "writer@example.test", welcomePending: false };

describe("ChatGPT connection UI", () => {
  it("does not query subscription status in other provider modes", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    renderHook(() => useChatGptConnection(false, vi.fn()));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards an old status response after disconnect even when fetch ignores cancellation", async () => {
    const old = createDeferred<Response>();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(disconnected));
    fetch.mockResolvedValueOnce(Response.json(connected)).mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json({ revocationConfirmed: true }));
    const invalidate = vi.fn();
    const { result } = renderHook(() => useChatGptConnection(true, invalidate));
    await waitFor(() => expect(result.current.status?.connected).toBe(true));
    let refreshing: Promise<void>;
    act(() => { refreshing = result.current.refresh(); });
    await act(async () => { await result.current.disconnect(); });
    expect(result.current.status?.connected).toBe(false);
    await act(async () => { old.resolve(Response.json(connected)); await refreshing; });
    expect(result.current.status?.connected).toBe(false);
    expect(invalidate).toHaveBeenCalled();
  });
  it("reports an unconfirmed remote revocation while remaining locally disconnected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(connected))
      .mockResolvedValueOnce(Response.json({ revocationConfirmed: false })).mockResolvedValue(Response.json(disconnected));
    const invalidate = vi.fn();
    const { result } = renderHook(() => useChatGptConnection(true, invalidate));
    await waitFor(() => expect(result.current.status?.connected).toBe(true));
    await act(async () => { await result.current.disconnect(); });
    expect(result.current.error).toContain("OpenAI側の解除は確認できなかった");
    expect(result.current.status?.connected).toBe(false);
  });
  it("rejects a sign-in URL outside the official authorization endpoint", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(disconnected)).mockResolvedValueOnce(Response.json({ authorizationUrl: "https://evil.example/auth" }));
    const invalidate = vi.fn();
    const { result } = renderHook(() => useChatGptConnection(true, invalidate));
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(async () => { await result.current.signIn(); });
    expect(result.current.authorizationUrl).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });
  it("shows connection controls and dismisses first-use confirmation before the server acknowledges it", async () => {
    const pending = createDeferred<void>();
    const acknowledgeWelcome = vi.fn(() => pending.promise);
    render(<ChatGptConnectionPanel disabled={false} connection={{
      status: { ...connected, welcomePending: true }, busy: false, connecting: false, error: null, authorizationUrl: null,
      signIn: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), acknowledgeWelcome,
    }} />);
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "ChatGPTで利用枠を確認" })).toHaveAttribute("href", "https://chatgpt.com/settings/usage");
    expect(await screen.findByRole("dialog", { name: "ChatGPTの利用枠を使います" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
    expect(acknowledgeWelcome).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "ChatGPTの利用枠を使います" })).not.toBeInTheDocument();
    pending.resolve();
  });
});
