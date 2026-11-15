import type { SyncPayload, SyncState } from "../../domain/sync";
import type { SyncRepository } from "../../persistence/sync-repository";
import { SyncTransportError, type SyncTransport } from "./transport";

export interface WorkspaceSyncActions {
  load(): Promise<SyncState>;
  enable(enabled: boolean): Promise<SyncState>;
  prepare(): Promise<SyncState>;
  send(transport: SyncTransport, signal: AbortSignal): Promise<SyncState>;
  receive(transport: SyncTransport, signal: AbortSignal): Promise<SyncState>;
  resolve(sequence: number): Promise<SyncState>;
  removeCopy(copyId: string, sequence: number): Promise<SyncState>;
  export(): Promise<SyncPayload>;
}
export async function sendPending(repository: SyncRepository, id: string, transport: SyncTransport, signal: AbortSignal): Promise<SyncState> {
  const state = await repository.load(id); const pending = state.pending;
  if (!state.enabled || !pending || state.conflict || signal.aborted) return state;
  try {
    const response = await transport.exchange(pending, signal);
    if (signal.aborted) return repository.load(id);
    return await repository.complete(id, response);
  } catch (error: unknown) {
    if (signal.aborted) return repository.load(id);
    return repository.fail(id, pending.operationId, error instanceof SyncTransportError ? error.code : "invalid");
  }
}
export async function receiveRemote(repository: SyncRepository, id: string, transport: SyncTransport, signal: AbortSignal): Promise<SyncState> {
  const state = await repository.load(id);
  if (!state.enabled || signal.aborted) return state;
  const remote = await transport.read(id, signal);
  if (signal.aborted) return repository.load(id);
  return repository.receive(id, remote, state.sequence);
}
