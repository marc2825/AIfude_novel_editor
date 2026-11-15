import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiConnectionSettingsPanel } from "../../src/features/ai-edit/AiConnectionSettingsPanel";
import { connectionActionSchema } from "../../src/domain/ai-connections";
import { createPublicConnectionStateFixture } from "../fixtures/ai-connections";
import { createDeferred } from "../helpers/deferred";

function props() { return { disabled: false, paidApiEnabled: false, onPaidApiEnabledChange: vi.fn(), onInvalidate: vi.fn(), onRuntimeChange: vi.fn(), onDirtyChange: vi.fn() }; }
describe("AI connection settings screen", () => {
  it("allows removing a previously saved API comparison when the server API permission is OFF", async () => {
    const current = createPublicConnectionStateFixture(); current.settings.comparison = ["mock", "openai"];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(current));
    render(<AiConnectionSettingsPanel {...props()} />); fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    const api = await screen.findByRole("checkbox", { name: "OpenAIを比較候補にする" }); expect(api).toBeChecked(); expect(api).toBeEnabled();
    fireEvent.click(api); expect(api).not.toBeChecked(); expect(api).toBeDisabled();
  });
  it("can reset to environment even with an invalid comparison draft", async () => {
    const current = createPublicConnectionStateFixture(); vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.body) expect(connectionActionSchema.parse(JSON.parse(String(init.body)))).toEqual({ action: "reset", expectedRevision: null });
      return Response.json(current);
    });
    render(<AiConnectionSettingsPanel {...props()} />); fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "ローカルLLMを比較候補にする" }));
    fireEvent.click(screen.getByRole("button", { name: "AI接続を環境設定に戻す" })); await screen.findByText("環境設定に戻しました。"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("loads only on request, saves explicit configuration and never includes credentials", async () => {
    const current = createPublicConnectionStateFixture(); const callbacks = props();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (!init?.body) return Response.json(current);
      const action = connectionActionSchema.parse(JSON.parse(String(init.body))); if (action.action !== "save") throw new Error("Unexpected action");
      return Response.json({ ...current, revision: crypto.randomUUID(), settings: action.settings });
    });
    render(<AiConnectionSettingsPanel {...callbacks} />); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" })); await screen.findByRole("combobox", { name: "主に使うAI" });
    fireEvent.change(screen.getByRole("combobox", { name: "主に使うAI" }), { target: { value: "local" } });
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "AI接続設定を保存" })); await screen.findByText("AI接続設定を保存しました。次の生成から反映されます。");
    expect(callbacks.onInvalidate).toHaveBeenCalledOnce(); expect(callbacks.onRuntimeChange).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: "local", settingsRevision: expect.any(String) }));
    expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(false); expect(String(fetch.mock.calls[1]?.[1]?.body)).not.toContain("apiKey");
    expect(callbacks.onPaidApiEnabledChange).toHaveBeenLastCalledWith(false);
  });
  it("keeps edits after a save failure and allows a same-value retry", async () => {
    const current = createPublicConnectionStateFixture(); const callbacks = props(); let failure = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (!init?.body) return Response.json(current);
      if (failure) { failure = false; return Response.json({ error: "保存できませんでした。" }, { status: 503 }); }
      const action = connectionActionSchema.parse(JSON.parse(String(init.body))); if (action.action !== "save") throw new Error("Unexpected action");
      return Response.json({ ...current, revision: crypto.randomUUID(), settings: action.settings });
    });
    render(<AiConnectionSettingsPanel {...callbacks} />); fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    const model = await screen.findByRole("textbox", { name: "ローカルLLMの接続モデルID" }); fireEvent.change(model, { target: { value: "new-local-model" } });
    fireEvent.click(screen.getByRole("button", { name: "AI接続設定を保存" })); await screen.findByText("保存できませんでした。"); expect(model).toHaveValue("new-local-model"); expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "AI接続設定を保存" })); await screen.findByText("AI接続設定を保存しました。次の生成から反映されます。"); expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it("ignores a cancelled diagnostic that arrives after a newer result despite ignoring abort", async () => {
    const current = createPublicConnectionStateFixture(); const pending = createDeferred<Response>(); let oldRequest: unknown; let requests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (!init?.body) return Response.json(current);
      const action = connectionActionSchema.parse(JSON.parse(String(init.body))); if (action.action !== "diagnose") throw new Error("Unexpected action");
      if (++requests === 1) { oldRequest = action; return pending.promise; }
      return Response.json({ requestId: action.requestId, revision: action.expectedRevision, mode: action.mode, status: "ok" });
    });
    render(<AiConnectionSettingsPanel {...props()} />); fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    fireEvent.click(await screen.findByRole("button", { name: "ローカルLLMの接続を診断" })); await screen.findByRole("button", { name: "接続処理をキャンセル" });
    fireEvent.click(screen.getByRole("button", { name: "接続処理をキャンセル" })); fireEvent.click(screen.getByRole("button", { name: "ローカルLLMの接続を診断" }));
    await screen.findByText(/ローカルLLM：接続と設定モデルの一覧掲載を確認しました/u);
    const old = connectionActionSchema.parse(oldRequest); if (old.action !== "diagnose") throw new Error("Missing old diagnosis");
    await act(async () => { pending.resolve(Response.json({ requestId: old.requestId, revision: null, mode: old.mode, status: "auth-required" })); });
    expect(screen.queryByText(/認証を確認できません/u)).not.toBeInTheDocument(); expect(requests).toBe(2);
  });
  it("keeps API diagnosis OFF until explicitly allowed and rejects a one-provider comparison", async () => {
    const current = { ...createPublicConnectionStateFixture(), paidApiAllowed: true }; const callbacks = props(); const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(current));
    const view = render(<AiConnectionSettingsPanel {...callbacks} />); fireEvent.click(screen.getByRole("button", { name: "AI接続の設定・診断" }));
    const diagnose = await screen.findByRole("button", { name: "OpenAIの接続を診断" }); expect(diagnose).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /サブスクと別料金のAPI利用・診断を許可/u })); expect(callbacks.onPaidApiEnabledChange).toHaveBeenCalledWith(true);
    view.rerender(<AiConnectionSettingsPanel {...callbacks} paidApiEnabled />); expect(diagnose).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "ローカルLLMを比較候補にする" })); fireEvent.click(screen.getByRole("button", { name: "AI接続設定を保存" }));
    await waitFor(() => expect(screen.getByText(/比較対象は0個または2個以上/u)).toBeInTheDocument()); expect(fetch).toHaveBeenCalledOnce();
  });
});
