import { WorkspaceApp } from "../../features/workspace/WorkspaceApp";

// This static document contains no runtime/provider/credential data. Manuscripts load from IndexedDB.
export const dynamic = "force-static";
export default function OfflinePage() { return <WorkspaceApp offlineShell />; }
