import { connectionActionSchema, diagnosticSchema, publicConnectionStateSchema, type ConnectionDiagnostic, type PublicConnectionState } from "../../domain/ai-connections";
import { z } from "zod";

type Action = z.infer<typeof connectionActionSchema>;
export async function requestAiConnectionSettings(action: Action | null, requestSignal: AbortSignal): Promise<PublicConnectionState | ConnectionDiagnostic> {
  requestSignal.throwIfAborted();
  if (action) connectionActionSchema.parse(action);
  const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 12_000);
  const signal = AbortSignal.any([timeout.signal, requestSignal]);
  let remove = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new Error("接続設定の処理を中止しました。")); signal.addEventListener("abort", abort, { once: true }); remove = () => signal.removeEventListener("abort", abort); if (signal.aborted) abort();
  });
  const receive = (async () => {
    const response = await fetch("/api/ai/connections", { method: action ? "POST" : "GET", cache: "no-store", signal,
      ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {}),
    });
    if (signal.aborted) { await response.body?.cancel(); throw new Error("Cancelled"); }
    const reader = response.body?.getReader(); if (!reader) throw new Error("Missing body");
    const cancelReader = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancelReader, { once: true });
    let bytes = 0; let text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        signal.throwIfAborted(); bytes += next.value.byteLength;
        if (bytes > 32_768) { await reader.cancel(); throw new Error("Response limit"); }
        text += decoder.decode(next.value, { stream: true });
      }
      const value: unknown = JSON.parse(text + decoder.decode());
      if (!response.ok) {
        const error = z.object({ error: z.string().max(256) }).strict().safeParse(value);
        throw new Error(error.success ? error.data.error : "AI接続設定を処理できませんでした。");
      }
      if (action?.action === "diagnose") {
        const parsed = diagnosticSchema.parse(value);
        if (parsed.requestId !== action.requestId || parsed.revision !== action.expectedRevision || parsed.mode !== action.mode) throw new Error("診断結果が現在の接続と一致しません。");
        return parsed;
      }
      return publicConnectionStateSchema.parse(value);
    } finally { signal.removeEventListener("abort", cancelReader); reader.releaseLock(); }
  })();
  try { return await Promise.race([receive, aborted]); }
  finally { clearTimeout(timer); remove(); }
}
