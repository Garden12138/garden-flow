// Run: pnpm --dir desktop exec node --test tests/contentExperimentService.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeContentIntelligence } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics } from '../electron/core/content-intelligence/metricsRepository.ts';
import { initializeContentExperiments, createContentExperimentsRepository, recoverContentExperimentTasks } from '../electron/core/content-intelligence/experimentsRepository.ts';
import { createContentExperimentsService } from '../electron/core/content-intelligence/experimentsService.ts';
import { productVideoHarness } from './helpers/productVideoHarness.ts';

const reference = (work: any) => ({ workspaceId: work.workspaceId, revision: work.revision, draftEpoch: work.draftEpoch, contentVersion: work.contentVersion });
async function fixture(t: any) {
    const h = await productVideoHarness({ platformVersions: true, productImageSets: true, dreamStory: true, creationWorkspaces: true });
    const db = new DatabaseSync(':memory:'); t.after(() => { db.close(); h.close(); });
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('default'), ('中文空间');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeContentExperiments(db);
    const repo = createContentExperimentsRepository(db, () => h.state.spaceId);
    let copies = 0;
    const adapter = { inspect: h.api.inspectCreationWorkspace,
        fork: async (id: string, input: unknown, guard: unknown) => { copies++; return h.api.forkCreationWorkspace(id, input, guard); },
        idForRequest: h.api.creationWorkspaceIdForRequest };
    const service = createContentExperimentsService(repo, adapter);
    const first = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image' });
    const second = await h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image' });
    const [baseline, variant] = await Promise.all([service.inspect(first.id), service.inspect(second.id)]);
    const request = { requestId: 'plan', title: '合成恢复验收', hypothesis: '同一内容仅修改封面文案可能影响观看，尚未证实',
        baseline: reference(baseline), variant: reference(variant), variable: { kind: 'cover', name: '封面文案', baselineTreatment: '参数描述', variantTreatment: '使用场景' },
        metric: { key: 'views', definition: '合成同窗口观看次数', unit: 'count' }, limitations: ['合成恢复测试，没有真实业绩'], singleVariableAcknowledged: true };
    const experiment = await service.create(request);
    const taskRequest = { requestId: 'next', experimentId: experiment.id, expectedRevision: experiment.revision, sourceRole: 'baseline', source: reference(baseline),
        change: { kind: 'cover', name: '封面文案', before: '参数描述', after: '使用场景', rationale: '下一轮待验证', preserve: ['正文、素材、平台和安排保持原计划'] } };
    const task = await service.createTask(taskRequest);
    return { h, db, repo, adapter, service, first, second, request, experiment, taskRequest, task, copies: () => copies };
}
test('confirmed tasks reuse the real guarded note copy; concurrent starts and later retries never recopy or overwrite edits', async t => {
    const f = await fixture(t); const start = { id: f.task.id, expectedRevision: f.task.revision, confirmed: true };
    await assert.rejects(f.service.startTask({ ...start, confirmed: false })); assert.equal(f.copies(), 0);
    await Promise.all([f.service.startTask(start), f.service.startTask(start)]);
    const done = f.repo.task(f.task.id); assert.equal(done.state, 'ready_to_edit'); assert.equal(f.copies(), 1);
    const copy = await f.h.api.readCreationWorkspace(done.workspaceId); assert.equal(copy.sourceId, f.first.id);
    const note = await f.h.api.getXhsNoteProject(copy.native.path);
    await f.h.api.saveXhsNoteProject({ path: note.relativePath, noteType: note.document.noteType, expectedRevision: note.version, document: { ...note.document, body: '人工编辑的下一轮草稿' } });
    const source = await f.h.api.getXhsNoteProject(f.first.native.path);
    await f.h.api.saveXhsNoteProject({ path: source.relativePath, noteType: source.document.noteType, expectedRevision: source.version, document: { ...source.document, body: '来源后续编辑' } });
    f.h.restart(); assert.equal((await f.service.startTask(start)).workspaceId, done.workspaceId);
    assert.equal((await f.service.createTask(f.taskRequest)).workspaceId, done.workspaceId); assert.equal((await f.service.create(f.request)).id, f.experiment.id);
    assert.equal((await f.h.api.getXhsNoteProject(copy.native.path)).document.body, '人工编辑的下一轮草稿'); assert.equal(f.copies(), 1);
    assert.equal((await f.h.api.listCreationWorkspaceSummaries()).length, 3); assert.equal(f.h.state.imageCalls + f.h.state.ttsCalls, 0);
});
test('native-only source edits invalidate an unstarted task without creating any copy', async t => {
    const f = await fixture(t); const source = await f.h.api.getXhsNoteProject(f.first.native.path);
    await f.h.api.saveXhsNoteProject({ path: source.relativePath, noteType: source.document.noteType, expectedRevision: source.version, document: { ...source.document, body: '新原生版本' } });
    assert.equal((await f.h.api.readCreationWorkspace(f.first.id)).revision, f.first.revision);
    const result = await f.service.startTask({ id: f.task.id, expectedRevision: 1, confirmed: true });
    assert.equal(result.state, 'needs_review'); assert.equal(result.errorCode, 'SOURCE_CHANGED'); assert.equal(f.copies(), 0);
    await assert.rejects(f.service.create({ ...f.request, requestId: 'stale-preview' }), /版本已变化/);
    assert.equal((await f.h.api.listCreationWorkspaceSummaries()).length, 2);
});
test('a lost association after a completed filesystem copy can be explicitly recovered without another copy or overwrite', async t => {
    const f = await fixture(t); let fail = true;
    const broken = createContentExperimentsService({ ...f.repo, finishTask: (...args: Parameters<typeof f.repo.finishTask>) => { if (fail) { fail = false; throw new Error('synthetic DB response loss'); } return f.repo.finishTask(...args); } }, f.adapter);
    const start = { id: f.task.id, expectedRevision: 1, confirmed: true }; const failed = await broken.startTask(start);
    assert.equal(failed.state, 'needs_review'); assert.equal(failed.errorCode, 'COPY_FAILED'); assert.equal(f.copies(), 1);
    assert.equal((await f.service.startTask(start)).state, 'needs_review'); recoverContentExperimentTasks(f.db);
    const target = await f.h.api.readCreationWorkspace(f.task.targetWorkspaceId); const note = await f.h.api.getXhsNoteProject(target.native.path);
    await f.h.api.saveXhsNoteProject({ path: note.relativePath, noteType: note.document.noteType, expectedRevision: note.version, document: { ...note.document, body: '保存关联前已人工修改' } });
    const recovered = await f.service.reviewTask({ id: failed.id, expectedRevision: failed.revision, workspaceId: target.id, confirmed: true });
    assert.equal(recovered.state, 'ready_to_edit'); assert.equal(recovered.completionOrigin, 'guarded-copy'); assert.equal(f.copies(), 1);
    assert.equal((await f.h.api.getXhsNoteProject(target.native.path)).document.body, '保存关联前已人工修改');
});
test('restart and partial-copy review require explicit confirmation; foreign/original works cannot be used as recovery targets', async t => {
    const f = await fixture(t); f.repo.claimTask({ id: f.task.id, expectedRevision: 1, confirmed: true }); recoverContentExperimentTasks(f.db);
    const interrupted = f.repo.task(f.task.id); assert.equal(interrupted.state, 'needs_review');
    const partial = await f.h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', requestId: interrupted.creationRequestId });
    const review = { id: interrupted.id, expectedRevision: interrupted.revision, workspaceId: partial.id, confirmed: true };
    await assert.rejects(f.service.reviewTask({ ...review, confirmed: false }));
    await assert.rejects(f.service.reviewTask({ ...review, workspaceId: f.first.id }), /不一致/);
    const foreign = createContentExperimentsService(f.repo, { ...f.adapter, inspect: async id => ({ ...await f.adapter.inspect(id), workspace: { ...partial, spaceId: '中文空间' } }) });
    await assert.rejects(foreign.reviewTask(review), /空间/);
    const manual = await f.service.reviewTask(review); assert.equal(manual.completionOrigin, 'manual-review'); assert.equal(f.copies(), 0);
    const cancelled = f.service.cancelTask({ id: manual.id, expectedRevision: manual.revision }); assert.equal(cancelled.workspaceId, partial.id);
    assert.ok(await f.h.api.readCreationWorkspace(partial.id));
});
test('an actual guarded fork rejects edits that occur after task claim and preserves the two original works', async t => {
    const f = await fixture(t);
    const service = createContentExperimentsService(f.repo, { ...f.adapter, fork: async (id, selection, guard) => {
        const source = await f.h.api.getXhsNoteProject(f.first.native.path);
        await f.h.api.saveXhsNoteProject({ path: source.relativePath, noteType: source.document.noteType, expectedRevision: source.version, document: { ...source.document, body: '确认后并发编辑' } });
        return f.adapter.fork(id, selection, guard);
    } });
    const result = await service.startTask({ id: f.task.id, expectedRevision: 1, confirmed: true });
    assert.equal(result.state, 'needs_review'); assert.equal(result.errorCode, 'COPY_FAILED');
    assert.equal((await f.h.api.listCreationWorkspaceSummaries()).length, 2); assert.equal(f.h.state.imageCalls + f.h.state.ttsCalls, 0);
});
test('all service reads and task actions reject a different space, including late preview callbacks', async t => {
    const f = await fixture(t); f.h.state.spaceId = '中文空间';
    await assert.rejects(f.service.startTask({ id: f.task.id, expectedRevision: 1, confirmed: true }), /当前空间/);
    await assert.rejects(f.service.createTask(f.taskRequest), /当前空间/); assert.deepEqual(f.service.list(), []); assert.equal(f.copies(), 0);
    f.h.state.spaceId = 'default';
    const service = createContentExperimentsService(f.repo, { ...f.adapter, inspect: async id => { const result = await f.adapter.inspect(id); f.h.state.spaceId = '中文空间'; return result; } });
    await assert.rejects(service.inspect(f.first.id), /空间已变化/); assert.deepEqual(f.service.list(), []);
});
