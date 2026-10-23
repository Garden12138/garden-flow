import { ConsumerProposalSchema, ResearchReferenceSchema, ResearchScopeSchema, ResearchSourceOverviewSchema, type ResearchReference, type ResearchScope, type ConsumerProposal } from '../../../shared/consumerResearch.ts';
import { SourceSnapshotSchema, type SourceSnapshot, type ContentEvidence } from '../../../shared/contentIntelligence.ts';
import { ciDigest, sourceKey } from './repository.ts';

export function prepareResearchReferences(input: ResearchScope, snapshotsInput: SourceSnapshot[]) {
    const scope = ResearchScopeSchema.parse(input); const snapshots = snapshotsInput.map(value => SourceSnapshotSchema.parse(value));
    if (new Set(scope.sources.map(ref => sourceKey(ref.source))).size !== scope.sources.length) throw new Error('研究来源重复');
    if (snapshots.length !== scope.sources.length) throw new Error('研究范围与实际来源不匹配');
    const bySource = new Map(snapshots.map(snapshot => [sourceKey(snapshot.source), snapshot]));
    const selected = scope.sources.map(ref => {
        const snapshot = bySource.get(sourceKey(ref.source));
        if (!snapshot || snapshot.version !== ref.version) throw new Error('来源已变化，请重新预览');
        if (scope.completeOnly && snapshot.coverage.partial) throw new Error('当前选择含部分采集来源，请调整范围');
        return snapshot;
    });
    const issues = new Set<string>();
    let captured = 0; let requested = 0; let requestedKnown = true; let partial = false;
    for (const source of selected) {
        captured += source.coverage.captured; partial ||= source.coverage.partial;
        if (source.coverage.requested === undefined) requestedKnown = false; else requested += source.coverage.requested;
        source.coverage.issues.forEach(issue => issues.add(issue));
        if (source.capturedAt === undefined) { issues.add('部分来源缺少采集时间'); partial = true; }
    }
    // Keep one context segment per source, then sample comments before filling remaining context.
    // Otherwise a multi-product scope can spend its entire bounded budget on specifications.
    const contexts = selected.map(snapshot => snapshot.segments.filter(segment => segment.kind !== 'comment' && segment.text.trim()).map(segment => ({ snapshot, segment })));
    const comments = selected.map(snapshot => snapshot.segments.filter(segment => segment.kind === 'comment' && segment.text.trim()).map(segment => ({ snapshot, segment })));
    const batches = [contexts.map(queue => queue.slice(0, 1)), comments, contexts.map(queue => queue.slice(1))];
    const references: ResearchReference[] = []; let commentCount = 0; let inputCharacters = 0; let omitted = 0;
    for (const queues of batches) for (let offset = 0; queues.some(queue => queue.length > offset); offset++) {
        for (const queue of queues) {
            const value = queue[offset]; if (!value) continue;
            const { snapshot, segment } = value;
            if (segment.kind === 'comment' && commentCount >= scope.maxComments || references.length >= 200 || inputCharacters >= 60000) { omitted++; continue; }
            const text = segment.text.slice(0, Math.min(2000, 60000 - inputCharacters));
            if (!text.trim()) { omitted++; continue; }
            if (text.length < segment.text.length) { issues.add('部分长原文仅发送前缀，引用仅可定位本轮已发送范围'); partial = true; }
            references.push(ResearchReferenceSchema.parse({ id: 'ref_' + ciDigest([snapshot.source, snapshot.version, segment.key, text]),
                source: snapshot.source, version: snapshot.version, key: segment.key, kind: segment.kind, text }));
            inputCharacters += text.length; if (segment.kind === 'comment') commentCount++;
        }
    }
    if (omitted) { issues.add(`范围内另有 ${omitted} 个片段未发送给模型`); partial = true; }
    if (!commentCount) issues.add('本轮没有评论样本，只能提出资料角度，不能归纳消费者痛点');
    const limits = [...issues].slice(0, 39);
    if (issues.size > limits.length) limits.push('其他来源限制请回看各来源详情');
    return { references, sourceCount: selected.length, commentCount, referenceCount: references.length, inputCharacters,
        sourceOverviews: describeResearchSources(scope, selected, references),
        coverage: { captured, ...(requestedKnown ? { requested } : {}), partial, issues: limits },
        sourceDigest: ciDigest({ version: 2, scope, versions: selected.map(snapshot => snapshot.version), references }) };
}

export function describeResearchSources(input: ResearchScope, snapshotsInput: SourceSnapshot[], referencesInput: ResearchReference[]) {
    const scope = ResearchScopeSchema.parse(input);
    const snapshots = new Map(snapshotsInput.map(value => { const snapshot = SourceSnapshotSchema.parse(value); return [sourceKey(snapshot.source), snapshot] as const; }));
    const references = referencesInput.map(value => ResearchReferenceSchema.parse(value));
    const selected = new Map(scope.sources.map(ref => [sourceKey(ref.source), ref.version]));
    if (selected.size !== scope.sources.length || snapshots.size !== selected.size || snapshotsInput.length !== selected.size
        || new Set(references.map(reference => reference.id)).size !== references.length) throw new Error('研究来源清单不匹配');
    for (const reference of references) {
        const key = sourceKey(reference.source); const snapshot = snapshots.get(key);
        if (!selected.has(key) || selected.get(key) !== reference.version || snapshot?.version !== reference.version
            || !snapshot.segments.find(segment => segment.key === reference.key && segment.kind === reference.kind)?.text.startsWith(reference.text)) {
            throw new Error('研究输入与来源快照不匹配');
        }
    }
    return scope.sources.map(ref => {
        const snapshot = snapshots.get(sourceKey(ref.source));
        if (!snapshot || snapshot.version !== ref.version) throw new Error('研究来源版本不匹配');
        const sent = references.filter(reference => sourceKey(reference.source) === sourceKey(ref.source));
        return ResearchSourceOverviewSchema.parse({ source: ref.source, version: ref.version, title: snapshot.title, capturedAt: snapshot.capturedAt,
            coverage: snapshot.coverage, referenceCount: sent.length, commentCount: sent.filter(reference => reference.kind === 'comment').length,
            inputCharacters: sent.reduce((sum, reference) => sum + reference.text.length, 0) });
    });
}

export interface VerifiedResearchQuote {
    refId: string; source: ResearchReference['source']; version: string;
    locator: ContentEvidence['locator']; excerpt: string; relation: 'supports' | 'contradicts';
}
export function verifyConsumerProposal(input: unknown, references: ResearchReference[]) {
    const proposal = ConsumerProposalSchema.parse(input);
    const refs = new Map(references.map(value => [value.id, ResearchReferenceSchema.parse(value)]));
    return { proposal, insights: proposal.insights.map(insight => {
        const verified: VerifiedResearchQuote[] = []; const issues = new Set<string>();
        const seen = new Set<string>();
        for (const relation of ['supports', 'contradicts'] as const) {
            const quotes = relation === 'supports' ? insight.supportRefs : insight.counterRefs;
            for (const quote of quotes) {
                const ref = refs.get(quote.refId);
                if (!ref) { issues.add('UNKNOWN_REFERENCE'); continue; }
                const start = ref.text.indexOf(quote.quote);
                if (start < 0) { issues.add('QUOTE_NOT_FOUND'); continue; }
                if (insight.category !== 'content_angle' && ref.kind !== 'comment') { issues.add('NOT_CONSUMER_EVIDENCE'); continue; }
                const key = ciDigest([ref.id, quote.quote, relation]); if (seen.has(key)) continue; seen.add(key);
                verified.push({ refId: ref.id, source: ref.source, version: ref.version, locator: { key: ref.key, start, end: start + quote.quote.length }, excerpt: quote.quote, relation });
            }
        }
        if (!verified.some(quote => quote.relation === 'supports')) issues.add('NO_SUPPORTING_EVIDENCE');
        return { insight, verified, issues: [...issues], reviewState: issues.size ? 'needs_evidence' as const : 'verified' as const };
    }) };
}

export function researchOpportunityScore(opportunity: ConsumerProposal['opportunities'][number]): number {
    const scores = opportunity.scores;
    return Math.round((scores.evidence.value * .3 + scores.fit.value * .25 + scores.feasibility.value * .2 + scores.business.value * .15 + scores.freshness.value * .1) * 100) / 100;
}
