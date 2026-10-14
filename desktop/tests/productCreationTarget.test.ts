import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { transform } from 'esbuild';
import { XHS_PUBLISHER_EXTENSION_ID } from '../shared/xhsPublisher.ts';
import { productVideoHarness, makeProposal } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { resolveProductCreationTarget, ProductCreationTargetSchema, ProductCreationSelectionSchema, assertProductTargetMatch, PRODUCT_CREATION_CAPABILITIES, TIKTOK_MAX_MEDIA_BYTES } from '../shared/productCreationTarget.ts';
import { ProductVideoComposeParamsSchema } from '../shared/productVideoProposal.ts';
import { ProductImageSetProposalSchema, productImageInputKey } from '../shared/productImageSet.ts';
import { buildVideoEditorV2RemotionComposition } from '../shared/videoAutoEditRemotion.ts';
import { createXhsNotePackageManifest } from '../shared/xhsNote.ts';

async function fixture(t: any) {
    const h = await productVideoHarness({ platformVersions: true, productImageSets: true });
    t.after(() => h.close());
    const bytes = createProductVideoVerificationPng('GF-ABC123DEF456');
    h.state.renderBytes = bytes;
    const bundle = await h.store.upsertProduct({ name: '目标版本隔离商品', images: [{ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    const proposal = (platform: 'xiaohongshu' | 'douyin' | 'tiktok', id = `target-${platform}`) => {
        const creationTarget = resolveProductCreationTarget({ platform });
        return ProductVideoComposeParamsSchema.parse({ ...makeProposal(product, id), voiceoverEnabled: false, creationTarget,
            publicationCopy: { title: platform === 'tiktok' ? 'Product details' : '商品细节', description: platform === 'tiktok' ? 'Original product photos and verified details.' : '采用已录入的商品资料与原图展示。', hashtags: ['product'] } });
    };
    const create = async (platform: 'xiaohongshu' | 'douyin' | 'tiktok', id?: string) => {
        const params = proposal(platform, id);
        await h.approveFixture(params, params.proposalId, `session-${params.proposalId}`);
        const result = await h.api.resolveProductVideoApproval(params.proposalId, true);
        assert.equal(result.success, true, result.message);
        return h.api.getVideoEditorV2Project(result.projectId);
    };
    return { h, product, proposal, create };
}

test('target profiles expose four supported combinations and preserve authoritative defaults', () => {
    assert.equal(PRODUCT_CREATION_CAPABILITIES.filter(item => item.creation).length, 4);
    assert.equal(resolveProductCreationTarget({}).language, 'zh-CN');
    assert.equal(resolveProductCreationTarget({ platform: 'tiktok' }).language, 'en');
    assert.equal(resolveProductCreationTarget({ platform: 'tiktok' }).market, 'International');
    assert.throws(() => resolveProductCreationTarget({ platform: 'douyin', contentKind: 'image-set' }));
    assert.throws(() => resolveProductCreationTarget({ platform: 'tiktok', aspectRatio: '16:9' }));
    const landscape = resolveProductCreationTarget({ platform: 'xiaohongshu', aspectRatio: '16:9' });
    assert.deepEqual([landscape.spec.width, landscape.spec.height], [1920, 1080]);
    assert.throws(() => ProductCreationTargetSchema.parse({ ...landscape, spec: { ...landscape.spec, width: 1080 } }));
    assert.throws(() => ProductCreationSelectionSchema.parse({ durationSeconds: 241 }));
    assert.equal(TIKTOK_MAX_MEDIA_BYTES, 10_000_000_000);
    assert.throws(() => assertProductTargetMatch(landscape, resolveProductCreationTarget({ platform: 'douyin' })), /用户选择/);
});

test('direct approvals create platform-native records, recover bindings, and never submit media models', async t => {
    const { h, create } = await fixture(t);
    for (const platform of ['xiaohongshu', 'douyin', 'tiktok'] as const) {
        const project = await create(platform);
        assert.equal(project.creationTarget.platform, platform);
        assert.equal(project.workVersion.publicationBinding.platform, platform);
        const resolved = await h.api.resolveProductWorkVariant(project);
        assert.equal(resolved.resolution, 'bound');
        if (platform === 'xiaohongshu') {
            const note = await h.api.getXhsNoteProject(project.workVersion.publicationBinding.notePath);
            assert.equal(JSON.stringify(note.document.creationTarget), JSON.stringify(project.creationTarget));
            assert.equal(note.document.workVersion.versionId, project.id);
        } else {
            const version = h.api[platform === 'douyin' ? 'getDouyinVideoVersionByProject' : 'getTikTokVideoVersionByProject'](project.id);
            assert.equal(version.projectId, project.id);
            assert.equal(version.description, project.productVideo.proposal.publicationCopy.description);
            assert.equal(project.sourceManuscriptPath, null);
            await h.api.saveVideoEditorV2Project({ ...project, workVersion: undefined });
            const repaired = await h.api.ensureProductVideoWorkBinding(await h.api.getVideoEditorV2Project(project.id));
            assert.equal(repaired.workVersion.publicationBinding.versionId, version.id);
        }
        const again = await h.api.resolveProductVideoApproval(`target-${platform}`, true);
        assert.equal(again.projectId, project.id);
        assert.ok(buildVideoEditorV2RemotionComposition(project)?.scenes[0].safeInsets);
    }
    assert.equal((await h.api.listVideoEditorV2Projects()).length, 3, 'no intermediate XHS videos');
    const notes = await fs.readdir(path.join(h.root, 'default/manuscripts/xiaohongshu'));
    assert.equal(notes.filter(name => name.endsWith('.redvideo')).length, 1);
    assert.deepEqual([h.state.imageCalls, h.state.videoCalls, h.state.ttsCalls], [0, 0, 0]);
    h.restart();
    assert.equal((await h.api.listVideoEditorV2Projects()).length, 3);
});

test('targeted proposals reject changed targets, missing copy, paid defaults and reused identities', async t => {
    const { h, proposal, create } = await fixture(t);
    const params = proposal('douyin');
    assert.throws(() => ProductVideoComposeParamsSchema.parse({ ...params, publicationCopy: undefined }));
    assert.throws(() => ProductVideoComposeParamsSchema.parse({ ...params, voiceoverEnabled: true }));
    await create('douyin');
    const mismatch = await new h.api.ProductVideoComposeTool().execute(proposal('tiktok', params.proposalId), new AbortController().signal);
    assert.equal(mismatch.success, false);
    assert.match(mismatch.error.message, /目标|用户选择/);
    assert.equal((await h.api.listVideoEditorV2Projects()).length, 1);
});

test('platform copies are independent, repeated creation reuses them and stale sources are rejected', async t => {
    const { h, create } = await fixture(t);
    const source = await create('xiaohongshu');
    const before = await fs.readFile(path.join(source.projectDir, 'project.json'));
    const target = resolveProductCreationTarget({ platform: 'tiktok' });
    const request = { sourceProjectId: source.id, expectedUpdatedAt: source.updatedAt, target };
    const copy = await h.api.createProductTargetVariant(request);
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.workVersion.workId, source.id);
    assert.equal(copy.workVersion.sourceVersionId, source.id);
    assert.equal(copy.renderOutputs.length, 0);
    assert.equal(copy.workVersion.publicationBinding.platform, 'tiktok');
    await assert.rejects(h.api.assertProductPublicationTarget(copy, 'tiktok'), /文案/);
    const reviewed = await h.api.reviewProductVariantCopy({ projectId: copy.id, expectedUpdatedAt: copy.updatedAt, confirmed: true });
    assert.equal((await h.api.assertProductPublicationTarget(reviewed, 'tiktok')).resolution, 'bound');
    const again = await h.api.createProductTargetVariant(request);
    assert.equal(again.id, copy.id);
    const third = await h.api.createProductTargetVariant({ ...request, duplicate: true });
    assert.notEqual(third.id, copy.id);
    await h.api.applyProductVideoEditCommand({ projectId: copy.id, command: { type: 'scene.text', sceneId: 'scene-0', text: 'Changed only here' } });
    assert.deepEqual(await fs.readFile(path.join(source.projectDir, 'project.json')), before);
    assert.equal((await h.api.listProductWorkVariants(source.id)).length, 3);
    await assert.rejects(h.api.createProductTargetVariant({ ...request, expectedUpdatedAt: 'stale' }), /更新/);
    await assert.rejects(h.api.assertProductPublicationTarget(copy, 'xiaohongshu'), /目标/);
    h.state.spaceId = 'other';
    await assert.rejects(h.api.listProductWorkVariants(source.id), /不存在/);
});

test('legacy reads do not rewrite files or add safe zones; explicit adoption preserves the rendered composition', async t => {
    const { h, product } = await fixture(t);
    const params = { ...makeProposal(product, 'legacy-target'), voiceoverEnabled: false };
    await h.approveFixture(params);
    const resolution = await h.api.resolveProductVideoApproval('approval-1', true);
    const source = await h.api.getVideoEditorV2Project(resolution.projectId);
    const bytes = await fs.readFile(path.join(source.projectDir, 'project.json'));
    assert.equal((await h.api.resolveProductWorkVariant(source)).resolution, 'unbound');
    assert.deepEqual(await fs.readFile(path.join(source.projectDir, 'project.json')), bytes);
    const oldComposition = buildVideoEditorV2RemotionComposition(source);
    assert.equal(oldComposition?.scenes[0].safeInsets, undefined);
    const adopted = await h.api.bindLegacyProductWorkTarget({ sourceProjectId: source.id, expectedUpdatedAt: source.updatedAt, target: resolveProductCreationTarget({ platform: 'douyin' }) });
    assert.equal(adopted.creationTarget.profileVersion, 0);
    const newComposition = buildVideoEditorV2RemotionComposition(adopted);
    assert.equal(JSON.stringify(newComposition?.scenes), JSON.stringify(oldComposition?.scenes));
    assert.deepEqual([newComposition?.width, newComposition?.height, newComposition?.fps], [oldComposition?.width, oldComposition?.height, oldComposition?.fps]);
    assert.equal((await h.api.resolveProductWorkVariant(adopted)).resolution, 'bound');
});

test('image targets persist a specification and refuse target tampering while retaining legacy keys', async t => {
    const { h, product } = await fixture(t);
    const target = resolveProductCreationTarget({ contentKind: 'image-set' });
    const proposal = ProductImageSetProposalSchema.parse({ creationTarget: target, proposalId: 'target-image', productId: product.id, productUpdatedAt: product.updatedAt, productName: product.name,
        finalTitle: '商品原图资料', body: '本地排版', pages: [{ id: 'cover', role: 'cover', title: '商品展示', productAssetIds: [product.assets[0].id], layout: 'cover' }] });
    const note = await h.api.createProductImageSet(proposal);
    assert.deepEqual(note.document.creationTarget, target);
    const set = note.document.productImageSet;
    assert.ok(productImageInputKey(set, set.pages[0]).includes('1440'));
    const legacy = { ...set, creationTarget: undefined };
    assert.ok(!productImageInputKey(legacy, legacy.pages[0]).includes('"spec"'));
    await assert.rejects(h.api.saveXhsNoteProject({ path: note.relativePath, expectedRevision: note.version, document: { ...note.document, creationTarget: resolveProductCreationTarget({ platform: 'douyin' }) } }), /不可原地/);
    const rendered = await h.api.renderProductImagePage({ path: note.relativePath, expectedRevision: note.version, pageId: 'cover' });
    assert.equal(rendered.document.mediaSlots[0].status, 'ready');
    const manifest = createXhsNotePackageManifest({ document: rendered.document, assets: [], warnings: [] });
    assert.equal(JSON.stringify(manifest.creationTarget), JSON.stringify(target), 'persisted target may omit optional undefined fields');
    assert.equal(manifest.workVersion?.versionId, rendered.document.workVersion.versionId);
    assert.equal(h.state.imageCalls, 0);
});


test('conflicting platform records and stale copy review block publication', async t => {
    const { h, create } = await fixture(t);
    const project = await create('douyin', 'target-conflict');
    h.api.insertTikTokVideoVersion({ id: 'conflicting-tiktok', spaceId: 'default', sourceProjectId: project.id, projectId: project.id, sourceProductId: project.productVideo.productSnapshot.id,
        sourceProductUpdatedAt: project.productVideo.productSnapshot.updatedAt, title: 'Conflict', description: 'Conflict', hashtags: [], language: 'en', market: 'International', revision: 1, createdAt: 1, updatedAt: 1 });
    assert.equal((await h.api.resolveProductWorkVariant(project)).resolution, 'conflict');
    await assert.rejects(h.api.assertProductPublicationTarget(project, 'douyin'), /不一致/);
    await assert.rejects(h.api.reviewProductVariantCopy({ projectId: project.id, expectedUpdatedAt: 'stale', confirmed: true }), /更新/);
    assert.deepEqual([h.state.imageCalls, h.state.videoCalls, h.state.ttsCalls], [0, 0, 0]);
});

test('legacy platform copies follow persisted source chains into one work group without rewriting files', async t => {
    const { h, product } = await fixture(t);
    const params = { ...makeProposal(product, 'legacy-chain'), voiceoverEnabled: false };
    await h.approveFixture(params);
    const approval = await h.api.resolveProductVideoApproval('approval-1', true);
    const source = await h.api.getVideoEditorV2Project(approval.projectId);
    const dy = await h.api.cloneProductVideoProject(source.id, '旧抖音版本');
    const tk = await h.api.cloneProductVideoProject(dy.id, '旧 TikTok 版本');
    const base = { spaceId: 'default', sourceProductId: product.id, sourceProductUpdatedAt: product.updatedAt, title: '商品版本', description: '商品资料', hashtags: [], revision: 1, createdAt: 1, updatedAt: 1 };
    h.api.insertDouyinVideoVersion({ ...base, id: 'legacy-dy-chain', sourceProjectId: source.id, projectId: dy.id });
    h.api.insertTikTokVideoVersion({ ...base, id: 'legacy-tk-chain', sourceProjectId: dy.id, projectId: tk.id, language: 'en', market: 'International' });
    const before = await fs.readFile(path.join(tk.projectDir, 'project.json'));
    const resolved = await h.api.resolveProductWorkVariant(tk);
    assert.equal(resolved.workVersion.workId, source.id);
    assert.equal(resolved.workVersion.sourceVersionId, dy.id);
    assert.equal((await h.api.listProductWorkVariants(source.id)).length, 3);
    assert.deepEqual(await fs.readFile(path.join(tk.projectDir, 'project.json')), before);
    const sql = new DatabaseSync(path.join(h.root, 'approvals.db'));
    sql.prepare('UPDATE douyin_video_versions SET source_project_id = ? WHERE id = ?').run(tk.id, 'legacy-dy-chain');
    sql.close();
    assert.equal((await h.api.resolveProductWorkVariant(tk)).resolution, 'conflict', 'cycles must not imply a work group');
});

test('desktop publication bundle validation accepts the actual three-platform manifest and rejects wider permissions', async t => {
    const source = await fs.readFile(new URL('../electron/appMain.ts', import.meta.url), 'utf8');
    const helper = source.slice(source.indexOf('const isUsableXhsPublisherPluginDir'), source.indexOf('const findBundledXhsPublisherPluginDir'));
    const code = await transform(helper, { loader: 'ts', format: 'cjs' });
    const validate = vm.runInNewContext(code.code + ';isUsableXhsPublisherPluginDir', { fs, path, createHash, Buffer, XHS_PUBLISHER_EXTENSION_ID });
    const plugin = path.resolve(import.meta.dirname, '../../PublishPlugin/src');
    assert.equal(await validate(plugin), true);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-publisher-contract-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const manifest = JSON.parse(await fs.readFile(path.join(plugin, 'manifest.json'), 'utf8'));
    for (const file of [manifest.background.service_worker, manifest.action.default_popup]) await fs.writeFile(path.join(root, file), 'fixture');
    for (const mutation of [
        { host_permissions: [...manifest.host_permissions, '<all_urls>'] },
        { permissions: [...manifest.permissions, 'cookies'] },
        { host_permissions: ['https://creator.xiaohongshu.com/*'] },
    ]) {
        await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, ...mutation }));
        assert.equal(await validate(root), false);
    }
});
