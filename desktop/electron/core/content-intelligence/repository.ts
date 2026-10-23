import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
    CiId, CiListSchema, SourceSnapshotSchema, ContentEvidenceSchema, OpportunitySchema, WorkLinkSchema,
    CreateOpportunitySchema, TransitionOpportunitySchema, EvidenceLocatorSchema, SourceIdentitySchema,
    canTransitionOpportunity, type SourceIdentity, type SourceSnapshot, type ContentEvidence, type Opportunity, type WorkLink,
} from '../../../shared/contentIntelligence.ts';
import { CreationStartSchema } from '../../../shared/creationWorkspace.ts';

// Both production better-sqlite3 and Node's temporary test databases satisfy this boundary.
export interface CiDatabase {
    exec(sql: string): unknown;
    prepare(sql: string): { run(...values: any[]): unknown; get(...values: any[]): any; all(...values: any[]): any[] };
}
export function ciDigest(value: unknown): string {
    function canonical(item: any): any {
        if (Array.isArray(item)) return item.map(canonical);
        if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, canonical(item[key])]));
        return item;
    }
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export const sourceKey = (source: SourceIdentity) => JSON.stringify([source.kind, source.namespace, source.id]);
let transactionId = 0;
export function ciTransaction<T>(db: CiDatabase, operation: () => T): T {
    const savepoint = 'ci_' + ++transactionId;
    db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = operation(); db.exec(`RELEASE ${savepoint}`); return result; }
    catch (error) { db.exec(`ROLLBACK TO ${savepoint}`); db.exec(`RELEASE ${savepoint}`); throw error; }
}
export function initializeContentIntelligence(db: CiDatabase): void {
    ciTransaction(db, () => db.exec(`
        CREATE TABLE IF NOT EXISTS ci_source_snapshots (
            space_id TEXT NOT NULL, source_key TEXT NOT NULL, version TEXT NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, source_key, version)
        );
        CREATE TABLE IF NOT EXISTS ci_evidence (
            id TEXT NOT NULL, space_id TEXT NOT NULL, source_key TEXT NOT NULL, source_version TEXT NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_evidence_source ON ci_evidence(space_id, source_key, source_version);
        CREATE TABLE IF NOT EXISTS ci_opportunities (
            id TEXT NOT NULL, space_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_opportunities_status ON ci_opportunities(space_id, status, id);
        CREATE TABLE IF NOT EXISTS ci_work_links (
            id TEXT NOT NULL, space_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, workspace_id TEXT NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, id), UNIQUE(space_id, opportunity_id, workspace_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_links_work ON ci_work_links(space_id, workspace_id);
        CREATE TABLE IF NOT EXISTS ci_requests (
            space_id TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, result_json TEXT NOT NULL,
            PRIMARY KEY(space_id, operation, request_id)
        );
        CREATE TABLE IF NOT EXISTS ci_analysis_runs (
            id TEXT NOT NULL, space_id TEXT NOT NULL, request_id TEXT NOT NULL, status TEXT NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, id), UNIQUE(space_id, request_id)
        );
        CREATE TABLE IF NOT EXISTS ci_insights (
            id TEXT NOT NULL, space_id TEXT NOT NULL, run_id TEXT NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, id)
        );
    `));
}
export function deleteContentIntelligenceSpace(db: CiDatabase, spaceId: string): void {
    for (const table of ['ci_work_links', 'ci_requests', 'ci_insights', 'ci_analysis_runs', 'ci_opportunities', 'ci_evidence', 'ci_source_snapshots']) {
        db.prepare(`DELETE FROM ${table} WHERE space_id = ?`).run(spaceId);
    }
}
const WorkRequestSchema = z.object({
    opportunityId: CiId, selection: CreationStartSchema, workspaceId: CiId.optional(),
}).strict();
export function createContentIntelligenceRepository(db: CiDatabase, currentSpace: () => string) {
    function space(): string {
        const id = CiId.parse(currentSpace());
        if (!db.prepare('SELECT 1 FROM spaces WHERE id = ?').get(id)) throw new Error('空间不存在');
        return id;
    }
    const decode = <T>(schema: z.ZodType<T, z.ZodTypeDef, any>, row: any): T => {
        if (!row) throw new Error('记录不存在或不属于当前空间');
        return schema.parse(JSON.parse(row.document_json));
    };
    function request<T>(operation: string, requestId: string, input: unknown, execute: () => T): T {
        const spaceId = space(); CiId.parse(requestId); const digest = ciDigest(input);
        return ciTransaction(db, () => {
            const old = db.prepare('SELECT digest, result_json FROM ci_requests WHERE space_id = ? AND operation = ? AND request_id = ?').get(spaceId, operation, requestId);
            if (old) { if (old.digest !== digest) throw new Error('同一请求不能用于不同内容'); return JSON.parse(old.result_json) as T; }
            const result = execute();
            db.prepare('INSERT INTO ci_requests VALUES (?, ?, ?, ?, ?)').run(spaceId, operation, requestId, digest, JSON.stringify(result));
            return result;
        });
    }
    function getEvidence(id: string): ContentEvidence {
        return decode(ContentEvidenceSchema, db.prepare('SELECT document_json FROM ci_evidence WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    }
    function getOpportunity(id: string): Opportunity {
        return decode(OpportunitySchema, db.prepare('SELECT document_json FROM ci_opportunities WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    }
    function getSnapshot(source: SourceIdentity, version: string): SourceSnapshot {
        SourceIdentitySchema.parse(source);
        return decode(SourceSnapshotSchema, db.prepare('SELECT document_json FROM ci_source_snapshots WHERE space_id = ? AND source_key = ? AND version = ?').get(space(), sourceKey(source), version));
    }
    function saveSnapshot(input: unknown): SourceSnapshot {
        const value = SourceSnapshotSchema.parse(input);
        const { version, ...payload } = value;
        if (version !== ciDigest(payload)) throw new Error('来源版本摘要不匹配');
        const old = db.prepare('SELECT document_json FROM ci_source_snapshots WHERE space_id = ? AND source_key = ? AND version = ?').get(space(), sourceKey(value.source), version);
        if (old && ciDigest(JSON.parse(old.document_json)) !== ciDigest(value)) throw new Error('来源版本冲突');
        db.prepare('INSERT OR IGNORE INTO ci_source_snapshots VALUES (?, ?, ?, ?)').run(space(), sourceKey(value.source), version, JSON.stringify(value));
        return value;
    }
    function addEvidence(snapshot: SourceSnapshot, locatorInput: unknown, excerpt: string): ContentEvidence {
        const locator = EvidenceLocatorSchema.parse(locatorInput);
        const value = SourceSnapshotSchema.parse(snapshot);
        const segment = value.segments.find(item => item.key === locator.key);
        if (!segment || !excerpt.trim() || segment.text.slice(locator.start, locator.end) !== excerpt || locator.end > segment.text.length) throw new Error('引用不能定位到原文');
        const evidence = ContentEvidenceSchema.parse({ id: 'ev_' + ciDigest([value.source, value.version, locator, excerpt]), spaceId: space(),
            source: value.source, sourceVersion: value.version, locator, excerpt, validity: 'verified', coverage: value.coverage, createdAt: Date.now() });
        return ciTransaction(db, () => {
            saveSnapshot(value);
            db.prepare('INSERT OR IGNORE INTO ci_evidence VALUES (?, ?, ?, ?, ?)').run(evidence.id, space(), sourceKey(value.source), value.version, JSON.stringify(evidence));
            return getEvidence(evidence.id);
        });
    }
    function createOpportunity(input: unknown): Opportunity {
        const parsed = CreateOpportunitySchema.parse(input);
        return request('opportunity.create', parsed.requestId, parsed, () => {
            for (const item of parsed.evidence) getEvidence(item.id);
            if (new Set(parsed.evidence.map(item => item.id + ':' + item.relation)).size !== parsed.evidence.length) throw new Error('证据关系重复');
            const { requestId, ...fields } = parsed;
            const supported = parsed.evidence.some(item => item.relation === 'supports');
            const now = Date.now(); const value = OpportunitySchema.parse({ ...fields, id: randomUUID(), spaceId: space(),
                basis: supported ? 'evidence' : 'hypothesis', status: supported ? 'proposed' : 'needs_evidence', revision: 1, createdAt: now, updatedAt: now });
            db.prepare('INSERT INTO ci_opportunities VALUES (?, ?, ?, ?, ?)').run(value.id, space(), value.status, value.revision, JSON.stringify(value));
            return value;
        });
    }
    function transitionOpportunity(input: unknown): Opportunity {
        const parsed = TransitionOpportunitySchema.parse(input);
        return request('opportunity.transition', parsed.requestId, parsed, () => {
            const value = getOpportunity(parsed.id);
            if (value.revision !== parsed.expectedRevision) throw new Error('机会已变化，请刷新后重试');
            if (!canTransitionOpportunity(value.status, parsed.to)) throw new Error('不允许的状态迁移');
            value.status = parsed.to; value.revision++; value.updatedAt = Date.now();
            db.prepare('UPDATE ci_opportunities SET status = ?, revision = ?, document_json = ? WHERE space_id = ? AND id = ?').run(value.status, value.revision, JSON.stringify(value), space(), value.id);
            return value;
        });
    }
    function listOpportunities(input: unknown = {}) {
        const query = CiListSchema.parse(input); const spaceId = space();
        const rows = db.prepare('SELECT document_json FROM ci_opportunities WHERE space_id = ? AND (? IS NULL OR status = ?) AND id > ? ORDER BY id LIMIT ?')
            .all(spaceId, query.status || null, query.status || null, query.after || '', query.limit + 1);
        const items = rows.slice(0, query.limit).map(row => decode(OpportunitySchema, row));
        return { items, ...(rows.length > query.limit ? { next: items[items.length - 1].id } : {}) };
    }
    function reserveWork(requestId: string, input: z.infer<typeof WorkRequestSchema>) {
        const value = WorkRequestSchema.parse(input);
        getOpportunity(value.opportunityId);
        return request('work.create', requestId, value, () => value);
    }
    function linkWork(requestId: string, workspaceId: string): WorkLink {
        const spaceId = space(); CiId.parse(workspaceId);
        return ciTransaction(db, () => {
            const row = db.prepare('SELECT result_json FROM ci_requests WHERE space_id = ? AND operation = ? AND request_id = ?').get(spaceId, 'work.create', CiId.parse(requestId));
            if (!row) throw new Error('缺少创作请求');
            const reserved = WorkRequestSchema.parse(JSON.parse(row.result_json)); getOpportunity(reserved.opportunityId);
            if (reserved.workspaceId && reserved.workspaceId !== workspaceId) throw new Error('作品请求关联冲突');
            const link = WorkLinkSchema.parse({ id: 'link_' + ciDigest([spaceId, requestId]), spaceId, opportunityId: reserved.opportunityId, workspaceId, requestId, createdAt: Date.now() });
            db.prepare('INSERT OR IGNORE INTO ci_work_links VALUES (?, ?, ?, ?, ?)').run(link.id, spaceId, link.opportunityId, workspaceId, JSON.stringify(link));
            db.prepare('UPDATE ci_requests SET result_json = ? WHERE space_id = ? AND operation = ? AND request_id = ?').run(JSON.stringify({ ...reserved, workspaceId }), spaceId, 'work.create', requestId);
            return decode(WorkLinkSchema, db.prepare('SELECT document_json FROM ci_work_links WHERE space_id = ? AND opportunity_id = ? AND workspace_id = ?').get(spaceId, link.opportunityId, workspaceId));
        });
    }
    function linksForWork(workspaceId: string): WorkLink[] {
        return db.prepare('SELECT document_json FROM ci_work_links WHERE space_id = ? AND workspace_id = ? ORDER BY id').all(space(), CiId.parse(workspaceId)).map(row => decode(WorkLinkSchema, row));
    }
    return { space, saveSnapshot, getSnapshot, addEvidence, getEvidence, createOpportunity, getOpportunity, transitionOpportunity, listOpportunities, reserveWork, linkWork, linksForWork };
}
export type ContentIntelligenceRepository = ReturnType<typeof createContentIntelligenceRepository>;
