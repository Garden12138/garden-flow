import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { InsightSchema, OpportunitySchema, type SourceSnapshot } from '../../../shared/contentIntelligence.ts';
import { CiId } from '../../../shared/contentIntelligence.ts';
import { PreviewResearchSchema, ResearchReferenceSchema, ResearchRunSchema, ResearchStartSchema, ResearchCancelSchema, type ResearchModel, type ResearchRun } from '../../../shared/consumerResearch.ts';
import { ciDigest, ciTransaction, createContentIntelligenceRepository, type CiDatabase } from './repository.ts';
import { prepareResearchReferences, verifyConsumerProposal, researchOpportunityScore } from './researchDomain.ts';

export function initializeConsumerResearch(db: CiDatabase): void {
    ciTransaction(db, () => db.exec(`CREATE TABLE IF NOT EXISTS ci_analysis_inputs (
        space_id TEXT NOT NULL, run_id TEXT NOT NULL, document_json TEXT NOT NULL, PRIMARY KEY(space_id, run_id)
    ); CREATE INDEX IF NOT EXISTS idx_ci_runs_space_status ON ci_analysis_runs(space_id, status);`));
}
export function recoverConsumerResearch(db: CiDatabase): void {
    ciTransaction(db, () => {
        for (const row of db.prepare("SELECT document_json FROM ci_analysis_runs WHERE status = 'running'").all()) {
            const run = ResearchRunSchema.parse(JSON.parse(row.document_json));
            run.status = 'interrupted'; run.errorCode = 'INTERRUPTED'; run.revision++; run.updatedAt = Date.now();
            db.prepare('UPDATE ci_analysis_runs SET status = ?, document_json = ? WHERE space_id = ? AND id = ?').run(run.status, JSON.stringify(run), run.spaceId, run.id);
        }
    });
}
export function deleteConsumerResearchSpace(db: CiDatabase, spaceId: string): void {
    db.prepare('DELETE FROM ci_analysis_inputs WHERE space_id = ?').run(spaceId);
}
export function createConsumerResearchRepository(db: CiDatabase, currentSpace: () => string) {
    const base = createContentIntelligenceRepository(db, currentSpace);
    const decode = (row: any) => {
        if (!row) throw new Error('研究记录不存在或不属于当前空间');
        return ResearchRunSchema.parse(JSON.parse(row.document_json));
    };
    function get(id: string): ResearchRun {
        return decode(db.prepare('SELECT document_json FROM ci_analysis_runs WHERE space_id = ? AND id = ?').get(base.space(), CiId.parse(id)));
    }
    function list() {
        return db.prepare('SELECT document_json FROM ci_analysis_runs WHERE space_id = ? ORDER BY rowid DESC LIMIT 50').all(base.space()).map(decode);
    }
    function references(id: string) {
        get(id);
        const row = db.prepare('SELECT document_json FROM ci_analysis_inputs WHERE space_id = ? AND run_id = ?').get(base.space(), id);
        if (!row) throw new Error('研究输入快照不可用');
        return z.array(ResearchReferenceSchema).max(200).parse(JSON.parse(row.document_json));
    }
    function write(run: ResearchRun) {
        const parsed = ResearchRunSchema.parse(run);
        if (parsed.spaceId !== base.space()) throw new Error('研究不属于当前空间');
        db.prepare('UPDATE ci_analysis_runs SET status = ?, document_json = ? WHERE space_id = ? AND id = ?').run(parsed.status, JSON.stringify(parsed), parsed.spaceId, parsed.id);
        return parsed;
    }
    function preview(input: unknown, snapshots: SourceSnapshot[], model: ResearchModel | null): ResearchRun {
        const parsed = PreviewResearchSchema.parse(input); const prepared = prepareResearchReferences(parsed.scope, snapshots);
        const sourceDigest = ciDigest([prepared.sourceDigest, model?.fingerprint || null]); const spaceId = base.space();
        return ciTransaction(db, () => {
            const old = db.prepare('SELECT document_json FROM ci_analysis_runs WHERE space_id = ? AND request_id = ?').get(spaceId, parsed.requestId);
            if (old) { const run = decode(old); if (run.sourceDigest !== sourceDigest) throw new Error('同一预览请求不能用于不同范围'); return run; }
            const duplicate = db.prepare("SELECT document_json FROM ci_analysis_runs WHERE space_id = ? AND json_extract(document_json, '$.sourceDigest') = ? AND status IN ('queued', 'running', 'partial', 'succeeded') ORDER BY rowid DESC LIMIT 1").get(spaceId, sourceDigest);
            if (duplicate) return decode(duplicate);
            const now = Date.now(); const { references, ...counts } = prepared;
            const run = ResearchRunSchema.parse({ ...counts, sourceDigest, id: randomUUID(), spaceId, requestId: parsed.requestId, scope: parsed.scope, model,
                status: 'queued', revision: 1, opportunityIds: [], issues: [], calls: 0, createdAt: now, updatedAt: now });
            snapshots.forEach(snapshot => base.saveSnapshot(snapshot));
            db.prepare('INSERT INTO ci_analysis_runs VALUES (?, ?, ?, ?, ?)').run(run.id, spaceId, run.requestId, run.status, JSON.stringify(run));
            db.prepare('INSERT INTO ci_analysis_inputs VALUES (?, ?, ?)').run(spaceId, run.id, JSON.stringify(references));
            return run;
        });
    }
    function claim(input: unknown) {
        const parsed = ResearchStartSchema.parse(input);
        return ciTransaction(db, () => {
            const run = get(parsed.id);
            if (run.status !== 'queued') return { run, claimed: false };
            if (run.revision !== parsed.expectedRevision) throw new Error('研究预览已变化，请刷新');
            if (!run.model) throw new Error('请先配置研究文本模型');
            if (parsed.modelFingerprint !== run.model.fingerprint) throw new Error('模型配置已变化，请重新预览并确认');
            if (!run.inputCharacters) throw new Error('本轮没有可分析的原文');
            run.status = 'running'; run.calls = 1; run.revision++; run.updatedAt = Date.now();
            return { run: write(run), claimed: true };
        });
    }
    function cancel(input: unknown) {
        const parsed = ResearchCancelSchema.parse(input);
        return ciTransaction(db, () => {
            const run = get(parsed.id);
            if (!['queued', 'running'].includes(run.status)) return run;
            if (run.revision !== parsed.expectedRevision) throw new Error('研究状态已变化，请刷新');
            run.status = 'cancelled'; run.revision++; run.updatedAt = Date.now(); return write(run);
        });
    }
    function fail(id: string, revision: number, code: NonNullable<ResearchRun['errorCode']>) {
        return ciTransaction(db, () => {
            const run = get(id); if (run.status !== 'running' || run.revision !== revision) return run;
            run.status = 'failed'; run.errorCode = code; run.revision++; run.updatedAt = Date.now(); return write(run);
        });
    }
    function finish(id: string, revision: number, output: unknown): ResearchRun {
        return ciTransaction(db, () => {
            const run = get(id); if (run.status !== 'running' || run.revision !== revision) return run;
            const verified = verifyConsumerProposal(output, references(id));
            const insightIds = verified.insights.map((result, index) => {
                const evidence = result.verified.map(quote => ({ id: base.addEvidence(base.getSnapshot(quote.source, quote.version), quote.locator, quote.excerpt).id, relation: quote.relation }));
                const insight = InsightSchema.parse({ id: 'ins_' + ciDigest([run.id, index]), spaceId: base.space(), runId: run.id,
                    category: result.insight.category, statement: result.insight.statement, evidence, uncertainties: [...result.insight.uncertainties, ...result.issues].slice(0, 30), reviewState: result.reviewState, createdAt: Date.now() });
                db.prepare('INSERT INTO ci_insights VALUES (?, ?, ?, ?)').run(insight.id, insight.spaceId, run.id, JSON.stringify(insight));
                return { insight, result };
            });
            let invalid = false;
            run.opportunityIds = verified.proposal.opportunities.map((candidate, index) => {
                const linked = insightIds[candidate.insightIndex];
                if (!linked) { invalid = true; return null; }
                const { insight, result } = linked;
                const value = base.createOpportunity({ requestId: 'research_' + ciDigest([run.id, index]), title: candidate.title, problem: candidate.problem, audience: candidate.audience, angle: candidate.angle, evidence: insight.evidence });
                if (result.reviewState === 'needs_evidence' || candidate.missingEvidence.length) { value.status = 'needs_evidence'; invalid = true; }
                value.research = { runId: run.id, insightId: insight.id, suggestedFormats: candidate.suggestedFormats,
                    uncertainties: [...new Set([...insight.uncertainties, ...candidate.missingEvidence, '仅为本次样本的创作建议，不能推断消费者总体'])].slice(0, 40),
                    scores: candidate.scores, weightedScore: researchOpportunityScore(candidate), confidence: result.reviewState !== 'verified' ? 'unknown' : run.coverage.partial || run.commentCount < 5 || result.verified.filter(quote => quote.relation === 'supports').length < 3 ? 'low' : 'medium' };
                const parsed = OpportunitySchema.parse(value);
                db.prepare('UPDATE ci_opportunities SET status = ?, document_json = ? WHERE space_id = ? AND id = ?').run(parsed.status, JSON.stringify(parsed), parsed.spaceId, parsed.id);
                return parsed.id;
            }).filter((value): value is string => value !== null);
            run.summary = verified.proposal.comment_insight;
            run.issues = [...new Set(verified.insights.flatMap(value => value.issues))];
            if (invalid) run.issues.push('部分机会缺少依据或引用了不存在的洞察');
            run.status = invalid || run.issues.length || run.coverage.partial ? 'partial' : 'succeeded'; run.revision++; run.updatedAt = Date.now();
            return write(run);
        });
    }
    return { preview, claim, cancel, fail, finish, get, list, references, space: base.space };
}
export type ConsumerResearchRepository = ReturnType<typeof createConsumerResearchRepository>;
