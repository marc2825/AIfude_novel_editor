"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatGptConnectionController } from "./use-chatgpt-connection";

export function ChatGptConnectionPanel({ connection, disabled }: Readonly<{ connection: ChatGptConnectionController; disabled: boolean }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissedConnection, setDismissedConnection] = useState<string | null>(null);
  const connectionId = connection.status?.connectionId ?? null;
  const welcome = connection.status?.welcomePending === true && connectionId !== dismissedConnection && !disabled;
  function dismissWelcome() {
    setDismissedConnection(connectionId);
    void connection.acknowledgeWelcome();
  }
  useEffect(() => {
    if (!welcome || dialog.current === null) return;
    const element = dialog.current;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    return () => { if (typeof element.close === "function") element.close(); };
  }, [welcome]);
  return <section aria-labelledby="chatgpt-connection-title">
    <h2 id="chatgpt-connection-title">ChatGPTサブスク連携（実験的）</h2>
    <p>提供元の利用条件を確認中の実験的な機能です。</p>
    <p>契約済みのChatGPT利用枠または利用可能なクレジットを使います。他のアプリと利用枠を共有します。</p>
    <p role="status">{connection.connecting ? "ChatGPTで認証してください。エディタはそのまま利用できます。" : connection.status?.connected
      ? `接続済み${connection.status.email ? `：${connection.status.email}` : ""}` : "未接続"}</p>
    <button disabled={disabled || connection.busy} onClick={() => void connection.signIn()} type="button">Continue with ChatGPT</button>
    {connection.status?.connected || connection.connecting ? <button disabled={disabled || connection.busy} onClick={() => void connection.disconnect()} type="button">ChatGPTの接続を解除</button> : null}
    <button disabled={connection.busy} onClick={() => void connection.refresh()} type="button">接続状態を更新</button>
    {connection.authorizationUrl ? <p><a href={connection.authorizationUrl} target="_blank" rel="noreferrer">ChatGPTの認証画面を開く</a></p> : null}
    <p><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">ChatGPTで利用枠を確認</a>：設定の「Usage」で管理できます。</p>
    <p>利用枠不足や接続失敗でも、従量課金APIやローカルLLMへの自動切替は行いません。</p>
    <p>接続はこのPCに保存され、本文のバックアップや削除とは別に管理されます。</p>
    {connection.error ? <p role="alert">{connection.error}</p> : null}
    {welcome ? <dialog aria-labelledby="chatgpt-welcome-title" ref={dialog} onCancel={(event) => { event.preventDefault(); dismissWelcome(); }}>
      <h2 id="chatgpt-welcome-title">ChatGPTの利用枠を使います</h2>
      <p>このアプリでの生成はChatGPTの利用枠を消費します。利用状況と上限はChatGPTの設定で管理できます。</p>
      <button autoFocus onClick={dismissWelcome} type="button">確認しました</button>
    </dialog> : null}
  </section>;
}
