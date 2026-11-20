import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmSecretExport, SecretLockScreen, SecretSettings } from "../../src/features/workspace/SecretControls";

afterEach(() => vi.restoreAllMocks());
const ok = async () => ({ ok: true });
function settings(overrides: Partial<Parameters<typeof SecretSettings>[0]> = {}) {
  const props = { vaultExists: false, unlocked: false, secret: false, disabled: false, onSetup: vi.fn(ok), onUnlock: vi.fn(ok), onToggle: vi.fn(ok), onChangePassword: vi.fn(ok), onLock: vi.fn(ok), ...overrides };
  render(<SecretSettings {...props} />);
  return props;
}

describe("secret controls", () => {
  it("sets a password only after matching entries and the no-recovery acknowledgement, then encrypts the work", async () => {
    const props = settings();
    fireEvent.click(screen.getByRole("button", { name: "この作品をシークレットにする" }));
    const submit = screen.getByRole("button", { name: "パスワードを設定して暗号化" });
    fireEvent.change(screen.getByLabelText("新しいパスワード（8文字以上）"), { target: { value: "password 1" } });
    fireEvent.change(screen.getByLabelText("もう一度入力"), { target: { value: "password 2" } });
    expect(screen.getByRole("alert")).toHaveTextContent("一致しません"); expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("もう一度入力"), { target: { value: "password 1" } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /復元できないことを理解しました/u }));
    fireEvent.click(submit);
    await waitFor(() => expect(props.onToggle).toHaveBeenCalledWith(true));
    expect(props.onSetup).toHaveBeenCalledWith("password 1");
  });

  it("asks for the password while locked and confirms before turning secret storage off", async () => {
    const locked = settings({ vaultExists: true });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "password 1" } });
    fireEvent.click(screen.getByRole("button", { name: "解錠" }));
    await waitFor(() => expect(locked.onUnlock).toHaveBeenCalledWith("password 1"));
    document.body.innerHTML = "";
    const open = settings({ vaultExists: true, unlocked: true, secret: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "シークレットを解除" }));
    expect(confirm).toHaveBeenCalledTimes(1); expect(open.onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "シークレットを解除" }));
    await waitFor(() => expect(open.onToggle).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: "今すぐロック" }));
    await waitFor(() => expect(open.onLock).toHaveBeenCalledTimes(1));
  });

  it("shows a wrong password and moves a locked work to the trash only after confirmation", async () => {
    const onUnlock = vi.fn(async () => ({ ok: false, message: "パスワードが違います。" }));
    const onTrash = vi.fn(ok);
    render(<SecretLockScreen onUnlock={onUnlock} onTrash={onTrash} canTrash />);
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "解錠" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("パスワードが違います。");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "この作品をごみ箱へ移す" }));
    expect(onTrash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "この作品をごみ箱へ移す" }));
    await waitFor(() => expect(onTrash).toHaveBeenCalledTimes(1)); expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("confirms single-file exports only for secret works", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(confirmSecretExport(false)).toBe(true); expect(confirm).not.toHaveBeenCalled();
    expect(confirmSecretExport(true)).toBe(false); expect(confirm).toHaveBeenCalledTimes(1);
  });
});
