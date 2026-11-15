import "server-only";

import { createChatGptAuthService, type ChatGptAuthService } from "./auth";
import { createChatGptStore } from "./store";

declare global {
  // Next route bundles share this server-only instance and its pending OAuth attempt.
  var novelEditorChatGptAuth: Map<string, ChatGptAuthService> | undefined;
}

export function getChatGptAuth(directory: string): ChatGptAuthService {
  const services = globalThis.novelEditorChatGptAuth ??= new Map();
  let service = services.get(directory);
  if (service === undefined) {
    service = createChatGptAuthService({ store: createChatGptStore(directory) });
    services.set(directory, service);
  }
  return service;
}
