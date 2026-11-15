import { WorkspaceApp } from "../features/workspace/WorkspaceApp";
import { publicRuntimeForConnections } from "../domain/ai-connections";
import { publicConnectionState, readEffectiveAiEnvironment } from "../server/ai/connection-settings";
export const dynamic = "force-dynamic";
export default async function Home() {
  const effective = await readEffectiveAiEnvironment();
  const runtime = publicRuntimeForConnections(publicConnectionState(effective.environment, null));
  return <WorkspaceApp aiRuntime={{ ...runtime, settingsRevision: effective.revision,
    comparisonProviders: runtime.comparisonProviders?.map((provider) => ({ ...provider, settingsRevision: effective.revision })),
  }} />;
}
