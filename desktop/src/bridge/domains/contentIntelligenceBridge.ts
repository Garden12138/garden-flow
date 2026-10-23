import type { z } from 'zod';
import type { BridgeCore } from '../types';
import type { CreationWorkspace } from '../../../shared/creationWorkspace';
import type {
    AddEvidenceSchema, CiListSchema, CiResult, ContentEvidence, CreateOpportunitySchema, CreateOpportunityWorkSchema,
    EvidenceSourceView, Opportunity, OpportunityDetail, SourceIdentity, SourceSnapshot, TransitionOpportunitySchema, WorkLink,
} from '../../../shared/contentIntelligence';

export function createContentIntelligenceBridge(core: BridgeCore) {
    const invoke = <T>(channel: string, payload: unknown): Promise<CiResult<T>> => core.invokeChannel(channel, payload) as Promise<CiResult<T>>;
    return { contentIntelligence: {
        sources: () => invoke<SourceSnapshot[]>('ci:sources', {}),
        source: (source: SourceIdentity) => invoke<SourceSnapshot>('ci:source', source),
        addEvidence: (input: z.input<typeof AddEvidenceSchema>) => invoke<ContentEvidence>('ci:evidence-add', input),
        evidenceSource: (id: string) => invoke<EvidenceSourceView>('ci:evidence-source', { id }),
        createOpportunity: (input: z.input<typeof CreateOpportunitySchema>) => invoke<Opportunity>('ci:opportunity-create', input),
        list: (input: z.input<typeof CiListSchema> = {}) => invoke<{ items: Opportunity[]; next?: string }>('ci:opportunity-list', input),
        detail: (id: string) => invoke<OpportunityDetail>('ci:opportunity-get', { id }),
        transition: (input: z.input<typeof TransitionOpportunitySchema>) => invoke<Opportunity>('ci:opportunity-transition', input),
        createWork: (input: z.input<typeof CreateOpportunityWorkSchema>) => invoke<{ workspace: CreationWorkspace; link: WorkLink }>('ci:work-create', input),
        workEvidence: (id: string) => invoke<OpportunityDetail[]>('ci:work-evidence', { id }),
    } };
}
