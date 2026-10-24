import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CiId, CiDigest, SourceIdentitySchema, ContentEvidenceSchema, OpportunitySchema, WorkLinkSchema, type SourceIdentity, type SourceSnapshot } from '../../../shared/contentIntelligence.ts';
import {
    CheckSourceMaintenanceSchema, MaintenanceSourcesQuerySchema, SourceMaintenanceImpactSchema, SourceMaintenanceReportSchema,
    MaintenanceScanCoverageSchema, RecordMaintenanceDecisionSchema, MaintenanceDecisionSchema,
    type MaintenanceDetail, type MaintenanceCheckResult, type MaintenanceSourceOption, type MaintenanceReportSummary,
} from '../../../shared/sourceMaintenance.ts';
import { ciDigest, ciTransaction, createContentIntelligenceRepository, sourceKey, type CiDatabase } from './repository.ts';
import { createContentMetricsRepository } from './metricsRepository.ts';
import { sourceFieldChanges } from './maintenanceDomain.ts';

export function initializeSourceMaintenance(db: CiDatabase) {
    ciTransaction(db, () => db.exec(`CREATE TABLE IF NOT EXISTS ci_source_changes (
        space_id TEXT NOT NULL, id TEXT NOT NULL, source_key TEXT NOT NULL, document_json TEXT NOT NULL, PRIMARY KEY(space_id, id)
    ); CREATE INDEX IF NOT EXISTS idx_ci_source_change_source ON ci_source_changes(space_id, source_key);
    CREATE TABLE IF NOT EXISTS ci_source_maintenance_decisions (
        space_id TEXT NOT NULL, change_id TEXT NOT NULL, impact_id TEXT NOT NULL, revision INTEGER NOT NULL,
        document_json TEXT NOT NULL, PRIMARY KEY(space_id, change_id, impact_id, revision)
    );`));
}
export function deleteSourceMaintenanceSpace(db: CiDatabase, spaceId: string) {
    for (const table of ['ci_source_maintenance_decisions', 'ci_source_changes']) db.prepare(`DELETE FROM ${table} WHERE space_id = ?`).run(spaceId);
}
export function createSourceMaintenanceRepository(db: CiDatabase, currentSpace: () => string) {
    const base = createContentIntelligenceRepository(db, currentSpace); const requests = createContentMetricsRepository(db, currentSpace); const space = base.space;
    const decode = <T>(schema: z.ZodType<T, z.ZodTypeDef, any>, row: any): T => {
        if (!row) throw new Error('来源复核记录不存在或不属于当前空间'); const value = schema.parse(JSON.parse(row.document_json));
        if ((value as { spaceId?: string }).spaceId !== space()) throw new Error('复核记录声明的空间不一致'); return value;
    };
    function report(id: string) {
        return decode(SourceMaintenanceReportSchema, db.prepare('SELECT document_json FROM ci_source_changes WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    }
    function get(id: string): MaintenanceDetail {
        const value = report(id);
        const decisions = db.prepare(`SELECT d.document_json FROM ci_source_maintenance_decisions d WHERE d.space_id = ? AND d.change_id = ?
            AND d.revision = (SELECT MAX(p.revision) FROM ci_source_maintenance_decisions p WHERE p.space_id = d.space_id AND p.change_id = d.change_id AND p.impact_id = d.impact_id)
            ORDER BY d.impact_id`).all(space(), value.id).map(row => decode(MaintenanceDecisionSchema, row));
        const decided = new Set(decisions.filter(decision => value.impacts.some(impact => impact.id === decision.impactId && impact.versionDigest === decision.impactVersion)).map(decision => decision.impactId));
        return { report: value, previous: base.getSnapshot(value.source, value.previousVersion), current: value.currentVersion ? base.getSnapshot(value.source, value.currentVersion) : null,
            decisions, pending: value.impacts.filter(impact => !decided.has(impact.id)).length };
    }
    function sources(input: unknown = {}) {
        const query = MaintenanceSourcesQuerySchema.parse(input);
        const rows = db.prepare(`SELECT s.rowid, s.document_json, (SELECT COUNT(*) FROM ci_evidence e WHERE e.space_id = s.space_id AND e.source_key = s.source_key AND e.source_version = s.version) AS evidence_count
            FROM ci_source_snapshots s WHERE s.space_id = ? AND (? IS NULL OR s.rowid < ?) ORDER BY s.rowid DESC LIMIT ?`).all(space(), query.afterRowId ?? null, query.afterRowId ?? null, query.limit + 1);
        const items: MaintenanceSourceOption[] = rows.slice(0, query.limit).map(row => {
            const snapshot = JSON.parse(row.document_json) as SourceSnapshot;
            return { rowId: Number(row.rowid), source: SourceIdentitySchema.parse(snapshot.source), version: CiDigest.parse(snapshot.version), title: z.string().max(500).parse(snapshot.title), evidenceCount: Number(row.evidence_count), ...(snapshot.capturedAt === undefined ? {} : { capturedAt: snapshot.capturedAt }) };
        });
        return { items, ...(rows.length > query.limit ? { nextRowId: items[items.length - 1].rowId } : {}) };
    }
    function list(): MaintenanceReportSummary[] {
        return db.prepare(`SELECT id, json_extract(document_json, '$.source') AS source, json_extract(document_json, '$.sourceTitle') AS title,
            json_extract(document_json, '$.previousVersion') AS previous_version, json_extract(document_json, '$.currentVersion') AS current_version,
            json_extract(document_json, '$.createdAt') AS created_at, json_array_length(document_json, '$.impacts') AS impacts
            FROM ci_source_changes WHERE space_id = ? ORDER BY rowid DESC LIMIT 50`).all(space()).map(row => ({ id: row.id, source: SourceIdentitySchema.parse(JSON.parse(row.source)), sourceTitle: row.title,
            previousVersion: row.previous_version, ...(row.current_version ? { currentVersion: row.current_version } : {}), createdAt: Number(row.created_at), impacts: Number(row.impacts) }));
    }
    function references(sourceInput: SourceIdentity, version: string) {
        const source = SourceIdentitySchema.parse(sourceInput); CiDigest.parse(version); base.getSnapshot(source, version);
        const key = sourceKey(source); const spaceId = space();
        const linkedEvidence = `EXISTS (SELECT 1 FROM json_each(o.document_json, '$.evidence') ref JOIN ci_evidence e
            ON e.id = json_extract(ref.value, '$.id') AND e.space_id = o.space_id WHERE e.source_key = ? AND e.source_version = ?)`;
        const evidence = db.prepare('SELECT document_json FROM ci_evidence WHERE space_id = ? AND source_key = ? AND source_version = ? ORDER BY id LIMIT 2001').all(spaceId, key, version);
        const opportunities = db.prepare(`SELECT o.document_json FROM ci_opportunities o WHERE o.space_id = ? AND ${linkedEvidence} ORDER BY o.id LIMIT 2001`).all(spaceId, key, version);
        const links = db.prepare(`SELECT w.document_json FROM ci_work_links w JOIN ci_opportunities o ON o.space_id = w.space_id AND o.id = w.opportunity_id
            WHERE w.space_id = ? AND ${linkedEvidence} ORDER BY w.id LIMIT 2001`).all(spaceId, key, version);
        if ([evidence, opportunities, links].some(rows => rows.length > 2000)) throw new Error('来源关联超过2000项，不能生成完整复核清单，请缩小关联范围');
        return { evidence: evidence.map(row => decode(ContentEvidenceSchema, row)), opportunities: opportunities.map(row => decode(OpportunitySchema, row)), links: links.map(row => decode(WorkLinkSchema, row)) };
    }
    type FrozenResult = { source: SourceIdentity; previousVersion: string; currentVersion?: string; currentAvailability: 'available' | 'missing'; reportId: string | null };
    function result(value: FrozenResult): MaintenanceCheckResult {
        return { source: value.source, previousVersion: value.previousVersion, ...(value.currentVersion ? { currentVersion: value.currentVersion } : {}), currentAvailability: value.currentAvailability,
            changed: value.reportId !== null, detail: value.reportId ? get(value.reportId) : null };
    }
    function completed(input: unknown): MaintenanceCheckResult | null {
        const request = CheckSourceMaintenanceSchema.parse(input); const previous = requests.completedRequest<FrozenResult>('maintenance.check', request.requestId, request);
        return previous ? result(previous.result) : null;
    }
    function record(input: unknown, previous: SourceSnapshot, current: SourceSnapshot | null, impactInput: unknown, coverageInput: unknown): MaintenanceCheckResult {
        const request = CheckSourceMaintenanceSchema.parse(input);
        const saved = requests.request<FrozenResult>('maintenance.check', request.requestId, request, () => {
            if (sourceKey(previous.source) !== sourceKey(request.source) || previous.version !== request.previousVersion
                || current && sourceKey(current.source) !== sourceKey(request.source)) throw new Error('复核来源身份与冻结版本不一致');
            base.saveSnapshot(previous); if (current) base.saveSnapshot(current);
            const frozen: FrozenResult = { source: request.source, previousVersion: previous.version, ...(current ? { currentVersion: current.version } : {}), currentAvailability: current ? 'available' : 'missing', reportId: null };
            if (current?.version === previous.version) return frozen;
            const impacts = z.array(SourceMaintenanceImpactSchema).max(2000).parse(impactInput).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
            const coverage = MaintenanceScanCoverageSchema.parse(coverageInput);
            const graphDigest = ciDigest([impacts, { completeWithinScope: coverage.completeWithinScope, excludedWorkspaces: coverage.excludedWorkspaces, unversionedSameProductWorkspaces: coverage.unversionedSameProductWorkspaces }]);
            const id = 'change_' + ciDigest([space(), request.source, previous.version, current?.version ?? 'missing', graphDigest]);
            const value = SourceMaintenanceReportSchema.parse({ version: 1, id, spaceId: space(), source: request.source, sourceTitle: previous.title,
                previousVersion: previous.version, ...(current ? { currentVersion: current.version } : {}), currentAvailability: frozen.currentAvailability,
                fields: sourceFieldChanges(previous, current), impacts, coverage, graphDigest, createdAt: Date.now() });
            db.prepare('INSERT OR IGNORE INTO ci_source_changes VALUES (?, ?, ?, ?)').run(space(), id, sourceKey(request.source), JSON.stringify(value));
            return { ...frozen, reportId: id };
        }); return result(saved);
    }
    function decide(input: unknown) {
        const request = RecordMaintenanceDecisionSchema.parse(input);
        return requests.request('maintenance.decision', request.requestId, request, () => {
            const value = report(request.reportId); const impact = value.impacts.find(item => item.id === request.impactId);
            if (!impact || impact.versionDigest !== request.impactVersion) throw new Error('影响对象或冻结版本不一致，请重新核对');
            const row = db.prepare('SELECT MAX(revision) AS revision FROM ci_source_maintenance_decisions WHERE space_id = ? AND change_id = ? AND impact_id = ?').get(space(), value.id, impact.id);
            const revision = Number(row.revision ?? 0);
            if (revision !== request.expectedDecisionRevision) throw new Error('处理记录已有更新，请刷新后再确认');
            const { confirmed: _confirmed, expectedDecisionRevision: _revision, ...fields } = request;
            const decision = MaintenanceDecisionSchema.parse({ ...fields, id: randomUUID(), spaceId: space(), revision: revision + 1, impact, createdAt: Date.now() });
            db.prepare('INSERT INTO ci_source_maintenance_decisions VALUES (?, ?, ?, ?, ?)').run(space(), value.id, impact.id, decision.revision, JSON.stringify(decision)); return decision;
        });
    }
    function history(reportId: string, impactId: string) {
        const value = report(reportId); if (!value.impacts.some(item => item.id === CiId.parse(impactId))) throw new Error('对象不属于当前复核清单');
        return db.prepare('SELECT document_json FROM ci_source_maintenance_decisions WHERE space_id = ? AND change_id = ? AND impact_id = ? ORDER BY revision DESC LIMIT 100').all(space(), value.id, impactId).map(row => decode(MaintenanceDecisionSchema, row));
    }
    return { space, get, report, sources, list, references, completed, record, decide, history, snapshot: base.getSnapshot };
}
export type SourceMaintenanceRepository = ReturnType<typeof createSourceMaintenanceRepository>;
