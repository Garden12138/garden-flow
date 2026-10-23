// Run: pnpm --dir desktop exec node --test tests/consumerResearchDomain.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ciDigest } from '../electron/core/content-intelligence/repository.ts';
import { prepareResearchReferences, describeResearchSources, verifyConsumerProposal, researchOpportunityScore } from '../electron/core/content-intelligence/researchDomain.ts';
import { ConsumerProposalSchema, ResearchScopeSchema, ResearchStartSchema } from '../shared/consumerResearch.ts';
import { SourceSnapshotSchema } from '../shared/contentIntelligence.ts';

function snapshot(id: string, comments = 3, partial = false) {
    const payload = { source: { kind: 'product' as const, namespace: 'taobao', id }, title: '明确标记的合成测试商品', capturedAt: 1,
        coverage: { captured: comments, partial, issues: partial ? ['部分采集'] : [] },
        segments: [{ key: 'fact', kind: 'fact' as const, text: '规格：10cm' }, ...Array.from({ length: comments }, (_, index) => ({ key: 'review_' + index, kind: 'comment' as const, text: `合成评论 ${id}-${index}：固定后会滑动` }))] };
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
}
const scope = (snapshots: ReturnType<typeof snapshot>[], maxComments = 100) => ResearchScopeSchema.parse({ sources: snapshots.map(snapshot => ({ source: snapshot.source, version: snapshot.version })), maxComments });
function proposal(refId: string, quote: string) {
    const score = { value: 3, reason: '仅作合成测试排序建议' };
    return { comment_insight: { questions: [], pain_points: ['固定使用障碍'], objections: [], demand_signals: [], opportunity: '说明安装范围' },
        insights: [{ category: 'usage_obstacle', statement: '部分样本提及固定后滑动', supportRefs: [{ refId, quote }], counterRefs: [], uncertainties: ['采样不能代表消费者总体'] }],
        opportunities: [{ insightIndex: 0, title: '安装说明', problem: '固定障碍', audience: '相关使用者', angle: '演示适用范围', suggestedFormats: ['note-image'], missingEvidence: [], scores: { evidence: score, fit: score, feasibility: score, business: score, freshness: score } }] };
}

test('bounded round-robin preview is deterministic and discloses partial, sampling limits and zero comments', () => {
    const sources = [snapshot('a', 8), snapshot('b', 8, true)]; const result = prepareResearchReferences(scope(sources, 4), sources);
    assert.equal(result.commentCount, 4); assert.equal(result.coverage.captured, 16); assert.equal(result.coverage.partial, true);
    assert.ok(result.coverage.issues.some(issue => issue.includes('未发送')));
    assert.deepEqual([...new Set(result.references.filter(ref => ref.kind === 'comment').map(ref => ref.source.id))], ['a', 'b']);
    assert.deepEqual(prepareResearchReferences(scope(sources, 4), sources), result);
    const empty = [snapshot('empty', 0)]; const noComments = prepareResearchReferences(scope(empty), empty);
    assert.equal(noComments.commentCount, 0); assert.ok(noComments.coverage.issues.some(issue => issue.includes('没有评论')));
    assert.throws(() => prepareResearchReferences({ ...scope(sources), completeOnly: true }, sources), /部分采集/);
    assert.throws(() => prepareResearchReferences(scope(sources), [sources[0]]), /范围/);
});

test('scope and confirmation contracts reject guessed sources, stale versions, renderer spaces, oversized scope and missing consent', () => {
    const source = snapshot('a'); const input = scope([source]);
    assert.equal(ResearchScopeSchema.safeParse({ ...input, spaceId: 'other' }).success, false);
    assert.equal(ResearchScopeSchema.safeParse({ ...input, sources: Array(21).fill(input.sources[0]) }).success, false);
    assert.equal(ResearchStartSchema.safeParse({ id: 'one', expectedRevision: 1, modelFingerprint: 'a'.repeat(64), consent: false }).success, false);
    assert.throws(() => prepareResearchReferences({ ...input, sources: [input.sources[0], input.sources[0]] }, [source, source]), /重复/);
    assert.throws(() => prepareResearchReferences({ ...input, sources: [{ ...input.sources[0], version: '0'.repeat(64) }] }, [source]), /来源已变化/);
});

test('model-invented IDs, modified quotes and product facts cannot masquerade as consumer evidence; real counterexamples survive', () => {
    const source = snapshot('a'); const { references } = prepareResearchReferences(scope([source]), [source]);
    const ref = references.find(ref => ref.kind === 'comment')!;
    const valid = verifyConsumerProposal(proposal(ref.id, '固定后会滑动'), references);
    assert.equal(valid.insights[0].reviewState, 'verified'); assert.equal(valid.insights[0].verified[0].locator.start, ref.text.indexOf('固定后会滑动'));
    for (const value of [proposal('fabricated_reference', '固定后会滑动'), proposal(ref.id, '模型编造的原文'), proposal(references[0].id, '10cm')]) {
        const result = verifyConsumerProposal(value, references); assert.equal(result.insights[0].reviewState, 'needs_evidence'); assert.equal(result.insights[0].verified.length, 0);
    }
    const counter = proposal(ref.id, '固定后会滑动'); counter.insights[0].counterRefs = [{ refId: references[2].id, quote: references[2].text }];
    const withCounter = verifyConsumerProposal(counter, references); assert.equal(withCounter.insights[0].verified.filter(ref => ref.relation === 'contradicts').length, 1);
    assert.equal(ConsumerProposalSchema.safeParse({ ...counter, fabricatedOriginals: [] }).success, false);
    assert.equal(verifyConsumerProposal({ comment_insight: { questions: [], pain_points: [], objections: [], demand_signals: [], opportunity: '' }, insights: [], opportunities: [] }, references).insights.length, 0);
});

test('oversized text is explicitly sampled, and deterministic scores are ranking suggestions', () => {
    const source = snapshot('a', 0); source.segments[0].text = '原文'.repeat(2000);
    const payload = { ...source }; delete (payload as any).version; source.version = ciDigest(payload);
    const result = prepareResearchReferences(scope([source]), [source]); assert.equal(result.references[0].text.length, 2000); assert.equal(result.coverage.partial, true);
    const sample = ConsumerProposalSchema.parse(proposal('ref', 'quote')).opportunities[0]; assert.equal(researchOpportunityScore(sample), 3);
    sample.scores.evidence.value = 5; sample.scores.fit.value = 0; assert.equal(researchOpportunityScore(sample), 2.85);
});

test('multi-product context cannot crowd out the comment sample and each frozen source reports its exact sent scope', () => {
    const sources = Array.from({ length: 20 }, (_, index) => {
        const source = snapshot('product_' + index, 2);
        const payload = { ...source, segments: [...Array.from({ length: 24 }, (_, field) => ({ key: 'spec_' + field, kind: 'fact' as const, text: `规格 ${field}` })), ...source.segments.filter(segment => segment.kind === 'comment')] };
        const { version, ...content } = payload; return { ...content, version: ciDigest(content) };
    });
    const result = prepareResearchReferences(scope(sources, 100), sources);
    assert.equal(result.commentCount, 40); assert.equal(result.referenceCount, 200); assert.equal(result.coverage.partial, true);
    assert.equal(result.sourceOverviews.length, 20);
    for (const source of result.sourceOverviews) { assert.equal(source.commentCount, 2); assert.ok(source.referenceCount >= 3); }
    assert.equal(result.sourceOverviews.reduce((sum, source) => sum + source.inputCharacters, 0), result.inputCharacters);
    assert.equal(result.sourceOverviews.reduce((sum, source) => sum + source.referenceCount, 0), result.referenceCount);
    const invalid = result.references.map(ref => ({ ...ref })); invalid[0].text = '快照中不存在的原文';
    assert.throws(() => describeResearchSources(scope(sources), sources, invalid), /输入与来源快照不匹配/);
});
