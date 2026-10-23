import { z } from 'zod';
import { PreviewResearchSchema, ResearchStartSchema, ResearchCancelSchema, type ResearchRun } from '../../../shared/consumerResearch.ts';
import type { ConsumerResearchRepository } from './researchRepository.ts';
import type { CiSourceAdapter } from './sourceAdapters.ts';
import type { ConsumerResearchModel } from './researchModel.ts';

const controllers = new Map<string, AbortController>();
export function createConsumerResearchService(repository: ConsumerResearchRepository, sources: CiSourceAdapter, model: ConsumerResearchModel) {
    async function preview(input: unknown) {
        const request = PreviewResearchSchema.parse(input); const space = repository.space();
        const snapshots = await Promise.all(request.scope.sources.map(ref => sources.read(ref.source)));
        if (repository.space() !== space) throw new Error('空间已变化');
        return repository.preview(request, snapshots, model.describe());
    }
    async function verifyCurrentSources(run: ResearchRun) {
        for (const source of run.scope.sources) {
            const current = await sources.read(source.source).catch(error => {
                if ((error as { code?: string }).code === 'CI_SOURCE_MISSING') throw Object.assign(new Error('来源已不可用'), { code: 'SOURCE_CHANGED' });
                throw error;
            });
            if (current.version !== source.version) throw Object.assign(new Error('来源版本已变化'), { code: 'SOURCE_CHANGED' });
        }
    }
    async function start(input: unknown): Promise<ResearchRun> {
        const request = ResearchStartSchema.parse(input); const space = repository.space();
        const original = repository.get(request.id);
        if (original.status !== 'queued') return original;
        if (model.describe()?.fingerprint !== request.modelFingerprint) throw new Error('模型配置已变化，请重新预览并确认');
        await verifyCurrentSources(original);
        if (repository.space() !== space) throw new Error('空间已变化');
        const claim = repository.claim(request); if (!claim.claimed) return claim.run;
        const key = space + ':' + claim.run.id; const controller = new AbortController(); controllers.set(key, controller);
        // The captured AsyncLocalStorage space from the IPC remains attached to this bounded background job.
        void (async () => {
            try {
                const output = await model.analyze(repository.references(claim.run.id), claim.run.scope.goal, claim.run.model!, AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]));
                if (controller.signal.aborted || repository.space() !== space) return;
                await verifyCurrentSources(claim.run);
                if (controller.signal.aborted || repository.space() !== space) return;
                repository.finish(claim.run.id, claim.run.revision, output);
            } catch (error) {
                if (repository.space() === space) {
                    const code = (error as { code?: string })?.code;
                    repository.fail(claim.run.id, claim.run.revision, code === 'SOURCE_CHANGED' || code === 'MODEL_NOT_CONFIGURED' || code === 'INVALID_OUTPUT' ? code : error instanceof z.ZodError ? 'INVALID_OUTPUT' : 'MODEL_FAILED');
                }
            } finally { if (controllers.get(key) === controller) controllers.delete(key); }
        })().catch(() => { /* A deleted space cannot receive results; never retry the provider. */ });
        return claim.run;
    }
    function cancel(input: unknown) {
        const request = ResearchCancelSchema.parse(input); const run = repository.cancel(request);
        if (run.status === 'cancelled') controllers.get(repository.space() + ':' + run.id)?.abort();
        return run;
    }
    return { preview, start, cancel, get: repository.get, list: repository.list };
}
