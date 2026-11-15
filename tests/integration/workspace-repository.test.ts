import "fake-indexeddb/auto";
import { authoringFixture } from "../fixtures/authoring";
import { createJsonWorkspaceDownload, parseWorkspaceBackup } from "../../src/features/workspace/backup";

import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidWorkspaceSnapshotError,
  UnsupportedWorkspaceSchemaVersionError,
} from "../../src/domain/workspace";
import {
  openWorkspaceDatabase,
  WORKSPACE_DATABASE_NAME,
  WORKSPACES_STORE_NAME,
  WORKSPACE_FILES_STORE_NAME,
  type OpenWorkspaceDatabase,
} from "../../src/persistence/indexeddb";
import {
  InvalidWorkspaceStoreError,
  WorkspaceRepository,
  WorkspaceVersionConflictError,
} from "../../src/persistence/workspace-repository";
import {
  createWorkspaceFixture,
  createWorkspaceV1Fixture,
  createWorkspaceV2Fixture,
  emptyPersistedDocument,
} from "../fixtures/workspace";

const openDatabases: OpenWorkspaceDatabase[] = [];

async function openTestRepository() {
  const database = await openWorkspaceDatabase();
  openDatabases.push(database);

  return {
    database,
    repository: new WorkspaceRepository(database),
  };
}

beforeEach(async () => {
  await deleteDB(WORKSPACE_DATABASE_NAME);
});

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }

  await deleteDB(WORKSPACE_DATABASE_NAME);
});

describe("WorkspaceRepository", () => {
  it("loads V4 without rewriting it, atomically persists authoring data and restores its backup", async () => {
    const { database, repository } = await openTestRepository();
    const source = createWorkspaceFixture();
    const { authoringProfile: _profile, ...project } = source.project; void _profile;
    const legacy = { ...source, schemaVersion: 4, project };
    await database.put(WORKSPACES_STORE_NAME, legacy, project.id);
    const loaded = await repository.load(); if (!loaded) throw new Error("load");
    expect(await database.get(WORKSPACES_STORE_NAME, project.id)).toEqual(legacy);
    const saved = await repository.save({ ...loaded, project: { ...loaded.project, authoringProfile: authoringFixture() } });
    expect(saved.schemaVersion).toBe(6); expect(saved.storageVersion).toBe(1);
    await expect(repository.save(loaded)).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
    const backup = createJsonWorkspaceDownload(saved);
    const restored = parseWorkspaceBackup(backup.contents, new TextEncoder().encode(backup.contents).length);
    expect(restored).toEqual(saved); expect(await repository.load()).toEqual(restored);
  });
  it("adds the file store to a V1 database without rewriting its existing workspace", async () => {
    const legacy = createWorkspaceV2Fixture();
    const old = await openDB(WORKSPACE_DATABASE_NAME, 1, { upgrade(db) { db.createObjectStore(WORKSPACES_STORE_NAME); } });
    await old.put(WORKSPACES_STORE_NAME, legacy, legacy.project.id); old.close();
    const { database, repository } = await openTestRepository();
    expect(database.version).toBe(5); expect(database.objectStoreNames.contains(WORKSPACE_FILES_STORE_NAME)).toBe(true);
    expect(await database.get(WORKSPACES_STORE_NAME, legacy.project.id)).toEqual(legacy);
    expect(await repository.listFiles()).toEqual([{ projectId: legacy.project.id, title: legacy.project.title }]);
  });
  it("atomically switches independent workspaces and preserves saved contents, settings, notes and versions", async () => {
    const { database, repository } = await openTestRepository();
    const first = await repository.save(createWorkspaceFixture());
    const second = createWorkspaceFixture({ identity: "replacement", body: emptyPersistedDocument });
    const active = await repository.activateFile({ projectId: first.project.id, storageVersion: first.storageVersion }, second);
    expect(active).toEqual(second); expect(await repository.load()).toEqual(second);
    expect(await database.get(WORKSPACE_FILES_STORE_NAME, first.project.id)).toEqual(first);
    const changed = await repository.save({ ...second, project: { ...second.project, storyMemory: { settingNotes: "第2作品", backgroundNotes: "", characterNotes: "" } } });
    await repository.activateFile({ projectId: second.project.id, storageVersion: changed.storageVersion }, first.project.id);
    expect(await repository.load()).toEqual(first);
    expect(await database.get(WORKSPACE_FILES_STORE_NAME, second.project.id)).toEqual(changed);
    expect(await database.count(WORKSPACES_STORE_NAME)).toBe(1); expect(await repository.listFiles()).toHaveLength(2);
  });
  it("rejects stale switches, malformed target files and import collisions without losing either work", async () => {
    const { database, repository } = await openTestRepository();
    const first = await repository.save(createWorkspaceFixture());
    const second = await repository.activateFile({ projectId: first.project.id, storageVersion: first.storageVersion }, createWorkspaceFixture({ identity: "replacement" }));
    const reference = { projectId: second.project.id, storageVersion: second.storageVersion };
    await expect(repository.activateFile({ ...reference, storageVersion: 99 }, first.project.id)).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
    await expect(repository.replace(reference, first)).rejects.toBeInstanceOf(InvalidWorkspaceStoreError);
    expect(await repository.load()).toEqual(second); expect(await database.get(WORKSPACE_FILES_STORE_NAME, first.project.id)).toEqual(first);
    await database.put(WORKSPACE_FILES_STORE_NAME, { schemaVersion: 99 }, first.project.id);
    await expect(repository.activateFile(reference, first.project.id)).rejects.toBeDefined();
    expect(await repository.load()).toEqual(second);
    expect(await database.get(WORKSPACE_FILES_STORE_NAME, first.project.id)).toEqual({ schemaVersion: 99 });
  });
  it("keeps archived works after deleting the active one and can reopen them without an active reference", async () => {
    const { repository } = await openTestRepository();
    const first = await repository.save(createWorkspaceFixture());
    const second = await repository.activateFile({ projectId: first.project.id, storageVersion: first.storageVersion }, createWorkspaceFixture({ identity: "replacement" }));
    await repository.delete({ projectId: second.project.id, storageVersion: second.storageVersion });
    expect(await repository.load()).toBeNull(); expect(await repository.listFiles()).toEqual([{ projectId: first.project.id, title: first.project.title }]);
    expect(await repository.activateFile(null, first.project.id)).toEqual(first);
  });
  it("loads V2 without modifying its stored record, then saves a V4 memory update with version checking", async () => {
    const { database, repository } = await openTestRepository();
    const legacy = createWorkspaceV2Fixture(); await database.put(WORKSPACES_STORE_NAME, legacy, legacy.project.id);
    const loaded = await repository.load(); if (!loaded) throw new Error("Expected workspace");
    expect(loaded.schemaVersion).toBe(6); expect(loaded.project.aiModelPreference).toBe("gpt-5.6-luna");
    expect(await database.get(WORKSPACES_STORE_NAME, legacy.project.id)).toEqual(legacy);
    const saved = await repository.save({ ...loaded, project: { ...loaded.project, storyMemory: {
      settingNotes: "魔法はない", backgroundNotes: "海辺の町", characterNotes: "葵：慎重",
    } } });
    expect(saved.storageVersion).toBe(legacy.storageVersion + 1); expect(saved.chapter).toEqual({ ...legacy.chapter, outlineNotes: "" });
    expect(await repository.load()).toEqual(saved);
    await expect(repository.save(loaded)).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
  });
  it("distinguishes a missing record from a valid empty manuscript", async () => {
    const { repository } = await openTestRepository();
    const snapshot = createWorkspaceFixture({ body: emptyPersistedDocument });

    await expect(repository.load(snapshot.project.id)).resolves.toBeNull();

    const saved = await repository.save(snapshot);

    await expect(repository.load(snapshot.project.id)).resolves.toEqual(saved);
    expect(saved.chapter.body).toEqual(emptyPersistedDocument);
  });

  it("persists a snapshot across database connections", async () => {
    const first = await openTestRepository();
    const snapshot = createWorkspaceFixture();

    await first.repository.save(snapshot);
    first.database.close();

    const second = await openTestRepository();

    await expect(second.repository.load(snapshot.project.id)).resolves.toEqual(
      snapshot,
    );
  });

  it("loads a stored V1 workspace through the explicit model migration", async () => {
    const { database, repository } = await openTestRepository();
    const legacy = createWorkspaceV1Fixture();
    await database.put(
      WORKSPACES_STORE_NAME,
      legacy,
      legacy.project.id,
    );

    await expect(repository.load(legacy.project.id)).resolves.toMatchObject({
      project: { aiModelPreference: "automatic" },
      schemaVersion: 6,
    });
    await expect(
      database.get(WORKSPACES_STORE_NAME, legacy.project.id),
    ).resolves.toEqual(legacy);
  });

  it("discovers the single V0.1 workspace when no project ID is supplied", async () => {
    const { repository } = await openTestRepository();
    const snapshot = await repository.save(createWorkspaceFixture());

    await expect(repository.load()).resolves.toEqual(snapshot);
  });

  it("rejects an invalid singleton store when loading without a project ID", async () => {
    const { database, repository } = await openTestRepository();
    const primary = createWorkspaceFixture();
    const replacement = createWorkspaceFixture({ identity: "replacement" });
    await database.put(
      WORKSPACES_STORE_NAME,
      primary,
      primary.project.id,
    );
    await database.put(
      WORKSPACES_STORE_NAME,
      replacement,
      replacement.project.id,
    );

    await expect(repository.load()).rejects.toBeInstanceOf(
      InvalidWorkspaceStoreError,
    );
  });

  it("increments storageVersion on repeated saves", async () => {
    const { repository } = await openTestRepository();
    const first = await repository.save(createWorkspaceFixture());
    const changed = {
      ...first,
      chapter: {
        ...first.chapter,
        body: emptyPersistedDocument,
        contentRevision: 1,
      },
    };

    const second = await repository.save(changed);

    expect(first.storageVersion).toBe(0);
    expect(second.storageVersion).toBe(1);
    expect(second.chapter.body).toEqual(emptyPersistedDocument);
  });

  it("does not create a second workspace through save", async () => {
    const { repository } = await openTestRepository();
    const current = await repository.save(createWorkspaceFixture());
    const other = createWorkspaceFixture({ identity: "replacement" });

    await expect(repository.save(other)).rejects.toBeInstanceOf(
      InvalidWorkspaceStoreError,
    );
    await expect(repository.load(current.project.id)).resolves.toEqual(current);
    await expect(repository.load(other.project.id)).resolves.toBeNull();
  });

  it("compares and updates storageVersion in the same transaction", async () => {
    const { repository } = await openTestRepository();
    const current = await repository.save(createWorkspaceFixture());
    const firstWrite = repository.save({
      ...current,
      chapter: { ...current.chapter, contentRevision: 1 },
    });
    const staleWrite = repository.save({
      ...current,
      chapter: { ...current.chapter, contentRevision: 2 },
    });

    const results = await Promise.allSettled([firstWrite, staleWrite]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: expect.any(WorkspaceVersionConflictError) });

    const loaded = await repository.load(current.project.id);
    expect(loaded?.storageVersion).toBe(1);
    expect([1, 2]).toContain(loaded?.chapter.contentRevision);
  });

  it("atomically replaces the single workspace and ignores imported storageVersion", async () => {
    const { repository } = await openTestRepository();
    const current = await repository.save(createWorkspaceFixture());
    const imported = createWorkspaceFixture({
      identity: "replacement",
      storageVersion: 99,
    });

    const replaced = await repository.replace(
      {
        projectId: current.project.id,
        storageVersion: current.storageVersion,
      },
      imported,
    );

    expect(replaced.project.id).toBe(imported.project.id);
    expect(replaced.storageVersion).toBe(1);
    await expect(repository.load(current.project.id)).resolves.toBeNull();
    await expect(repository.load(imported.project.id)).resolves.toEqual(replaced);
  });

  it("deletes only the expected workspace version", async () => {
    const { repository } = await openTestRepository();
    const current = await repository.save(createWorkspaceFixture());

    await expect(
      repository.delete({
        projectId: current.project.id,
        storageVersion: 1,
      }),
    ).rejects.toBeInstanceOf(WorkspaceVersionConflictError);
    await expect(repository.load(current.project.id)).resolves.toEqual(current);

    await repository.delete({
      projectId: current.project.id,
      storageVersion: current.storageVersion,
    });

    await expect(repository.load(current.project.id)).resolves.toBeNull();
  });

  it("rejects malformed stored data without overwriting it", async () => {
    const { database, repository } = await openTestRepository();
    const snapshot = createWorkspaceFixture();
    const malformed = {
      schemaVersion: 1,
      storageVersion: 0,
      project: { id: snapshot.project.id },
    };

    await database.put(WORKSPACES_STORE_NAME, malformed, snapshot.project.id);

    await expect(repository.load(snapshot.project.id)).rejects.toBeInstanceOf(
      InvalidWorkspaceSnapshotError,
    );
    await expect(repository.save(snapshot)).rejects.toBeInstanceOf(
      InvalidWorkspaceSnapshotError,
    );
    await expect(
      database.get(WORKSPACES_STORE_NAME, snapshot.project.id),
    ).resolves.toEqual(malformed);
  });

  it("rejects an unsupported stored version without replacing it", async () => {
    const { database, repository } = await openTestRepository();
    const snapshot = createWorkspaceFixture();
    const future = { ...snapshot, schemaVersion: 7 };

    await database.put(WORKSPACES_STORE_NAME, future, snapshot.project.id);

    await expect(repository.load(snapshot.project.id)).rejects.toBeInstanceOf(
      UnsupportedWorkspaceSchemaVersionError,
    );
    await expect(repository.save(snapshot)).rejects.toBeInstanceOf(
      UnsupportedWorkspaceSchemaVersionError,
    );
    await expect(
      database.get(WORKSPACES_STORE_NAME, snapshot.project.id),
    ).resolves.toEqual(future);
  });

  it("surfaces storage read failure", async () => {
    const { database, repository } = await openTestRepository();
    const snapshot = createWorkspaceFixture();
    database.close();

    await expect(repository.load(snapshot.project.id)).rejects.toBeDefined();
  });

  it("surfaces storage write failure without reporting success", async () => {
    const { database, repository } = await openTestRepository();
    database.close();

    await expect(
      repository.save(createWorkspaceFixture()),
    ).rejects.toBeDefined();
  });
});
