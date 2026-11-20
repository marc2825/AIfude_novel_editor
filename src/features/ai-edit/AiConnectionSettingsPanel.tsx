"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CONNECTION_MODES, MODEL_FIELDS, connectionLabel, connectionSettingsSchema, DIAGNOSTIC_MESSAGES, isTrainingContributorModel, publicRuntimeForConnections,
  type ConnectionDiagnostic, type ConnectionMode, type ConnectionSettings, type PublicConnectionState } from "../../domain/ai-connections";
import { isPaidApiProvider, type PublicAiRuntime } from "../../domain/ai-models";
import type { WorkspaceActionResult } from "../workspace/use-workspace";
import { requestAiConnectionSettings } from "./ai-connections-client";
import styles from "../workspace/Workspace.module.css";
import { HelpHeading, HelpTip } from "../ui/HelpTip";

export type AiConnectionSettingsHandle = Readonly<{ save: () => Promise<WorkspaceActionResult> }>;
type Props = Readonly<{ embedded?: boolean; active?: boolean; disabled: boolean; paidApiEnabled: boolean; onPaidApiEnabledChange: (enabled: boolean) => void;
  onInvalidate: () => void; onRuntimeChange: (runtime: PublicAiRuntime) => void; onDirtyChange: (dirty: boolean) => void;
}>;
export const AiConnectionSettingsPanel = forwardRef<AiConnectionSettingsHandle, Props>(function AiConnectionSettingsPanel({ embedded = false, active = false, disabled, paidApiEnabled, onPaidApiEnabledChange, onInvalidate, onRuntimeChange, onDirtyChange }, ref) {
  const [open, setOpen] = useState(embedded); const [data, setData] = useState<PublicConnectionState | null>(null);
  const [draft, setDraft] = useState<ConnectionSettings | null>(null); const baseline = useRef<ConnectionSettings | null>(null); const revision = useRef<string | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef<AbortController | null>(null); const generation = useRef(0);
  const [message, setMessage] = useState(""); const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const channel = useRef<BroadcastChannel | null>(null); const dirtyRef = useRef(false);
  const callbacks = useRef({ onInvalidate, onRuntimeChange, onDirtyChange });
  useEffect(() => { callbacks.current = { onInvalidate, onRuntimeChange, onDirtyChange }; });
  function stop() { generation.current++; pending.current?.abort(); pending.current = null; setBusy(false); }
  async function load(replaceDraft: boolean) {
    stop(); const own = ++generation.current; const abort = new AbortController(); pending.current = abort; setBusy(true);
    try {
      const result = await requestAiConnectionSettings(null, abort.signal);
      if (own !== generation.current || abort.signal.aborted || !("settings" in result)) return;
      setData(result); callbacks.current.onRuntimeChange(publicRuntimeForConnections(result));
      if (replaceDraft || !dirtyRef.current) {
        setDraft(result.settings); baseline.current = result.settings; revision.current = result.revision; dirtyRef.current = false; callbacks.current.onDirtyChange(false);
      } else setMessage("別の画面で接続が変更されました。入力内容は保持しています。保存前にAI設定を再読み込みしてください。");
    } catch (error: unknown) { if (own === generation.current && !abort.signal.aborted) setMessage(error instanceof Error ? error.message : "AI設定を読み込めません。"); }
    finally { if (own === generation.current) { pending.current = null; setBusy(false); } }
  }
  const loadRef = useRef(load); useEffect(() => { loadRef.current = load; });
  useEffect(() => { if (embedded && active) void loadRef.current(false); }, [active, embedded]);
  useEffect(() => {
    const requests = pending;
    let ownedChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      ownedChannel = new BroadcastChannel("novel-ai-connection-settings");
      channel.current = ownedChannel;
      channel.current.onmessage = () => { callbacks.current.onInvalidate(); void loadRef.current(false); };
    }
    return () => { requests.current?.abort(); ownedChannel?.close(); };
  }, []);
  function edit(next: ConnectionSettings) {
    stop(); setDraft(next); setMessage(""); setDiagnostic(null);
    dirtyRef.current = JSON.stringify(next) !== JSON.stringify(baseline.current); callbacks.current.onDirtyChange(dirtyRef.current);
  }
  async function save(reset = false): Promise<WorkspaceActionResult> {
    if (disabled || pending.current !== null || !draft) return { ok: false, message: "現在はAI設定を保存できません。" };
    const parsed = connectionSettingsSchema.safeParse(draft);
    if (!reset && isTrainingContributorModel(draft.models.meta)) { setMessage("Meta Muse APIの「-contributor」付きモデルは、送った内容が学習に使われるため使えません。"); return { ok: false }; }
    if (!reset && !parsed.success) { setMessage("モデルID・比較対象の選択を確認してください。比較対象は0個または2個以上にしてください。"); return { ok: false }; }
    callbacks.current.onInvalidate(); setMessage(""); setDiagnostic(null);
    const own = ++generation.current; const abort = new AbortController(); pending.current = abort; setBusy(true);
    try {
      const action = reset ? { action: "reset" as const, expectedRevision: revision.current }
        : parsed.success ? { action: "save" as const, expectedRevision: revision.current, settings: parsed.data } : null;
      if (!action) return { ok: false };
      const result = await requestAiConnectionSettings(action, abort.signal);
      if (own !== generation.current || abort.signal.aborted || !("settings" in result)) return { ok: false, message: "処理を中止しました。AI設定を再読み込みして保存状態を確認してください。" };
      setData(result); setDraft(result.settings); baseline.current = result.settings; revision.current = result.revision;
      dirtyRef.current = false; callbacks.current.onDirtyChange(false); callbacks.current.onRuntimeChange(publicRuntimeForConnections(result));
      onPaidApiEnabledChange(false); channel.current?.postMessage({ changed: true });
      setMessage(reset ? "環境設定に戻しました。" : "AI接続設定を保存しました。次の生成から反映されます。"); return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI設定を保存できませんでした。";
      if (own === generation.current && !abort.signal.aborted) setMessage(message); return { ok: false, message };
    } finally { if (own === generation.current) { pending.current = null; setBusy(false); } }
  }
  useImperativeHandle(ref, () => ({ save: () => save() }));
  async function diagnose(mode: ConnectionMode) {
    if (disabled || pending.current !== null || dirtyRef.current || !data) return;
    const own = ++generation.current; const abort = new AbortController(); pending.current = abort; setBusy(true); setDiagnostic(null); setMessage("");
    try {
      const result = await requestAiConnectionSettings({ action: "diagnose", expectedRevision: revision.current, requestId: crypto.randomUUID(), mode, allowPaidApi: paidApiEnabled }, abort.signal);
      if (own === generation.current && !abort.signal.aborted && "status" in result) setDiagnostic(result);
    } catch (error: unknown) { if (own === generation.current && !abort.signal.aborted) setMessage(error instanceof Error ? error.message : "診断できませんでした。"); }
    finally { if (own === generation.current) { pending.current = null; setBusy(false); } }
  }
  const controlsDisabled = disabled || busy;
  return <section className={styles.files} aria-label="AI接続の設定と診断">
    <button hidden={embedded} type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !data) void load(true); }}>AI接続の設定・診断</button>
    {open ? <div className={styles.settingsContent}>
      <p>このPCのアプリ全体で使う接続先です。<HelpTip label="AI接続">作品ファイルには保存しません。診断では本文・メモ・プロンプトを送信しません。</HelpTip></p>
      <button type="button" disabled={busy} onClick={() => { if (!dirtyRef.current || window.confirm("未保存のAI接続設定を破棄して再読み込みしますか？")) void load(true); }}>AI設定を再読み込み</button>
      {draft && data ? <>
        <h3>接続先</h3>
        <label>主に使うAI<select aria-label="主に使うAI" value={draft.primary} disabled={controlsDisabled} onChange={(event) => {
          const primary = CONNECTION_MODES.find((mode) => mode === event.target.value); if (primary) edit({ ...draft, primary });
        }}>{CONNECTION_MODES.map((mode) => <option key={mode} value={mode} disabled={isPaidApiProvider(mode) && !data.paidApiAllowed}>{connectionLabel(mode)}</option>)}</select></label>
        <fieldset disabled={controlsDisabled}><legend>比較候補に表示するAI（0個または2個以上）</legend>
          {CONNECTION_MODES.filter((mode) => mode !== "disabled").map((mode) => <label key={mode}><input type="checkbox" checked={draft.comparison.includes(mode)} disabled={isPaidApiProvider(mode) && !data.paidApiAllowed && !draft.comparison.includes(mode)}
            onChange={(event) => edit({ ...draft, comparison: event.target.checked ? [...draft.comparison, mode] : draft.comparison.filter((id) => id !== mode) })} />{connectionLabel(mode)}を比較候補にする</label>)}
        </fieldset>
        <HelpHeading level={3} label="モデルIDと接続の診断" help={<>接続先で使う正確なモデルIDを入力します。「接続を診断」は保存済みの設定で、モデル一覧や認証状態だけを確かめます。本文は送りません。</>}>モデルIDと接続の診断</HelpHeading>
        {MODEL_FIELDS.map((mode) => <div key={mode}>
          <label>{connectionLabel(mode)}のモデルID<input aria-label={`${connectionLabel(mode)}の接続モデルID`} value={draft.models[mode]} disabled={controlsDisabled} onChange={(event) => edit({ ...draft, models: { ...draft.models, [mode]: event.target.value } })} /></label>
          {isPaidApiProvider(mode) ? <p>APIキー：{data.apiKeysConfigured[mode === "openai" || mode === "anthropic" || mode === "gemini" || mode === "xai" || mode === "deepseek" || mode === "meta" ? mode : "openai"] ? "サーバーに設定あり" : "サーバーに未設定"}</p> : null}
          <button type="button" aria-label={`${connectionLabel(mode)}の接続を診断`} disabled={controlsDisabled || dirtyRef.current || (isPaidApiProvider(mode) && (!data.paidApiAllowed || !paidApiEnabled))} onClick={() => void diagnose(mode)}>接続を診断</button>
        </div>)}
        <label>ローカルLLMのURL<input aria-label="ローカルLLMの接続URL" value={draft.localBaseUrl} disabled={controlsDisabled} onChange={(event) => edit({ ...draft, localBaseUrl: event.target.value })} /></label>
        <p>localhost / 127.0.0.1 / ::1 の /v1 だけ使えます。</p>
        <HelpHeading level={3} label="別料金のAPI" help={<>APIキー・認証情報・CLIの実行パスはサーバー側で管理します。APIは、サーバーの AI_ENABLE_PAID_API もONの場合だけ利用できます。</>}>別料金のAPI</HelpHeading>
        <label><input type="checkbox" checked={paidApiEnabled} disabled={controlsDisabled || !data.paidApiAllowed} onChange={(event) => { setDiagnostic(null); onPaidApiEnabledChange(event.target.checked); }} />サブスクと別料金のAPI利用・診断を許可する（初期OFF）</label>
        {dirtyRef.current ? <p role="status">AI接続設定に未保存の変更があります。診断前に保存してください。</p> : null}
        <button type="button" disabled={controlsDisabled} onClick={() => void save()}>AI接続設定を保存</button>
        <button type="button" disabled={controlsDisabled} onClick={() => { if (window.confirm("AI接続をサーバーの環境設定へ戻しますか？ 未保存の接続設定は破棄されます。")) void save(true); }}>AI接続を環境設定に戻す</button>
      </> : null}
      {busy ? <><p role="status">AI接続を確認・保存しています。</p><button type="button" onClick={() => { stop(); setMessage("処理を中止しました。保存中だった場合はAI設定を再読み込みして状態を確認してください。"); }}>接続処理をキャンセル</button></> : null}
      {diagnostic ? <p role="status">{connectionLabel(diagnostic.mode)}：{DIAGNOSTIC_MESSAGES[diagnostic.status]}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </div> : null}
  </section>;
});
