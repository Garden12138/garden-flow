import { randomUUID } from 'node:crypto';
import { CiId } from '../../../shared/contentIntelligence.ts';
import { ExplanationInputSchema, ExplanationRunSchema, ExperimentExplanationProposalSchema, PreviewExperimentExplanationSchema, StartExperimentExplanationSchema, CancelExperimentExplanationSchema, type ExplanationRun } from '../../../shared/experimentExplanation.ts';
import type { ResearchModel } from '../../../shared/consumerResearch.ts';
import { ciDigest, ciTransaction, type CiDatabase } from './repository.ts';
import { createContentExperimentsRepository } from './experimentsRepository.ts';
import { createContentMetricsRepository } from './metricsRepository.ts';

export function initializeExperimentExplanations(db: CiDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS ci_experiment_explanations (
        space_id TEXT NOT NULL, id TEXT NOT NULL, experiment_id TEXT NOT NULL, request_id TEXT NOT NULL,
        status TEXT NOT NULL, document_json TEXT NOT NULL, PRIMARY KEY(space_id, id), UNIQUE(space_id, request_id)
    ); CREATE INDEX IF NOT EXISTS idx_ci_explanation_experiment ON ci_experiment_explanations(space_id, experiment_id);`);
}
export function recoverExperimentExplanations(db: CiDatabase) {
    ciTransaction(db, () => {
        for (const row of db.prepare("SELECT document_json FROM ci_experiment_explanations WHERE status = 'running'").all()) {
            const value = ExplanationRunSchema.parse(JSON.parse(row.document_json));
            const next = ExplanationRunSchema.parse({ ...value, status: 'interrupted', errorCode: 'INTERRUPTED', revision: value.revision + 1, updatedAt: Date.now() });
            db.prepare("UPDATE ci_experiment_explanations SET status = ?, document_json = ? WHERE space_id = ? AND id = ? AND status = 'running'").run(next.status, JSON.stringify(next), next.spaceId, next.id);
        }
    });
}
export function deleteExperimentExplanationsSpace(db: CiDatabase, spaceId: string) {
    db.prepare('DELETE FROM ci_experiment_explanations WHERE space_id = ?').run(spaceId);
}
export function createExperimentExplanationRepository(db: CiDatabase, currentSpace: () => string) {
    const experiments = createContentExperimentsRepository(db, currentSpace); const metrics = createContentMetricsRepository(db, currentSpace); const space = experiments.space;
    const decode = (row: any): ExplanationRun => {
        if (!row) throw new Error('解释记录不存在或不属于当前空间'); return ExplanationRunSchema.parse(JSON.parse(row.document_json));
    };
    const get = (id: string) => decode(db.prepare('SELECT document_json FROM ci_experiment_explanations WHERE space_id = ? AND id = ?').get(space(), CiId.parse(id)));
    const list = (experimentId: string) => {
        experiments.experiment(experimentId);
        return db.prepare('SELECT document_json FROM ci_experiment_explanations WHERE space_id = ? AND experiment_id = ? ORDER BY rowid DESC LIMIT 50').all(space(), experimentId).map(decode);
    };
    function currentInput(id: string) {
        const detail = experiments.detail(id); const value = detail.experiment;
        if (!value.observations || !detail.comparison || value.status === 'archived') throw new Error('请先绑定两组观测并核对实验状态');
        const input = ExplanationInputSchema.parse({ experimentId: value.id, experimentRevision: value.revision, title: value.title, hypothesis: value.hypothesis,
            variable: value.variable, limitations: value.limitations, comparison: detail.comparison, observationRevisionsChanged: detail.observationRevisionsChanged,
            arms: (['baseline', 'variant'] as const).map(role => {
                const ref = value.observations![role]; const observation = metrics.observation(ref.id, ref.revision); const { publicationLinkId: _link, sourceNote: _note, ...selected } = observation.input;
                const arm = value[role]; return { role, title: arm.title, engineeringVersionKnown: 'workspaceId' in arm && !!arm.nativeRevision,
                    fact: { role, id: observation.id, revision: observation.revision, value: observation.input.value, unit: observation.input.metric.unit }, observation: selected };
            }) });
        if (JSON.stringify(input).length > 60000) throw new Error('本轮解释资料超出60000字符，请缩小限制与备注');
        return input;
    }
    function preview(input: unknown, model: ResearchModel | null) {
        const request = PreviewExperimentExplanationSchema.parse(input);
        const saved = metrics.request('experiment.explanation-preview', request.requestId, { ...request, modelFingerprint: model?.fingerprint ?? null }, () => {
            const frozen = currentInput(request.experimentId);
            if (frozen.experimentRevision !== request.expectedRevision) throw new Error('实验已变化，请刷新');
            const basisDigest = ciDigest(frozen);
            const duplicate = list(request.experimentId).find(run => run.basisDigest === basisDigest && run.model?.fingerprint === model?.fingerprint && ['queued', 'running', 'succeeded'].includes(run.status));
            if (duplicate) return duplicate;
            const now = Date.now(); const run = ExplanationRunSchema.parse({ id: randomUUID(), spaceId: space(), requestId: request.requestId, revision: 1,
                input: frozen, basisDigest, inputCharacters: JSON.stringify(frozen).length, model, status: 'queued', calls: 0, createdAt: now, updatedAt: now });
            db.prepare('INSERT INTO ci_experiment_explanations VALUES (?, ?, ?, ?, ?, ?)').run(space(), run.id, request.experimentId, request.requestId, run.status, JSON.stringify(run)); return run;
        });
        return get(saved.id);
    }
    function write(value: ExplanationRun, update: Partial<ExplanationRun>) {
        const next = ExplanationRunSchema.parse({ ...value, ...update, revision: value.revision + 1, updatedAt: Date.now() });
        db.prepare('UPDATE ci_experiment_explanations SET status = ?, document_json = ? WHERE space_id = ? AND id = ?').run(next.status, JSON.stringify(next), space(), next.id); return next;
    }
    const assertCurrent = (run: ExplanationRun) => {
        try { if (ciDigest(currentInput(run.input.experimentId)) === run.basisDigest) return; } catch { /* Missing or archived data is also a changed basis. */ }
        throw Object.assign(new Error('实验或观测已变化，请重新预览'), { code: 'SOURCE_CHANGED' });
    };
    function claim(input: unknown) {
        const request = StartExperimentExplanationSchema.parse(input);
        return ciTransaction(db, () => {
            const run = get(request.id); if (run.status !== 'queued') return { run, claimed: false };
            if (run.revision !== request.expectedRevision || !run.model || run.model.fingerprint !== request.modelFingerprint) throw new Error('模型或预览已变化，请重新确认');
            assertCurrent(run); return { run: write(run, { status: 'running', calls: 1 }), claimed: true };
        });
    }
    function finish(id: string, revision: number, output: unknown) {
        return ciTransaction(db, () => {
            const run = get(id); if (run.status !== 'running' || run.revision !== revision) return run;
            assertCurrent(run); const proposal = ExperimentExplanationProposalSchema.parse(output);
            const expected = run.input.arms.map(arm => arm.fact); const actual = proposal.facts;
            if (proposal.basisDigest !== run.basisDigest || ciDigest(actual) !== ciDigest(expected) || ciDigest(proposal.comparison) !== ciDigest(run.input.comparison)) throw Object.assign(new Error('模型引用或计算不匹配，已拒绝结果'), { code: 'INVALID_OUTPUT' });
            return write(run, { status: 'succeeded', proposal });
        });
    }
    function fail(id: string, revision: number, errorCode: NonNullable<ExplanationRun['errorCode']>) {
        return ciTransaction(db, () => { const run = get(id); return run.status === 'running' && run.revision === revision ? write(run, { status: 'failed', errorCode }) : run; });
    }
    function cancel(input: unknown) {
        const request = CancelExperimentExplanationSchema.parse(input);
        return ciTransaction(db, () => {
            const run = get(request.id); if (!['queued', 'running'].includes(run.status)) return run;
            if (run.revision !== request.expectedRevision) throw new Error('解释状态已变化，请刷新'); return write(run, { status: 'cancelled' });
        });
    }
    return { space, get, list, preview, claim, finish, fail, cancel };
}
export type ExperimentExplanationRepository = ReturnType<typeof createExperimentExplanationRepository>;
