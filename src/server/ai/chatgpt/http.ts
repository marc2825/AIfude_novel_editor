import "server-only";

export type ChatGptFetch = typeof globalThis.fetch;

export async function readBoundedJson(response: Response, maximumBytes = 65_536, signal?: AbortSignal): Promise<unknown> {
  if (response.body === null) {
    throw new Error("Missing response");
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let length = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error("Response limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    return value;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
