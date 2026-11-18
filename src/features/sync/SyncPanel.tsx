"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_SYNC_BYTES, parseSyncPayload, historyFromSync, workspaceFromSync, type SyncPayload, type SyncState } from "../../domain/sync";
import { manuscriptPlainText } from "../../domain/typography";
import type { LibraryBackup } from "../../persistence/library-backup";
import type { WorkspaceActionResult } from "../workspace/use-workspace";
import { downloadWorkspaceFile } from "../workspace/backup";
import { useOnline } from "../offline/use-online";
import type { WorkspaceSyncActions } from "./operations";
import { SyncTransportError, type SyncTransport } from "./transport";
import { HelpHeading } from "../ui/HelpTip";

const errors = { offline: "オフラインです。原稿は端末に保存されています。接続後に再送を選んでください。", auth: "同期の認証が失効しています。再認証後に再送してください。", network: "同期先へ接続できません。送信待ちは保持しています。", invalid: "同期データを検証できませんでした。原稿と送信待ちは保持しています。", limit: "同期先の容量・件数上限に達しました。原稿と送信待ちは端末に保持しています。", unconfigured: "同期先が未設定です。ネットワークへ送信していません。" };
export function SyncPanel({ actions, onSave, onImport, disabled, transport }: Readonly<{
  actions: WorkspaceSyncActions; onSave: () => Promise<WorkspaceActionResult>; onImport: (backup: LibraryBackup) => Promise<WorkspaceActionResult>;
  disabled: boolean; transport?: SyncTransport;
}>) {
  const online = useOnline(); const [state, setState] = useState<SyncState | null>(null); const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<SyncPayload | null>(null);
  const alive = useRef(false); const request = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    alive.current = true; let active = true;
    void actions.load().then((value) => { if (active) setState(value); }).catch(() => { if (active) setMessage("同期状態を読み込めませんでした。本文の編集・保存は続けられます。"); });
    return () => { alive.current = false; active = false; request.current?.abort(); };
  }, [actions]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current || disabled) return; busyRef.current = true; setBusy(true); setMessage("");
    const controller = new AbortController(); request.current = controller;
    try { await action(controller.signal); }
    catch (error: unknown) { if (alive.current) setMessage(error instanceof SyncTransportError ? errors[error.code] : "操作を完了できませんでした。原稿・履歴・同期コピーは保持しています。容量と同期状態を確認してください。"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); if (request.current === controller) request.current = null; }
  }
  async function saved() { const result = await onSave(); if (!result.ok) throw new Error("Local save failed"); }
  async function refresh(value: Promise<SyncState>) { const next = await value; if (alive.current) setState(next); }
  return <section aria-label="端末同期" style={{ marginBlock: "1rem" }}>
    <HelpHeading level={3} label="端末同期" help={<>同期は初期OFFです。本文・全章・作品メモリ・執筆設定・保存履歴を扱います。AI接続設定・APIキー・OAuth資格情報は含みません。</>}>端末同期（プレビュー）</HelpHeading>
    <p>{transport ? `同期先：${transport.destination}` : "接続先は未設定です。端末移行用ファイルの書き出し・コピー復元は使えます。"}</p>
    <details><summary>保存先と保護方式</summary><p>端末には送信待ちと受信コピーを保存します。接続時は同じサイトのHTTPSサーバーへ送信する設計です。サーバー管理者は原稿を読めます。端末間暗号化（E2EE）は未対応です。原稿・メモに自分で記載した秘密は自動除去されません。</p><p>同期先との連携は認証方式の決定・検証後に提供します。端末からの削除を同期先へ伝播しません。復旧後の再送は明示操作です。</p></details>
    <label style={{ display: "flex", alignItems: "center", minHeight: 44, gap: 8 }}><input type="checkbox" style={{ width: 20, height: 20, flex: "0 0 20px" }} checked={state?.enabled ?? false} disabled={disabled || busy || !state}
      onChange={(event) => {
        const enabled = event.target.checked; const previous = state; if (!previous) return;
        setState({ ...previous, enabled });
        void run(async () => { try { await refresh(actions.enable(enabled)); } catch (error: unknown) { if (alive.current) setState(previous); throw error; } });
      }} />この作品の同期準備を有効にする</label>
    <p role="status">{!state?.enabled ? "同期準備はOFFです。送信待ちやコピーは端末に保持します。" : state.conflict ? "同期競合：双方の原稿をコピーとして保持しています。" : state.pending ? "送信待ちの原稿があります。端末への保存と同期完了は別です。" : state.lastUploaded ? `前回の送信完了（改訂 ${state.remoteRevision}）。新しい編集は改めて準備してください。` : "同期はまだ完了していません。"}</p>
    {state?.lastError ? <p role="alert">{errors[state.lastError]}</p> : null}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" disabled={disabled || busy || !state?.enabled || !!state.pending || state.conflict} onClick={() => void run(async () => { await saved(); await refresh(actions.prepare()); })}>保存して送信待ちを準備</button>
      <button type="button" disabled={disabled || busy || !online || !transport || !state?.enabled || !state.pending || state.conflict}
        onClick={() => void run(async (signal) => { if (transport) await refresh(actions.send(transport, signal)); })}>送信待ちを送る・再送</button>
      <button type="button" disabled={disabled || busy || !online || !transport || !state?.enabled}
        onClick={() => void run(async (signal) => { if (transport) await refresh(actions.receive(transport, signal)); })}>同期先の原稿を受信</button>
    </div>
    {state?.pending ? <><p>待機中の原稿は固定されています。準備後の編集は端末へ保存され、今回の送信には入りません。</p><button type="button" onClick={() => setPreview(state.pending?.payload ?? null)}>送信待ちの内容を確認</button></> : null}
    {state?.conflict ? <><p>コピーを確認してください。現在の端末版を次の改訂として送るには、次の操作で競合を解決し、改めて送信待ちを準備します。</p>
      <button type="button" disabled={disabled || busy} onClick={() => void run(() => refresh(actions.resolve(state.sequence)))}>コピーを残して端末版で競合を解決</button></> : null}
    {state?.copies.length ? <><p>同期コピー {state.copies.length}/20件。通常のバックアップへ含めるには、作品として復元してください。確認画面から個別に書き出すこともできます。</p>
      <ul>{state.copies.map((copy) => <li key={copy.id}>{copy.source === "local-conflict" ? "端末の競合コピー" : copy.source === "remote-conflict" ? "同期先の競合コピー" : "同期先の受信コピー"}（改訂 {copy.revision}）
      <button type="button" onClick={() => setPreview(copy.payload)}>内容を確認</button>
      <button type="button" disabled={disabled || busy || state.conflict} onClick={() => {
        if (window.confirm("この同期コピーを端末から削除しますか？ 必要な原稿は先に書き出すか作品として復元してください。現在の本文は変更しません。")) void run(() => refresh(actions.removeCopy(copy.id, state.sequence)));
      }}>同期コピーを削除</button></li>)}</ul></> : null}
    <details><summary>ファイルで端末移行・コピー復元</summary>
      <p>10MiBまで。原稿とメモを含むファイルです。受け渡し先を確認してください。取り込みは内容確認後にコピーを追加し、既存の原稿を残します。</p>
      <button type="button" disabled={disabled || busy} onClick={() => void run(async () => {
        await saved(); const payload = await actions.export();
        if (alive.current) downloadWorkspaceFile({ contents: JSON.stringify(payload), filename: `novel-transfer-${payload.workspace.project.id}.json`, mimeType: "application/json;charset=utf-8" });
      })}>端末移行用ファイルを書き出す</button>
      <label>端末移行用ファイルを確認<input type="file" accept="application/json,.json" disabled={disabled || busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return;
        void run(async () => { if (file.size > MAX_SYNC_BYTES) throw new Error("File limit"); const payload = parseSyncPayload(JSON.parse(await file.text())); if (alive.current) setPreview(payload); });
      }} /></label>
    </details>
    {preview ? <div role="region" aria-label="同期原稿の確認">
      <h4>{preview.workspace.project.title}</h4><p>{preview.workspace.chapters.length}章・保存履歴{preview.history.length}件。作品メモリと執筆設定も復元対象です。</p>
      {preview.workspace.chapters.map((chapter) => <details key={chapter.id}><summary>{chapter.title}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "18rem", overflow: "auto" }}>{manuscriptPlainText(chapter.body)}</pre></details>)}
      <button type="button" onClick={() => downloadWorkspaceFile({ contents: JSON.stringify(preview), filename: `novel-transfer-${preview.workspace.project.id}.json`, mimeType: "application/json;charset=utf-8" })}>確認中の原稿を書き出す</button>
      <button type="button" disabled={disabled || busy} onClick={() => void run(async () => {
        await saved(); const result = await onImport({ kind: "novel-editor-library", version: 2, exportedAt: new Date().toISOString(), workspaces: [workspaceFromSync(preview.workspace)], history: historyFromSync(preview), trash: [] });
        if (alive.current) { setMessage(result.message ?? (result.ok ? "コピーを復元しました。作品一覧から開けます。" : "復元できませんでした。")); if (result.ok) setPreview(null); }
      })}>この原稿と履歴をコピーとして復元</button>
      <button type="button" onClick={() => setPreview(null)}>確認を閉じる</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
