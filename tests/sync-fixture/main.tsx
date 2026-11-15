import { createRoot } from "react-dom/client";
import { WorkspaceApp } from "../../src/features/workspace/WorkspaceApp";
import { sameOriginSyncTransport } from "../../src/features/sync/transport";
import { openWorkspaceDatabase } from "../../src/persistence/indexeddb";
import { WorkspaceRepository } from "../../src/persistence/workspace-repository";
import { createHistoryEntry, WritingHistoryRepository } from "../../src/persistence/writing-history";
import { createWorkspaceFixture } from "../fixtures/workspace";
import { authoringFixture } from "../fixtures/authoring";
import "../../src/app/globals.css";

// A separate test-only site, not a Next route, production mode, credential or deployment.
const database = await openWorkspaceDatabase();
const repository = new WorkspaceRepository(database);
if ((await repository.listFiles()).length === 0) {
  const snapshot = createWorkspaceFixture(); snapshot.project.authoringProfile = authoringFixture(); snapshot.project.storyMemory.characterNotes = "葵は静かに話す。";
  const saved = await repository.save(snapshot); await new WritingHistoryRepository(database).add(createHistoryEntry(saved, "端末移行前", "manual"));
}
database.close();
const root = document.getElementById("root"); if (!root) throw new Error("Missing root");
createRoot(root).render(<WorkspaceApp syncTransport={sameOriginSyncTransport(window.location.origin, true)} />);
