import { CiId } from '../../../shared/contentIntelligence.ts';
import { CreateCampaignWorkSchema, CAMPAIGN_ROLE_LABELS, type CampaignDetail } from '../../../shared/contentCampaigns.ts';
import { CreationStartSchema, supportsCreation, CreationCapabilitySchema } from '../../../shared/creationWorkspace.ts';
import type { CreationWorkspace } from '../../../shared/creationWorkspace.ts';
import type { PublicationCompletion, PublicationJobView } from '../../../shared/publication.ts';
import type { ContentCampaignsRepository } from './campaignsRepository.ts';
import type { ContentIntelligenceService } from './service.ts';
import type { ContentMetricsRepository } from './metricsRepository.ts';
import { publicationForWorkspace } from './metricsService.ts';

export function createContentCampaignsService(repository: ContentCampaignsRepository, intelligence: ContentIntelligenceService, metrics: ContentMetricsRepository, adapter: {
    read(id: string): Promise<CreationWorkspace>; completions(): PublicationCompletion[]; jobs?(): PublicationJobView[];
}) {
    const sameSpace = (id: string) => { if (repository.space() !== id) throw new Error('空间已变化'); };
    async function planningContext(id: string) {
        const spaceId = repository.space(); const campaign = repository.get(CiId.parse(id));
        const opportunities = await Promise.all(campaign.opportunities.map(ref => intelligence.getOpportunity(ref.id)));
        sameSpace(spaceId);
        const targets = campaign.platforms.flatMap(platform => CreationCapabilitySchema.options.filter(capability => capability !== 'dream-story' && supportsCreation(platform, capability)).map(capability => ({ platform, capability })));
        const context = { campaign, opportunities, supportedTargets: targets,
            boundary: '只规划3–8条至少三种角色的候选，引用所选机会的真实证据ID。原文可定位不代表商品主张可信，保留规格差异、失效和样本限制。候选不会创建工程、生成媒体或发布。' };
        if (JSON.stringify(context).length > 60000) throw new Error('规划上下文超出60000字符，请缩小机会范围');
        return context;
    }
    async function createWork(input: unknown) {
        const request = CreateCampaignWorkSchema.parse(input); const spaceId = repository.space();
        const claim = repository.claimWork(request); if (!claim.claimed) return claim.campaign;
        const campaign = claim.campaign; const item = claim.item;
        try {
            const additionalBrief = [`成组内容：${campaign.title}`, `目标：${campaign.goal}`, `受众：${campaign.audience}`,
                `本条角色：${CAMPAIGN_ROLE_LABELS[item.role]}`, `本条题目：${item.title}`, `职责与理由（待核实）：${item.why}`,
                ...campaign.limitations.map(text => `限制：${text}`), '内容条目只是一项待编辑任务，不代表媒体已生成或已发布。'].join('\n');
            // The existing CI service owns source validation, durable reservation, filesystem recovery and WorkLink.
            const result = await intelligence.createWork({ requestId: item.creationRequestId, opportunityId: item.opportunity.id,
                expectedRevision: item.opportunity.revision, additionalBrief,
                selection: CreationStartSchema.parse({ ...item.target, ...(campaign.productId ? { productId: campaign.productId } : {}) }) });
            sameSpace(spaceId);
            if (result.workspace.spaceId !== spaceId || result.workspace.platform !== item.target.platform || result.workspace.capability !== item.target.capability) throw new Error('工程与本条目标不一致');
            return repository.finishWork(campaign.id, item.id, item.revision, result.workspace.id);
        } catch {
            sameSpace(spaceId); return repository.finishWork(campaign.id, item.id, item.revision);
        }
    }
    async function detail(id: string): Promise<CampaignDetail> {
        const spaceId = repository.space(); const campaign = repository.get(CiId.parse(id));
        const completions = adapter.completions().filter(value => value.spaceId === spaceId && value.snapshot.spaceId === spaceId); const jobs = adapter.jobs?.() || [];
        const works = await Promise.all(campaign.items.map(async item => {
            const empty = { itemId: item.id, workspaceId: item.workspaceId, exportedVersions: 0, publicationLinks: 0, observations: 0, publicationStates: { declared: 0, submitted: 0, published: 0 }, publicationStatesPartial: false };
            if (!item.workspaceId) return { ...empty, availability: 'not-created' as const };
            try {
                const work = await adapter.read(item.workspaceId); sameSpace(spaceId);
                if (work.spaceId !== spaceId || work.id !== item.workspaceId) throw new Error('工程不属于当前空间');
                const links = metrics.publications(work.id); const counts = metrics.workCounts(work.id);
                const tracked = [...links, ...jobs.map(job => publicationForWorkspace(job, work, spaceId)).filter(candidate => candidate !== null).filter(candidate => !links.some(link => link.jobId === candidate.jobId && link.status === candidate.status))];
                const publicationStates = { declared: tracked.filter(link => link.status === 'declared-published').length,
                    submitted: tracked.filter(link => link.status === 'submitted').length, published: tracked.filter(link => link.status === 'published').length };
                const exports = completions.filter(value => work.native?.kind === 'video' ? (value.source.kind === 'video' || value.source.kind === 'dream-story') && value.source.projectId === work.native.projectId
                    : work.native?.kind === 'note' && (value.source.kind === 'note' || value.source.kind === 'image-set') && value.source.path === work.native.path);
                return { ...empty, availability: 'available' as const, title: work.draft.title, revision: work.revision, draftEpoch: work.draftEpoch,
                    exportedVersions: new Set(exports.map(value => value.semanticDigest)).size, publicationLinks: counts.publications, publicationStates, publicationStatesPartial: links.length < counts.publications,
                    observations: counts.observations };
            } catch (error) {
                sameSpace(spaceId); if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                return { ...empty, availability: 'missing' as const };
            }
        }));
        sameSpace(spaceId); return { campaign, works };
    }
    return { ...repository, planningContext, createWork, detail };
}
