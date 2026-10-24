import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CiId } from '../../../shared/contentIntelligence.ts';
import {
    ContentExperimentSchema, CreateExperimentSchema, ExperimentWorkSchema, BindExperimentObservationsSchema,
    TransitionExperimentSchema, CreateExperimentTaskSchema, ExperimentTaskSchema, StartExperimentTaskSchema, CancelExperimentTaskSchema,
    type ContentExperiment, type ExperimentWork, type ExperimentTask, type ContentExperimentDetail,
} from '../../../shared/contentExperimentPlans.ts';
import { ciDigest, ciTransaction, type CiDatabase } from './repository.ts';
import { createContentMetricsRepository } from './metricsRepository.ts';
import { compareMetricObservations } from './metricsDomain.ts';

export function initializeContentExperiments(db: CiDatabase): void {
    ciTransaction(db, () => db.exec(`
        CREATE TABLE IF NOT EXISTS ci_experiments (
            space_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
            document_json TEXT NOT NULL, PRIMARY KEY(space_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_experiment_status ON ci_experiments(space_id, status);
        CREATE TABLE IF NOT EXISTS ci_experiment_tasks (
            space_id TEXT NOT NULL, id TEXT NOT NULL, experiment_id TEXT NOT NULL, revision INTEGER NOT NULL,
            state TEXT NOT NULL, source_workspace_id TEXT NOT NULL, target_workspace_id TEXT NOT NULL,
            result_workspace_id TEXT, document_json TEXT NOT NULL, PRIMARY KEY(space_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_ci_task_experiment ON ci_experiment_tasks(space_id, experiment_id);
        CREATE INDEX IF NOT EXISTS idx_ci_task_source ON ci_experiment_tasks(space_id, source_workspace_id);
        CREATE INDEX IF NOT EXISTS idx_ci_task_target ON ci_experiment_tasks(space_id, target_workspace_id);
        CREATE INDEX IF NOT EXISTS idx_ci_task_result ON ci_experiment_tasks(space_id, result_workspace_id);
    `));
}
export function recoverContentExperimentTasks(db: CiDatabase): void {
    ciTransaction(db, () => {
        for (const row of db.prepare("SELECT document_json FROM ci_experiment_tasks WHERE state = 'copying'").all()) {
            const task = ExperimentTaskSchema.parse(JSON.parse(row.document_json));
            const next = ExperimentTaskSchema.parse({ ...task, state: 'needs_review', errorCode: 'INTERRUPTED', revision: task.revision + 1, updatedAt: Date.now() });
            db.prepare("UPDATE ci_experiment_tasks SET state = ?, revision = ?, document_json = ? WHERE space_id = ? AND id = ? AND state = 'copying'").run(next.state, next.revision, JSON.stringify(next), next.spaceId, next.id);
        }
    });
}
export function deleteContentExperimentsSpace(db: CiDatabase, spaceId: string): void {
    for (const table of ['ci_experiment_tasks', 'ci_experiments']) db.prepare(`DELETE FROM ${table} WHERE space_id = ?`).run(spaceId);
}
export function createContentExperimentsRepository(db: CiDatabase, currentSpace: () => string) {
    const metrics = createContentMetricsRepository(db, currentSpace); const space = metrics.space;
    const decode = <T>(schema: z.ZodType<T, z.ZodTypeDef, any>, row: any): T => {
        if (!row) throw new Error('记录不存在或不属于当前空间'); return schema.parse(JSON.parse(row.document_json));
    };
    function experiment(id: string): ContentExperiment {
        return decode(ContentExperimentSchema, db.prepare('SELECT document_json FROM ci_experiments WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    }
    function task(id: string): ExperimentTask {
        return decode(ExperimentTaskSchema, db.prepare('SELECT document_json FROM ci_experiment_tasks WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    }
    function prior(operation: string, requestId: string, input: unknown): { id: string } | null {
        const row = db.prepare('SELECT digest, result_json FROM ci_requests WHERE space_id = ? AND operation = ? AND request_id = ?').get(space(), operation, CiId.parse(requestId));
        if (!row) return null;
        if (row.digest !== ciDigest(input)) throw new Error('同一请求不能用于不同内容'); return JSON.parse(row.result_json);
    }
    function previousExperiment(input: unknown) {
        const request = CreateExperimentSchema.parse(input); const previous = prior('experiment.create', request.requestId, request);
        return previous ? experiment(previous.id) : null;
    }
    function previousTask(input: unknown) {
        const request = CreateExperimentTaskSchema.parse(input); const previous = prior('experiment.task-create', request.requestId, request);
        return previous ? task(previous.id) : null;
    }
    function assertWork(expected: { workspaceId: string; revision: string; draftEpoch: number; contentVersion: string }, actual: ExperimentWork) {
        if (['workspaceId', 'revision', 'draftEpoch', 'contentVersion'].some(key => expected[key as keyof typeof expected] !== actual[key as keyof ExperimentWork])) throw new Error('工程内容或版本已变化，请重新预览');
    }
    function writeExperiment(value: ContentExperiment): ContentExperiment {
        const next = ContentExperimentSchema.parse({ ...value, revision: value.revision + 1, updatedAt: Date.now() });
        const result = db.prepare('UPDATE ci_experiments SET revision = ?, status = ?, document_json = ? WHERE space_id = ? AND id = ? AND revision = ?')
            .run(next.revision, next.status, JSON.stringify(next), space(), next.id, value.revision) as { changes: number };
        if (!result.changes) throw new Error('实验已变化，请刷新'); return next;
    }
    function writeTask(value: ExperimentTask): ExperimentTask {
        const next = ExperimentTaskSchema.parse({ ...value, revision: value.revision + 1, updatedAt: Date.now() });
        const result = db.prepare('UPDATE ci_experiment_tasks SET revision = ?, state = ?, result_workspace_id = ?, document_json = ? WHERE space_id = ? AND id = ? AND revision = ?')
            .run(next.revision, next.state, next.workspaceId ?? null, JSON.stringify(next), space(), next.id, value.revision) as { changes: number };
        if (!result.changes) throw new Error('任务已变化，请刷新'); return next;
    }
    function create(input: unknown, baselineInput: unknown, variantInput: unknown): ContentExperiment {
        const request = CreateExperimentSchema.parse(input);
        const result = metrics.request('experiment.create', request.requestId, request, () => {
            const baseline = ExperimentWorkSchema.parse(baselineInput); const variant = ExperimentWorkSchema.parse(variantInput);
            assertWork(request.baseline, baseline); assertWork(request.variant, variant);
            if (baseline.platform !== variant.platform) throw new Error('实验须保持工程平台一致');
            if (baseline.capability !== variant.capability && request.variable.kind !== 'format') throw new Error('内容形式不同，须明确以内容形式作为待研究变量');
            const now = Date.now(); const value = ContentExperimentSchema.parse({ ...request, version: 1, id: randomUUID(), spaceId: space(), revision: 1, status: 'draft', baseline, variant, createdAt: now, updatedAt: now });
            db.prepare('INSERT INTO ci_experiments VALUES (?, ?, ?, ?, ?)').run(value.spaceId, value.id, value.revision, value.status, JSON.stringify(value)); return value;
        });
        return experiment(result.id);
    }
    function list(): ContentExperiment[] {
        return db.prepare("SELECT document_json FROM ci_experiments WHERE space_id = ? ORDER BY json_extract(document_json, '$.createdAt') DESC, id DESC LIMIT 100").all(space()).map(row => decode(ContentExperimentSchema, row));
    }
    function bind(input: unknown) {
        const request = BindExperimentObservationsSchema.parse(input);
        return metrics.request('experiment.bind', request.requestId, request, () => {
            const value = experiment(request.id); if (value.revision !== request.expectedRevision || value.status === 'archived') throw new Error('实验已变化或归档，请重新核对');
            for (const role of ['baseline', 'variant'] as const) {
                const ref = request.observations[role]; const observation = metrics.observation(ref.id);
                if (observation.revision !== ref.revision) throw new Error('观测已修订，请刷新后绑定');
                const publication = metrics.publication(observation.input.publicationLinkId);
                if (publication.workspaceId !== value[role].workspaceId || publication.platform !== value[role].platform) throw new Error('观测不属于对应实验工程');
                if (publication.workspaceRevision !== value[role].revision || publication.nativeRevision && value[role].nativeRevision && publication.nativeRevision !== value[role].nativeRevision) throw new Error('发布关联与实验冻结工程版本不一致，请核对历史版本');
                if (ciDigest(observation.input.metric) !== ciDigest(value.metric)) throw new Error('观测口径与实验指标不一致');
            }
            return writeExperiment({ ...value, status: 'collecting', observations: request.observations });
        });
    }
    function transition(input: unknown) {
        const request = TransitionExperimentSchema.parse(input);
        return metrics.request('experiment.transition', request.requestId, request, () => {
            const value = experiment(request.id); if (value.revision !== request.expectedRevision) throw new Error('实验已变化，请刷新');
            const allowed = { draft: ['collecting', 'completed', 'archived'], collecting: ['completed', 'archived'], completed: ['collecting', 'archived'], archived: ['collecting'] };
            if (!allowed[value.status].includes(request.to)) throw new Error('不允许的实验状态迁移');
            return writeExperiment({ ...value, status: request.to });
        });
    }
    function tasks(experimentId?: string, workspaceId?: string): ExperimentTask[] {
        if (experimentId !== undefined) experiment(experimentId); if (workspaceId !== undefined) CiId.parse(workspaceId);
        return db.prepare(`SELECT document_json FROM ci_experiment_tasks WHERE space_id = ? AND (? IS NULL OR experiment_id = ?)
            AND (? IS NULL OR source_workspace_id = ? OR target_workspace_id = ? OR result_workspace_id = ?)
            ORDER BY json_extract(document_json, '$.createdAt') DESC, id DESC LIMIT 500`)
            .all(space(), experimentId ?? null, experimentId ?? null, workspaceId ?? null, workspaceId ?? null, workspaceId ?? null, workspaceId ?? null).map(row => decode(ExperimentTaskSchema, row));
    }
    function detail(id: string): ContentExperimentDetail {
        const value = experiment(id); let comparison: ContentExperimentDetail['comparison'] = null; let observationRevisionsChanged = false;
        if (value.observations) {
            const a = metrics.observation(value.observations.baseline.id, value.observations.baseline.revision); const b = metrics.observation(value.observations.variant.id, value.observations.variant.revision);
            comparison = compareMetricObservations(a, b, metrics.publication(a.input.publicationLinkId), metrics.publication(b.input.publicationLinkId));
            const versionUnknown = (['baseline', 'variant'] as const).some((role, index) => {
                const publication = metrics.publication((index ? b : a).input.publicationLinkId);
                return !publication.nativeRevision || !value[role].nativeRevision;
            });
            const reasons = [...comparison.reasons, ...(versionUnknown ? ['发布内容与冻结工程的原生版本缺少对应证明'] : []), ...(value.baseline.capability !== value.variant.capability ? ['内容形式不同，平台分发和观看口径可能不同，当前不足以判断效果'] : [])];
            if (reasons.length) comparison = { ...comparison, reasons, comparable: false, difference: null, relativeChange: null, interpretation: 'insufficient' };
            observationRevisionsChanged = metrics.observation(a.id).revision !== a.revision || metrics.observation(b.id).revision !== b.revision;
        }
        return { experiment: value, comparison, observationRevisionsChanged, tasks: tasks(id) };
    }
    function taskIdentity(requestId: string) {
        const id = 'task_' + ciDigest([space(), CiId.parse(requestId)]); return { id, creationRequestId: 'experiment_' + id };
    }
    function createTask(input: unknown, sourceInput: unknown, targetWorkspaceId: string): ExperimentTask {
        const request = CreateExperimentTaskSchema.parse(input);
        const result = metrics.request('experiment.task-create', request.requestId, request, () => {
            const value = experiment(request.experimentId);
            if (value.revision !== request.expectedRevision || value.status === 'archived') throw new Error('实验已变化或归档，请重新核对');
            const source = ExperimentWorkSchema.parse(sourceInput); assertWork(request.source, source);
            if (source.workspaceId !== value[request.sourceRole].workspaceId || source.platform !== value[request.sourceRole].platform || source.capability !== value[request.sourceRole].capability) throw new Error('任务来源与实验工程不一致');
            z.string().regex(/^creation_[a-f0-9]{40}$/).parse(targetWorkspaceId);
            const identity = taskIdentity(request.requestId); const now = Date.now();
            const { expectedRevision: _expectedRevision, ...fields } = request;
            const next = ExperimentTaskSchema.parse({ ...fields, id: identity.id, creationRequestId: identity.creationRequestId, version: 1, spaceId: space(), revision: 1,
                experimentRevision: value.revision, source, targetWorkspaceId, state: 'ready',
                basis: { hypothesis: value.hypothesis, metric: value.metric, observations: value.observations, limitations: value.limitations }, createdAt: now, updatedAt: now });
            db.prepare('INSERT INTO ci_experiment_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(next.spaceId, next.id, next.experimentId, next.revision, next.state, next.source.workspaceId, next.targetWorkspaceId, null, JSON.stringify(next)); return next;
        });
        return task(result.id);
    }
    function claimTask(input: unknown) {
        const request = StartExperimentTaskSchema.parse(input);
        return ciTransaction(db, () => {
            const value = task(request.id); if (value.state !== 'ready') return { claimed: false, task: value };
            if (value.revision !== request.expectedRevision) throw new Error('任务已变化，请刷新');
            return { claimed: true, task: writeTask({ ...value, state: 'copying' }) };
        });
    }
    function markReview(id: string, expectedRevision: number, errorCode: NonNullable<ExperimentTask['errorCode']>) {
        return ciTransaction(db, () => {
            const value = task(id);
            if (value.revision !== expectedRevision || !['ready', 'copying', 'needs_review'].includes(value.state)) return value;
            return writeTask({ ...value, state: 'needs_review', errorCode });
        });
    }
    function finishTask(id: string, expectedRevision: number, workspaceId: string, origin: 'guarded-copy' | 'manual-review' = 'guarded-copy') {
        CiId.parse(workspaceId);
        return ciTransaction(db, () => {
            const value = task(id);
            if (value.revision !== expectedRevision || !['copying', 'needs_review'].includes(value.state)) return value;
            if (workspaceId === value.source.workspaceId || origin === 'guarded-copy' && workspaceId !== value.targetWorkspaceId) throw new Error('任务副本关联不一致');
            return writeTask({ ...value, state: 'ready_to_edit', workspaceId, completionOrigin: origin, errorCode: undefined });
        });
    }
    function cancelTask(input: unknown) {
        const request = CancelExperimentTaskSchema.parse(input);
        return ciTransaction(db, () => {
            const value = task(request.id); if (value.state === 'cancelled') return value;
            if (value.revision !== request.expectedRevision || value.state === 'copying') throw new Error('任务已变化或正在复制，请完成后再处理');
            return writeTask({ ...value, state: 'cancelled' });
        });
    }
    return { space, previousExperiment, previousTask, experiment, task, create, list, bind, transition, detail, tasks, taskIdentity, createTask, claimTask, markReview, finishTask, cancelTask };
}
export type ContentExperimentsRepository = ReturnType<typeof createContentExperimentsRepository>;
