import { z } from 'zod';
import { StartExperimentExplanationSchema, CancelExperimentExplanationSchema } from '../../../shared/experimentExplanation.ts';
import type { ExperimentExplanationRepository } from './explanationRepository.ts';
import type { ExperimentExplanationModel } from './explanationModel.ts';

export function createExperimentExplanationService(repository: ExperimentExplanationRepository, model: ExperimentExplanationModel, timeoutMs = 90000) {
    const controllers = new Map<string, AbortController>();
    const preview = (input: unknown) => repository.preview(input, model.describe());
    async function start(input: unknown) {
        const request = StartExperimentExplanationSchema.parse(input); const spaceId = repository.space(); const original = repository.get(request.id);
        if (original.status !== 'queued') return original;
        if (model.describe()?.fingerprint !== request.modelFingerprint) throw new Error('模型配置已变化，请重新预览并确认');
        const claim = repository.claim(request); if (!claim.claimed) return claim.run;
        const run = claim.run; const key = spaceId + ':' + run.id; const controller = new AbortController(); controllers.set(key, controller);
        void (async () => {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
            let rejectAborted: (() => void) | undefined;
            try {
                const output = await new Promise<unknown>((resolve, reject) => {
                    rejectAborted = () => reject(signal.reason); signal.addEventListener('abort', rejectAborted, { once: true }); signal.throwIfAborted();
                    void model.analyze(run.input, run.basisDigest, run.model!, signal).then(resolve, reject);
                });
                if (controller.signal.aborted || repository.space() !== spaceId) return;
                repository.finish(run.id, run.revision, output);
            } catch (error) {
                if (repository.space() === spaceId) {
                    const code = (error as { code?: string })?.code;
                    repository.fail(run.id, run.revision, code === 'SOURCE_CHANGED' || code === 'INVALID_OUTPUT' ? code : error instanceof z.ZodError ? 'INVALID_OUTPUT' : 'MODEL_FAILED');
                }
            } finally { if (rejectAborted) signal.removeEventListener('abort', rejectAborted); if (controllers.get(key) === controller) controllers.delete(key); }
        })().catch(() => { /* Deleted spaces cannot receive late results; no automatic retries. */ });
        return run;
    }
    function cancel(input: unknown) {
        const request = CancelExperimentExplanationSchema.parse(input); const run = repository.cancel(request);
        if (run.status === 'cancelled') controllers.get(repository.space() + ':' + run.id)?.abort(); return run;
    }
    return { preview, start, cancel, get: repository.get, list: repository.list };
}
