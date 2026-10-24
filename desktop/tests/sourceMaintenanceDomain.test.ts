// pnpm --dir desktop exec node --test tests/sourceMaintenanceDomain.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciDigest } from '../electron/core/content-intelligence/repository.ts';
import { sourceFieldChanges, affectedWorkspaceLineage } from '../electron/core/content-intelligence/maintenanceDomain.ts';
import { SourceSnapshotSchema } from '../shared/contentIntelligence.ts';
import { RecordMaintenanceDecisionSchema, MaintenanceWorkReferenceSchema } from '../shared/sourceMaintenance.ts';

const source = { kind: 'product' as const, namespace: 'tmall', id: 'synthetic-product' };
const snapshot = (overrides: Record<string, unknown> = {}) => {
    const payload = { source, title: '合成规格样本', capturedAt: 1, coverage: { captured: 1, partial: true, issues: ['合成测试，不是真实商品变更'] },
        segments: [{ key: 'selectedSku', kind: 'fact', text: '{"name":"300g×12","size":"3.6kg"}' }, { key: 'price', kind: 'fact', text: '{"value":10,"currency":"CNY","sku":"small"}' }, { key: 'comment_one', kind: 'comment', text: '其他规格背景评价' }], ...overrides };
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
};
test('field diff retains exact old/new SKU and price conditions without manufacturing a rate or interpreting unavailable fields as removed', () => {
    const old = snapshot(); const current = snapshot({ segments: [
        { key: 'selectedSku', kind: 'fact', text: '{"name":"600g×6","size":"3.6kg","note":"本地合成变更"}' },
        { key: 'price', kind: 'fact', text: '{"value":12,"currency":"USD","sku":"large"}' },
        { key: 'added', kind: 'fact', text: '' },
    ] });
    const changes = sourceFieldChanges(old, current);
    assert.deepEqual(changes.map(change => [change.key, change.change]), [['added', 'added'], ['comment_one', 'removed'], ['price', 'changed'], ['selectedSku', 'changed']]);
    const price = changes.find(change => change.key === 'price')!;
    assert.equal(price.previous, old.segments[1].text); assert.equal(price.current, current.segments[1].text); assert.equal(price.kind, 'segment');
    assert.equal(changes.find(change => change.key === 'added')!.current, ''); assert.deepEqual(sourceFieldChanges(old, null), []);
    assert.deepEqual(sourceFieldChanges(old, old), []);
});
test('source identity and metadata changes remain distinct from semantic content changes; reordered segments do not change values', () => {
    const old = snapshot(); const metadata = snapshot({ capturedAt: 2 });
    assert.deepEqual(sourceFieldChanges(old, metadata).map(change => [change.kind, change.key]), [['metadata', 'capturedAt']]);
    assert.deepEqual(sourceFieldChanges(old, snapshot({ segments: [...old.segments].reverse() })), []);
    assert.throws(() => sourceFieldChanges(old, snapshot({ source: { ...source, namespace: 'taobao' } })), /不同身份/);
    assert.throws(() => sourceFieldChanges(old, snapshot({ source: { ...source, kind: 'social' } })), /不同身份/);
    const changedKind = snapshot({ segments: old.segments.map(segment => segment.key === 'comment_one' ? { ...segment, kind: 'fact' } : segment) });
    assert.equal(sourceFieldChanges(old, changedKind)[0].previousKind, 'comment'); assert.equal(sourceFieldChanges(old, changedKind)[0].currentKind, 'fact');
});
const work = (id: string, sourceId?: string) => MaintenanceWorkReferenceSchema.parse({ id, spaceId: 'default', revision: 'revision', draftEpoch: 0, productId: 'same-product', title: '合成工程', platform: 'xiaohongshu', capability: 'note-image', ...(sourceId ? { sourceId } : {}) });
test('only explicit work roots and their actual descendants are affected; same product and unrelated works are not inferred dependencies', () => {
    const works = [work('root'), work('experiment-copy', 'root'), work('next-copy', 'experiment-copy'), work('unrelated-same-product'), work('other-copy', 'unrelated-same-product')];
    const affected = affectedWorkspaceLineage(['root', 'missing-root'], works);
    assert.deepEqual([...affected.keys()], ['missing-root', 'root', 'experiment-copy', 'next-copy']);
    assert.equal(affected.get('next-copy'), 'experiment-copy'); assert.equal(affected.has('unrelated-same-product'), false);
    assert.deepEqual([...affectedWorkspaceLineage([], works)], []);
});
test('affected cycles and excessive lineage depth are refused rather than silently returning a complete report', () => {
    assert.throws(() => affectedWorkspaceLineage(['root'], [work('root', 'copy'), work('copy', 'root')]), /循环或超限/);
    const chain = Array.from({ length: 33 }, (_, index) => work('work-' + index, index ? 'work-' + (index - 1) : undefined));
    assert.throws(() => affectedWorkspaceLineage(['work-0'], chain), /循环或超限/);
    assert.throws(() => affectedWorkspaceLineage(['root'], [work('root'), work('root')]), /身份重复/);
    assert.equal(affectedWorkspaceLineage(['root'], [work('root'), work('unrelated-cycle', 'unrelated-cycle')]).size, 1);
});
test('maintenance decisions require explicit acknowledgement, exact frozen impact identity and a nonempty human note', () => {
    const request = { requestId: 'decision', reportId: 'change', impactId: 'impact', impactVersion: 'a'.repeat(64), expectedDecisionRevision: 0, action: 'edit-manually', note: '待人工核对修改，未更正或发布', confirmed: true };
    assert.equal(RecordMaintenanceDecisionSchema.safeParse(request).success, true);
    for (const invalid of [{ ...request, confirmed: false }, { ...request, note: '' }, { ...request, action: 'publish' }, { ...request, spaceId: 'foreign' }]) assert.equal(RecordMaintenanceDecisionSchema.safeParse(invalid).success, false);
});
