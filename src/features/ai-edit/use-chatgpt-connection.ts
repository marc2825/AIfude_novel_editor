"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatGptConnectionStatusSchema, type ChatGptConnectionStatus } from "../../domain/chatgpt-connection";

async function connectionRequest(init: RequestInit = {}) {
  const signal = init.signal ?? AbortSignal.timeout(15_000);
  let cleanup = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new DOMException("Connection request aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    cleanup = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) onAbort();
  });
  const receive = (async () => {
    const response = await fetch("/api/ai/chatgpt", { ...init, cache: "no-store", signal });
    const value: unknown = await response.json();
    return { ok: response.ok, value };
  })();
  try { return await Promise.race([receive, aborted]); } finally { cleanup(); }
}

export function useChatGptConnection(enabled: boolean, onInvalidate: () => void) {
  const [status, setStatus] = useState<ChatGptConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const sequence = useRef(0);
  const alive = useRef(false);
  const identity = useRef<string | null>(null);
  const awaiting = useRef<{ previous: string | null } | null>(null);
  const popup = useRef<Window | null>(null);
  const mutations = useRef(0);
  const locallyDisconnected = useRef(false);
  const cancelPending = useCallback(() => { ++sequence.current; ++mutations.current; }, []);

  const refresh = useCallback(async () => {
    if (!alive.current) return;
    const ownSequence = ++sequence.current;
    try {
      const response = await connectionRequest();
      const value = response.value;
      const parsed = chatGptConnectionStatusSchema.safeParse(value);
      if (!response.ok || !parsed.success) throw new Error("Invalid status");
      if (!alive.current || ownSequence !== sequence.current) return;
      if (locallyDisconnected.current && parsed.data.connected) return;
      if (identity.current !== parsed.data.connectionId) onInvalidate();
      identity.current = parsed.data.connectionId;
      setStatus(parsed.data);
      if (awaiting.current !== null && parsed.data.signInFailed) {
        awaiting.current = null; setConnecting(false); setAuthorizationUrl(null);
        setError("認証が完了しませんでした。もう一度接続してください。");
      }
      if (awaiting.current !== null && parsed.data.connected && parsed.data.connectionId !== awaiting.current.previous) {
        awaiting.current = null;
        setConnecting(false); setAuthorizationUrl(null); setError(null);
        popup.current?.close(); popup.current = null;
      }
    } catch {
      if (!alive.current || ownSequence !== sequence.current) return;
      onInvalidate(); identity.current = null; setStatus(null);
      setError("ChatGPTへの接続状態を確認できませんでした。");
    }
  }, [onInvalidate]);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    const focused = () => { void refresh(); };
    window.addEventListener("focus", focused);
    return () => { active = false; alive.current = false; cancelPending(); window.removeEventListener("focus", focused); };
  }, [enabled, refresh, cancelPending]);

  useEffect(() => {
    if (!connecting) return;
    const interval = window.setInterval(() => { void refresh(); }, 2000);
    const timeout = window.setTimeout(() => {
      awaiting.current = null; setConnecting(false); setAuthorizationUrl(null);
      setError("認証の待ち時間を超えました。もう一度接続してください。");
    }, 300_000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [connecting, refresh]);

  async function change(action: "sign-in" | "disconnect" | "acknowledge") {
    const ownMutation = ++mutations.current;
    if (action !== "acknowledge") { onInvalidate(); ++sequence.current; }
    setBusy(true); setError(null);
    const previous = identity.current;
    if (action === "sign-in") {
      locallyDisconnected.current = false;
      try { popup.current = window.open("about:blank", "_blank", "popup"); }
      catch { popup.current = null; }
      if (popup.current !== null) popup.current.opener = null;
      awaiting.current = { previous }; setConnecting(true);
    } else if (action === "disconnect") {
      locallyDisconnected.current = true;
      awaiting.current = null; setConnecting(false); setAuthorizationUrl(null);
      identity.current = null; setStatus(null);
      popup.current?.close(); popup.current = null;
    }
    try {
      const response = await connectionRequest({
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }), signal: AbortSignal.timeout(15_000),
      });
      const value = response.value;
      if (!response.ok || typeof value !== "object" || value === null) throw new Error("Connection failure");
      if (!alive.current || ownMutation !== mutations.current) return;
      if (action === "sign-in") {
        if (!("authorizationUrl" in value) || typeof value.authorizationUrl !== "string") throw new Error("Invalid URL");
        const url = new URL(value.authorizationUrl);
        if (url.origin !== "https://auth.openai.com" || url.pathname !== "/api/accounts/authorize" || url.username || url.password) throw new Error("Invalid URL");
        setAuthorizationUrl(url.href);
        if (popup.current !== null) popup.current.location.href = url.href;
      } else {
        await refresh();
        if (action === "disconnect" && "revocationConfirmed" in value && value.revocationConfirmed !== true) {
          setError("このPCの接続は解除しました。OpenAI側の解除は確認できなかったため、ChatGPTの設定でも接続を確認してください。");
        }
      }
    } catch {
      if (!alive.current || ownMutation !== mutations.current) return;
      awaiting.current = null; setConnecting(false); setAuthorizationUrl(null);
      popup.current?.close(); popup.current = null;
      setError("ChatGPTへの接続を変更できませんでした。再度お試しください。");
    } finally { if (alive.current && ownMutation === mutations.current) setBusy(false); }
  }
  return { status, busy, connecting, error, authorizationUrl, refresh,
    signIn: () => change("sign-in"), disconnect: () => change("disconnect"), acknowledgeWelcome: () => change("acknowledge") };
}
export type ChatGptConnectionController = ReturnType<typeof useChatGptConnection>;
