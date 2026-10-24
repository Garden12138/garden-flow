import { CiDigest, SourceSnapshotSchema } from '../../../shared/contentIntelligence.ts';
import { CheckSourceMaintenanceSchema, MaintenanceWorkReferenceSchema, type SourceMaintenanceImpact } from '../../../shared/sourceMaintenance.ts';
import type { CreationWorkspace } from '../../../shared/creationWorkspace.ts';
import type { MaintenanceWorkspaceScan } from '../creationWorkspaceMaintenance.ts';
import type { CiSourceAdapter } from './sourceAdapters.ts';
import type { SourceMaintenanceRepository } from './maintenanceRepository.ts';
import { ciDigest, sourceKey } from './repository.ts';
import { affectedWorkspaceLineage } from './maintenanceDomain.ts';

export function createSourceMaintenanceService(repository: SourceMaintenanceRepository, sources: Pick<CiSourceAdapter, 'read'>, adapter: {
    scan(): Promise<MaintenanceWorkspaceScan>;
    inspect(id: string): Promise<{ workspace: CreationWorkspace; contentVersion: string; nativeRevision?: string }>;
}) {
    const sameSpace = (space: string) => { if (repository.space() !== space) throw new Error('空间已变化，请重新检查来源'); };
    async function currentSource(source: Parameters<CiSourceAdapter['read']>[0]) {
        try { return SourceSnapshotSchema.parse(await sources.read(source)); }
        catch (error) { if ((error as { code?: string }).code === 'CI_SOURCE_MISSING') return null; throw error; }
    }
    async function check(input: unknown) {
        const request = CheckSourceMaintenanceSchema.parse(input); const spaceId = repository.space();
        const completed = repository.completed(request); if (completed) return completed;
        const previous = repository.snapshot(request.source, request.previousVersion);
        const current = await currentSource(request.source); sameSpace(spaceId);
        if (current && sourceKey(current.source) !== sourceKey(request.source)) throw new Error('当前来源身份不一致');
        const emptyCoverage = { scope: 'registered-creation-workspaces-and-ci-links', totalWorkspaceRecords: 0, scannedWorkspaces: 0, excludedWorkspaces: 0,
            completeWithinScope: true, unversionedSameProductWorkspaces: 0, legacyUnregisteredProjects: 'not-enumerated' };
        if (current?.version === previous.version) return repository.record(request, previous, current, [], emptyCoverage);
        const references = repository.references(request.source, previous.version);
        const scan = await adapter.scan(); sameSpace(spaceId);
        if (scan.spaceId !== spaceId) throw new Error('工程扫描不属于当前空间');
        const works = scan.works.map(work => MaintenanceWorkReferenceSchema.parse(work));
        if (works.some(work => work.spaceId !== spaceId)) throw new Error('工程扫描包含其他空间');
        const lineage = affectedWorkspaceLineage(references.links.map(link => link.workspaceId), works);
        const byId = new Map(works.map(work => [work.id, work])); const evidenceIds = new Set(references.evidence.map(value => value.id));
        const impacts: SourceMaintenanceImpact[] = references.evidence.map(evidence => ({
            id: 'impact_' + ciDigest(['evidence', evidence.id]), kind: 'evidence', targetId: evidence.id, title: evidence.excerpt.slice(0, 500), versionDigest: ciDigest(evidence), reviewState: 'needs_review',
            reason: 'source-version', evidenceIds: [evidence.id], opportunityIds: [], quoteStatus: !current ? 'source-unavailable'
                : current.segments.find(segment => segment.key === evidence.locator.key)?.text.slice(evidence.locator.start, evidence.locator.end) === evidence.excerpt ? 'matches-current-location' : 'differs-current-location',
        }));
        for (const opportunity of references.opportunities) impacts.push({
            id: 'impact_' + ciDigest(['opportunity', opportunity.id]), kind: 'opportunity', targetId: opportunity.id, title: opportunity.title.slice(0, 500),
            versionDigest: ciDigest(opportunity), reviewState: 'needs_review', reason: 'linked-opportunity',
            evidenceIds: opportunity.evidence.filter(ref => evidenceIds.has(ref.id)).map(ref => ref.id).sort(), opportunityIds: [opportunity.id], targetRevision: String(opportunity.revision),
        });
        for (const [id, parent] of lineage) {
            const ancestors = new Set<string>(); let ancestor: string | undefined = id;
            while (ancestor) { ancestors.add(ancestor); ancestor = byId.get(ancestor)?.sourceId; }
            const opportunities = [...new Set(references.links.filter(link => ancestors.has(link.workspaceId)).map(link => link.opportunityId))].sort();
            const relatedEvidence = [...new Set(references.opportunities.filter(value => opportunities.includes(value.id)).flatMap(value => value.evidence.filter(ref => evidenceIds.has(ref.id)).map(ref => ref.id)))].sort();
            const metadata = byId.get(id); let availability: 'available' | 'missing' | 'unreadable' = metadata ? 'available' : scan.excludedIds.includes(id) ? 'unreadable' : 'missing';
            let contentVersion: string | undefined; let targetRevision = metadata?.revision;
            if (metadata) {
                try {
                    const actual = await adapter.inspect(id); sameSpace(spaceId);
                    if (actual.workspace.id !== id || actual.workspace.spaceId !== spaceId) throw Object.assign(new Error('工程不属于当前空间'), { code: 'MAINTENANCE_SCOPE_MISMATCH' });
                    const actualMetadata = MaintenanceWorkReferenceSchema.parse({ ...metadata, revision: actual.workspace.revision, draftEpoch: actual.workspace.draftEpoch,
                        sourceId: actual.workspace.sourceId, productId: actual.workspace.draft.productId, title: actual.workspace.draft.title, platform: actual.workspace.platform, capability: actual.workspace.capability });
                    if (ciDigest(actualMetadata) !== ciDigest(metadata)) throw Object.assign(new Error('工程索引已变化，请重新检查'), { code: 'MAINTENANCE_SCAN_CHANGED' });
                    contentVersion = CiDigest.parse(actual.contentVersion); targetRevision = actual.nativeRevision || actual.workspace.revision;
                } catch (error) {
                    sameSpace(spaceId); const code = (error as { code?: string }).code;
                    if (code === 'MAINTENANCE_SCOPE_MISMATCH' || code === 'MAINTENANCE_SCAN_CHANGED' || code === 'WORKSPACE_SCOPE_MISMATCH') throw error;
                    availability = code === 'ENOENT' ? 'missing' : 'unreadable';
                }
            }
            impacts.push({ id: 'impact_' + ciDigest(['workspace', id]), kind: 'workspace', targetId: id, title: metadata?.title || id,
                versionDigest: ciDigest([id, metadata ?? null, availability, contentVersion ?? null, opportunities, relatedEvidence]), reviewState: 'needs_review',
                reason: parent ? 'inherited-work' : 'direct-work', evidenceIds: relatedEvidence, opportunityIds: opportunities,
                ...(parent ? { viaWorkspaceId: parent } : {}), availability, ...(targetRevision ? { targetRevision } : {}) });
        }
        const coverage = { ...emptyCoverage, totalWorkspaceRecords: scan.totalWorkspaceRecords, scannedWorkspaces: works.length, excludedWorkspaces: scan.excludedWorkspaces,
            completeWithinScope: scan.excludedWorkspaces === 0,
            unversionedSameProductWorkspaces: request.source.kind === 'product' ? works.filter(work => work.productId === request.source.id && !lineage.has(work.id)).length : 0 };
        // Re-read after asynchronous filesystem work. A changed source or dependency set requires a fresh explicit check.
        const latest = await currentSource(request.source); sameSpace(spaceId);
        if (latest?.version !== current?.version || ciDigest(repository.references(request.source, previous.version)) !== ciDigest(references)) throw new Error('来源或引用关系已变化，请重新检查');
        const latestScan = await adapter.scan(); sameSpace(spaceId);
        if (ciDigest(latestScan) !== ciDigest(scan)) throw new Error('工程索引已变化，请重新检查');
        return repository.record(request, previous, current, impacts, coverage);
    }
    return { ...repository, check };
}
