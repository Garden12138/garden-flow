// Run: pnpm --dir desktop exec node --test tests/contentIntelligenceSources.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBrandWorkspaceStore } from '../electron/core/brandWorkspaceStore.ts';
import { createCiSourceAdapter, knowledgeSourceSnapshot } from '../electron/core/content-intelligence/sourceAdapters.ts';
import { initializeContentIntelligence, createContentIntelligenceRepository } from '../electron/core/content-intelligence/repository.ts';

test('real brand store ingestion locates reviews, preserves partial status, and detects changed/missing source without redirecting old evidence', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-ci-source-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => dir);
    const capture = (text: string, capturedAt: string) => ({ platform: 'taobao', externalId: '10001', sourceUrl: 'https://item.taobao.com/item.htm?id=10001&token=private', capturedAt,
        title: '测试夹式风扇（合成）', parameters: [{ key: '尺寸', value: '10cm' }], missingFields: [],
        reviewCapture: { modalDetected: true, status: 'partial' as const, availableFilters: [], selectedFilters: [], results: [{ filterId: 'all', label: '全部', requested: 20, captured: 1, status: 'partial' as const }], warnings: ['仅合成测试样本'],
            reviews: [{ id: 'same_review', platformReviewId: 'external_review', text, matchedFilterIds: [], images: [] }] } });
    const first = await store.ingestProduct(capture('夹在推车上会滑动', '2026-10-01T00:00:00Z'));
    const adapter = createCiSourceAdapter({ products: async () => (await store.list()).flatMap(group => group.products), knowledge: async () => [] });
    const sources = await adapter.list(); assert.equal(sources.length, 1);
    const source = sources[0]; assert.equal(source.coverage.captured, 1); assert.equal(source.coverage.requested, 20); assert.equal(source.coverage.partial, true);
    assert.equal(source.sourceUrl, 'https://item.taobao.com/item.htm?id=10001');
    const segment = source.segments.find(segment => segment.kind === 'comment')!; assert.equal(segment.text, '夹在推车上会滑动');
    const sql = new DatabaseSync(':memory:'); t.after(() => sql.close()); sql.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a');"); initializeContentIntelligence(sql);
    const repo = createContentIntelligenceRepository(sql, () => 'a'); const evidence = repo.addEvidence(source, { key: segment.key, start: 0, end: segment.text.length }, segment.text);
    assert.equal(await adapter.validity(evidence), 'verified');
    await store.ingestProduct(capture('现在修改了规格', '2026-10-02T00:00:00Z'));
    assert.equal(await adapter.validity(evidence), 'stale'); assert.equal(repo.getEvidence(evidence.id).excerpt, '夹在推车上会滑动');
    assert.equal(repo.getSnapshot(source.source, source.version).segments.find(segment => segment.key === evidence.locator.key)?.text, evidence.excerpt);
    await store.deleteProduct(first.product.product.id); assert.equal(await adapter.validity(evidence), 'missing');
});

test('knowledge namespaces prevent platform collisions, dedupe sample comments and exclude conflicting originals', async () => {
    const knowledge = (platform: string, comments: any[]) => ({ id: 'same_id', type: 'note' as const, title: '合成', content: '资料正文', meta: { sourceUrl: `https://www.${platform}.com/${platform === 'tiktok' ? '@demo/video/' : 'video/'}1234`, capture: { status: 'partial', comments: 'partial', commentLimit: 20 }, commentsSnapshot: comments } });
    const a = knowledgeSourceSnapshot(knowledge('douyin', [{ id: 'one', text: '相同评论' }, { id: 'one', text: '相同评论' }]))!;
    const b = knowledgeSourceSnapshot(knowledge('tiktok', [{ id: 'one', text: '相同评论' }]))!;
    assert.notEqual(a.version, b.version); assert.equal(a.coverage.captured, 1); assert.equal(a.coverage.partial, true);
    const conflict = knowledgeSourceSnapshot(knowledge('tiktok', [{ id: 'one', text: '不同版本' }, { id: 'one', text: '冲突原文' }]))!;
    assert.equal(conflict.coverage.captured, 0); assert.ok(conflict.coverage.issues.some(issue => issue.includes('冲突')));
    const adapter = createCiSourceAdapter({ products: async () => [], knowledge: async () => [knowledge('douyin', []), knowledge('tiktok', [])] });
    assert.equal((await adapter.list()).length, 2);
    await assert.rejects(adapter.read({ kind: 'social', namespace: 'xiaohongshu', id: 'same_id' }), /来源不存在/);
    await assert.rejects(adapter.read({ kind: 'social', namespace: 'tiktok', id: '../escape' }));
});

test('zero comments and document preview limits are explicit; document display-ID collisions do not merge source identities', () => {
    const document = (relativePath: string) => ({ id: 'sanitized_same', type: 'note' as const, title: '合成文档', content: '原文', meta: { sourceType: 'document', sourceId: 'folder', relativePath } });
    const a = knowledgeSourceSnapshot(document('a b.md'))!; const b = knowledgeSourceSnapshot(document('a_b.md'))!;
    assert.notEqual(a.source.id, b.source.id); assert.equal(a.coverage.captured, 0); assert.equal(a.coverage.partial, true);
    assert.ok(a.coverage.issues.some(issue => issue.includes('12000')));
    assert.equal(knowledgeSourceSnapshot({ id: 'unknown', type: 'note', title: 'unknown', content: 'none', meta: {} }), null);
});
