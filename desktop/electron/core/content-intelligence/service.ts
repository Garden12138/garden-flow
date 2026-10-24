import { createHash } from 'node:crypto';
import {
    AddEvidenceSchema, CiId, CreateOpportunityWorkSchema, type OpportunityDetail, type EvidenceSourceView,
} from '../../../shared/contentIntelligence.ts';
import { CreationStartSchema, type CreationWorkspace } from '../../../shared/creationWorkspace.ts';
import { ciDigest, sourceKey, type ContentIntelligenceRepository } from './repository.ts';
import type { CiSourceAdapter } from './sourceAdapters.ts';

export interface CiCreationAdapter {
    start(input: unknown): Promise<CreationWorkspace>;
    read(id: string): Promise<CreationWorkspace>;
}
const locks = new Map<string, Promise<unknown>>();
export function createContentIntelligenceService(repository: ContentIntelligenceRepository, sources: CiSourceAdapter, creation: CiCreationAdapter) {
    const assertSpace = (id: string) => { if (repository.space() !== id) throw new Error('空间已变化'); };
    async function addEvidence(input: unknown) {
        const parsed = AddEvidenceSchema.parse(input); const spaceId = repository.space();
        const source = await sources.read(parsed.source); assertSpace(spaceId);
        if (source.version !== parsed.version) throw new Error('来源已变化，请刷新后重新选择证据');
        return repository.addEvidence(source, parsed.locator, parsed.excerpt);
    }
    async function getOpportunity(id: string): Promise<OpportunityDetail> {
        const spaceId = repository.space(); const opportunity = repository.getOpportunity(CiId.parse(id));
        const evidence = await Promise.all(opportunity.evidence.map(async ref => {
            const evidence = repository.getEvidence(ref.id);
            return { ...evidence, validity: await sources.validity(evidence) };
        }));
        assertSpace(spaceId); return { opportunity, evidence };
    }
    async function evidenceSource(id: string): Promise<EvidenceSourceView> {
        const spaceId = repository.space(); const evidence = repository.getEvidence(CiId.parse(id));
        const snapshot = repository.getSnapshot(evidence.source, evidence.sourceVersion);
        let current;
        try { current = await sources.read(evidence.source); }
        catch (error) { if ((error as { code?: string }).code !== 'CI_SOURCE_MISSING') throw error; }
        assertSpace(spaceId);
        return { evidence: { ...evidence, validity: current ? current.version === snapshot.version ? 'verified' : 'stale' : 'missing' }, snapshot, current };
    }
    async function createWork(input: unknown) {
        const parsed = CreateOpportunityWorkSchema.parse(input); const spaceId = repository.space();
        const key = `${spaceId}:${parsed.requestId}`; const old = locks.get(key) || Promise.resolve();
        const task = old.catch(() => undefined).then(async () => {
            assertSpace(spaceId);
            const intentDigest = ciDigest(parsed);
            let reserved = repository.getWorkRequest(parsed.requestId);
            if (reserved && reserved.intentDigest !== intentDigest) throw new Error('同一创作请求不能用于不同内容');
            const opportunity = repository.getOpportunity(parsed.opportunityId);
            if (!reserved) {
                if (opportunity.revision !== parsed.expectedRevision) throw new Error('机会已变化，请刷新后重试');
                if (opportunity.status !== 'accepted') throw new Error('请先采纳机会，再确认创作目标');
                const detail = await getOpportunity(opportunity.id); assertSpace(spaceId);
                if (detail.evidence.some(evidence => evidence.validity !== 'verified')) throw new Error('存在失效证据，请先复核来源');
                const identities = new Set(detail.evidence.map(evidence => sourceKey(evidence.source)));
                if (identities.size > 20) throw new Error('超过 20 个来源，请缩小机会范围后创作');
                const productIds = [...new Set(detail.evidence.filter(evidence => evidence.source.kind === 'product').map(evidence => evidence.source.id))];
                const productId = parsed.selection.productId || (productIds.length === 1 ? productIds[0] : undefined);
                if (parsed.selection.productId && !productIds.includes(parsed.selection.productId)) throw new Error('商品不属于本机会的证据范围');
                if (parsed.selection.capability.startsWith('product-') && !productId) throw new Error('请先为机会绑定明确的商品证据');
                const brief = [`机会：${opportunity.title}`, `问题：${opportunity.problem}`, `受众：${opportunity.audience}`, `角度：${opportunity.angle}`,
                    `依据性质：${opportunity.basis === 'hypothesis' ? '用户假设，尚无消费者证据' : '仅本次已采集样本，不代表消费者总体'}`,
                    ...detail.evidence.map(evidence => `${opportunity.evidence.find(ref => ref.id === evidence.id)?.relation} [${evidence.id}] ${evidence.excerpt}`)].join('\n');
                const selection = CreationStartSchema.parse({ ...parsed.selection, productId, entry: 'conversation', brief,
                    requestId: 'ci_' + ciDigest([opportunity.id, parsed.requestId]) });
                // No await between the final revision check and the durable reservation.
                if (repository.getOpportunity(opportunity.id).revision !== parsed.expectedRevision) throw new Error('机会已变化，请刷新后重试');
                reserved = repository.reserveWork(parsed.requestId, { opportunityId: opportunity.id, selection, intentDigest });
            }
            const id = 'creation_' + createHash('sha256').update(spaceId + ':' + reserved.selection.requestId).digest('hex').slice(0, 40);
            let workspace: CreationWorkspace;
            try { workspace = await creation.read(id); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                const detail = await getOpportunity(opportunity.id); assertSpace(spaceId);
                if (detail.opportunity.status !== 'accepted' || detail.opportunity.revision !== parsed.expectedRevision || detail.evidence.some(value => value.validity !== 'verified')) throw new Error('机会或证据已变化，请复核后使用新请求');
                workspace = await creation.start(reserved.selection);
            }
            assertSpace(spaceId);
            if (workspace.id !== id || workspace.spaceId !== spaceId) throw new Error('作品不属于当前请求或空间');
            const link = repository.linkWork(parsed.requestId, workspace.id);
            return { workspace, link };
        });
        locks.set(key, task);
        try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
    }
    async function workEvidence(workspaceId: string) {
        const spaceId = repository.space(); const originalId = CiId.parse(workspaceId);
        const visited = new Set<string>(); const found = new Map<string, OpportunityDetail>(); let currentId: string | undefined = originalId;
        while (currentId) {
            if (visited.has(currentId) || visited.size >= 32) throw new Error('工程来源链存在循环或超出读取范围，请人工复核');
            visited.add(currentId); const workspace = await creation.read(CiId.parse(currentId)); assertSpace(spaceId);
            if (workspace.id !== currentId || workspace.spaceId !== spaceId) throw new Error('来源工程不属于当前空间');
            for (const link of repository.linksForWork(currentId)) {
                if (!found.has(link.opportunityId)) found.set(link.opportunityId, { ...await getOpportunity(link.opportunityId), ...(currentId !== originalId ? { inheritedFromWorkspaceId: currentId } : {}) });
            }
            currentId = workspace.sourceId;
        }
        assertSpace(spaceId); return [...found.values()];
    }
    return { listSources: sources.list, readSource: sources.read, addEvidence, getOpportunity, evidenceSource, createWork, workEvidence,
        createOpportunity: repository.createOpportunity, listOpportunities: repository.listOpportunities, transitionOpportunity: repository.transitionOpportunity };
}
export type ContentIntelligenceService = ReturnType<typeof createContentIntelligenceService>;
