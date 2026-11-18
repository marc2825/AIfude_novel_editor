"use client";
import { useEffect, useState } from "react";
import type { WorkspaceActionResult } from "../workspace/use-workspace";
import { HelpHeading } from "../ui/HelpTip";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
function isInstallPrompt(event: Event): event is InstallPrompt { return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event && event.userChoice instanceof Promise; }
export function PwaControls({ online, offlineShell, onSave }: Readonly<{ online: boolean; offlineShell: boolean; onSave: () => Promise<WorkspaceActionResult> }>) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    let alive = true;
    if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration("/").then((registration) => { if (alive) setReady(!!registration?.active); }).catch(() => {});
    function prompt(event: Event) { if (isInstallPrompt(event)) { event.preventDefault(); setInstall(event); } }
    window.addEventListener("beforeinstallprompt", prompt);
    return () => { alive = false; window.removeEventListener("beforeinstallprompt", prompt); };
  }, []);
  async function prepare() {
    if (!online || busy) return;
    if (process.env.NODE_ENV !== "production") { setMessage("オフライン用画面は本番ビルドで準備してください。"); return; }
    if (!("serviceWorker" in navigator) || !window.isSecureContext) { setMessage("この環境ではPWAを利用できません。HTTPSまたはlocalhostが必要です。"); return; }
    setBusy(true); setMessage("オフライン用の静的画面を保存しています…");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const updating = !!registration.active;
      await new Promise<void>((resolve, reject) => {
        if (registration.active && !registration.installing) { resolve(); return; }
        const worker = registration.installing ?? registration.waiting;
        if (!worker) { reject(new Error("No worker")); return; }
        const timer = setTimeout(() => { worker.removeEventListener("statechange", check); reject(new Error("Timeout")); }, 60_000);
        function check() {
          if (worker?.state === "activated" || (updating && worker?.state === "installed")) { clearTimeout(timer); worker.removeEventListener("statechange", check); resolve(); }
          else if (worker?.state === "redundant") { clearTimeout(timer); worker.removeEventListener("statechange", check); reject(new Error("Install failed")); }
        }
        worker.addEventListener("statechange", check); check();
      });
      // Refill an evicted static cache even when the worker script is unchanged.
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Cache timeout")); }, 60_000);
        channel.port1.onmessage = (event: MessageEvent<unknown>) => { clearTimeout(timer); channel.port1.close(); if (event.data === true) resolve(); else reject(new Error("Cache failed")); };
        (registration.waiting ?? registration.active)?.postMessage("prepare-public-shell", [channel.port2]);
      });
      setReady(true); setMessage(updating && registration.waiting ? "更新を準備しました。未保存の入力を保存し、このアプリの全タブを閉じて開き直すと更新されます。" : "オフライン利用の準備ができました。");
    } catch { setMessage("オフライン画面を保存できませんでした。接続や空き容量を確認して再試行してください。原稿は変更していません。"); }
    finally { setBusy(false); }
  }
  return <section aria-label="PWAとオフライン" style={{ marginBlock: "1rem" }}>
    <HelpHeading level={3} label="PWAとオフライン" help={<>iPhone/iPadはSafariの共有メニューから「ホーム画面に追加」、AndroidはChromeのメニューからインストールします。表示名はOSで異なります。画面のキャッシュに原稿・AI応答・認証情報は含めません。オフラインではAIを実行せず、通信が戻っても自動で再送信しません。</>}>PWAとオフライン</HelpHeading><p>{ready ? "オフライン画面の準備済みです。原稿はこの端末のブラウザへ保存します。" : "オフラインで再起動するには、接続中に画面を準備してください。"}</p>
    <button type="button" disabled={!online || busy} onClick={() => void prepare()}>{ready ? "オフライン画面の更新を確認" : "オフライン利用を準備"}</button>
    <button type="button" disabled={busy} onClick={async () => {
      try { const persisted = await navigator.storage?.persist?.(); setMessage(persisted ? "ブラウザから永続保存を許可されました。端末やブラウザからの手動削除には備えてバックアップしてください。" : "永続保存の許可を得られませんでした。編集は続けられます。JSONバックアップを併用してください。"); }
      catch { setMessage("永続保存の許可を確認できませんでした。JSONバックアップを併用してください。"); }
    }}>原稿の永続保存を要求</button>
    {install ? <button type="button" onClick={async () => { try { await install.prompt(); await install.userChoice; } catch { setMessage("インストールできませんでした。ブラウザのメニューを確認してください。"); } finally { setInstall(null); } }}>ホーム画面へ追加</button> : null}
    {offlineShell ? <button type="button" disabled={!online || busy} onClick={async () => {
      setBusy(true);
      // A fresh navigation reads the server runtime; the static offline shell never does.
      try { const saved = await onSave(); if (saved.ok) window.location.assign(new URL("/", window.location.href).href); else setMessage(saved.message ?? "保存が完了していないため、通常画面へ戻れません。"); }
      catch { setMessage("保存が完了していないため、通常画面へ戻れません。入力はこの画面に保持しています。"); }
      finally { setBusy(false); }
    }}>保存してオンライン画面へ戻る</button> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
