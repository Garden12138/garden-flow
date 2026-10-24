import { randomUUID } from 'node:crypto';
import { CiId } from '../../../shared/contentIntelligence.ts';
import {
    ContentCampaignSchema, CampaignCandidateSchema, CreateCampaignSchema, AddCampaignItemSchema, ProposeCampaignItemsSchema,
    ReorderCampaignSchema, ArchiveCampaignSchema, ConfirmCampaignSchema, CreateCampaignWorkSchema, UpdateCampaignItemSchema,
    type ContentCampaign, type CampaignItem, type CampaignCandidate,
} from '../../../shared/contentCampaigns.ts';
import { ciDigest, ciTransaction, createContentIntelligenceRepository, type CiDatabase } from './repository.ts';
import { createContentMetricsRepository } from './metricsRepository.ts';

export function initializeContentCampaigns(db: CiDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS ci_campaigns (
        space_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, document_json TEXT NOT NULL, PRIMARY KEY(space_id, id)
    ); CREATE INDEX IF NOT EXISTS idx_ci_campaign_status ON ci_campaigns(space_id, status);`);
}
export function recoverContentCampaigns(db: CiDatabase) {
    ciTransaction(db, () => {
        for (const row of db.prepare("SELECT document_json FROM ci_campaigns WHERE json_extract(document_json, '$.items') IS NOT NULL").all()) {
            const value = ContentCampaignSchema.parse(JSON.parse(row.document_json));
            if (!value.items.some(item => item.state === 'creating')) continue;
            const next = ContentCampaignSchema.parse({ ...value, revision: value.revision + 1, updatedAt: Date.now(), items: value.items.map(item => item.state === 'creating'
                ? { ...item, revision: item.revision + 1, state: 'needs_review', errorCode: 'INTERRUPTED' } : item) });
            db.prepare('UPDATE ci_campaigns SET document_json = ? WHERE space_id = ? AND id = ?').run(JSON.stringify(next), next.spaceId, next.id);
        }
    });
}
export function deleteContentCampaignsSpace(db: CiDatabase, spaceId: string) { db.prepare('DELETE FROM ci_campaigns WHERE space_id = ?').run(spaceId); }
export function createContentCampaignsRepository(db: CiDatabase, currentSpace: () => string) {
    const base = createContentIntelligenceRepository(db, currentSpace); const metrics = createContentMetricsRepository(db, currentSpace); const space = base.space;
    const decode = (row: any): ContentCampaign => { if (!row) throw new Error('成组内容不存在或不属于当前空间'); return ContentCampaignSchema.parse(JSON.parse(row.document_json)); };
    const get = (id: string) => decode(db.prepare('SELECT document_json FROM ci_campaigns WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    const list = () => db.prepare('SELECT document_json FROM ci_campaigns WHERE space_id = ? ORDER BY rowid DESC LIMIT 100').all(space()).map(decode);
    const forWork = (workspaceId: string) => db.prepare(`SELECT document_json FROM ci_campaigns WHERE space_id = ? AND EXISTS
        (SELECT 1 FROM json_each(ci_campaigns.document_json, '$.items') item WHERE json_extract(item.value, '$.workspaceId') = ?) ORDER BY rowid DESC LIMIT 100`).all(space(), CiId.parse(workspaceId)).map(decode);
    function write(value: ContentCampaign, update: Partial<ContentCampaign>) {
        const next = ContentCampaignSchema.parse({ ...value, ...update, revision: value.revision + 1, updatedAt: Date.now() });
        db.prepare('UPDATE ci_campaigns SET status = ?, document_json = ? WHERE space_id = ? AND id = ?').run(next.status, JSON.stringify(next), space(), next.id); return next;
    }
    function editable(id: string, revision: number) {
        const value = get(id);
        if (value.revision !== revision || value.status !== 'active' || value.items.some(item => item.state === 'creating')) throw new Error('成组内容已变化、已归档或正在创建，请刷新');
        return value;
    }
    function assertOpportunity(ref: { id: string; revision: number }) {
        const opportunity = base.getOpportunity(ref.id);
        if (opportunity.revision !== ref.revision || opportunity.status !== 'accepted') throw new Error('请先采纳并核对机会当前版本');
        return opportunity;
    }
    function create(input: unknown) {
        const request = CreateCampaignSchema.parse(input);
        const result = metrics.request('campaign.create', request.requestId, request, () => {
            if (new Set(request.opportunities.map(ref => ref.id)).size !== request.opportunities.length || new Set(request.platforms).size !== request.platforms.length) throw new Error('机会和平台不得重复');
            const opportunities = request.opportunities.map(assertOpportunity);
            if (request.productId && !opportunities.some(opportunity => opportunity.evidence.some(ref => { const evidence = base.getEvidence(ref.id); return evidence.source.kind === 'product' && evidence.source.id === request.productId; }))) throw new Error('商品不属于所选机会依据');
            const now = Date.now(); const value = ContentCampaignSchema.parse({ ...request, version: 1, id: randomUUID(), spaceId: space(), revision: 1, planVersion: 1, status: 'active', items: [], createdAt: now, updatedAt: now });
            db.prepare('INSERT INTO ci_campaigns VALUES (?, ?, ?, ?)').run(space(), value.id, value.status, JSON.stringify(value)); return { id: value.id };
        }); return get(result.id);
    }
    function validateCandidate(value: ContentCampaign, input: unknown): CampaignCandidate {
        const candidate = CampaignCandidateSchema.parse(input); const ref = value.opportunities.find(item => item.id === candidate.opportunity.id);
        if (!ref || ref.revision !== candidate.opportunity.revision) throw new Error('内容机会不属于本组冻结范围');
        const opportunity = assertOpportunity(candidate.opportunity); const allowed = new Set(opportunity.evidence.map(item => item.id));
        if (candidate.evidenceRefs.some(id => !allowed.has(id)) || new Set(candidate.evidenceRefs).size !== candidate.evidenceRefs.length) throw new Error('内容引用缺失、重复或不属于对应机会');
        candidate.evidenceRefs.forEach(id => base.getEvidence(id));
        if (!value.platforms.includes(candidate.target.platform)) throw new Error('内容平台不属于本组范围');
        return candidate;
    }
    function item(candidate: CampaignCandidate, dependencies: string[], origin: CampaignItem['origin']): CampaignItem {
        const id = randomUUID(); return { ...candidate, id, revision: 1, origin, dependencies, state: 'planned', creationRequestId: 'campaign_' + ciDigest([space(), id]) };
    }
    function add(input: unknown) {
        const request = AddCampaignItemSchema.parse(input); const result = metrics.request('campaign.add', request.requestId, request, () => {
            const value = editable(request.id, request.expectedRevision); if (value.items.length >= 8) throw new Error('每组最多8条内容');
            const candidate = validateCandidate(value, request.item);
            if (request.dependencies.some(id => !value.items.some(item => item.id === id))) throw new Error('依赖项不属于当前组');
            write(value, { items: [...value.items, item(candidate, request.dependencies, 'manual')], planVersion: value.planVersion + 1, confirmedPlanVersion: undefined }); return { id: value.id };
        }); return get(result.id);
    }
    function propose(input: unknown) {
        const request = ProposeCampaignItemsSchema.parse(input); const result = metrics.request('campaign.propose', request.requestId, request, () => {
            const value = editable(request.id, request.expectedRevision); if (value.items.length + request.items.length > 8) throw new Error('每组最多8条内容，请先新建组');
            const identity = (candidate: CampaignCandidate) => ciDigest([candidate.role, candidate.title, candidate.target, candidate.opportunity.id]);
            const seen = new Set(value.items.map(identity)); const added: CampaignItem[] = [];
            for (const proposed of request.items) {
                const { dependsOn, ...fields } = proposed; const candidate = validateCandidate(value, fields);
                if (seen.has(identity(candidate))) throw new Error('成组候选重复，请修改已有条目而非重复追加'); seen.add(identity(candidate));
                added.push(item(candidate, dependsOn.map(index => added[index].id), 'agent'));
            }
            write(value, { items: [...value.items, ...added], planVersion: value.planVersion + 1, confirmedPlanVersion: undefined }); return { id: value.id };
        }); return get(result.id);
    }
    function updateItem(input: unknown) {
        const request = UpdateCampaignItemSchema.parse(input); const result = metrics.request('campaign.update-item', request.requestId, request, () => {
            const value = editable(request.id, request.expectedRevision); const selected = value.items.find(item => item.id === request.itemId);
            if (!selected || selected.state !== 'planned') throw new Error('仅可修改尚未尝试创建工程的内容项');
            const next = { ...selected, ...validateCandidate(value, request.item), dependencies: request.dependencies, revision: selected.revision + 1 };
            write(value, { items: value.items.map(item => item.id === selected.id ? next : item), planVersion: value.planVersion + 1, confirmedPlanVersion: undefined }); return { id: value.id };
        }); return get(result.id);
    }
    function reorder(input: unknown) {
        const request = ReorderCampaignSchema.parse(input); const result = metrics.request('campaign.reorder', request.requestId, request, () => {
            const value = editable(request.id, request.expectedRevision);
            if (request.itemIds.length !== value.items.length || new Set(request.itemIds).size !== value.items.length || request.itemIds.some(id => !value.items.some(item => item.id === id))) throw new Error('排序必须包含全部内容项且不得重复');
            write(value, { items: request.itemIds.map(id => value.items.find(item => item.id === id)!), planVersion: value.planVersion + 1, confirmedPlanVersion: undefined }); return { id: value.id };
        }); return get(result.id);
    }
    function confirm(input: unknown) {
        const request = ConfirmCampaignSchema.parse(input); const result = metrics.request('campaign.confirm', request.requestId, request, () => {
            const value = editable(request.id, request.expectedRevision);
            if (value.items.length < 3 || new Set(value.items.map(item => item.role)).size < 3) throw new Error('请先规划至少三条不同角色的内容');
            value.items.forEach(item => validateCandidate(value, CampaignCandidateSchema.strip().parse(item)));
            write(value, { confirmedPlanVersion: value.planVersion }); return { id: value.id };
        }); return get(result.id);
    }
    function archive(input: unknown) {
        const request = ArchiveCampaignSchema.parse(input); const result = metrics.request('campaign.archive', request.requestId, request, () => {
            const value = get(request.id); if (value.revision !== request.expectedRevision || value.items.some(item => item.state === 'creating')) throw new Error('内容已变化或正在创建，请刷新');
            write(value, { status: request.archived ? 'archived' : 'active' }); return { id: value.id };
        }); return get(result.id);
    }
    function claimWork(input: unknown) {
        const request = CreateCampaignWorkSchema.parse(input);
        return ciTransaction(db, () => {
            const value = get(request.id); const selected = value.items.find(item => item.id === request.itemId); if (!selected) throw new Error('内容项不存在');
            if (['linked', 'creating'].includes(selected.state)) return { campaign: value, item: selected, claimed: false };
            if (value.status !== 'active' || value.confirmedPlanVersion !== value.planVersion || selected.revision !== request.expectedItemRevision) throw new Error('请先核对当前内容列表并确认');
            const next: CampaignItem = { ...selected, revision: selected.revision + 1, state: 'creating', errorCode: undefined };
            return { campaign: write(value, { items: value.items.map(item => item.id === next.id ? next : item) }), item: next, claimed: true };
        });
    }
    function finishWork(id: string, itemId: string, expectedRevision: number, workspaceId?: string) {
        return ciTransaction(db, () => {
            const value = get(id); const selected = value.items.find(item => item.id === itemId); if (!selected) throw new Error('内容项不存在');
            if (selected.state !== 'creating' || selected.revision !== expectedRevision) return value;
            if (workspaceId) CiId.parse(workspaceId);
            const next: CampaignItem = { ...selected, revision: selected.revision + 1, state: workspaceId ? 'linked' : 'needs_review', ...(workspaceId ? { workspaceId } : {}), errorCode: workspaceId ? undefined : 'CREATE_FAILED' };
            return write(value, { items: value.items.map(item => item.id === next.id ? next : item) });
        });
    }
    return { space, get, list, forWork, create, add, propose, updateItem, reorder, confirm, archive, claimWork, finishWork };
}
export type ContentCampaignsRepository = ReturnType<typeof createContentCampaignsRepository>;
