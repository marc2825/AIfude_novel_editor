import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const WORKSPACE_DATABASE_NAME = "novel-ai-editor";
export const WORKSPACE_DATABASE_VERSION = 6;
export const WORKSPACE_SYNC_STORE_NAME = "workspace-sync";
export const WORKSPACES_STORE_NAME = "workspaces";
export const WORKSPACE_FILES_STORE_NAME = "workspace-files";

export const WORKSPACE_TRASH_STORE_NAME = "workspace-trash";
export const WORKSPACE_HISTORY_STORE_NAME = "workspace-history";
export const WORKSPACE_VAULT_STORE_NAME = "workspace-vault";

export interface WorkspaceDatabase extends DBSchema {
  "workspace-sync": { key: string; value: unknown };
  workspaces: {
    key: string;
    value: unknown;
  };
  "workspace-trash": { key: string; value: unknown };
  "workspace-files": { key: string; value: unknown };
  "workspace-history": { key: string; value: unknown; indexes: { projectId: string } };
  "workspace-vault": { key: string; value: unknown };
}

export type OpenWorkspaceDatabase = IDBPDatabase<WorkspaceDatabase>;

export function openWorkspaceDatabase(): Promise<OpenWorkspaceDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("この環境ではIndexedDBを利用できません。"),
    );
  }

  return openDB<WorkspaceDatabase>(
    WORKSPACE_DATABASE_NAME,
    WORKSPACE_DATABASE_VERSION,
    {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore(WORKSPACES_STORE_NAME);
        }
        if (oldVersion < 2) database.createObjectStore(WORKSPACE_FILES_STORE_NAME);
        if (oldVersion < 4) database.createObjectStore(WORKSPACE_TRASH_STORE_NAME);
        if (oldVersion < 5) database.createObjectStore(WORKSPACE_SYNC_STORE_NAME);
        if (oldVersion < 3) database.createObjectStore(WORKSPACE_HISTORY_STORE_NAME).createIndex("projectId", "projectId");
        if (oldVersion < 6) database.createObjectStore(WORKSPACE_VAULT_STORE_NAME);
      },
    },
  );
}
