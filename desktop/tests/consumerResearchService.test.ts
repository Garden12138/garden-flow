// Run: pnpm --dir desktop exec node --test tests/consumerResearchService.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { initializeContentIntelligence, createContentIntelligenceRepository, ciDigest } from '../electron/core/content-intelligence/repository.ts';
import { initializeConsumerResearch, createConsumerResearchRepository } from '../electron/core/content-intelligence/researchRepository.ts';
import { createConsumerResearchService } from '../electron/core/content-intelligence/researchService.ts';
import { createConsumerResearchModel } from '../electron/core/content-intelligence/researchModel.ts';
import { SourceSnapshotSchema } from '../shared/contentIntelligence.ts';

function snapshot(text: string) {
    const payload = { source: { kind: 'product' as const, namespace: 'tmall', id: 'one' }, title: '合成测试', capturedAt: 1,
        coverage: { captured: 1, partial: false, issues: [] }, segments: [{ key: 'one', kind: 'comment' as const, text }] };
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
}
function proposal(refId: string, quote = '固定后会滑动') {
    const score = { value: 3, reason: '仅合成测试建议' };
    return { comment_insight: { questions: [], pain_points: [], objections: [], demand_signals: [], opportunity: '' },
        insights: [{ category: 'usage_obstacle', statement: '样本提及固定问题', supportRefs: [{ refId, quote }], counterRefs: [], uncertainties: ['仅样本'] }],
        opportunities: [{ insightIndex: 0, title: '安装演示', problem: '样本问题', audience: '相关使用者', angle: '解释适用范围', suggestedFormats: ['note-image'], missingEvidence: [], scores: { evidence: score, fit: score, feasibility: score, business: score, freshness: score } }] };
}
const description = { sourceId: 'test-local', name: 'synthetic', host: 'localhost', fingerprint: 'a'.repeat(64) };
const consent = (run: any) => ({ id: run.id, expectedRevision: run.revision, consent: true, modelFingerprint: description.fingerprint });
async function settle(check: () => boolean) { for (let i = 0; i < 50; i++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('background task did not settle'); }
function fixture(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close()); db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'), ('b');");
    initializeContentIntelligence(db); initializeConsumerResearch(db);
    const context = new AsyncLocalStorage<string>(); let active = 'a'; const current = () => context.getStore() || active;
    const data: Record<string, ReturnType<typeof snapshot>> = { a: snapshot('固定后会滑动'), b: snapshot('另一个空间完全不同的评论') };
    const repo = createConsumerResearchRepository(db, current); const base = createContentIntelligenceRepository(db, current);
    let calls = 0; let release: (value: unknown) => void = () => {}; let reject: (error: Error) => void = () => {};
    let configured = true; const model = { describe: () => configured ? description : null,
        analyze: async () => { calls++; return new Promise((resolve, fail) => { release = resolve; reject = fail; }); } };
    const sources = { list: async () => [data[current()]], read: async () => data[current()], validity: async () => 'verified' as const };
    const service = createConsumerResearchService(repo, sources, model);
    const input = () => ({ requestId: 'preview', scope: { sources: [{ source: data[current()].source, version: data[current()].version }] } });
    return { repo, base, service, context, data, input, current, switch: (id: string) => { active = id; }, setConfigured: (value: boolean) => { configured = value; }, calls: () => calls, release: (value: unknown) => release(value), reject: (error: Error) => reject(error) };
}

test('concurrent confirmation charges at most once and persisted structured results use only frozen source evidence', async t => {
    const h = fixture(t); const preview = await h.service.preview(h.input()); assert.equal(h.calls(), 0);
    const [one, two] = await Promise.all([h.service.start(consent(preview)), h.service.start(consent(preview))]);
    assert.equal(h.calls(), 1); assert.equal(one.id, two.id);
    h.release(proposal(h.repo.references(one.id)[0].id)); await settle(() => h.repo.get(one.id).status !== 'running');
    assert.equal(h.repo.get(one.id).opportunityIds.length, 1); assert.equal(h.base.listOpportunities().items[0].evidence.length, 1);
    await h.service.start(consent(preview)); assert.equal(h.calls(), 1);
});

test('cancel, source changes and invalid model output never write late or stale opportunities', async t => {
    const h = fixture(t); let preview = await h.service.preview(h.input()); let run = await h.service.start(consent(preview));
    h.service.cancel({ id: run.id, expectedRevision: run.revision }); h.release(proposal(h.repo.references(run.id)[0].id));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(h.repo.get(run.id).status, 'cancelled'); assert.equal(h.base.listOpportunities().items.length, 0);
    preview = await h.service.preview({ ...h.input(), requestId: 'new_confirm' }); run = await h.service.start(consent(preview));
    h.data.a = snapshot('来源已变化'); h.release(proposal(h.repo.references(run.id)[0].id)); await settle(() => h.repo.get(run.id).status === 'failed');
    assert.equal(h.repo.get(run.id).errorCode, 'SOURCE_CHANGED'); assert.equal(h.base.listOpportunities().items.length, 0);
    preview = await h.service.preview({ ...h.input(), requestId: 'new_version' }); run = await h.service.start(consent(preview));
    h.release({ made_up: true }); await settle(() => h.repo.get(run.id).status === 'failed');
    assert.equal(h.repo.get(run.id).errorCode, 'INVALID_OUTPUT'); assert.equal(h.calls(), 3);
});

test('captured AsyncLocalStorage space persists results to original space after UI switch without leaking same-ID sources', async t => {
    const h = fixture(t);
    const run = await h.context.run('a', async () => h.service.start(consent(await h.service.preview(h.input()))));
    const ref = h.repo.references(run.id)[0]; h.switch('b'); assert.deepEqual(h.repo.list(), []); assert.throws(() => h.repo.get(run.id), /当前空间/);
    h.release(proposal(ref.id)); await settle(() => h.context.run('a', () => h.repo.get(run.id).status !== 'running'));
    assert.deepEqual(h.repo.list(), []); assert.equal(h.base.listOpportunities().items.length, 0);
    h.switch('a'); const opportunity = h.base.getOpportunity(h.repo.get(run.id).opportunityIds[0]); assert.equal(h.base.getEvidence(opportunity.evidence[0].id).excerpt, '固定后会滑动');
});

test('disabled or changed model configuration blocks confirmation without falling back or consuming a call', async t => {
    const h = fixture(t); const run = await h.service.preview(h.input()); h.setConfigured(false);
    await assert.rejects(h.service.start(consent(run)), /模型配置已变化/); assert.equal(h.calls(), 0); assert.equal(h.repo.get(run.id).calls, 0);
    const disabled = await h.service.preview({ ...h.input(), requestId: 'disabled' }); assert.equal(disabled.model, null);
});

test('model adapter uses the configured wander route, passes no tools, forbids implicit retries and validates structured output', async () => {
    const settings: any = { ai_sources_json: [{ id: 'local', baseURL: 'http://127.0.0.1:12345/v1', model: 'synthetic', apiKey: '' }], ai_model_routes_json: { wander: { mode: 'custom', sourceId: 'local', model: 'synthetic' } } };
    let calls = 0; let request: any;
    const adapter = createConsumerResearchModel(() => settings, async input => { calls++; request = input; return JSON.stringify(proposal('allowed')); });
    const model = adapter.describe()!; assert.equal(model.host, '127.0.0.1'); assert.equal('apiKey' in model, false);
    const output: any = await adapter.analyze([], '合成测试', model, new AbortController().signal);
    assert.equal(output.insights.length, 1); assert.equal(request.model, 'synthetic'); assert.equal(request.allowJsonFallback, false); assert.equal(request.retryOnTimeout, false); assert.equal(request.streamPreview, false); assert.equal('tools' in request, false);
    settings.ai_model_routes_json.wander.mode = 'disabled'; assert.equal(adapter.describe(), null);
    await assert.rejects(adapter.analyze([], '', model, new AbortController().signal), /配置已变化/); assert.equal(calls, 1);
});
