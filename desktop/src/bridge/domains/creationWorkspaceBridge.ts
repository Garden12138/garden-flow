import type { BridgeCore } from '../types';
import type { CreationWorkspace, CreationTurn, CreationDraft } from '../../../shared/creationWorkspace';
import type { ProductPlatform } from '../../../shared/productCreationTarget';
import type { CreationCapability } from '../../../shared/creationWorkspace';
export interface CreationResponse { success: boolean; error?: string; workspace?: CreationWorkspace; }
export function createCreationWorkspaceBridge(core: BridgeCore) {
    const invoke = (channel: string, payload: unknown) => core.invokeChannel(channel, payload) as Promise<CreationResponse>;
    return { creationWorkspace: {
        start: (selection: import('zod').z.input<typeof import('../../../shared/creationWorkspace').CreationStartSchema>) => invoke('creation-workspace:start', selection),
        read: (workspaceId: string) => invoke('creation-workspace:read', { workspaceId }),
        save: (input: CreationTurn & { draft: CreationDraft }) => invoke('creation-workspace:save', input),
        markDraft: (workspaceId: string) => invoke('creation-workspace:draft', { workspaceId }),
        undo: (input: CreationTurn) => invoke('creation-workspace:undo', input),
        materialize: (input: CreationTurn) => invoke('creation-workspace:materialize', input),
        fork: (workspaceId: string, selection: import('zod').z.input<typeof import('../../../shared/creationWorkspace').CreationStartSchema>) => invoke('creation-workspace:fork', { workspaceId, selection }),
        sources: <T = unknown>(workspaceId: string) => core.invokeChannel('creation-workspace:sources', { workspaceId }) as Promise<T>,
    } };
}
