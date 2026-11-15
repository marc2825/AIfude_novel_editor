import { analyzeJapanese, DIAGNOSTIC_TEXT_LIMIT } from "../../domain/japanese-diagnostics";

self.onmessage = (event: MessageEvent<unknown>) => {
  if (typeof event.data !== "string" || event.data.length > DIAGNOSTIC_TEXT_LIMIT) { self.postMessage(null); return; }
  try { self.postMessage(analyzeJapanese(event.data)); } catch { self.postMessage(null); }
};
