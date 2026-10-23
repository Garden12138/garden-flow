// Run: pnpm --dir desktop exec node --test tests/consumerResearchRepository.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeContentIntelligence, createContentIntelligenceRepository, ciDigest } from '../electron/core/content-intelligence/repository.ts';
import { initializeConsumerResearch, recoverConsumerResearch, deleteConsumerResearchSpace, createConsumerResearchRepository } from '../electron/core/content-intelligence/researchRepository.ts';
import { SourceSnapshotSchema } from '../shared/contentIntelligence.ts';
const model = { sourceId: 'test-local', name: 'synthetic-local-provider', host: 'localhost', fingerprint: 'a'.repeat(64) };
function snapshot() {
    const payload = { source: { kind: 'product' as const, namespace: 'taobao', id: 'one' }, title: '合成测试', capturedAt: 1,
        coverage: { captured: 1, requested: 1, partial: false, issues: [] }, segments: [{ key: 'review_one', kind: 'comment' as const, text: '合成评论：固定后会滑动' }] };
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
}
function fixture(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'), ('中文空间'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('untouched');");
    initializeContentIntelligence(db); initializeConsumerResearch(db); initializeConsumerResearch(db);
    let space = 'a'; const repo = createConsumerResearchRepository(db, () => space); const base = createContentIntelligenceRepository(db, () => space);
    const source = snapshot(); const input = { requestId: 'preview_one', scope: { sources: [{ source: source.source, version: source.version }] } };
    return { db, repo, base, source, input, switch: (value: string) => { space = value; } };
}
const consent = (run: any) => ({ id: run.id, expectedRevision: run.revision, consent: true, modelFingerprint: model.fingerprint });
function proposal(refId: string) {
    const score = { value: 3, reason: '合成排序理由' };
    return { comment_insight: { questions: [], pain_points: ['合成问题'], objections: [], demand_signals: [], opportunity: '合成创作建议' },
        insights: [{ category: 'usage_obstacle', statement: '样本中提及固定问题', supportRefs: [{ refId, quote: '固定后会滑动' }], counterRefs: [], uncertainties: ['合成测试数据'] }],
        opportunities: [{ insightIndex: 0, title: '固定演示', problem: '部分样本固定不便', audience: '相关使用者', angle: '实拍操作', suggestedFormats: ['note-image'], missingEvidence: [], scores: { evidence: score, fit: score, feasibility: score, business: score, freshness: score } }] };
}

test('preview is idempotent by request and frozen scope; confirmed jobs are claimed only once', t => {
    const h = fixture(t); const run = h.repo.preview(h.input, [h.source], model);
    assert.equal(run.status, 'queued'); assert.equal(run.calls, 0); assert.equal(run.commentCount, 1);
    assert.deepEqual(h.repo.preview(h.input, [h.source], model), run);
    assert.equal(h.repo.preview({ ...h.input, requestId: 'other_preview' }, [h.source], model).id, run.id);
    assert.throws(() => h.repo.preview({ ...h.input, scope: { ...h.input.scope, goal: 'changed' } }, [h.source], model), /同一预览请求/);
    assert.throws(() => h.repo.claim({ ...consent(run), consent: false }));
    assert.throws(() => h.repo.claim({ ...consent(run), modelFingerprint: 'b'.repeat(64) }), /配置已变化/);
    assert.equal(h.repo.claim(consent(run)).claimed, true); assert.equal(h.repo.claim(consent(run)).claimed, false);
    assert.equal(h.repo.get(run.id).calls, 1);
});

test('verified insight creates a traceable candidate once; late duplicate output preserves adopted state and revisions', t => {
    const h = fixture(t); const run = h.repo.preview(h.input, [h.source], model); const started = h.repo.claim(consent(run)).run;
    const ref = h.repo.references(run.id)[0]; const complete = h.repo.finish(run.id, started.revision, proposal(ref.id));
    assert.equal(complete.status, 'succeeded'); assert.equal(complete.opportunityIds.length, 1);
    const opportunity = h.base.getOpportunity(complete.opportunityIds[0]); assert.equal(opportunity.status, 'proposed'); assert.equal(opportunity.research?.confidence, 'low');
    assert.equal(h.base.getEvidence(opportunity.evidence[0].id).excerpt, '固定后会滑动');
    const adopted = h.base.transitionOpportunity({ id: opportunity.id, requestId: 'adopt', expectedRevision: 1, to: 'accepted' });
    assert.deepEqual(h.repo.finish(run.id, started.revision, proposal('fabricated')), complete);
    assert.equal(h.base.getOpportunity(opportunity.id).revision, adopted.revision); assert.equal(h.base.getOpportunity(opportunity.id).status, 'accepted');
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM ci_opportunities').get()!.n, 1);
});

test('invented references are retained as unverified hypotheses, never as source evidence', t => {
    const h = fixture(t); const run = h.repo.preview(h.input, [h.source], model); const started = h.repo.claim(consent(run)).run;
    const result = h.repo.finish(run.id, started.revision, proposal('fabricated_ref'));
    assert.equal(result.status, 'partial'); assert.ok(result.issues.includes('UNKNOWN_REFERENCE'));
    const opportunity = h.base.getOpportunity(result.opportunityIds[0]); assert.equal(opportunity.status, 'needs_evidence'); assert.equal(opportunity.basis, 'hypothesis'); assert.equal(opportunity.research?.confidence, 'unknown');
    assert.equal(opportunity.evidence.length, 0); assert.equal(h.db.prepare('SELECT count(*) AS n FROM ci_evidence').get()!.n, 0);
});

test('cancellation and restart prevent late results and automatic fee retries; explicit failed-run preview creates a new request', t => {
    const h = fixture(t); let run = h.repo.preview(h.input, [h.source], model); let started = h.repo.claim(consent(run)).run;
    const cancelled = h.repo.cancel({ id: run.id, expectedRevision: started.revision }); assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(h.repo.finish(run.id, started.revision, proposal(h.repo.references(run.id)[0].id)), cancelled); assert.equal(h.base.listOpportunities().items.length, 0);
    assert.equal(h.repo.preview(h.input, [h.source], model).status, 'cancelled');
    run = h.repo.preview({ ...h.input, requestId: 'explicit_retry' }, [h.source], model); assert.notEqual(run.id, cancelled.id); started = h.repo.claim(consent(run)).run;
    recoverConsumerResearch(h.db); initializeConsumerResearch(h.db); recoverConsumerResearch(h.db);
    const interrupted = h.repo.get(run.id); assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.calls, 1);
    assert.equal(h.repo.claim(consent(interrupted)).claimed, false); assert.deepEqual(h.repo.finish(run.id, started.revision, proposal('late')), interrupted);
    assert.equal(h.db.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched');
});

test('all research input, output and cleanup operations stay in the captured space, including Chinese IDs', t => {
    const h = fixture(t); const first = h.repo.preview(h.input, [h.source], model); h.switch('中文空间');
    assert.deepEqual(h.repo.list(), []); assert.throws(() => h.repo.get(first.id), /当前空间/); assert.throws(() => h.repo.references(first.id), /当前空间/);
    assert.throws(() => h.repo.claim(consent(first)), /当前空间/);
    const own = h.repo.preview(h.input, [h.source], model); assert.equal(own.spaceId, '中文空间');
    deleteConsumerResearchSpace(h.db, 'a'); assert.equal(h.repo.references(own.id).length, 1);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM ci_analysis_inputs WHERE space_id = ?').get('a')!.n, 0);
    h.switch('missing'); assert.throws(() => h.repo.list(), /空间不存在/);
});

test('invalid output rolls back every derived row; no-model preview and empty proposals remain honest', t => {
    const h = fixture(t); const noModel = h.repo.preview(h.input, [h.source], null); assert.equal(noModel.model, null); assert.throws(() => h.repo.claim(consent(noModel)), /先配置/);
    const run = h.repo.preview({ ...h.input, requestId: 'configured' }, [h.source], model); const started = h.repo.claim(consent(run)).run;
    assert.throws(() => h.repo.finish(run.id, started.revision, { invented: true })); assert.equal(h.repo.get(run.id).status, 'running'); assert.equal(h.base.listOpportunities().items.length, 0);
    const complete = h.repo.finish(run.id, started.revision, { comment_insight: { questions: [], pain_points: [], objections: [], demand_signals: [], opportunity: '' }, insights: [], opportunities: [] });
    assert.equal(complete.status, 'succeeded'); assert.equal(complete.opportunityIds.length, 0);
});
