import type { BridgeCore, Listener } from '../types';
import type { PublicationSource, PublicationSnapshot, PublicationJobView, PublicationBrowserState, PublicationCompletion } from '../../../shared/publication';
import type { PublicationPlatform } from '../../../shared/platformPublisher';
type Result<T> = T & { success: boolean; error?: string };
type Action = { platform: PublicationPlatform; jobId: string; expectedDigest: string; acknowledged?: boolean; coverOnly?: true };
export function createPublicationBridge(core: BridgeCore) {
    return { publication: {
        readSource: (payload: { source: PublicationSource }) => core.invokeChannel('publication:source', payload) as Promise<Result<{ snapshot?: PublicationSnapshot }>>,
        status: (payload: { refresh?: boolean } = {}) => core.invokeChannel('publication:status', payload) as Promise<Result<{ statuses: PublicationBrowserState[] }>>,
        list: () => core.invokeChannel('publication:list') as Promise<Result<{ jobs: PublicationJobView[]; offers: PublicationCompletion[] }>>,
        getJob: (payload: { platform: PublicationPlatform; jobId: string }) => core.invokeChannel('publication:get-job', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        prepare: (payload: { source: PublicationSource; expectedRevision: string; origin?: 'manual' | 'completion'; promptId?: string }) => core.invokeChannel('publication:prepare', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        upload: (payload: Action) => core.invokeChannel('publication:upload', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        submit: (payload: Action) => core.invokeChannel('publication:submit', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        cancel: (payload: Action) => core.invokeChannel('publication:cancel', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        recover: (payload: Action) => core.invokeChannel('publication:recover', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        review: (payload: Action) => core.invokeChannel('publication:review', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        receipt: (payload: Action) => core.invokeChannel('publication:receipt', payload) as Promise<Result<{ job?: PublicationJobView }>>,
        bind: (payload: { platform: PublicationPlatform; extensionInstanceId: string }) => core.invokeChannel('publication:bind', payload) as Promise<Result<{}>>,
        dismissOffer: (payload: { id: string }) => core.invokeChannel('publication:dismiss-offer', payload) as Promise<Result<{}>>,
        onChanged: (listener: Listener) => core.on('publication:changed', listener),
        offChanged: (listener: Listener) => core.off('publication:changed', listener),
    } };
}
