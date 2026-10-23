// Run: pnpm --dir desktop exec node --test tests/contentIntelligenceRepository.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeContentIntelligence, createContentIntelligenceRepository, deleteContentIntelligenceSpace, ciDigest, ciTransaction } from '../electron/core/content-intelligence/repository.ts';
import { AddEvidenceSchema, CreateOpportunitySchema, CreateOpportunityWorkSchema, SourceSnapshotSchema, TransitionOpportunitySchema } from '../shared/contentIntelligence.ts';

function fixture(t: any, filename = ':memory:') {
    const sql = new DatabaseSync(filename); t.after(() => sql.close());
    sql.exec("CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY); INSERT OR IGNORE INTO spaces VALUES ('a'), ('b');");
    initializeContentIntelligence(sql);
    let active = 'a'; const repo = createContentIntelligenceRepository(sql, () => active);
    return { sql, repo, switch: (id: string) => { active = id; } };
}
function snapshot(namespace = 'taobao', text = '夹在推车上会滑动') {
    const payload = { source: { kind: 'product' as const, namespace, id: 'product_one' }, title: '合成测试商品', coverage: { captured: 1, requested: 5, partial: true, issues: ['合成测试，非真实消费者数据'] }, segments: [{ key: 'review:one', kind: 'comment' as const, text }] };
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
}
const opportunity = (id = 'create_one', evidence: any[] = []) => ({ requestId: id, title: '如何固定', problem: '样本提及固定不便', audience: '使用推车的人', angle: '演示固定方式并说明适用范围', evidence });

test('strict contracts reject renderer space, unknown fields, path IDs, invalid bounds and unsupported targets', () => {
    for (const input of [{ ...opportunity(), spaceId: 'b' }, { ...opportunity(), requestId: '../escape' }, { ...opportunity(), evidence: [{ id: 'made_up', relation: 'proof' }] }, { ...opportunity(), title: '' }]) assert.equal(CreateOpportunitySchema.safeParse(input).success, false);
    assert.equal(AddEvidenceSchema.safeParse({ source: snapshot().source, version: 'fake', locator: { key: 'r', start: 1, end: 0 }, excerpt: 'x' }).success, false);
    assert.equal(CreateOpportunityWorkSchema.safeParse({ opportunityId: 'one', requestId: 'r', expectedRevision: 1, selection: { platform: 'tiktok', capability: 'product-image-set' } }).success, false);
    assert.equal(TransitionOpportunitySchema.safeParse({ id: 'one', requestId: 'r', expectedRevision: 0, to: 'accepted' }).success, false);
});

test('fresh, legacy and restart migrations preserve old data and frozen evidence versions', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-ci-migration-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const filename = path.join(dir, 'legacy.db');
    let sql = new DatabaseSync(filename);
    sql.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'); CREATE TABLE old_work(id TEXT PRIMARY KEY, value TEXT); INSERT INTO old_work VALUES ('old', 'untouched');");
    initializeContentIntelligence(sql); initializeContentIntelligence(sql);
    const repo = createContentIntelligenceRepository(sql, () => 'a');
    const source = snapshot(); const evidence = repo.addEvidence(source, { key: 'review:one', start: 0, end: 8 }, source.segments[0].text);
    const value = repo.createOpportunity(opportunity('one', [{ id: evidence.id, relation: 'supports' }]));
    sql.close(); sql = new DatabaseSync(filename); t.after(() => sql.close()); initializeContentIntelligence(sql);
    const restored = createContentIntelligenceRepository(sql, () => 'a');
    assert.equal(restored.getOpportunity(value.id).title, value.title);
    assert.deepEqual(restored.getSnapshot(source.source, source.version), source);
    assert.equal(sql.prepare('SELECT value FROM old_work').get()!.value, 'untouched');
    assert.throws(() => restored.saveSnapshot({ ...source, title: '偷偷改写' }), /摘要/);
    const updated = snapshot('taobao', '已修改的来源版本'); restored.saveSnapshot(updated);
    assert.equal(restored.getEvidence(evidence.id).sourceVersion, source.version);
});

test('quotes are exact and immutable, with platform namespaces and full space isolation', t => {
    const h = fixture(t); const source = snapshot();
    assert.throws(() => h.repo.addEvidence(source, { key: 'fiction', start: 0, end: 8 }, source.segments[0].text), /原文/);
    assert.throws(() => h.repo.addEvidence(source, { key: 'review:one', start: 0, end: 8 }, '模型编造的引用'), /原文/);
    const evidence = h.repo.addEvidence(source, { key: 'review:one', start: 0, end: 8 }, source.segments[0].text);
    assert.equal(h.repo.addEvidence(source, evidence.locator, evidence.excerpt).id, evidence.id);
    const otherPlatform = snapshot('jd'); assert.notEqual(h.repo.addEvidence(otherPlatform, evidence.locator, evidence.excerpt).id, evidence.id);
    const item = h.repo.createOpportunity(opportunity('one', [{ id: evidence.id, relation: 'supports' }]));
    h.switch('b'); assert.throws(() => h.repo.getEvidence(evidence.id), /当前空间/); assert.throws(() => h.repo.getOpportunity(item.id), /当前空间/);
    assert.throws(() => h.repo.createOpportunity(opportunity('bad', [{ id: evidence.id, relation: 'supports' }])), /当前空间/);
    assert.deepEqual(h.repo.listOpportunities().items, []);
    const inB = h.repo.addEvidence(source, evidence.locator, evidence.excerpt); assert.equal(inB.spaceId, 'b');
    h.switch('deleted'); assert.throws(() => h.repo.listOpportunities(), /空间不存在/);
});

test('request conflicts and revisions cannot overwrite user decisions; scoped pagination is stable', t => {
    const h = fixture(t); const input = opportunity(); const first = h.repo.createOpportunity(input);
    assert.deepEqual(h.repo.createOpportunity(input), first);
    assert.equal(first.basis, 'hypothesis'); assert.equal(first.status, 'needs_evidence');
    assert.throws(() => h.repo.createOpportunity({ ...input, title: '不同内容' }), /同一请求/);
    const change = { id: first.id, requestId: 'adopt', expectedRevision: 1, to: 'accepted' };
    const second = h.repo.transitionOpportunity(change); assert.equal(second.revision, 2);
    assert.deepEqual(h.repo.transitionOpportunity(change), second);
    assert.throws(() => h.repo.transitionOpportunity({ ...change, requestId: 'late', to: 'dismissed' }), /已变化/);
    const archived = h.repo.transitionOpportunity({ id: first.id, requestId: 'archive', expectedRevision: 2, to: 'archived' });
    assert.throws(() => h.repo.transitionOpportunity({ id: first.id, requestId: 'invalid', expectedRevision: archived.revision, to: 'accepted' }), /状态迁移/);
    for (let i = 0; i < 4; i++) h.repo.createOpportunity(opportunity('page_' + i));
    const page = h.repo.listOpportunities({ limit: 2 }); assert.equal(page.items.length, 2); assert.ok(page.next);
    const next = h.repo.listOpportunities({ after: page.next, limit: 2 }); assert.equal(next.items.length, 2);
    assert.equal(new Set([...page.items, ...next.items].map(item => item.id)).size, 4);
    h.switch('b'); h.repo.createOpportunity(opportunity()); assert.equal(h.repo.listOpportunities().items.length, 1);
});

test('work requests recover after link failure and cannot point a retry at a different work', t => {
    const h = fixture(t); const item = h.repo.createOpportunity(opportunity());
    const input = { opportunityId: item.id, selection: { platform: 'douyin' as const, capability: 'product-video' as const, requestId: 'stable_creation' } };
    assert.deepEqual(h.repo.reserveWork('work_request', input), input);
    assert.throws(() => ciTransaction(h.sql, () => { h.repo.linkWork('work_request', 'created_work'); throw new Error('disk unavailable'); }), /disk unavailable/);
    assert.deepEqual(h.repo.linksForWork('created_work'), []);
    const link = h.repo.linkWork('work_request', 'created_work');
    assert.deepEqual(h.repo.linkWork('work_request', 'created_work'), link);
    assert.equal(h.repo.reserveWork('work_request', input).workspaceId, 'created_work');
    assert.throws(() => h.repo.linkWork('work_request', 'different_work'), /冲突/);
    h.switch('b'); assert.deepEqual(h.repo.linksForWork('created_work'), []);
    assert.throws(() => h.repo.linkWork('work_request', 'created_work'), /缺少/);
});

test('space cleanup is scoped and transactional, including analysis, evidence and request records', t => {
    const h = fixture(t); h.repo.createOpportunity(opportunity()); h.switch('b'); const retained = h.repo.createOpportunity(opportunity());
    assert.throws(() => ciTransaction(h.sql, () => { deleteContentIntelligenceSpace(h.sql, 'a'); throw new Error('rollback'); }), /rollback/);
    h.switch('a'); assert.equal(h.repo.listOpportunities().items.length, 1);
    ciTransaction(h.sql, () => deleteContentIntelligenceSpace(h.sql, 'a')); assert.equal(h.repo.listOpportunities().items.length, 0);
    h.switch('b'); assert.equal(h.repo.getOpportunity(retained.id).spaceId, 'b');
});
