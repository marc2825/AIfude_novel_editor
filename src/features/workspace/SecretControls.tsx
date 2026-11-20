"use client";

import { useState, type FormEvent } from "react";
import { HelpHeading } from "../ui/HelpTip";
import type { WorkspaceActionResult } from "./use-workspace";
import styles from "./Workspace.module.css";

type Action = () => Promise<WorkspaceActionResult>;

export const SECRET_EXPORT_CONFIRMATION = "この作品はシークレット作品です。書き出すファイルは暗号化されません。書き出しますか？";
/** Single-file exports of a secret work leave the encryption behind; ask first. */
export function confirmSecretExport(secret: boolean | undefined): boolean {
  return !secret || window.confirm(SECRET_EXPORT_CONFIRMATION);
}

function useRunner() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WorkspaceActionResult | null>(null);
  async function run(action: Action): Promise<WorkspaceActionResult> {
    setBusy(true); setResult(null);
    try { const next = await action(); setResult(next); return next; }
    catch { const failed = { ok: false, message: "操作できませんでした。" }; setResult(failed); return failed; }
    finally { setBusy(false); }
  }
  return { busy, result, run };
}
function Feedback({ result }: Readonly<{ result: WorkspaceActionResult | null }>) {
  return result?.message ? <p role={result.ok ? "status" : "alert"}>{result.message}</p> : null;
}

export function UnlockForm({ onUnlock, label = "解錠" }: Readonly<{ onUnlock: (password: string) => Promise<WorkspaceActionResult>; label?: string }>) {
  const [password, setPassword] = useState("");
  const { busy, result, run } = useRunner();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = await run(() => onUnlock(password));
    if (next.ok) setPassword("");
  }
  return <form className={styles.secretForm} onSubmit={(event) => void submit(event)}>
    <label>パスワード<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button type="submit" disabled={busy || password.length === 0}>{label}</button>
    <Feedback result={result} />
  </form>;
}

/** The locked active work: only the password form and moving the encrypted work to the trash. */
export function SecretLockScreen({ onUnlock, onTrash, canTrash }: Readonly<{ onUnlock: (password: string) => Promise<WorkspaceActionResult>; onTrash: Action; canTrash: boolean }>) {
  const { busy, result, run } = useRunner();
  return <section className={styles.lockScreen} aria-labelledby="secret-lock-title">
    <h2 id="secret-lock-title">シークレット作品はロックされています</h2>
    <p>本文を開くにはパスワードを入力してください。</p>
    <UnlockForm onUnlock={onUnlock} />
    <details>
      <summary>パスワードを忘れた場合</summary>
      <p>パスワードは復元できません。この作品は暗号化されたまま、ごみ箱へ移すことだけができます。</p>
      <button type="button" disabled={!canTrash || busy} onClick={() => {
        if (window.confirm("このシークレット作品をごみ箱へ移しますか？ パスワードがなければ、ごみ箱からも本文は読めません。")) void run(onTrash);
      }}>この作品をごみ箱へ移す</button>
      <Feedback result={result} />
    </details>
  </section>;
}

type SettingsProps = Readonly<{
  vaultExists: boolean; unlocked: boolean; secret: boolean; disabled: boolean;
  onSetup: (password: string) => Promise<WorkspaceActionResult>;
  onUnlock: (password: string) => Promise<WorkspaceActionResult>;
  onToggle: (on: boolean) => Promise<WorkspaceActionResult>;
  onChangePassword: (current: string, next: string) => Promise<WorkspaceActionResult>;
  onLock: Action;
}>;

export function SecretSettings({ vaultExists, unlocked, secret, disabled, onSetup, onUnlock, onToggle, onChangePassword, onLock }: SettingsProps) {
  const { busy, result, run } = useRunner();
  const [setupOpen, setSetupOpen] = useState(false);
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [understood, setUnderstood] = useState(false);
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [nextConfirm, setNextConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;
  return <section aria-labelledby="secret-settings-title" className={styles.secretSettings}>
    <HelpHeading level={2} id="secret-settings-title" label="シークレット作品" help={<>
      シークレットにした作品は、本文・メモ・保存履歴・ごみ箱の内容を暗号化して保存し、パスワードを入力しないと開けません。パスワードはアプリ全体で1つです。再読み込み時と10分間操作がないときに自動でロックします。パスワードを忘れると、誰も復元できません。
    </>}>シークレット作品</HelpHeading>
    {!vaultExists ? <>
      <p>他人に見せたくない作品を、パスワードで暗号化して保存します。</p>
      {!setupOpen ? <button type="button" disabled={disabled} onClick={() => setSetupOpen(true)}>この作品をシークレットにする</button> :
        <form className={styles.secretForm} onSubmit={(event) => {
          event.preventDefault();
          if (password !== confirm || !understood) return;
          void run(async () => { const setup = await onSetup(password); return setup.ok ? onToggle(true) : setup; }).then((outcome) => { if (outcome.ok) { setPassword(""); setConfirm(""); setSetupOpen(false); } });
        }}>
          <label>新しいパスワード（8文字以上）<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>もう一度入力<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
          {mismatch ? <p role="alert">パスワードが一致しません。</p> : null}
          <label className={styles.checkLabel}><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />パスワードを忘れると、誰も（自分も）復元できないことを理解しました</label>
          <button type="submit" disabled={disabled || busy || password.length === 0 || password !== confirm || !understood}>パスワードを設定して暗号化</button>
        </form>}
    </> : !unlocked ? <>
      <p>ロック中です。シークレットの設定を変えるには解錠してください。</p>
      <UnlockForm onUnlock={onUnlock} />
    </> : <>
      <p role="status">{secret ? "この作品はシークレットです（暗号化して保存）。" : "この作品は通常の保存です。"}</p>
      <div className={styles.buttonRow}>
        <button type="button" disabled={disabled || busy} onClick={() => {
          if (secret && !window.confirm("シークレットを解除すると、この作品は暗号化されずに保存されます。解除しますか？")) return;
          void run(() => onToggle(!secret));
        }}>{secret ? "シークレットを解除" : "この作品をシークレットにする"}</button>
        <button type="button" disabled={busy} onClick={() => void run(onLock)}>今すぐロック</button>
      </div>
      <details>
        <summary>パスワードを変更</summary>
        <form className={styles.secretForm} onSubmit={(event) => {
          event.preventDefault();
          if (next !== nextConfirm) return;
          void run(() => onChangePassword(current, next)).then((outcome) => { if (outcome.ok) { setCurrent(""); setNext(""); setNextConfirm(""); } });
        }}>
          <label>現在のパスワード<input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
          <label>新しいパスワード（8文字以上）<input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></label>
          <label>もう一度入力<input type="password" autoComplete="new-password" value={nextConfirm} onChange={(event) => setNextConfirm(event.target.value)} /></label>
          {nextConfirm.length > 0 && next !== nextConfirm ? <p role="alert">パスワードが一致しません。</p> : null}
          <button type="submit" disabled={busy || current.length === 0 || next.length === 0 || next !== nextConfirm}>パスワードを変更</button>
        </form>
      </details>
    </>}
    <Feedback result={result} />
  </section>;
}
