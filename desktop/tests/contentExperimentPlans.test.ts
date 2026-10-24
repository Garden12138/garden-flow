import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeContentIntelligence } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics, createContentMetricsRepository } from '../electron/core/content-intelligence/metricsRepository.ts';
import { initializeContentExperiments, recoverContentExperimentTasks, deleteContentExperimentsSpace, createContentExperimentsRepository } from '../electron/core/content-intelligence/experimentsRepository.ts';
import { CreateExperimentSchema, ExperimentTaskSchema, ExperimentWorkSchema, type ExperimentWork } from '../shared/contentExperimentPlans.ts';
import { MetricCsvFields } from '../shared/contentExperiments.ts';

const baseline: ExperimentWork = { workspaceId: 'control', revision: 'rev-one', draftEpoch: 0, contentVersion: 'a'.repeat(64), nativeRevision: 'native-one', title: '合成对照工程', platform: 'xiaohongshu', capability: 'note-image' };
const variant: ExperimentWork = { ...baseline, workspaceId: 'variant', contentVersion: 'b'.repeat(64), title: '合成变体工程' };
const reference = (work: ExperimentWork) => ({ workspaceId: work.workspaceId, revision: work.revision, draftEpoch: work.draftEpoch, contentVersion: work.contentVersion });
const metric = { key: 'likes', definition: '合成窗口新增点赞次数', unit: 'count' as const };
const plan = { requestId: 'plan-one', title: '合成单变量计划', hypothesis: '开头先展示实拍，可能影响窗口内点赞行为，尚未证实', baseline: reference(baseline), variant: reference(variant),
    variable: { kind: 'opening', name: '开头表达', baselineTreatment: '先讲参数', variantTreatment: '先展示实拍' }, metric, limitations: ['合成测试数据，不是真实业务效果'], singleVariableAcknowledged: true };
const change = { kind: 'title', name: '标题表达', before: '原有标题', after: '具体场景标题', rationale: '待验证的新假设，不声称因果', preserve: ['正文、素材、平台和发布安排保持原计划'] };
const target = 'creation_' + 'c'.repeat(40);
function fixture(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'), ('中文空间'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('unchanged');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeContentExperiments(db); initializeContentExperiments(db);
    let space = 'a'; const repo = createContentExperimentsRepository(db, () => space); const metrics = createContentMetricsRepository(db, () => space);
    return { db, repo, metrics, switch: (value: string) => { space = value; } };
}
function observations(metrics: ReturnType<typeof createContentMetricsRepository>, value = 100, requestId = 'observations', revise = false, observedAt = '2026-10-02T00:00:00Z') {
    const links = [baseline, variant].map((work, index) => metrics.recordPublication({ workspaceId: work.workspaceId, workspaceRevision: work.revision, nativeRevision: work.nativeRevision, platform: work.platform, accountAlias: 'synthetic-same-account', externalWorkId: String(index + 1), origin: 'manual', status: 'declared-published', sourceNote: '合成声明，不是真实发布', observedAt: 1 }));
    const rows = links.map((link, index) => ({ publicationLinkId: link.id, metric: metric.key, definition: metric.definition, unit: metric.unit, value: String(index ? 150 : value),
        start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z', timeZone: 'UTC', alignment: 'calendar', ageStartHours: '', ageEndHours: '', confounders: '未知推广因素', sourceNote: '合成观测，不是真实效果', observedAt }));
    const csv = MetricCsvFields.join(',') + '\n' + rows.map(row => MetricCsvFields.map(key => row[key]).join(',')).join('\n');
    const mapping = Object.fromEntries(MetricCsvFields.map(key => [key, key])); const payload = { csv, mapping }; const preview = metrics.preview(payload);
    metrics.importCsv({ ...payload, requestId, previewDigest: preview.digest, confirmed: true, reviseConflicts: revise });
    return Object.fromEntries(links.map((link, index) => { const value = metrics.observations().find(item => item.input.publicationLinkId === link.id)!; return [index ? 'variant' : 'baseline', { id: value.id, revision: value.revision }]; })) as { baseline: { id: string; revision: number }; variant: { id: string; revision: number } };
}
const taskRequest = (experiment: any) => ({ requestId: 'task-one', experimentId: experiment.id, expectedRevision: experiment.revision, sourceRole: 'baseline', source: reference(baseline), change });

test('strict experiment schemas preserve explicit single-variable intent and reject malformed or unsupported bindings', () => {
    assert.equal(CreateExperimentSchema.safeParse(plan).success, true);
    for (const value of [{ ...plan, singleVariableAcknowledged: false }, { ...plan, spaceId: 'other' }, { ...plan, baseline: { ...plan.baseline, contentVersion: 'invented' } }, { ...plan, variant: plan.baseline }, { ...plan, variable: { ...plan.variable, variantTreatment: plan.variable.baselineTreatment } }]) assert.equal(CreateExperimentSchema.safeParse(value).success, false);
    assert.equal(ExperimentWorkSchema.safeParse({ ...baseline, platform: 'tiktok' }).success, false);
    assert.equal(ExperimentTaskSchema.safeParse({ state: 'ready_to_edit', workspaceId: undefined }).success, false);
});
test('plan create/transition requests are idempotent and retain original native/work versions and legacy data', t => {
    const h = fixture(t); const created = h.repo.create(plan, baseline, variant);
    assert.equal(created.status, 'draft'); assert.equal(created.baseline.contentVersion, baseline.contentVersion); assert.equal(h.repo.detail(created.id).comparison, null);
    assert.equal(h.repo.create(plan, baseline, variant).id, created.id);
    assert.throws(() => h.repo.create({ ...plan, hypothesis: 'changed' }, baseline, variant), /同一请求/);
    assert.throws(() => h.repo.create({ ...plan, requestId: 'wrong' }, { ...baseline, revision: 'changed' }, variant), /版本已变化/);
    assert.throws(() => h.repo.create({ ...plan, requestId: 'format' }, baseline, { ...variant, capability: 'product-image-set' }), /内容形式/);
    const request = { id: created.id, requestId: 'archive', expectedRevision: created.revision, to: 'archived' };
    const archived = h.repo.transition(request); assert.equal(archived.status, 'archived'); assert.equal(h.repo.transition(request).revision, archived.revision);
    assert.equal(h.repo.previousExperiment(plan)?.status, 'archived'); assert.equal(h.repo.create(plan, null, null).status, 'archived');
    assert.throws(() => h.repo.transition({ id: created.id, requestId: 'stale', expectedRevision: 1, to: 'collecting' }), /变化/);
    assert.equal(h.repo.list().length, 1); assert.equal(h.db.prepare('SELECT id FROM legacy_work').get()!.id, 'unchanged');
});
test('bound observations must belong to the correct arms/definition; immutable revisions keep an auditable comparison', t => {
    const h = fixture(t); const created = h.repo.create(plan, baseline, variant); const refs = observations(h.metrics);
    assert.throws(() => h.repo.bind({ id: created.id, requestId: 'reverse', expectedRevision: 1, observations: { baseline: refs.variant, variant: refs.baseline } }), /对应实验工程/);
    const bound = h.repo.bind({ id: created.id, requestId: 'bind', expectedRevision: 1, observations: refs });
    assert.equal(bound.status, 'collecting'); assert.equal(h.repo.detail(bound.id).comparison?.relativeChange, .5);
    const revised = observations(h.metrics, 120, 'revised-observations', true);
    const historical = h.repo.detail(bound.id); assert.equal(historical.comparison?.relativeChange, .5); assert.equal(historical.observationRevisionsChanged, true);
    assert.throws(() => h.repo.bind({ id: bound.id, requestId: 'old-ref', expectedRevision: bound.revision, observations: refs }), /观测已修订/);
    const refreshed = h.repo.bind({ id: bound.id, requestId: 'bind-new', expectedRevision: bound.revision, observations: revised });
    assert.equal(h.repo.detail(refreshed.id).comparison?.relativeChange, .25); assert.equal(h.repo.detail(refreshed.id).observationRevisionsChanged, false);
    const otherMetric = h.repo.create({ ...plan, requestId: 'other-metric', metric: { ...metric, definition: '不同指标口径' } }, baseline, variant);
    assert.throws(() => h.repo.bind({ id: otherMetric.id, requestId: 'metric-mismatch', expectedRevision: 1, observations: revised }), /口径/);
});
test('unfinished windows remain insufficient even after binding or explicitly closing an experiment', t => {
    const h = fixture(t); const created = h.repo.create(plan, baseline, variant); const refs = observations(h.metrics, 100, 'partial-window', false, '2026-10-01T12:00:00Z');
    const bound = h.repo.bind({ id: created.id, requestId: 'bind', expectedRevision: 1, observations: refs });
    assert.equal(h.repo.detail(bound.id).comparison?.interpretation, 'insufficient'); assert.equal(h.repo.detail(bound.id).comparison?.relativeChange, null);
    h.repo.transition({ id: bound.id, requestId: 'close-insufficient', expectedRevision: bound.revision, to: 'completed' });
    assert.equal(h.repo.detail(bound.id).comparison?.interpretation, 'insufficient');
});
test('external experiment arms freeze actual post identity without an engineering fiction and require an acknowledged independent task source', t => {
    const h = fixture(t);
    const links = ['image-set', 'video'].map((externalContentKind, index) => h.metrics.recordPublication({ platform: 'xiaohongshu', accountAlias: 'synthetic-owner', externalWorkId: 'external-' + index,
        title: '合成历史作品', externalContentKind: externalContentKind as 'video' | 'image-set', origin: 'manual', status: 'declared-published', sourceNote: '合成历史声明，原工程未关联', observedAt: 1 }));
    const request = { ...plan, requestId: 'external-plan', baseline: { publicationLinkId: links[0].id }, variant: { publicationLinkId: links[1].id }, variable: { ...plan.variable, kind: 'format' } };
    const [a, b] = links.map(link => h.repo.externalArm(link.id));
    assert.throws(() => h.repo.create({ ...request, variable: plan.variable }, a, b), /内容形式不同/);
    assert.throws(() => h.repo.create(request, { ...a, title: 'forged metadata' }, b), /来源不一致/);
    const experiment = h.repo.create(request, a, b); assert.equal(experiment.baseline.engineering, 'unlinked'); assert.equal(experiment.baseline.workspaceId, undefined);
    assert.equal(h.repo.create(request, null, null).id, experiment.id);
    const rows = links.map((link, index) => [link.id, metric.key, metric.definition, metric.unit, index ? 5 : 2, '2026-10-15', '2026-10-24', 'unknown', 'calendar', '', '', '不同内容形式，未知推广', '合成日期观测', '2026-10-24T01:00:00Z'].join(','));
    const payload = { csv: MetricCsvFields.join(',') + '\n' + rows.join('\n'), mapping: Object.fromEntries(MetricCsvFields.map(key => [key, key])) };
    const preview = h.metrics.preview(payload); h.metrics.importCsv({ ...payload, requestId: 'external-observations', previewDigest: preview.digest, confirmed: true, reviseConflicts: false });
    const observations = links.map(link => h.metrics.observations().find(value => value.input.publicationLinkId === link.id)!);
    const refs = { baseline: { id: observations[0].id, revision: 1 }, variant: { id: observations[1].id, revision: 1 } };
    assert.throws(() => h.repo.bind({ id: experiment.id, requestId: 'reversed-external', expectedRevision: 1, observations: { baseline: refs.variant, variant: refs.baseline } }), /历史作品/);
    const bound = h.repo.bind({ id: experiment.id, requestId: 'external-bind', expectedRevision: 1, observations: refs });
    const report = h.repo.detail(bound.id).comparison!; assert.equal(report.relativeChange, null); assert.equal(report.interpretation, 'insufficient'); assert.ok(report.reasons.some(value => value.includes('对应证明')));
    const taskInput = { ...taskRequest(bound), requestId: 'external-next' };
    assert.throws(() => h.repo.createTask(taskInput, baseline, target), /另选起点/);
    const task = h.repo.createTask({ ...taskInput, differentSourceAcknowledged: true }, baseline, target);
    assert.equal(task.basis.sourceDiffersFromArm, true); assert.equal(task.differentSourceAcknowledged, true); assert.equal(task.basis.observations?.baseline.id, refs.baseline.id);
    assert.equal(ExperimentTaskSchema.safeParse({ ...task, differentSourceAcknowledged: undefined }).success, false);
    assert.equal(h.metrics.publication(links[0].id).workspaceId, undefined);
    h.switch('中文空间'); assert.throws(() => h.repo.externalArm(links[0].id), /当前空间/);
});
test('native-only edits cannot reuse historical publication metrics; unknown versions and different formats remain insufficient', t => {
    const h = fixture(t); const refs = observations(h.metrics);
    const updated = { ...baseline, nativeRevision: 'native-two', contentVersion: 'd'.repeat(64) };
    const changed = h.repo.create({ ...plan, baseline: reference(updated) }, updated, variant);
    assert.throws(() => h.repo.bind({ id: changed.id, requestId: 'old-content', expectedRevision: 1, observations: refs }), /工程版本不一致/);
    const oldWorkspace = { ...baseline, revision: 'later-workspace' };
    const differentWorkspace = h.repo.create({ ...plan, requestId: 'workspace-changed', baseline: reference(oldWorkspace) }, oldWorkspace, variant);
    assert.throws(() => h.repo.bind({ id: differentWorkspace.id, requestId: 'old-workspace', expectedRevision: 1, observations: refs }), /工程版本不一致/);
    const unknown = { ...baseline, nativeRevision: undefined };
    const legacy = h.repo.create({ ...plan, requestId: 'legacy-native' }, unknown, variant);
    h.repo.bind({ id: legacy.id, requestId: 'legacy-bind', expectedRevision: 1, observations: refs });
    assert.equal(h.repo.detail(legacy.id).comparison?.interpretation, 'insufficient'); assert.equal(h.repo.detail(legacy.id).comparison?.difference, null);
    const otherFormat = { ...variant, capability: 'note-video' as const };
    const format = h.repo.create({ ...plan, requestId: 'format-explicit', variable: { ...plan.variable, kind: 'format' } }, baseline, otherFormat);
    h.repo.bind({ id: format.id, requestId: 'format-bind', expectedRevision: 1, observations: refs });
    assert.ok(h.repo.detail(format.id).comparison?.reasons.some(value => value.includes('内容形式不同')));
    assert.equal(h.repo.detail(format.id).comparison?.relativeChange, null);
});
test('single-variable tasks freeze their basis, claim once, recover interruption without recopying and keep completed work links', t => {
    const h = fixture(t); let experiment = h.repo.create(plan, baseline, variant); const refs = observations(h.metrics);
    experiment = h.repo.bind({ id: experiment.id, requestId: 'bind', expectedRevision: 1, observations: refs });
    const request = taskRequest(experiment); const created = h.repo.createTask(request, baseline, target);
    assert.equal(created.state, 'ready'); assert.equal(created.basis.observations?.baseline.revision, 1); assert.equal(created.creationRequestId, h.repo.taskIdentity(request.requestId).creationRequestId);
    assert.throws(() => h.repo.createTask({ ...request, change: { ...change, after: 'changed' } }, baseline, target), /同一请求/);
    assert.throws(() => h.repo.claimTask({ id: created.id, expectedRevision: 1, confirmed: false }));
    const claim = h.repo.claimTask({ id: created.id, expectedRevision: 1, confirmed: true }); assert.equal(claim.claimed, true);
    assert.equal(h.repo.claimTask({ id: created.id, expectedRevision: 1, confirmed: true }).claimed, false);
    assert.throws(() => h.repo.cancelTask({ id: created.id, expectedRevision: claim.task.revision }), /正在复制/);
    recoverContentExperimentTasks(h.db); initializeContentExperiments(h.db); recoverContentExperimentTasks(h.db);
    const interrupted = h.repo.task(created.id); assert.equal(interrupted.state, 'needs_review'); assert.equal(interrupted.errorCode, 'INTERRUPTED'); assert.equal(interrupted.revision, 3);
    assert.equal(h.repo.claimTask({ id: created.id, expectedRevision: interrupted.revision, confirmed: true }).claimed, false);
    assert.throws(() => h.repo.finishTask(created.id, interrupted.revision, 'other-target'), /关联不一致/);
    const done = h.repo.finishTask(created.id, interrupted.revision, target); assert.equal(done.state, 'ready_to_edit');
    assert.equal(h.repo.previousTask(request)?.workspaceId, target); assert.equal(h.repo.createTask(request, null, target).workspaceId, target);
    assert.equal(h.repo.tasks(undefined, target).length, 1); assert.equal(h.repo.tasks(undefined, baseline.workspaceId).length, 1);
    assert.equal(h.repo.markReview(done.id, claim.task.revision, 'COPY_FAILED').state, 'ready_to_edit');
    const cancelled = h.repo.cancelTask({ id: done.id, expectedRevision: done.revision }); assert.equal(cancelled.workspaceId, target); assert.equal(cancelled.state, 'cancelled');
    assert.equal(h.repo.task(created.id).basis.hypothesis, plan.hypothesis); assert.equal(h.repo.tasks(experiment.id).length, 1);
});
test('all experiment/task reads, mutations and cleanup stay in their space, including Chinese IDs', t => {
    const h = fixture(t); const first = h.repo.create(plan, baseline, variant); const firstTask = h.repo.createTask(taskRequest(first), baseline, target);
    h.switch('中文空间'); assert.equal(h.repo.list().length, 0); assert.equal(h.repo.tasks().length, 0);
    assert.throws(() => h.repo.experiment(first.id), /当前空间/); assert.throws(() => h.repo.task(firstTask.id), /当前空间/);
    assert.throws(() => h.repo.claimTask({ id: firstTask.id, expectedRevision: 1, confirmed: true }), /当前空间/);
    const own = h.repo.create(plan, baseline, variant); const ownTask = h.repo.createTask(taskRequest(own), baseline, target);
    assert.notEqual(firstTask.id, ownTask.id); deleteContentExperimentsSpace(h.db, 'a'); assert.equal(h.repo.task(ownTask.id).spaceId, '中文空间');
    h.switch('missing'); assert.throws(() => h.repo.list(), /空间不存在/);
});
test('disk migration/restart preserves old records and interrupted task scope without executing any work', t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gardenflow-experiments-')); let db = new DatabaseSync(path.join(directory, 'legacy.db'));
    t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('old');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeContentExperiments(db);
    let repo = createContentExperimentsRepository(db, () => 'a'); const created = repo.create(plan, baseline, variant); const task = repo.createTask(taskRequest(created), baseline, target);
    repo.claimTask({ id: task.id, expectedRevision: 1, confirmed: true }); db.close(); db = new DatabaseSync(path.join(directory, 'legacy.db'));
    initializeContentExperiments(db); recoverContentExperimentTasks(db); repo = createContentExperimentsRepository(db, () => 'a');
    assert.equal(repo.task(task.id).state, 'needs_review'); assert.equal(repo.experiment(created.id).baseline.contentVersion, baseline.contentVersion);
    assert.equal(db.prepare('SELECT id FROM legacy_work').get()!.id, 'old'); assert.equal(repo.tasks().length, 1);
});
