import { ManualPublicationLinkSchema, type PublicationLink } from '../../../shared/contentExperiments.ts';
import type { PublicationJobView } from '../../../shared/publication.ts';
import type { CreationWorkspace } from '../../../shared/creationWorkspace.ts';
import { CiId } from '../../../shared/contentIntelligence.ts';
import { ciDigest } from './repository.ts';
import { compareMetricObservations } from './metricsDomain.ts';
import type { ContentMetricsRepository } from './metricsRepository.ts';

// Identity is extracted only from canonical work URLs. Management pages and signed share URLs are not receipts.
export function canonicalPublicationUrl(platform: string, value: string): { url: string; externalWorkId: string } | null {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        const match = platform === 'tiktok' && url.hostname === 'www.tiktok.com' ? url.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)
            : platform === 'douyin' && url.hostname === 'www.douyin.com' ? url.pathname.match(/^\/video\/(\d+)\/?$/)
                : platform === 'xiaohongshu' && url.hostname === 'www.xiaohongshu.com' ? url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-fA-F0-9]+)\/?$/) : null;
        if (!match || !CiId.safeParse(match[1]).success) return null;
        url.search = ''; url.hash = ''; return { url: url.href, externalWorkId: match[1] };
    } catch { return null; }
}
export function publicationForWorkspace(job: PublicationJobView, work: CreationWorkspace, spaceId: string): Omit<PublicationLink, 'id' | 'spaceId' | 'createdAt'> | null {
    const context = job.context; const snapshot = context?.snapshot;
    if (work.spaceId !== spaceId || context?.spaceId !== spaceId || snapshot?.spaceId !== spaceId || !snapshot || !context?.accountId
        || context.jobId !== job.id || context.platform !== job.platform || snapshot.platform !== work.platform || job.platform !== work.platform
        || context.contentDigest !== job.contentDigest || !['submitted', 'pending_review', 'published'].includes(job.publishStatus)) return null;
    const native = work.native; const source = snapshot.source;
    const matches = native?.kind === 'video' ? (source.kind === 'video' || source.kind === 'dream-story') && source.projectId === native.projectId
        : native?.kind === 'note' && (source.kind === 'note' || source.kind === 'image-set') && source.path === native.path;
    if (!matches) return null;
    const receipt = job.platform === 'tiktok' && job.receiptSource === 'tiktok-studio-posts' && job.publishStatus === 'published' && job.receiptUrl ? canonicalPublicationUrl(job.platform, job.receiptUrl) : null;
    return { workspaceId: work.id, workspaceRevision: work.revision, platform: job.platform,
        accountAlias: 'account_' + ciDigest([job.platform, context.accountId]).slice(0, 16),
        ...(receipt || {}), origin: receipt ? 'receipt' : 'submission', status: receipt ? 'published' : 'submitted',
        sourceNote: receipt ? '现有 TikTok Studio 作品回执' : '现有发布任务已提交；无可信作品回执，审核结果未知',
        jobId: job.id, nativeRevision: snapshot.revision, contentDigest: snapshot.semanticDigest, observedAt: job.updatedAt };
}
export function createContentMetricsService(repository: ContentMetricsRepository, adapter: {
    readWork(id: string): Promise<CreationWorkspace>; jobs(): PublicationJobView[];
}) {
    async function attachManual(input: unknown) {
        const request = ManualPublicationLinkSchema.parse(input); const spaceId = repository.space();
        const work = await adapter.readWork(request.workspaceId);
        if (repository.space() !== spaceId || work.spaceId !== spaceId) throw new Error('空间已变化');
        if (work.revision !== request.expectedRevision || work.platform !== request.platform) throw new Error('工程版本或平台已变化');
        const canonical = request.url ? canonicalPublicationUrl(request.platform, request.url) : null;
        if (request.url && (!canonical || canonical.externalWorkId !== request.externalWorkId)) throw new Error('作品网址与平台作品 ID 不一致');
        return repository.request('publication.manual', request.requestId, request, () => repository.recordPublication({
            workspaceId: work.id, workspaceRevision: work.revision, platform: request.platform, accountAlias: request.accountAlias,
            externalWorkId: request.externalWorkId, ...(canonical ? { url: canonical.url } : {}),
            origin: 'manual', status: 'declared-published', sourceNote: request.sourceNote, observedAt: request.observedAt,
        }));
    }
    async function syncWork(workspaceId: string) {
        CiId.parse(workspaceId); const spaceId = repository.space(); const work = await adapter.readWork(workspaceId);
        if (repository.space() !== spaceId || work.spaceId !== spaceId) throw new Error('空间已变化');
        for (const job of adapter.jobs()) {
            const candidate = publicationForWorkspace(job, work, spaceId);
            if (candidate) {
                const previous = repository.publications(workspaceId).find(link => link.jobId === candidate.jobId && link.origin === candidate.origin && link.status === candidate.status);
                repository.recordPublication({ ...candidate, workspaceRevision: previous?.workspaceRevision || candidate.workspaceRevision });
            }
        }
        return repository.publications(workspaceId);
    }
    function compare(baselineId: string, variantId: string, baselineRevision?: number, variantRevision?: number) {
        const baseline = repository.observation(baselineId); const variant = repository.observation(variantId);
        if (baselineRevision !== undefined && baselineRevision !== baseline.revision || variantRevision !== undefined && variantRevision !== variant.revision) throw new Error('观测已修订，请刷新后比较');
        return compareMetricObservations(baseline, variant, repository.publication(baseline.input.publicationLinkId), repository.publication(variant.input.publicationLinkId));
    }
    return { attachManual, syncWork, compare };
}
