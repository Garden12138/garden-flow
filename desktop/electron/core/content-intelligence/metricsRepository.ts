import { z } from 'zod';
import { CiId } from '../../../shared/contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from '../../../shared/workspaceSpace.ts';
import { MetricCsvImportSchema, MetricObservationSchema, PublicationLinkSchema, type MetricImportPreview, type MetricImportRow, type MetricObservation, type PublicationLink } from '../../../shared/contentExperiments.ts';
import { ciDigest, ciTransaction, type CiDatabase } from './repository.ts';
import { metricIdentity, readMetricCsv } from './metricsDomain.ts';

export function initializeContentMetrics(db: CiDatabase): void {
    ciTransaction(db, () => db.exec(`
        CREATE TABLE IF NOT EXISTS ci_publication_links (
            space_id TEXT NOT NULL, id TEXT NOT NULL, workspace_id TEXT NOT NULL, document_json TEXT NOT NULL,
            PRIMARY KEY(space_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_publication_workspace ON ci_publication_links(space_id, workspace_id);
        CREATE TABLE IF NOT EXISTS ci_metric_observations (
            space_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, publication_link_id TEXT NOT NULL,
            document_json TEXT NOT NULL, PRIMARY KEY(space_id, id, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_metric_publication ON ci_metric_observations(space_id, publication_link_id, id, revision);
    `));
}
export function deleteContentMetricsSpace(db: CiDatabase, spaceId: string): void {
    for (const table of ['ci_metric_observations', 'ci_publication_links']) db.prepare(`DELETE FROM ${table} WHERE space_id = ?`).run(spaceId);
}
export function createContentMetricsRepository(db: CiDatabase, currentSpace: () => string) {
    function space() {
        const id = WorkspaceSpaceIdSchema.parse(currentSpace());
        if (!db.prepare('SELECT 1 FROM spaces WHERE id = ?').get(id)) throw new Error('空间不存在');
        return id;
    }
    const decode = <T>(schema: z.ZodType<T, z.ZodTypeDef, any>, row: any): T => {
        if (!row) throw new Error('记录不存在或不属于当前空间'); return schema.parse(JSON.parse(row.document_json));
    };
    function request<T>(operation: string, requestId: string, input: unknown, execute: () => T): T {
        const spaceId = space(); CiId.parse(requestId); const digest = ciDigest(input);
        return ciTransaction(db, () => {
            const previous = db.prepare('SELECT digest, result_json FROM ci_requests WHERE space_id = ? AND operation = ? AND request_id = ?').get(spaceId, operation, requestId);
            if (previous) { if (previous.digest !== digest) throw new Error('同一请求不能用于不同内容'); return JSON.parse(previous.result_json) as T; }
            const result = execute();
            db.prepare('INSERT INTO ci_requests VALUES (?, ?, ?, ?, ?)').run(spaceId, operation, requestId, digest, JSON.stringify(result)); return result;
        });
    }
    function publication(id: string): PublicationLink {
        return decode(PublicationLinkSchema, db.prepare('SELECT document_json FROM ci_publication_links WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    }
    // Only the service calls this after validating the native work and/or a captured publication job.
    function recordPublication(input: Omit<PublicationLink, 'id' | 'spaceId' | 'createdAt'>): PublicationLink {
        const spaceId = space(); const parsed = PublicationLinkSchema.omit({ id: true, spaceId: true, createdAt: true }).parse(input);
        const id = 'pub_' + ciDigest([spaceId, parsed.workspaceId, parsed.workspaceRevision, parsed.platform, parsed.accountAlias, parsed.externalWorkId, parsed.jobId, parsed.origin, parsed.status]);
        const value = PublicationLinkSchema.parse({ ...parsed, id, spaceId, createdAt: Date.now() });
        const previous = db.prepare('SELECT document_json FROM ci_publication_links WHERE space_id = ? AND id = ?').get(spaceId, id);
        if (previous) {
            const old = decode(PublicationLinkSchema, previous);
            // Do not silently replace a manual citation, receipt or captured version.
            if (ciDigest({ ...old, createdAt: 0, observedAt: 0 }) !== ciDigest({ ...value, createdAt: 0, observedAt: 0 })) throw new Error('发布关联内容冲突，请保留原始记录并核对');
            return old;
        }
        db.prepare('INSERT INTO ci_publication_links VALUES (?, ?, ?, ?)').run(spaceId, id, value.workspaceId, JSON.stringify(value)); return value;
    }
    function publications(workspaceId?: string): PublicationLink[] {
        if (workspaceId !== undefined) CiId.parse(workspaceId);
        return db.prepare('SELECT document_json FROM ci_publication_links WHERE space_id = ? AND (? IS NULL OR workspace_id = ?) ORDER BY id LIMIT 1000')
            .all(space(), workspaceId ?? null, workspaceId ?? null).map(row => decode(PublicationLinkSchema, row));
    }
    function observation(id: string, revision?: number): MetricObservation {
        CiId.parse(id); if (revision !== undefined) z.number().int().positive().parse(revision);
        return decode(MetricObservationSchema, db.prepare('SELECT document_json FROM ci_metric_observations WHERE space_id = ? AND id = ? AND (? IS NULL OR revision = ?) ORDER BY revision DESC LIMIT 1').get(space(), id, revision ?? null, revision ?? null));
    }
    function observations(): MetricObservation[] {
        return db.prepare(`SELECT document_json FROM ci_metric_observations a WHERE a.space_id = ? AND a.revision =
            (SELECT MAX(b.revision) FROM ci_metric_observations b WHERE b.space_id = a.space_id AND b.id = a.id) ORDER BY a.id LIMIT 1000`)
            .all(space()).map(row => decode(MetricObservationSchema, row));
    }
    function history(id: string): MetricObservation[] {
        observation(id);
        return db.prepare('SELECT document_json FROM ci_metric_observations WHERE space_id = ? AND id = ? ORDER BY revision DESC').all(space(), id).map(row => decode(MetricObservationSchema, row));
    }
    function preview(input: unknown): MetricImportPreview {
        const spaceId = space(); const parsed = readMetricCsv(input); const seen = new Map<string, number>();
        const rows: MetricImportRow[] = [];
        for (const row of parsed.rows) {
            if (!row.input) { rows.push({ row: row.row, status: 'error', error: row.error }); continue; }
            const value = row.input;
            try {
                if (!publication(value.publicationLinkId).externalWorkId) throw new Error('发布关联缺少平台作品 ID，请先手动核实补充');
                const id = 'obs_' + ciDigest([spaceId, metricIdentity(value)]);
                const oldRow = db.prepare('SELECT document_json FROM ci_metric_observations WHERE space_id = ? AND id = ? ORDER BY revision DESC LIMIT 1').get(spaceId, id);
                const previous = oldRow ? decode(MetricObservationSchema, oldRow) : null;
                const firstIndex = seen.get(id);
                if (firstIndex !== undefined) {
                    const first = rows[firstIndex];
                    if (first.status === 'error' || ciDigest(first.input) !== ciDigest(value)) {
                        rows[firstIndex] = { row: first.row, status: 'error', error: '同一 CSV 内同一观测存在冲突' };
                        rows.push({ row: row.row, status: 'error', error: '同一 CSV 内同一观测存在冲突' });
                    } else rows.push({ row: row.row, status: 'duplicate', input: value, observationId: id, expectedRevision: previous?.revision });
                    continue;
                }
                seen.set(id, rows.length);
                rows.push({ row: row.row, input: value, observationId: id, expectedRevision: previous?.revision,
                    status: !previous ? 'new' : ciDigest(previous.input) === ciDigest(value) ? 'duplicate' : 'conflict' });
            } catch (error) { rows.push({ row: row.row, status: 'error', error: error instanceof Error ? error.message : '发布关联不可用' }); }
        }
        return { headers: parsed.headers, rows, digest: ciDigest([spaceId, input, rows]) };
    }
    function importCsv(input: unknown) {
        const parsed = MetricCsvImportSchema.parse(input);
        return request('metrics.import', parsed.requestId, parsed, () => {
            const next = preview({ csv: parsed.csv, mapping: parsed.mapping });
            if (next.digest !== parsed.previewDigest) throw new Error('预览或现有观测已变化，请重新核对');
            if (!next.rows.length || next.rows.some(row => row.status === 'error')) throw new Error('请先修复错误行再导入');
            if (next.rows.some(row => row.status === 'conflict') && !parsed.reviseConflicts) throw new Error('存在冲突，须明确确认保留审计版本的修订');
            const changed: MetricObservation[] = []; const importDigest = ciDigest(parsed.csv);
            for (const row of next.rows.filter(row => row.status === 'new' || row.status === 'conflict')) {
                const value = MetricObservationSchema.parse({ id: row.observationId, spaceId: space(), revision: (row.expectedRevision || 0) + 1, input: row.input, importDigest, recordedAt: Date.now() });
                db.prepare('INSERT INTO ci_metric_observations VALUES (?, ?, ?, ?, ?)').run(value.spaceId, value.id, value.revision, value.input.publicationLinkId, JSON.stringify(value)); changed.push(value);
            }
            return { changed, duplicates: next.rows.filter(row => row.status === 'duplicate').length, importDigest };
        });
    }
    return { space, request, publication, publications, recordPublication, observation, observations, history, preview, importCsv };
}
export type ContentMetricsRepository = ReturnType<typeof createContentMetricsRepository>;
