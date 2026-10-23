// Run: pnpm --dir desktop exec node --test tests/contentIntelligenceService.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import { createContentIntelligenceRepository, initializeContentIntelligence } from '../electron/core/content-intelligence/repository.ts';
import { createContentIntelligenceService } from '../electron/core/content-intelligence/service.ts';
import { createCiSourceAdapter } from '../electron/core/content-intelligence/sourceAdapters.ts';
import { productVideoHarness } from './helpers/productVideoHarness.ts';

async function fixture(t: any) {
    const h = await productVideoHarness({ creationWorkspaces: true, productImageSets: true }); t.after(() => h.close());
    const sql = new DatabaseSync(':memory:'); t.after(() => sql.close()); sql.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('default'), ('b');"); initializeContentIntelligence(sql);
    const repo = createContentIntelligenceRepository(sql, () => h.state.spaceId);
    const sources = createCiSourceAdapter({ products: async () => (await h.store.list()).flatMap((group: any) => group.products), knowledge: async () => [] });
    const service = createContentIntelligenceService(repo, sources, { start: input => h.api.startCreationWorkspace(input), read: id => h.api.readCreationWorkspace(id) });
    await h.store.ingestProduct({ platform: 'taobao', externalId: '123', sourceUrl: 'https://item.taobao.com/item.htm?id=123', capturedAt: '2026-10-01T00:00:00Z', title: '合成测试商品', parameters: [], missingFields: [],
        reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [{ id: 'review_one', text: '夹子固定后容易滑动', matchedFilterIds: [], images: [] }] } });
    const source = (await sources.list())[0]; const segment = source.segments.find(segment => segment.kind === 'comment')!;
    const evidence = await service.addEvidence({ source: source.source, version: source.version, locator: { key: segment.key, start: 0, end: segment.text.length }, excerpt: segment.text });
    const opportunity = service.createOpportunity({ requestId: 'manual_one', title: '固定方式演示', problem: '部分样本提及固定不便', audience: '有相关使用场景的人', angle: '展示适用范围', evidence: [{ id: evidence.id, relation: 'supports' }] });
    const accepted = service.transitionOpportunity({ id: opportunity.id, requestId: 'adopt', expectedRevision: opportunity.revision, to: 'accepted' });
    const input = { opportunityId: opportunity.id, requestId: 'create_work', expectedRevision: accepted.revision, selection: { platform: 'douyin', capability: 'product-video' } };
    return { h, repo, sources, service, input, source, evidence, accepted };
}

test('opportunity opens a real existing CreationWorkspace, retry/restart uses same work and original evidence, no generation or publication', async t => {
    const { h, repo, service, input, evidence } = await fixture(t);
    const [first, retry] = await Promise.all([service.createWork(input), service.createWork(input)]);
    assert.equal(first.workspace.id, retry.workspace.id); assert.equal(first.link.id, retry.link.id);
    assert.ok(first.workspace.draft.brief.includes(evidence.excerpt)); assert.ok(first.workspace.draft.productId);
    assert.equal((await service.workEvidence(first.workspace.id))[0].evidence[0].excerpt, evidence.excerpt);
    h.restart(); assert.equal((await service.createWork(input)).workspace.id, first.workspace.id);
    assert.equal(repo.linksForWork(first.workspace.id).length, 1);
    assert.equal((await h.api.readCreationWorkspace(first.workspace.id)).sessionId, first.workspace.sessionId);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls + h.state.publisherCalls.length, 0);
    await assert.rejects(service.createWork({ ...input, selection: { platform: 'tiktok', capability: 'product-video' } }), /同一创作请求/);
    h.state.spaceId = 'b'; await assert.rejects(service.workEvidence(first.workspace.id));
    await assert.rejects(service.getOpportunity(input.opportunityId), /当前空间/);
});

test('created work survives link failure and can be recovered after source/decision changes without re-creating or overwriting', async t => {
    const { h, repo, service, sources, input, accepted } = await fixture(t);
    let fail = true;
    const recovering = createContentIntelligenceService({ ...repo, linkWork: (...args) => { if (fail) { fail = false; throw new Error('synthetic link failure'); } return repo.linkWork(...args); } }, sources,
        { start: input => h.api.startCreationWorkspace(input), read: id => h.api.readCreationWorkspace(id) });
    await assert.rejects(recovering.createWork(input), /synthetic link failure/);
    const sessions = h.state.sessions.size; assert.equal(sessions, 1);
    repo.transitionOpportunity({ id: accepted.id, requestId: 'user_change', expectedRevision: accepted.revision, to: 'dismissed' });
    const result = await recovering.createWork(input); assert.equal(h.state.sessions.size, sessions);
    assert.equal((await service.workEvidence(result.workspace.id))[0].opportunity.status, 'dismissed');
    assert.equal(repo.getOpportunity(accepted.id).revision, 3);
});

test('stale sources, forged excerpts, unknown product selection and unsupported targets cannot create works', async t => {
    const { service, sources, source, input, h } = await fixture(t);
    await assert.rejects(service.addEvidence({ source: source.source, version: source.version, locator: { key: 'fake', start: 0, end: 2 }, excerpt: '造假' }), /原文/);
    await assert.rejects(service.createWork({ ...input, selection: { ...input.selection, productId: 'other_product' } }), /证据范围/);
    await assert.rejects(service.createWork({ ...input, selection: { platform: 'tiktok', capability: 'product-image-set' } }));
    await h.store.upsertProduct({ id: source.source.id, name: '已更新', facts: [{ key: '尺寸', value: '20cm', origin: 'user-confirmed' }] });
    assert.notEqual((await sources.read(source.source)).version, source.version);
    await assert.rejects(service.createWork(input), /失效证据/);
    assert.equal(h.state.sessions.size, 0);
});

test('IPC handler and typed bridge channels match, are registered, and never accept a renderer space override', async () => {
    const main = await fs.readFile(new URL('../electron/core/contentIntelligenceIpc.ts', import.meta.url), 'utf8');
    const bridge = await fs.readFile(new URL('../src/bridge/domains/contentIntelligenceBridge.ts', import.meta.url), 'utf8');
    const channels = (value: string) => [...new Set([...value.matchAll(/['"]ci:([a-z-]+)['"]/g)].map(match => match[1]))].sort();
    assert.equal(channels(main).length, 25); assert.deepEqual(channels(main), channels(bridge));
    assert.ok(main.includes('runInWorkspaceSpace(spaceId'));
    const startup = await fs.readFile(new URL('../electron/appMain.ts', import.meta.url), 'utf8'); assert.ok(startup.includes('registerContentIntelligenceIpc();'));
});
