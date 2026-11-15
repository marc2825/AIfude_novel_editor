import { describe, expect, it } from "vitest";

import {
  acquireWorkspaceLock,
  WORKSPACE_LOCK_NAME,
} from "../../src/persistence/workspace-lock";
import {
  installTestLockManager,
  removeTestLockManager,
} from "../helpers/web-locks";

describe("workspace editing lock", () => {
  it("uses the fixed namespaced lock for the session lifetime", async () => {
    const manager = installTestLockManager();
    const first = await acquireWorkspaceLock();
    const second = await acquireWorkspaceLock();

    expect(first.status).toBe("acquired");
    expect(second.status).toBe("unavailable");
    expect(manager.requestedNames).toEqual([
      WORKSPACE_LOCK_NAME,
      WORKSPACE_LOCK_NAME,
    ]);
    expect(WORKSPACE_LOCK_NAME).toBe("novel-editor:workspace");

    first.release();
    await first.released;

    const third = await acquireWorkspaceLock();
    expect(third.status).toBe("acquired");
    third.release();
    await third.released;
  });

  it("reports unsupported instead of pretending to own a lock", async () => {
    removeTestLockManager();

    const lease = await acquireWorkspaceLock();

    expect(lease.status).toBe("unsupported");
    await expect(lease.released).resolves.toBeUndefined();
  });
});
