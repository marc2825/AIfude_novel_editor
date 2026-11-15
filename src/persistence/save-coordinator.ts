export const AUTOSAVE_DEBOUNCE_MS = 500;
export const AUTOSAVE_MAX_WAIT_MS = 2_000;

export type SaveCoordinatorStatus =
  | "saved"
  | "dirty"
  | "saving"
  | "error";

export type SaveCoordinatorState = Readonly<{
  dirtySequence: number;
  error: unknown | null;
  savedSequence: number;
  status: SaveCoordinatorStatus;
}>;

type SaveCoordinatorOptions = Readonly<{
  onStateChange: (state: SaveCoordinatorState) => void;
  save: (dirtySequence: number) => Promise<void>;
}>;

export class SaveCoordinator {
  readonly #onStateChange: SaveCoordinatorOptions["onStateChange"];
  readonly #save: SaveCoordinatorOptions["save"];
  #activeSave: Promise<void> | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #dirtySequence = 0;
  #disposed = false;
  #maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  #savedSequence = 0;
  #state: SaveCoordinatorState = {
    dirtySequence: 0,
    error: null,
    savedSequence: 0,
    status: "saved",
  };

  constructor(options: SaveCoordinatorOptions) {
    this.#onStateChange = options.onStateChange;
    this.#save = options.save;
  }

  get state(): SaveCoordinatorState {
    return this.#state;
  }

  async flush(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    this.#startSave();
    await this.#activeSave;
  }

  markDirty(): number {
    if (this.#disposed) {
      return this.#dirtySequence;
    }

    this.#dirtySequence += 1;
    this.#setState({
      error: null,
      status: this.#activeSave === null ? "dirty" : "saving",
    });

    if (this.#activeSave === null) {
      this.#scheduleSave();
    }

    return this.#dirtySequence;
  }

  async dispose(): Promise<void> {
    if (!this.#disposed) {
      this.#disposed = true;
      this.#clearTimers();
    }

    await this.#activeSave;
  }

  #scheduleSave(): void {
    if (this.#maxWaitTimer === null) {
      this.#maxWaitTimer = setTimeout(() => {
        this.#maxWaitTimer = null;
        this.#startSave();
      }, AUTOSAVE_MAX_WAIT_MS);
    }

    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
    }

    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#startSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  #startSave(): void {
    this.#clearTimers();

    if (
      this.#disposed ||
      this.#activeSave !== null ||
      this.#dirtySequence <= this.#savedSequence
    ) {
      return;
    }

    const activeSave = this.#drain();
    this.#activeSave = activeSave;

    void activeSave.finally(() => {
      if (this.#activeSave === activeSave) {
        this.#activeSave = null;
      }
    });
  }

  async #drain(): Promise<void> {
    while (
      !this.#disposed &&
      this.#dirtySequence > this.#savedSequence
    ) {
      const savingSequence = this.#dirtySequence;
      this.#setState({ error: null, status: "saving" });

      try {
        await this.#save(savingSequence);
      } catch (error: unknown) {
        if (!this.#disposed) {
          this.#setState({ error, status: "error" });
        }
        return;
      }

      if (this.#disposed) {
        return;
      }

      this.#savedSequence = savingSequence;

      if (this.#dirtySequence === this.#savedSequence) {
        this.#setState({ error: null, status: "saved" });
      } else {
        this.#setState({ error: null, status: "saving" });
      }
    }
  }

  #setState(
    update: Pick<SaveCoordinatorState, "error" | "status">,
  ): void {
    this.#state = {
      dirtySequence: this.#dirtySequence,
      error: update.error,
      savedSequence: this.#savedSequence,
      status: update.status,
    };
    this.#onStateChange(this.#state);
  }

  #clearTimers(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    if (this.#maxWaitTimer !== null) {
      clearTimeout(this.#maxWaitTimer);
      this.#maxWaitTimer = null;
    }
  }
}
