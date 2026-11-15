export const WORKSPACE_LOCK_NAME = "novel-editor:workspace";

export type WorkspaceLockStatus =
  | "acquired"
  | "unavailable"
  | "unsupported";

export type WorkspaceLockLease = Readonly<{
  release: () => void;
  released: Promise<void>;
  status: WorkspaceLockStatus;
}>;

function inactiveLease(
  status: Exclude<WorkspaceLockStatus, "acquired">,
): WorkspaceLockLease {
  return {
    release() {},
    released: Promise.resolve(),
    status,
  };
}

export function acquireWorkspaceLock(): Promise<WorkspaceLockLease> {
  if (typeof navigator === "undefined" || navigator.locks === undefined) {
    return Promise.resolve(inactiveLease("unsupported"));
  }

  let releaseLock: (() => void) | null = null;
  let resolveLease!: (lease: WorkspaceLockLease) => void;
  let rejectLease!: (error: unknown) => void;
  let resolveReleased!: () => void;
  let rejectReleased!: (error: unknown) => void;
  let leaseSettled = false;

  const leasePromise = new Promise<WorkspaceLockLease>((resolve, reject) => {
    resolveLease = resolve;
    rejectLease = reject;
  });
  const released = new Promise<void>((resolve, reject) => {
    resolveReleased = resolve;
    rejectReleased = reject;
  });

  try {
    const request = navigator.locks.request(
      WORKSPACE_LOCK_NAME,
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (lock === null) {
          leaseSettled = true;
          resolveLease(inactiveLease("unavailable"));
          return;
        }

        const hold = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        let releasedByOwner = false;

        leaseSettled = true;
        resolveLease({
          release() {
            if (!releasedByOwner) {
              releasedByOwner = true;
              releaseLock?.();
            }
          },
          released,
          status: "acquired",
        });

        await hold;
      },
    );

    void request.then(resolveReleased, (error: unknown) => {
      if (!leaseSettled) {
        leaseSettled = true;
        resolveReleased();
        rejectLease(error);
        return;
      }
      rejectReleased(error);
    });
  } catch (error: unknown) {
    resolveReleased();
    rejectLease(error);
  }

  return leasePromise;
}
