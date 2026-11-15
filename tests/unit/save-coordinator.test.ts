import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  SaveCoordinator,
  type SaveCoordinatorState,
} from "../../src/persistence/save-coordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SaveCoordinator", () => {
  it("debounces rapid changes for 500ms", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const coordinator = new SaveCoordinator({
      onStateChange() {},
      save,
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(2);
    expect(coordinator.state).toMatchObject({
      dirtySequence: 2,
      savedSequence: 2,
      status: "saved",
    });
  });

  it("saves after the two-second maximum wait during continuous changes", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const coordinator = new SaveCoordinator({
      onStateChange() {},
      save,
    });

    coordinator.markDirty();

    for (let elapsed = 400; elapsed < AUTOSAVE_MAX_WAIT_MS; elapsed += 400) {
      await vi.advanceTimersByTimeAsync(400);
      coordinator.markDirty();
    }

    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(5);
  });

  it("serializes a newer change behind an active save", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const save = vi
      .fn<(sequence: number) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const coordinator = new SaveCoordinator({
      onStateChange() {},
      save,
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenNthCalledWith(1, 1);

    coordinator.markDirty();
    expect(coordinator.state).toMatchObject({
      dirtySequence: 2,
      savedSequence: 0,
      status: "saving",
    });

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenNthCalledWith(2, 2);
    expect(coordinator.state.status).toBe("saving");

    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.state).toMatchObject({
      dirtySequence: 2,
      savedSequence: 2,
      status: "saved",
    });
  });

  it("flushes pending work immediately", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const coordinator = new SaveCoordinator({
      onStateChange() {},
      save,
    });

    coordinator.markDirty();
    await coordinator.flush();

    expect(save).toHaveBeenCalledWith(1);
    expect(coordinator.state.status).toBe("saved");
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledOnce();
  });

  it("retains dirty state after failure and recovers on a later edit", async () => {
    vi.useFakeTimers();
    const failure = new DOMException("quota", "QuotaExceededError");
    const save = vi
      .fn<(sequence: number) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce();
    const coordinator = new SaveCoordinator({
      onStateChange() {},
      save,
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(coordinator.state).toMatchObject({
      dirtySequence: 1,
      error: failure,
      savedSequence: 0,
      status: "error",
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(save).toHaveBeenNthCalledWith(2, 2);
    expect(coordinator.state).toMatchObject({
      dirtySequence: 2,
      error: null,
      savedSequence: 2,
      status: "saved",
    });
  });

  it("cancels pending debounce work when disposed", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const states: SaveCoordinatorState[] = [];
    const coordinator = new SaveCoordinator({
      onStateChange(state) {
        states.push(state);
      },
      save,
    });

    coordinator.markDirty();
    await coordinator.dispose();
    await vi.runAllTimersAsync();

    expect(save).not.toHaveBeenCalled();
    expect(states.at(-1)?.status).toBe("dirty");
  });

  it("does not publish a late save completion after disposal", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const states: SaveCoordinatorState[] = [];
    const coordinator = new SaveCoordinator({
      onStateChange(state) {
        states.push(state);
      },
      save: () => pending.promise,
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    const publishedBeforeDispose = states.length;
    const disposal = coordinator.dispose();
    pending.resolve();
    await disposal;

    expect(states).toHaveLength(publishedBeforeDispose);
    expect(states.at(-1)?.status).toBe("saving");
  });
});
