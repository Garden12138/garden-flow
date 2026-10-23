import type { z } from 'zod';
import type { BridgeCore } from '../types';
import type { CreationWorkspace } from '../../../shared/creationWorkspace';
import type { PreviewResearchSchema, ResearchStartSchema, ResearchCancelSchema, ResearchRun, ResearchReference } from '../../../shared/consumerResearch';
import type { ManualPublicationLinkSchema, MetricCsvPreviewSchema, MetricCsvImportSchema, MetricImportPreview, MetricObservation, PublicationLink, MetricWorkSummary, MetricComparison } from '../../../shared/contentExperiments';
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
        previewResearch: (input: z.input<typeof PreviewResearchSchema>) => invoke<ResearchRun>('ci:research-preview', input),
        startResearch: (input: z.input<typeof ResearchStartSchema>) => invoke<ResearchRun>('ci:research-start', input),
        researchRun: (id: string) => invoke<ResearchRun>('ci:research-get', { id }),
        researchInput: (id: string) => invoke<ResearchReference[]>('ci:research-input', { id }),
        researchRuns: () => invoke<ResearchRun[]>('ci:research-list', {}),
        cancelResearch: (input: z.input<typeof ResearchCancelSchema>) => invoke<ResearchRun>('ci:research-cancel', input),
        metricWorks: () => invoke<MetricWorkSummary[]>('ci:metric-works', {}),
        attachPublication: (input: z.input<typeof ManualPublicationLinkSchema>) => invoke<PublicationLink>('ci:publication-manual', input),
        syncPublication: (id: string) => invoke<PublicationLink[]>('ci:publication-sync', { id }),
        publications: () => invoke<PublicationLink[]>('ci:publication-list', {}),
        previewMetrics: (input: z.input<typeof MetricCsvPreviewSchema>) => invoke<MetricImportPreview>('ci:metric-preview', input),
        importMetrics: (input: z.input<typeof MetricCsvImportSchema>) => invoke<{ changed: MetricObservation[]; duplicates: number; importDigest: string }>('ci:metric-import', input),
        metrics: () => invoke<MetricObservation[]>('ci:metric-list', {}),
        metricHistory: (id: string) => invoke<MetricObservation[]>('ci:metric-history', { id }),
        compareMetrics: (baselineId: string, variantId: string, baselineRevision: number, variantRevision: number) => invoke<MetricComparison>('ci:metric-compare', { baselineId, variantId, baselineRevision, variantRevision }),
    } };
}
