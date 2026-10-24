// pnpm --dir desktop exec node --test tests/sourceMaintenanceRepository.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeContentIntelligence, createContentIntelligenceRepository, ciDigest } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics } from '../electron/core/content-intelligence/metricsRepository.ts';
import { initializeSourceMaintenance, createSourceMaintenanceRepository, deleteSourceMaintenanceSpace } from '../electron/core/content-intelligence/maintenanceRepository.ts';
import { SourceSnapshotSchema } from '../shared/contentIntelligence.ts';

const source = { kind: 'product' as const, namespace: 'tmall', id: 'synthetic-product' };
const snapshot = (text = '合成规格300g×12', namespace = 'tmall') => {
    const payload = { source: { ...source, namespace }, title: '合成来源', capturedAt: 1, coverage: { captured: 0, partial: true, issues: ['本地合成快照，非真实平台变化'] }, segments: [{ key: 'selectedSku', kind: 'fact', text }] };
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
};
const coverage = { scope: 'registered-creation-workspaces-and-ci-links', totalWorkspaceRecords: 1, scannedWorkspaces: 1, excludedWorkspaces: 0, completeWithinScope: true, unversionedSameProductWorkspaces: 0, legacyUnregisteredProjects: 'not-enumerated' };
function fixture(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('default'), ('中文空间'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('untouched');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeSourceMaintenance(db); initializeSourceMaintenance(db);
    let current = 'default'; const base = createContentIntelligenceRepository(db, () => current); const repo = createSourceMaintenanceRepository(db, () => current);
    const previous = base.saveSnapshot(snapshot()); const next = snapshot('本地合成变更600g×6');
    const evidence = base.addEvidence(previous, { key: 'selectedSku', start: 0, end: previous.segments[0].text.length }, previous.segments[0].text);
    const opportunity = base.createOpportunity({ requestId: 'opp', title: '合成机会', problem: '核对规格', audience: '样本读者', angle: '只复核，不承诺效果', evidence: [{ id: evidence.id, relation: 'context' }] });
    base.reserveWork('work', { opportunityId: opportunity.id, selection: { platform: 'xiaohongshu', capability: 'note-image', requestId: 'synthetic-native' } });
    const link = base.linkWork('work', 'synthetic-work');
    const impacts = [
        { id: 'impact-evidence', kind: 'evidence', targetId: evidence.id, title: '合成规格引用', versionDigest: ciDigest(evidence), reason: 'source-version', evidenceIds: [evidence.id], opportunityIds: [], quoteStatus: 'differs-current-location' },
        { id: 'impact-opportunity', kind: 'opportunity', targetId: opportunity.id, title: opportunity.title, versionDigest: ciDigest(opportunity), reason: 'linked-opportunity', evidenceIds: [evidence.id], opportunityIds: [opportunity.id] },
        { id: 'impact-work', kind: 'workspace', targetId: link.workspaceId, title: '合成工程', versionDigest: ciDigest(link), reason: 'direct-work', evidenceIds: [evidence.id], opportunityIds: [opportunity.id], availability: 'available', targetRevision: 'synthetic-native-version' },
    ];
    const input = { requestId: 'check', source, previousVersion: previous.version };
    return { db, base, repo, previous, next, evidence, opportunity, link, impacts, input, switch: (space: string) => { current = space; } };
}
test('immutable review snapshots dedupe exact graphs, reject forged source identity/hash and keep unchanged/missing-source meanings distinct', t => {
    const f = fixture(t);
    assert.equal(f.repo.record({ ...f.input, requestId: 'unchanged' }, f.previous, f.previous, [], coverage).changed, false); assert.equal(f.repo.list().length, 0);
    assert.throws(() => f.repo.record(f.input, f.previous, { ...f.next, version: 'a'.repeat(64) }, f.impacts, coverage), /摘要不匹配/); assert.equal(f.repo.list().length, 0);
    assert.throws(() => f.repo.record(f.input, f.previous, snapshot('其他平台', 'taobao'), f.impacts, coverage), /身份/);
    const first = f.repo.record(f.input, f.previous, f.next, f.impacts, coverage); assert.equal(first.changed, true); assert.equal(first.detail!.pending, 3);
    assert.ok(first.detail!.report.impacts.every(impact => impact.reviewState === 'needs_review')); assert.equal(first.detail!.report.fields[0].key, 'selectedSku');
    const retry = f.repo.record(f.input, f.previous, null, [], coverage); assert.equal(retry.detail!.report.id, first.detail!.report.id); assert.equal(retry.currentVersion, f.next.version);
    assert.equal(f.repo.completed(f.input)!.detail!.report.id, first.detail!.report.id);
    const alias = f.repo.record({ ...f.input, requestId: 'alias' }, f.previous, f.next, [...f.impacts].reverse(), coverage); assert.equal(alias.detail!.report.id, first.detail!.report.id);
    assert.throws(() => f.repo.completed({ ...f.input, source: { ...source, namespace: 'taobao' } }), /同一请求/);
    const missing = f.repo.record({ ...f.input, requestId: 'missing' }, f.previous, null, f.impacts, coverage); assert.equal(missing.currentAvailability, 'missing'); assert.equal(missing.detail!.current, null); assert.deepEqual(missing.detail!.report.fields, []);
    assert.equal(f.base.getSnapshot(source, f.previous.version).segments[0].text, f.previous.segments[0].text); assert.equal(f.db.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched');
});
test('only exact old source/version references enter the dependency graph; platform namespaces and spaces stay isolated', t => {
    const f = fixture(t); const unrelated = f.base.saveSnapshot(snapshot('其他平台合成规格', 'taobao'));
    const unrelatedEvidence = f.base.addEvidence(unrelated, { key: 'selectedSku', start: 0, end: unrelated.segments[0].text.length }, unrelated.segments[0].text);
    f.base.createOpportunity({ requestId: 'unrelated', title: '不关联本轮的机会', problem: '合成', audience: '合成', angle: '合成', evidence: [{ id: unrelatedEvidence.id, relation: 'context' }] });
    const refs = f.repo.references(source, f.previous.version); assert.deepEqual(refs.evidence.map(value => value.id), [f.evidence.id]); assert.deepEqual(refs.opportunities.map(value => value.id), [f.opportunity.id]); assert.deepEqual(refs.links.map(value => value.workspaceId), ['synthetic-work']);
    f.repo.record(f.input, f.previous, f.next, f.impacts, coverage); const id = f.repo.list()[0].id;
    const page = f.repo.sources({ limit: 1 }); assert.equal(page.items.length, 1); assert.ok(page.nextRowId); assert.equal(f.repo.sources({ limit: 100, afterRowId: page.nextRowId }).items.length, 2);
    const versions = f.repo.sources().items; assert.equal(versions.find(item => item.version === f.previous.version)!.evidenceCount, 1); assert.equal(versions.find(item => item.version === f.next.version)!.evidenceCount, 0);
    f.switch('中文空间'); assert.deepEqual(f.repo.sources().items, []); assert.deepEqual(f.repo.list(), []); assert.throws(() => f.repo.get(id), /当前空间/); assert.throws(() => f.repo.references(source, f.previous.version));
    deleteSourceMaintenanceSpace(f.db, '中文空间'); f.switch('default'); assert.equal(f.repo.get(id).report.id, id);
});
test('per-item human decisions are acknowledged plans with optimistic audit revisions, no source or opportunity rewrite and no automatic carry-over to new work versions', t => {
    const f = fixture(t); const detail = f.repo.record(f.input, f.previous, f.next, f.impacts, coverage).detail!;
    const impact = detail.report.impacts.find(value => value.kind === 'workspace')!;
    const input = { requestId: 'decision', reportId: detail.report.id, impactId: impact.id, impactVersion: impact.versionDigest, expectedDecisionRevision: 0, action: 'edit-manually', note: '待人工核对，未更正或发布', confirmed: true };
    assert.throws(() => f.repo.decide({ ...input, confirmed: false })); assert.throws(() => f.repo.decide({ ...input, impactVersion: 'b'.repeat(64) }), /版本不一致/);
    const first = f.repo.decide(input); assert.equal(first.revision, 1); assert.equal(f.repo.decide(input).id, first.id); assert.equal(f.repo.get(detail.report.id).pending, 2);
    assert.throws(() => f.repo.decide({ ...input, note: 'changed under same request' }), /同一请求/);
    assert.throws(() => f.repo.decide({ ...input, requestId: 'stale' }), /已有更新/);
    const second = f.repo.decide({ ...input, requestId: 'second', expectedDecisionRevision: 1, action: 'keep-historical', note: '保留历史引用，当前稿件仍需另行核实' });
    assert.equal(second.revision, 2); assert.equal(f.repo.get(detail.report.id).decisions[0].id, second.id); assert.equal(f.repo.history(detail.report.id, impact.id).length, 2);
    const changed = f.repo.record({ ...f.input, requestId: 'new-work-version' }, f.previous, f.next, f.impacts.map(value => value.kind === 'workspace' ? { ...value, versionDigest: 'c'.repeat(64), targetRevision: 'later-native-version' } : value), coverage).detail!;
    assert.notEqual(changed.report.id, detail.report.id); assert.equal(changed.pending, 3); assert.equal(changed.decisions.length, 0);
    assert.equal(f.repo.get(detail.report.id).pending, 2); assert.equal(f.base.getOpportunity(f.opportunity.id).revision, f.opportunity.revision); assert.equal(f.base.getEvidence(f.evidence.id).sourceVersion, f.previous.version);
});
test('duplicate impact identities and inconsistent declared spaces reject rather than persisting an apparently complete report', t => {
    const f = fixture(t);
    for (const badCoverage of [{ ...coverage, totalWorkspaceRecords: 2 }, { ...coverage, completeWithinScope: false }, { ...coverage, unversionedSameProductWorkspaces: 2 }]) {
        assert.throws(() => f.repo.record(f.input, f.previous, f.next, f.impacts, badCoverage));
    }
    assert.throws(() => f.repo.record(f.input, f.previous, f.next, [f.impacts[0], f.impacts[0]], coverage), /影响项重复/); assert.equal(f.repo.list().length, 0);
    const old = f.base.getEvidence(f.evidence.id); f.db.prepare('UPDATE ci_evidence SET document_json = ? WHERE space_id = ? AND id = ?').run(JSON.stringify({ ...old, spaceId: '中文空间' }), 'default', old.id);
    assert.throws(() => f.repo.references(source, f.previous.version), /空间不一致/);
});
test('a real file database reopens with immutable reports, old and new source versions and decision audit intact; deleting one space preserves legacy data', async t => {
    const f = fixture(t); const detail = f.repo.record(f.input, f.previous, f.next, f.impacts, coverage).detail!; const impact = detail.report.impacts[0];
    f.repo.decide({ requestId: 'decision', reportId: detail.report.id, impactId: impact.id, impactVersion: impact.versionDigest, expectedDecisionRevision: 0, action: 'collect-evidence', note: '等待补充证据，未修改来源或作品', confirmed: true });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-source-maintenance-migration-')); const file = path.join(root, 'legacy.db'); f.db.exec("VACUUM INTO '" + file.replaceAll("'", "''") + "'"); const db = new DatabaseSync(file);
    try {
        initializeSourceMaintenance(db); initializeSourceMaintenance(db); const repo = createSourceMaintenanceRepository(db, () => 'default'); const reopened = repo.get(detail.report.id);
        assert.equal(reopened.pending, 2); assert.equal(reopened.previous.version, f.previous.version); assert.equal(reopened.current!.version, f.next.version); assert.equal(reopened.decisions[0].action, 'collect-evidence');
        assert.equal(repo.completed(f.input)!.detail!.report.id, detail.report.id); assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
        deleteSourceMaintenanceSpace(db, '中文空间'); assert.equal(repo.get(detail.report.id).report.id, detail.report.id); deleteSourceMaintenanceSpace(db, 'default'); assert.throws(() => repo.get(detail.report.id));
        assert.equal(db.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched'); assert.equal(createContentIntelligenceRepository(db, () => 'default').getEvidence(f.evidence.id).sourceVersion, f.previous.version);
    } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
});
