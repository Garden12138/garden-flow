import { CiId } from '../../../shared/contentIntelligence.ts';
import {
    CreateExperimentSchema, CreateExperimentTaskSchema, ExperimentWorkSchema, StartExperimentTaskSchema, ReviewExperimentTaskSchema,
    type ExperimentWork, type ExperimentTask,
} from '../../../shared/contentExperimentPlans.ts';
import type { CreationWorkspace } from '../../../shared/creationWorkspace.ts';
import type { ContentExperimentsRepository } from './experimentsRepository.ts';

interface WorkInspector {
    workspace: CreationWorkspace; contentVersion: string; nativeRevision?: string;
}
export function createContentExperimentsService(repository: ContentExperimentsRepository, adapter: {
    inspect(id: string): Promise<WorkInspector>;
    fork(id: string, selection: unknown, guard: unknown): Promise<CreationWorkspace>;
    idForRequest(spaceId: string, requestId: string): string;
}) {
    function sameSpace(spaceId: string) {
        if (repository.space() !== spaceId) throw new Error('空间已变化，请在原空间核对任务');
    }
    async function inspect(id: string): Promise<ExperimentWork> {
        const spaceId = repository.space(); const result = await adapter.inspect(CiId.parse(id)); sameSpace(spaceId);
        if (result.workspace.id !== id || result.workspace.spaceId !== spaceId) throw new Error('工程不属于当前空间');
        const work = result.workspace;
        return ExperimentWorkSchema.parse({ workspaceId: work.id, revision: work.revision, draftEpoch: work.draftEpoch,
            contentVersion: result.contentVersion, ...(result.nativeRevision ? { nativeRevision: result.nativeRevision } : {}),
            title: work.draft.title, platform: work.platform, capability: work.capability });
    }
    async function create(input: unknown) {
        const request = CreateExperimentSchema.parse(input); const spaceId = repository.space();
        const previous = repository.previousExperiment(request); if (previous) return previous;
        const [baseline, variant] = await Promise.all([inspect(request.baseline.workspaceId), inspect(request.variant.workspaceId)]);
        sameSpace(spaceId); return repository.create(request, baseline, variant);
    }
    async function createTask(input: unknown) {
        const request = CreateExperimentTaskSchema.parse(input); const spaceId = repository.space();
        const previous = repository.previousTask(request); if (previous) return previous;
        // Read the scoped experiment before any filesystem access; renderer IDs never supply authority.
        const experiment = repository.experiment(request.experimentId);
        if (request.source.workspaceId !== experiment[request.sourceRole].workspaceId) throw new Error('任务来源与实验工程不一致');
        const source = await inspect(request.source.workspaceId); sameSpace(spaceId);
        const identity = repository.taskIdentity(request.requestId);
        return repository.createTask(request, source, adapter.idForRequest(spaceId, identity.creationRequestId));
    }
    function matchesSource(task: ExperimentTask, current: ExperimentWork): boolean {
        return task.source.workspaceId === current.workspaceId && task.source.revision === current.revision
            && task.source.draftEpoch === current.draftEpoch && task.source.contentVersion === current.contentVersion;
    }
    function completedCopy(task: ExperimentTask, work: CreationWorkspace): boolean {
        return work.id === task.targetWorkspaceId && work.spaceId === task.spaceId && work.platform === task.source.platform && work.capability === task.source.capability
            && work.sourceId === task.source.workspaceId && work.sourceRevision === task.source.revision && work.sourceContentVersion === task.source.contentVersion;
    }
    async function startTask(input: unknown): Promise<ExperimentTask> {
        const request = StartExperimentTaskSchema.parse(input); const spaceId = repository.space(); const value = repository.task(request.id);
        // Completed or interrupted requests never re-enter the copy path, including after later source edits.
        if (value.state !== 'ready') return value;
        if (value.revision !== request.expectedRevision) throw new Error('任务已变化，请刷新');
        let current: ExperimentWork;
        try { current = await inspect(value.source.workspaceId); }
        catch { sameSpace(spaceId); return repository.markReview(value.id, value.revision, 'SOURCE_CHANGED'); }
        sameSpace(spaceId);
        if (!matchesSource(value, current)) return repository.markReview(value.id, value.revision, 'SOURCE_CHANGED');
        const claim = repository.claimTask(request); if (!claim.claimed) return claim.task;
        const task = claim.task;
        try {
            const work = await adapter.fork(task.source.workspaceId,
                { platform: task.source.platform, capability: task.source.capability, requestId: task.creationRequestId },
                { expectedRevision: task.source.revision, expectedDraftEpoch: task.source.draftEpoch, contentVersion: task.source.contentVersion });
            sameSpace(spaceId);
            if (!completedCopy(task, work)) return repository.markReview(task.id, task.revision, 'INCOMPLETE_COPY');
            return repository.finishTask(task.id, task.revision, work.id);
        } catch {
            sameSpace(spaceId); return repository.markReview(task.id, task.revision, 'COPY_FAILED');
        }
    }
    async function reviewTask(input: unknown): Promise<ExperimentTask> {
        const request = ReviewExperimentTaskSchema.parse(input); const spaceId = repository.space(); const task = repository.task(request.id);
        if (task.state === 'ready_to_edit') return task;
        if (task.state !== 'needs_review' || task.revision !== request.expectedRevision) throw new Error('任务不处于当前待复核版本');
        const result = await adapter.inspect(request.workspaceId); sameSpace(spaceId); const work = result.workspace;
        if (work.id !== request.workspaceId || work.spaceId !== spaceId || work.id === task.source.workspaceId
            || work.platform !== task.source.platform || work.capability !== task.source.capability) throw new Error('复核工程的空间、平台或内容形式不一致');
        // Explicit manual review may link a retained partial copy; its origin remains distinct from a proven guarded copy.
        return repository.finishTask(task.id, task.revision, work.id, completedCopy(task, work) ? 'guarded-copy' : 'manual-review');
    }
    return { inspect, create, createTask, startTask, reviewTask, list: repository.list, detail: repository.detail, bind: repository.bind,
        transition: repository.transition, tasks: repository.tasks, cancelTask: repository.cancelTask };
}
