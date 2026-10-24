// pnpm --dir desktop exec node --test tests/sourceMaintenanceService.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { scanCreationWorkspaceReferences } from '../electron/core/creationWorkspaceMaintenance.ts';
import { createContentIntelligenceRepository, initializeContentIntelligence } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics } from '../electron/core/content-intelligence/metricsRepository.ts';
import { initializeSourceMaintenance, createSourceMaintenanceRepository } from '../electron/core/content-intelligence/maintenanceRepository.ts';
import { createSourceMaintenanceService } from '../electron/core/content-intelligence/maintenanceService.ts';
import { createCiSourceAdapter } from '../electron/core/content-intelligence/sourceAdapters.ts';
import { createContentIntelligenceService } from '../electron/core/content-intelligence/service.ts';

async function fixture(t: any) {
    const h = await productVideoHarness({ creationWorkspaces: true, productImageSets: true }); t.after(() => h.close());
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('default'), ('中文空间');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeSourceMaintenance(db);
    const base = createContentIntelligenceRepository(db, () => h.state.spaceId); const repo = createSourceMaintenanceRepository(db, () => h.state.spaceId);
    const sources = createCiSourceAdapter({ products: async () => (await h.store.list()).flatMap((group: any) => group.products), knowledge: async () => [] });
    const intelligence = createContentIntelligenceService(base, sources, { start: h.api.startCreationWorkspace, read: h.api.readCreationWorkspace });
    await h.store.ingestProduct({ platform: 'tmall', externalId: '123', sourceUrl: 'https://detail.tmall.com/item.htm?id=123', capturedAt: '2026-10-01T00:00:00Z', title: '合成规格复核商品', parameters: [], missingFields: [],
        reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [{ id: 'r1', text: '合成评论，仅验证引用链', matchedFilterIds: [], images: [] }] } });
    const snapshot = (await sources.list())[0]; const segment = snapshot.segments.find(value => value.kind === 'comment')!;
    const evidence = await intelligence.addEvidence({ source: snapshot.source, version: snapshot.version, locator: { key: segment.key, start: 0, end: segment.text.length }, excerpt: segment.text });
    let opportunity = intelligence.createOpportunity({ requestId: 'opp', title: '合成复核机会', problem: '核实规格', audience: '合成样本', angle: '不推断效果', evidence: [{ id: evidence.id, relation: 'context' }] });
    opportunity = intelligence.transitionOpportunity({ id: opportunity.id, requestId: 'adopt', expectedRevision: opportunity.revision, to: 'accepted' });
    const directory = () => path.join(h.root, h.state.spaceId, 'gardenflow/creation-workspaces');
    const adapter = { scan: () => scanCreationWorkspaceReferences(directory(), h.state.spaceId), inspect: h.api.inspectCreationWorkspace };
    const service = createSourceMaintenanceService(repo, sources, adapter);
    const input = { requestId: 'check', source: snapshot.source, previousVersion: snapshot.version };
    const change = () => h.store.upsertProduct({ id: snapshot.source.id, name: '合成规格复核商品', facts: [{ key: '规格', value: '本地合成更新，不代表平台变化', origin: 'user-confirmed' }] });
    const create = async (id: string) => (await intelligence.createWork({ requestId: id, opportunityId: opportunity.id, expectedRevision: opportunity.revision, selection: { platform: 'xiaohongshu', capability: 'note-image', productId: snapshot.source.id } })).workspace;
    return { h, db, base, repo, sources, intelligence, snapshot, evidence, opportunity, directory, adapter, service, input, change, create };
}
test('a complete registered-workspace scan refuses overflow and directory links, excludes corrupt/foreign/symlink records explicitly, and never follows their targets', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-maintenance-scan-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
    const directory = path.join(root, 'index'); assert.equal((await scanCreationWorkspaceReferences(directory, 'default')).totalWorkspaceRecords, 0); await fs.mkdir(directory);
    const work = { version: 1, id: 'valid', spaceId: 'default', revision: 'r1', draftEpoch: 0, platform: 'xiaohongshu', capability: 'note-image', draft: { title: '合成索引', productId: '' } };
    await fs.writeFile(path.join(directory, 'valid.json'), JSON.stringify(work));
    await fs.writeFile(path.join(directory, 'foreign.json'), JSON.stringify({ ...work, id: 'foreign', spaceId: '中文空间' }));
    await fs.writeFile(path.join(directory, 'broken.json'), '{'); await fs.writeFile(path.join(directory, 'unsafe name.json'), '{}');
    await fs.writeFile(path.join(root, 'private.json'), JSON.stringify({ ...work, id: 'linked', draft: { title: '不可读取内容', productId: '' } }));
    await fs.symlink(path.join(root, 'private.json'), path.join(directory, 'linked.json')); await fs.mkdir(path.join(directory, 'folder.json'));
    const scan = await scanCreationWorkspaceReferences(directory, 'default'); assert.equal(scan.totalWorkspaceRecords, 6); assert.equal(scan.excludedWorkspaces, 5); assert.deepEqual(scan.works.map(value => value.id), ['valid']); assert.ok(!JSON.stringify(scan).includes('不可读取内容'));
    await fs.symlink(directory, path.join(root, 'linked-index')); await assert.rejects(scanCreationWorkspaceReferences(path.join(root, 'linked-index'), 'default'), /普通目录/);
    for (let i = 0; i < 50; i++) await Promise.all(Array.from({ length: 100 }, (_, j) => fs.writeFile(path.join(directory, `empty_${i}_${j}.json`), '{}')));
    await assert.rejects(scanCreationWorkspaceReferences(directory, 'default'), /5000/);
});
test('source changes identify four direct works and one experiment descendant, exclude unproven same-product works and preserve all actual native contents', async t => {
    const f = await fixture(t); const direct = await Promise.all(['root', 'campaign1', 'campaign2', 'campaign3'].map(f.create));
    const child = await f.h.api.forkCreationWorkspace(direct[0].id, { platform: 'xiaohongshu', capability: 'note-image', requestId: 'experiment-child' });
    const unrelated = await f.h.api.startCreationWorkspace({ platform: 'xiaohongshu', capability: 'note-image', productId: f.snapshot.source.id, requestId: 'unversioned' });
    const before = await Promise.all([...direct, child, unrelated].map(work => f.h.api.inspectCreationWorkspace(work.id)));
    await f.change(); const result = await f.service.check(f.input); const report = result.detail!.report;
    assert.equal(result.changed, true); assert.equal(report.impacts.filter(value => value.kind === 'workspace').length, 5);
    assert.equal(report.impacts.find(value => value.targetId === child.id)!.reason, 'inherited-work'); assert.equal(report.impacts.find(value => value.targetId === child.id)!.viaWorkspaceId, direct[0].id);
    assert.ok(!report.impacts.some(value => value.targetId === unrelated.id)); assert.equal(report.coverage.unversionedSameProductWorkspaces, 1); assert.equal(report.coverage.scannedWorkspaces, 6); assert.equal(report.coverage.completeWithinScope, true);
    assert.equal(report.impacts.find(value => value.targetId === f.evidence.id)!.quoteStatus, 'matches-current-location');
    assert.equal(f.base.getEvidence(f.evidence.id).sourceVersion, f.snapshot.version); assert.equal((await f.intelligence.getOpportunity(f.opportunity.id)).evidence[0].validity, 'stale');
    for (const inspected of before) assert.equal((await f.h.api.inspectCreationWorkspace(inspected.workspace.id)).contentVersion, inspected.contentVersion);
    assert.equal(f.h.state.imageCalls + f.h.state.videoCalls + f.h.state.ttsCalls + f.h.state.publisherCalls.length, 0);
    const first = report.id; assert.equal((await f.service.check({ ...f.input, requestId: 'alias' })).detail!.report.id, first);
    const note = await f.h.api.getXhsNoteProject(direct[0].native.path); await f.h.api.saveXhsNoteProject({ path: note.relativePath, noteType: 'image', expectedRevision: note.version, document: { ...note.document, body: '本轮检查之后的手动编辑' } });
    assert.equal((await f.service.check(f.input)).detail!.report.id, first); assert.notEqual((await f.service.check({ ...f.input, requestId: 'new-round' })).detail!.report.id, first);
});
test('missing sources and affected native files remain explicit; foreign/corrupt index records do not get read as available engineering', async t => {
    const f = await fixture(t); const work = await f.create('root'); await f.change();
    const note = await f.h.api.getXhsNoteProject(work.native.path); await fs.rename(note.projectPath, note.projectPath + '.preserved');
    await fs.writeFile(path.join(f.directory(), 'broken.json'), '{');
    const detail = (await f.service.check(f.input)).detail!; assert.equal(detail.report.impacts.find(value => value.targetId === work.id)!.availability, 'missing'); assert.equal(detail.report.coverage.excludedWorkspaces, 1); assert.equal(detail.report.coverage.completeWithinScope, false);
    const missing = createSourceMaintenanceService(f.repo, { read: async () => { throw Object.assign(new Error('synthetic missing'), { code: 'CI_SOURCE_MISSING' }); } }, f.adapter);
    const gone = await missing.check({ ...f.input, requestId: 'missing-source' }); assert.equal(gone.currentAvailability, 'missing'); assert.deepEqual(gone.detail!.report.fields, []); assert.equal(gone.detail!.report.impacts.find(value => value.kind === 'evidence')!.quoteStatus, 'source-unavailable');
    const metadata = JSON.parse(await fs.readFile(path.join(f.directory(), work.id + '.json'), 'utf8')); await fs.writeFile(path.join(f.directory(), work.id + '.json'), JSON.stringify({ ...metadata, spaceId: '中文空间' }));
    let calls = 0; const guarded = createSourceMaintenanceService(f.repo, f.sources, { ...f.adapter, inspect: async () => { calls++; throw new Error('must not inspect excluded foreign record'); } });
    const foreign = (await guarded.check({ ...f.input, requestId: 'excluded' })).detail!; assert.equal(calls, 0); assert.equal(foreign.report.impacts.find(value => value.targetId === work.id)!.availability, 'unreadable');
    f.h.state.spaceId = '中文空间'; await assert.rejects(f.service.check({ ...f.input, requestId: 'foreign-space' })); assert.deepEqual(f.repo.list(), []);
});
test('infrastructure failure, late space switches, changed scan/source and cyclic ancestry abort without a misleading report', async t => {
    const f = await fixture(t); const work = await f.create('root');
    assert.equal((await f.service.check({ ...f.input, requestId: 'unchanged' })).changed, false); await f.change();
    await assert.rejects(createSourceMaintenanceService(f.repo, { read: async () => { throw new Error('synthetic unavailable infrastructure'); } }, f.adapter).check(f.input), /infrastructure/);
    await assert.rejects(createSourceMaintenanceService(f.repo, f.sources, { ...f.adapter, scan: async () => { const scan = await f.adapter.scan(); f.h.state.spaceId = '中文空间'; return scan; } }).check(f.input), /空间已变化/); f.h.state.spaceId = 'default';
    await assert.rejects(createSourceMaintenanceService(f.repo, f.sources, { ...f.adapter, inspect: async id => { const actual = await f.adapter.inspect(id); actual.workspace.sourceId = 'changed-parent'; return actual; } }).check(f.input), /索引已变化/);
    let reads = 0; await assert.rejects(createSourceMaintenanceService(f.repo, { read: async input => { const value = await f.sources.read(input); return reads++ ? f.snapshot : value; } }, f.adapter).check(f.input), /来源或引用关系已变化/);
    let scans = 0; await assert.rejects(createSourceMaintenanceService(f.repo, f.sources, { ...f.adapter, scan: async () => { const value = await f.adapter.scan(); return scans++ ? { ...value, totalWorkspaceRecords: value.totalWorkspaceRecords + 1 } : value; } }).check(f.input), /工程索引已变化/);
    const file = path.join(f.directory(), work.id + '.json'); const metadata = JSON.parse(await fs.readFile(file, 'utf8')); await fs.writeFile(file, JSON.stringify({ ...metadata, sourceId: work.id }));
    await assert.rejects(f.service.check(f.input), /循环或超限/); assert.equal(f.repo.list().length, 0);
});
