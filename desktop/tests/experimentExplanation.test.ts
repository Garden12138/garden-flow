// pnpm --dir desktop exec node --test tests/experimentExplanation.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { initializeContentIntelligence } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics, createContentMetricsRepository } from '../electron/core/content-intelligence/metricsRepository.ts';
import { initializeContentExperiments, createContentExperimentsRepository } from '../electron/core/content-intelligence/experimentsRepository.ts';
import { initializeExperimentExplanations, recoverExperimentExplanations, deleteExperimentExplanationsSpace, createExperimentExplanationRepository } from '../electron/core/content-intelligence/explanationRepository.ts';
import { createExperimentExplanationService } from '../electron/core/content-intelligence/explanationService.ts';
import { createExperimentExplanationModel } from '../electron/core/content-intelligence/explanationModel.ts';
import { MetricCsvFields } from '../shared/contentExperiments.ts';
import type { ExplanationInput } from '../shared/experimentExplanation.ts';

const model = { sourceId: 'synthetic', name: 'local-fixture', host: '127.0.0.1', fingerprint: 'f'.repeat(64) };
const reply = (input: ExplanationInput, basisDigest: string) => ({ basisDigest, facts: input.arms.map(arm => arm.fact), comparison: input.comparison,
    considerations: ['合成观点，不是已验证效果'], suggestions: [{ kind: 'title', name: '标题提问', before: '待人工核对的原处理', after: '下一轮提问', rationale: '待验证的假设，不承诺效果', preserve: ['正文、素材、平台、窗口口径'] }] });
function fixture(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('default'), ('中文空间'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('untouched');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeContentExperiments(db);
    initializeExperimentExplanations(db); initializeExperimentExplanations(db);
    let space = 'default'; const current = () => space;
    const metrics = createContentMetricsRepository(db, current); const plans = createContentExperimentsRepository(db, current); const repo = createExperimentExplanationRepository(db, current);
    const links = [0, 1].map(index => metrics.recordPublication({ platform: 'xiaohongshu', accountAlias: 'synthetic-account', externalWorkId: 'synthetic-' + index, title: '合成历史稿', externalContentKind: 'image-set', origin: 'manual', status: 'declared-published', sourceNote: '合成来源并非真实业绩', observedAt: 1 }));
    const request = { requestId: 'plan', title: '合成实验', hypothesis: '标题提问可能改变观看，待验证', baseline: { publicationLinkId: links[0].id }, variant: { publicationLinkId: links[1].id },
        variable: { kind: 'title', name: '标题', baselineTreatment: '参数', variantTreatment: '问题' }, metric: { key: 'views', definition: '合成同窗口次数', unit: 'count' }, limitations: ['合成测试；原工程未知'], singleVariableAcknowledged: true };
    const unbound = plans.create(request, plans.externalArm(links[0].id), plans.externalArm(links[1].id));
    const rows = links.map((link, i) => [link.id, 'views', '合成同窗口次数', 'count', i ? 5 : 2, '2026-10-15', '2026-10-24', 'unknown', 'calendar', '', '', '小样本与未知推广', '合成来源', '2026-10-24T01:00:00Z'].join(','));
    const csv = { csv: MetricCsvFields.join(',') + '\n' + rows.join('\n'), mapping: Object.fromEntries(MetricCsvFields.map(key => [key, key])) };
    metrics.importCsv({ ...csv, requestId: 'metrics', previewDigest: metrics.preview(csv).digest, confirmed: true, reviseConflicts: false });
    const observations = links.map(link => metrics.observations().find(row => row.input.publicationLinkId === link.id)!);
    const experiment = plans.bind({ id: unbound.id, expectedRevision: 1, requestId: 'bind', observations: { baseline: { id: observations[0].id, revision: 1 }, variant: { id: observations[1].id, revision: 1 } } });
    const preview = { requestId: 'preview', experimentId: experiment.id, expectedRevision: experiment.revision };
    return { db, repo, plans, metrics, request, unbound, experiment, preview, switch: (value: string) => { space = value; } };
}
const start = (run: any) => ({ id: run.id, expectedRevision: run.revision, consent: true, modelFingerprint: run.model.fingerprint });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

test('preview freezes only selected observations and deterministic report; aliases, empty data, old tables and spaces remain safe', t => {
    const f = fixture(t); const run = f.repo.preview(f.preview, model);
    assert.equal(run.calls, 0); assert.equal(run.input.comparison.interpretation, 'insufficient'); assert.equal(run.input.comparison.relativeChange, null);
    assert.deepEqual(run.input.arms.map(arm => arm.fact.value), [2, 5]); assert.ok(run.input.arms.every(arm => !arm.engineeringVersionKnown));
    assert.ok(!JSON.stringify(run.input).includes('synthetic-account')); assert.ok(!('sourceNote' in run.input.arms[0].observation));
    assert.equal(f.repo.preview({ ...f.preview, requestId: 'alias' }, model).id, run.id);
    assert.throws(() => f.repo.preview({ ...f.preview, requestId: 'alias', expectedRevision: 9 }, model), /同一请求/);
    const empty = f.plans.create({ ...f.request, requestId: 'empty' }, f.experiment.baseline, f.experiment.variant);
    assert.throws(() => f.repo.preview({ ...f.preview, requestId: 'empty-preview', experimentId: empty.id, expectedRevision: 1 }, model), /两组观测/);
    f.switch('中文空间'); assert.throws(() => f.repo.get(run.id), /当前空间/); assert.throws(() => f.repo.list(f.experiment.id), /当前空间/);
    deleteExperimentExplanationsSpace(f.db, '中文空间'); f.switch('default'); assert.equal(f.repo.get(run.id).id, run.id);
    deleteExperimentExplanationsSpace(f.db, 'default'); assert.throws(() => f.repo.get(run.id)); assert.equal(f.db.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched');
});
test('double starts and completed replay perform one bounded model call; no consent or changed model cannot call', async t => {
    const f = fixture(t); let calls = 0;
    const service = createExperimentExplanationService(f.repo, { describe: () => model, analyze: async (input, digest) => { calls++; return reply(input, digest); } });
    const run = service.preview(f.preview);
    await assert.rejects(service.start({ ...start(run), consent: false }));
    await assert.rejects(service.start({ ...start(run), modelFingerprint: 'a'.repeat(64) }), /模型配置/); assert.equal(calls, 0);
    await Promise.all([service.start(start(run)), service.start(start(run))]); await flush();
    const done = service.get(run.id); assert.equal(done.status, 'succeeded'); assert.equal(done.calls, 1); assert.equal(calls, 1);
    assert.equal(done.proposal?.suggestions.length, 1); await service.start(start(run)); assert.equal(calls, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM ci_experiment_tasks').get()!.n, 0);
});
test('fabricated observation IDs, revisions, numbers and calculation claims reject the whole model result', t => {
    const f = fixture(t); let index = 0;
    for (const mutate of [
        (p: any) => { p.facts[0].id = 'invented'; }, (p: any) => { p.facts[0].revision++; },
        (p: any) => { p.facts[0].value = 999; }, (p: any) => { p.comparison.relativeChange = 1.5; },
        (p: any) => { p.comparison.interpretation = 'observational'; }, (p: any) => { p.basisDigest = 'a'.repeat(64); },
    ]) {
        const run = f.repo.preview({ ...f.preview, requestId: 'forgery-' + index++ }, model); const active = f.repo.claim(start(run)).run;
        const output = structuredClone(reply(run.input, run.basisDigest)); mutate(output);
        assert.throws(() => f.repo.finish(run.id, active.revision, output), /已拒绝结果/);
        f.repo.fail(run.id, active.revision, 'INVALID_OUTPUT'); assert.equal(f.repo.get(run.id).proposal, undefined);
    }
});
test('cancellation discards late output and restart interrupts without retry; changed basis cannot send or attach results', async t => {
    const f = fixture(t); let resolve: (value: unknown) => void = () => {}; let calls = 0;
    const service = createExperimentExplanationService(f.repo, { describe: () => model, analyze: () => { calls++; return new Promise(done => { resolve = done; }); } });
    const run = service.preview(f.preview); const active = await service.start(start(run));
    service.cancel({ id: run.id, expectedRevision: active.revision }); resolve(reply(run.input, run.basisDigest)); await flush();
    assert.equal(service.get(run.id).status, 'cancelled'); assert.equal(service.get(run.id).proposal, undefined); await service.start(start(run)); assert.equal(calls, 1);
    const second = service.preview({ ...f.preview, requestId: 'second' }); await service.start(start(second));
    recoverExperimentExplanations(f.db); resolve(reply(second.input, second.basisDigest)); await flush();
    assert.equal(service.get(second.id).status, 'interrupted'); await service.start(start(second)); assert.equal(calls, 2);
    const third = service.preview({ ...f.preview, requestId: 'third' }); await service.start(start(third));
    f.plans.transition({ id: f.experiment.id, expectedRevision: f.experiment.revision, requestId: 'archive', to: 'archived' });
    resolve(reply(third.input, third.basisDigest)); await flush(); assert.equal(service.get(third.id).errorCode, 'SOURCE_CHANGED');
    const queued = f.repo.get(third.id); assert.equal(queued.proposal, undefined);
});
test('timeouts and late space callbacks expose no provider contents and never retry', async t => {
    const f = fixture(t); let calls = 0;
    const timed = createExperimentExplanationService(f.repo, { describe: () => model, analyze: async (_input, _digest, _model, signal) => {
        calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private raw provider content'))));
    } }, 5);
    const run = timed.preview(f.preview); await timed.start(start(run)); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(timed.get(run.id).errorCode, 'MODEL_FAILED'); assert.ok(!JSON.stringify(timed.get(run.id)).includes('private raw'));
    await timed.start(start(run)); assert.equal(calls, 1);
    let resolve: (value: unknown) => void = () => {};
    const late = createExperimentExplanationService(f.repo, { describe: () => model, analyze: () => new Promise(done => { resolve = done; }) });
    const next = late.preview({ ...f.preview, requestId: 'late' }); await late.start(start(next)); f.switch('中文空间');
    resolve(reply(next.input, next.basisDigest)); await flush(); assert.throws(() => late.get(next.id), /当前空间/);
    f.switch('default'); assert.equal(late.get(next.id).proposal, undefined); recoverExperimentExplanations(f.db); assert.equal(late.get(next.id).status, 'interrupted');
});
test('missing model, changed data before confirmation, invalid output and an uncooperative late timeout fail safely', async t => {
    const f = fixture(t); let calls = 0;
    const absent = createExperimentExplanationService(f.repo, { describe: () => null, analyze: async () => { calls++; } });
    const missing = absent.preview(f.preview); assert.equal(missing.model, null);
    await assert.rejects(absent.start({ id: missing.id, expectedRevision: 1, consent: true, modelFingerprint: model.fingerprint })); assert.equal(calls, 0);
    const invalid = createExperimentExplanationService(f.repo, { describe: () => model, analyze: async () => { calls++; return { invented: 10 }; } });
    const run = invalid.preview({ ...f.preview, requestId: 'invalid' }); await invalid.start(start(run)); await flush(); assert.equal(invalid.get(run.id).errorCode, 'INVALID_OUTPUT');
    let finish: (value: unknown) => void = () => {};
    const late = createExperimentExplanationService(f.repo, { describe: () => model, analyze: () => new Promise(resolve => { finish = resolve; }) }, 5);
    const second = late.preview({ ...f.preview, requestId: 'timeout' }); await late.start(start(second)); await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(late.get(second.id).status, 'failed'); finish(reply(second.input, second.basisDigest)); await flush(); assert.equal(late.get(second.id).proposal, undefined);
    const queued = invalid.preview({ ...f.preview, requestId: 'changed' });
    f.plans.transition({ id: f.experiment.id, expectedRevision: f.experiment.revision, requestId: 'archive', to: 'archived' });
    await assert.rejects(invalid.start(start(queued)), /已变化/); assert.equal(calls, 1); assert.equal(invalid.get(queued.id).calls, 0);
});
test('model adapter reuses configured Wander transport with no tool, retry, repair or media capability', async t => {
    const f = fixture(t); const run = f.repo.preview(f.preview, model); let calls = 0; let sent: any;
    const settings: any = { ai_sources_json: [{ id: 'local', baseURL: 'http://127.0.0.1:12345/v1', model: 'synthetic', apiKey: '' }], ai_model_routes_json: { wander: { mode: 'custom', sourceId: 'local', model: 'synthetic' } } };
    const adapter = createExperimentExplanationModel(() => settings, async input => { sent = input; calls++; return JSON.stringify(reply(run.input, run.basisDigest)); });
    const route = adapter.describe()!; assert.equal(route.host, '127.0.0.1');
    await adapter.analyze(run.input, run.basisDigest, route, new AbortController().signal);
    assert.equal(calls, 1); assert.equal(sent.maxTokens, 4000); assert.equal(sent.allowJsonFallback, false); assert.equal(sent.retryOnTimeout, false); assert.equal(sent.tools, undefined);
    settings.ai_sources_json[0].baseURL = 'http://127.0.0.1:12346/v1';
    await assert.rejects(adapter.analyze(run.input, run.basisDigest, route, new AbortController().signal), /模型配置/); assert.equal(calls, 1);
});
test('an existing file database reopens, migrates repeatedly and recovers a persisted running explanation without another claim', t => {
    const f = fixture(t); const run = f.repo.preview(f.preview, model); f.repo.claim(start(run));
    const root = mkdtempSync(path.join(tmpdir(), 'gardenflow-explanation-migration-')); const file = path.join(root, 'legacy.db');
    f.db.exec("VACUUM INTO '" + file.replaceAll("'", "''") + "'");
    const reopened = new DatabaseSync(file);
    try {
        initializeExperimentExplanations(reopened); initializeExperimentExplanations(reopened); recoverExperimentExplanations(reopened); recoverExperimentExplanations(reopened);
        const repo = createExperimentExplanationRepository(reopened, () => 'default'); const restored = repo.get(run.id);
        assert.equal(restored.status, 'interrupted'); assert.equal(restored.calls, 1); assert.equal(restored.proposal, undefined); assert.equal(repo.claim(start(run)).claimed, false);
        assert.equal(reopened.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched'); assert.equal(reopened.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
        assert.equal(repo.list(f.experiment.id).length, 1);
    } finally { reopened.close(); rmSync(root, { recursive: true, force: true }); }
});
