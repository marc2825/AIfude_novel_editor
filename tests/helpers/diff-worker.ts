export class FakeDiffWorker {
  static instances: FakeDiffWorker[] = [];

  readonly messages: unknown[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminated = false;

  constructor() {
    FakeDiffWorker.instances.push(this);
  }

  static reset(): void {
    FakeDiffWorker.instances = [];
  }

  emitMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}
