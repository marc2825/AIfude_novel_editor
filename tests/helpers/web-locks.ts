export class TestLockManager implements LockManager {
  readonly requestedNames: string[] = [];
  readonly #heldNames = new Set<string>();

  async query(): Promise<LockManagerSnapshot> {
    return {
      held: [...this.#heldNames].map((name) => ({
        mode: "exclusive",
        name,
      })),
      pending: [],
    };
  }

  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
  request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  async request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    suppliedCallback?: LockGrantedCallback<T>,
  ): Promise<Awaited<T>> {
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : suppliedCallback;

    if (callback === undefined) {
      throw new Error("A Web Locks callback is required");
    }

    this.requestedNames.push(name);

    if (this.#heldNames.has(name)) {
      if (options.ifAvailable === true) {
        return await callback(null);
      }

      throw new Error("The test lock manager only supports immediate requests");
    }

    this.#heldNames.add(name);

    try {
      return await callback({ mode: options.mode ?? "exclusive", name });
    } finally {
      this.#heldNames.delete(name);
    }
  }
}

export function installTestLockManager(
  manager = new TestLockManager(),
): TestLockManager {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: manager,
  });

  return manager;
}

export function removeTestLockManager(): void {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
}
