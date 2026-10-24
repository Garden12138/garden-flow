// pnpm --dir desktop exec node --test tests/contentCampaigns.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeContentIntelligence, createContentIntelligenceRepository } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics, createContentMetricsRepository } from '../electron/core/content-intelligence/metricsRepository.ts';
import { initializeContentCampaigns, recoverContentCampaigns, deleteContentCampaignsSpace, createContentCampaignsRepository } from '../electron/core/content-intelligence/campaignsRepository.ts';
import { createContentCampaignsService } from '../electron/core/content-intelligence/campaignsService.ts';
import { createContentIntelligenceService } from '../electron/core/content-intelligence/service.ts';
import { createCiSourceAdapter } from '../electron/core/content-intelligence/sourceAdapters.ts';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { CampaignCandidateSchema, ProposeCampaignItemsSchema } from '../shared/contentCampaigns.ts';
import { MetricCsvFields } from '../shared/contentExperiments.ts';

async function fixture(t: any) {
    const h = await productVideoHarness({ creationWorkspaces: true, productImageSets: true }); t.after(() => h.close());
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('default'), ('b'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('untouched');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeContentCampaigns(db); initializeContentCampaigns(db);
    const current = () => h.state.spaceId; const base = createContentIntelligenceRepository(db, current); const repo = createContentCampaignsRepository(db, current); const metrics = createContentMetricsRepository(db, current);
    const sources = createCiSourceAdapter({ products: async () => (await h.store.list()).flatMap((group: any) => group.products), knowledge: async () => [] });
    let starts = 0; const intelligence = createContentIntelligenceService(base, sources, { start: async input => { starts++; return h.api.startCreationWorkspace(input); }, read: h.api.readCreationWorkspace });
    await h.store.ingestProduct({ platform: 'taobao', externalId: '123', sourceUrl: 'https://item.taobao.com/item.htm?id=123', capturedAt: '2026-10-01T00:00:00Z', title: '合成测试商品', parameters: [], missingFields: [],
        reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [{ id: 'review', text: '夹子固定后容易滑动', matchedFilterIds: [], images: [] }] } });
    const snapshot = (await sources.list())[0]; const segment = snapshot.segments.find(value => value.kind === 'comment')!;
    const evidence = await intelligence.addEvidence({ source: snapshot.source, version: snapshot.version, locator: { key: segment.key, start: 0, end: segment.text.length }, excerpt: segment.text });
    let opportunity = intelligence.createOpportunity({ requestId: 'opportunity', title: '合成固定疑问', problem: '复核固定方式', audience: '相关样本', angle: '解释限制', evidence: [{ id: evidence.id, relation: 'context' }] });
    opportunity = intelligence.transitionOpportunity({ id: opportunity.id, requestId: 'adopt', expectedRevision: 1, to: 'accepted' });
    const create = { requestId: 'campaign', title: '合成三条内容', goal: '说明使用范围', audience: '相关场景读者', productId: snapshot.source.id, platforms: ['xiaohongshu'], opportunities: [{ id: opportunity.id, revision: opportunity.revision }], limitations: ['合成数据，不能推断消费者总体'] };
    let campaign = repo.create(create);
    const candidates = ['awareness', 'education', 'objection'].map((role, index) => ({ role, title: '合成内容' + index, why: '本条待核实的独立职责' + index,
        opportunity: create.opportunities[0], evidenceRefs: [evidence.id], target: { platform: 'xiaohongshu', capability: 'note-image' }, assetNeeds: ['需人工选择和核对素材'], dependsOn: [] }));
    const proposal = { id: campaign.id, requestId: 'proposal', expectedRevision: campaign.revision, items: candidates };
    campaign = repo.propose(proposal);
    const adapter = { read: async (id: string) => (await h.api.inspectCreationWorkspace(id)).workspace, completions: () => [] };
    const service = createContentCampaignsService(repo, intelligence, metrics, adapter);
    return { h, db, base, repo, metrics, sources, intelligence, snapshot, opportunity, evidence, create, campaign, candidates, proposal, service, adapter, starts: () => starts };
}
const claim = (campaign: any, item = campaign.items[0]) => ({ id: campaign.id, itemId: item.id, expectedItemRevision: item.revision, confirmed: true });
const confirm = (repo: any, campaign: any) => repo.confirm({ id: campaign.id, expectedRevision: campaign.revision, requestId: 'confirm-' + campaign.revision, confirmed: true });

test('campaign proposals have real scoped references and supported targets; replay, manual changes and ordering retain explicit list confirmation', async t => {
    const f = await fixture(t); assert.equal(f.repo.create(f.create).id, f.campaign.id); assert.equal(f.repo.propose(f.proposal).items.length, 3);
    assert.equal(f.campaign.items.every(item => item.origin === 'agent'), true); assert.equal(f.starts(), 0);
    assert.throws(() => f.repo.claimWork(claim(f.campaign)), /确认/);
    const first = CampaignCandidateSchema.strip().parse(f.campaign.items[0]);
    for (const item of [{ ...first, evidenceRefs: ['fabricated'] }, { ...first, opportunity: { id: 'foreign', revision: 2 } }, { ...first, target: { platform: 'tiktok', capability: 'note-image' } }]) {
        assert.throws(() => f.repo.add({ id: f.campaign.id, expectedRevision: f.campaign.revision, requestId: 'invalid-add', item, dependencies: [] }));
    }
    assert.equal(ProposeCampaignItemsSchema.safeParse({ ...f.proposal, items: [f.candidates[0], f.candidates[0], f.candidates[0]] }).success, false);
    assert.equal(ProposeCampaignItemsSchema.safeParse({ ...f.proposal, items: f.candidates.map((item, i) => ({ ...item, dependsOn: i ? [i] : [] })) }).success, false);
    let campaign = confirm(f.repo, f.campaign); assert.equal(campaign.confirmedPlanVersion, campaign.planVersion);
    campaign = f.repo.updateItem({ id: campaign.id, requestId: 'edit', expectedRevision: campaign.revision, itemId: campaign.items[0].id, item: { ...first, title: '人工核对后题目' }, dependencies: [] });
    assert.equal(campaign.confirmedPlanVersion, undefined); assert.equal(campaign.items[0].revision, 2);
    campaign = f.repo.reorder({ id: campaign.id, requestId: 'order', expectedRevision: campaign.revision, itemIds: campaign.items.map(item => item.id).reverse() });
    assert.equal(campaign.items[2].title, '人工核对后题目'); assert.equal(f.starts(), 0);
    f.h.state.spaceId = 'b'; assert.throws(() => f.repo.get(campaign.id), /当前空间/); assert.deepEqual(f.repo.list(), []); deleteContentCampaignsSpace(f.db, 'b');
    f.h.state.spaceId = 'default'; assert.equal(f.repo.get(campaign.id).items.length, 3); assert.equal(f.db.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched');
});
test('three independently confirmed roles enter real native works with evidence; archive preserves all works and double clicks never duplicate', async t => {
    const f = await fixture(t); let campaign = confirm(f.repo, f.campaign);
    await assert.rejects(f.service.createWork({ ...claim(campaign), confirmed: false })); assert.equal(f.starts(), 0);
    for (const item of campaign.items) {
        await Promise.all([f.service.createWork(claim(campaign, item)), f.service.createWork(claim(campaign, item))]);
        campaign = f.repo.get(campaign.id);
    }
    assert.equal(f.starts(), 3); assert.equal(new Set(campaign.items.map(item => item.workspaceId)).size, 3);
    for (const item of campaign.items) {
        const work = await f.h.api.readCreationWorkspace(item.workspaceId); assert.equal(work.capability, item.target.capability);
        const brief = work.native?.kind === 'note' ? (await f.h.api.getXhsNoteProject(work.native.path)).document.creationConfig?.brief || '' : work.draft.brief;
        assert.ok(brief.includes(item.title)); assert.ok(brief.includes(item.why));
        assert.equal((await f.intelligence.workEvidence(work.id))[0].evidence[0].id, f.evidence.id);
    }
    const status = await f.service.detail(campaign.id); assert.ok(status.works.every(work => work.availability === 'available' && work.exportedVersions === 0 && work.publicationStates.published === 0 && work.observations === 0));
    campaign = f.repo.archive({ id: campaign.id, requestId: 'archive', expectedRevision: campaign.revision, archived: true });
    for (const item of campaign.items) await f.service.createWork(claim(campaign, item)); assert.equal(f.starts(), 3);
    assert.equal((await f.h.api.listCreationWorkspaceSummaries()).length, 3); assert.equal(f.h.state.imageCalls + f.h.state.videoCalls + f.h.state.ttsCalls + f.h.state.publisherCalls.length, 0);
});
test('lost links and restart retain engineering; explicit review reuses one reserved work while stale evidence creates none', async t => {
    const f = await fixture(t); let campaign = confirm(f.repo, f.campaign); let fail = true;
    const broken = createContentCampaignsService({ ...f.repo, finishWork: (...args) => { if (args[3] && fail) { fail = false; throw new Error('synthetic lost association'); } return f.repo.finishWork(...args); } }, f.intelligence, f.metrics, f.adapter);
    campaign = await broken.createWork(claim(campaign)); assert.equal(campaign.items[0].state, 'needs_review'); assert.equal(f.starts(), 1);
    const work = (await f.h.api.listCreationWorkspaceSummaries())[0]; const native = await f.h.api.readCreationWorkspace(work.id); const note = await f.h.api.getXhsNoteProject(native.native.path);
    await f.h.api.saveXhsNoteProject({ path: note.relativePath, noteType: note.document.noteType, expectedRevision: note.version, document: { ...note.document, body: '恢复前人工编辑' } });
    f.h.restart(); campaign = await f.service.createWork(claim(campaign)); assert.equal(campaign.items[0].workspaceId, work.id); assert.equal(f.starts(), 1);
    assert.equal((await f.h.api.getXhsNoteProject(native.native.path)).document.body, '恢复前人工编辑');
    const second = f.repo.claimWork(claim(campaign, campaign.items[1])); assert.equal(second.claimed, true); recoverContentCampaigns(f.db); recoverContentCampaigns(f.db);
    campaign = f.repo.get(campaign.id); assert.equal(campaign.items[1].errorCode, 'INTERRUPTED'); assert.equal(f.starts(), 1);
    await f.h.store.upsertProduct({ id: f.snapshot.source.id, name: '合成规格更新', facts: [{ key: '尺寸', value: '20cm', origin: 'user-confirmed' }] });
    campaign = await f.service.createWork(claim(campaign, campaign.items[1])); assert.equal(campaign.items[1].state, 'needs_review'); assert.equal(f.starts(), 1);
});
test('deleted engineering is missing, exported history is separate from publication, and late foreign-space reads do not restore data', async t => {
    const f = await fixture(t); let campaign = confirm(f.repo, f.campaign); campaign = await f.service.createWork(claim(campaign)); const id = campaign.items[0].workspaceId!;
    const work = await f.h.api.readCreationWorkspace(id);
    const completion: any = { spaceId: 'default', source: { kind: 'note', path: work.native.path }, semanticDigest: 'a'.repeat(64), snapshot: { spaceId: 'default' } };
    const exports = createContentCampaignsService(f.repo, f.intelligence, f.metrics, { ...f.adapter, completions: () => [completion, completion, { ...completion, spaceId: 'b' }] });
    const summary = (await exports.detail(campaign.id)).works[0]; assert.equal(summary.exportedVersions, 1); assert.equal(summary.publicationStates.published, 0);
    const publication = f.metrics.recordPublication({ workspaceId: work.id, workspaceRevision: work.revision, platform: work.platform, accountAlias: 'synthetic', externalWorkId: 'synthetic-post', origin: 'manual', status: 'declared-published', sourceNote: '合成人工声明', observedAt: 1 });
    for (const value of [2, 5]) {
        const csv = { csv: MetricCsvFields.join(',') + '\n' + [publication.id, 'views', '合成窗口计数', 'count', value, '2026-10-15', '2026-10-24', 'unknown', 'calendar', '', '', '小样本', '合成来源', '2026-10-24T01:00:00Z'].join(','), mapping: Object.fromEntries(MetricCsvFields.map(key => [key, key])) };
        f.metrics.importCsv({ ...csv, requestId: 'observe-' + value, previewDigest: f.metrics.preview(csv).digest, confirmed: true, reviseConflicts: true });
    }
    const manual = (await exports.detail(campaign.id)).works[0]; assert.equal(manual.publicationStates.declared, 1); assert.equal(manual.publicationStates.published, 0);
    assert.equal(manual.observations, 1); assert.equal(f.metrics.history(f.metrics.observations()[0].id).length, 2);
    f.h.state.spaceId = 'b'; assert.deepEqual(f.metrics.workCounts(work.id), { publications: 0, observations: 0 }); f.h.state.spaceId = 'default';
    const late = createContentCampaignsService(f.repo, f.intelligence, f.metrics, { ...f.adapter, read: async id => { const value = await f.adapter.read(id); f.h.state.spaceId = 'b'; return value; } });
    await assert.rejects(late.detail(campaign.id), /空间已变化/); f.h.state.spaceId = 'default';
    const note = await f.h.api.getXhsNoteProject(work.native.path); await fs.rename(note.projectPath, note.projectPath + '.retained-test-backup');
    assert.equal((await f.service.detail(campaign.id)).works[0].availability, 'missing'); assert.equal(f.repo.get(campaign.id).items[0].state, 'linked');
    assert.equal(f.starts(), 1);
});
test('invalid grouped references roll back atomically; dependency ordering, capacity and started item edits cannot invalidate retained works', async t => {
    const f = await fixture(t); const before = f.repo.get(f.campaign.id);
    assert.throws(() => f.repo.propose({ ...f.proposal, requestId: 'duplicate-group', expectedRevision: before.revision }), /候选重复/);
    assert.throws(() => f.repo.propose({ ...f.proposal, requestId: 'bad-group', expectedRevision: before.revision, items: f.candidates.map((item, index) => ({ ...item, title: item.title + '新组', ...(index === 2 ? { evidenceRefs: ['invented'] } : {}) })) }), /引用/);
    assert.equal(f.repo.get(before.id).revision, before.revision); assert.equal(f.repo.get(before.id).items.length, 3);
    let campaign = f.repo.updateItem({ id: before.id, requestId: 'dependency', expectedRevision: before.revision, itemId: before.items[2].id, item: CampaignCandidateSchema.strip().parse(before.items[2]), dependencies: [before.items[0].id] });
    assert.throws(() => f.repo.reorder({ id: campaign.id, requestId: 'invalid-order', expectedRevision: campaign.revision, itemIds: campaign.items.map(item => item.id).reverse() }), /依赖顺序/);
    assert.equal(f.repo.get(campaign.id).revision, campaign.revision);
    campaign = confirm(f.repo, campaign); const active = f.repo.claimWork(claim(campaign));
    assert.throws(() => f.repo.archive({ id: campaign.id, requestId: 'busy-archive', expectedRevision: active.campaign.revision, archived: true }), /正在创建/);
    recoverContentCampaigns(f.db); campaign = f.repo.get(campaign.id);
    assert.throws(() => f.repo.updateItem({ id: campaign.id, requestId: 'unsafe-edit', expectedRevision: campaign.revision, itemId: campaign.items[0].id, item: CampaignCandidateSchema.strip().parse(campaign.items[0]), dependencies: [] }), /尚未尝试/);
    assert.equal(f.starts(), 0);
});
test('campaign migration and recovery work after a real SQLite file reopen and leave old records and linked native works intact', async t => {
    const f = await fixture(t); let campaign = confirm(f.repo, f.campaign); campaign = await f.service.createWork(claim(campaign)); f.repo.claimWork(claim(campaign, campaign.items[1]));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-campaign-migration-')); const file = path.join(root, 'legacy.db');
    f.db.exec("VACUUM INTO '" + file.replaceAll("'", "''") + "'"); const db = new DatabaseSync(file);
    try {
        initializeContentCampaigns(db); initializeContentCampaigns(db); recoverContentCampaigns(db); recoverContentCampaigns(db);
        const repo = createContentCampaignsRepository(db, () => 'default'); const restored = repo.get(campaign.id);
        assert.equal(restored.items[0].workspaceId, campaign.items[0].workspaceId); assert.equal(restored.items[1].state, 'needs_review'); assert.equal(restored.items[1].errorCode, 'INTERRUPTED');
        assert.equal(db.prepare('SELECT id FROM legacy_work').get()!.id, 'untouched'); assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
        deleteContentCampaignsSpace(db, 'b'); assert.equal(repo.get(campaign.id).id, campaign.id); deleteContentCampaignsSpace(db, 'default'); assert.throws(() => repo.get(campaign.id));
        assert.ok(await f.h.api.readCreationWorkspace(campaign.items[0].workspaceId)); assert.equal(f.starts(), 1);
    } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
});
