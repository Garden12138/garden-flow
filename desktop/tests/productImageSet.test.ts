import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { ProductImageSetProposalSchema, ProductImageSetSchema, productImageInputKey, renderProductImageHtml } from '../shared/productImageSet.ts';
import { normalizeXhsNoteDocument } from '../shared/xhsNote.ts';
import { applyProductImageSetWorkflowPolicy, evaluateProductImageSetToolPolicy } from '../electron/core/ai/productImageSetWorkflowPolicy.ts';
import { resolveProductVideoVisualPreparation } from '../electron/core/ai/productVideoWorkflowPolicy.ts';
import { shouldRunSubagentOrchestration, shouldUseCoordinator } from '../electron/core/ai/orchestrationPolicy.ts';
import type { IntentRoute } from '../electron/core/ai/types.ts';

const bytes = createProductVideoVerificationPng('GF-ABC123DEF456');
const picture = `data:image/png;base64,${bytes.toString('base64')}`;
const imageSettings = { image_provider: 'openai-compatible', image_provider_template: 'openai-images', image_model: 'fixture-image', image_endpoint: 'https://image.invalid/v1', image_api_key: 'fixture-only' };

async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
    const h = await productVideoHarness({ productImageSets: true });
    t.after(() => h.close());
    h.state.renderBytes = bytes;
    const bundle = await h.store.upsertProduct({ name: '套图验收商品', description: '原图排版验收', images: [{ dataUrl: picture }, { dataUrl: picture }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    const proposal = ProductImageSetProposalSchema.parse({
        proposalId: 'proposal-image-1', productId: product.id, productUpdatedAt: product.updatedAt, productName: product.name,
        finalTitle: '套图验收商品 · 五张图', body: '真实商品图文文案', hashtags: ['商品实拍'],
        pages: Array.from({ length: 5 }, (_, index) => ({ id: `page-${index}`, role: index === 0 ? 'cover' : 'content', title: `商品展示 ${index + 1}`,
            copy: '根据已录入的商品资料介绍', layout: index === 0 ? 'cover' : index === 4 ? 'grid' : 'split', productAssetIds: [product.assets[index % 2].id], aiPrompt: '商品置于自然光桌面，保持参考外观' })),
    });
    const ground = { status: 'verified', productId: product.id, productUpdatedAt: product.updatedAt, imageCount: product.assets.length,
        assets: product.assets.map((asset: any) => ({ assetId: asset.id, visibleText: [], suitability: 'safe' })), aiMotion: { available: false } };
    const approve = (callId = 'approval-image-1', params = proposal) => {
        h.state.tasks.set(`task-${callId}`, { status: 'paused', route: { workflowKind: 'product-image-set-compose' }, artifacts: [], metadata: {
            explicitProductRefs: [{ productId: params.productId, name: params.productName, updatedAt: params.productUpdatedAt }], productAssetVisualGrounding: ground,
        } });
        return h.api.createOrReusePendingToolApproval({ callId, sessionId: 'image-session', taskId: `task-${callId}`, toolName: 'product_image_set_compose',
            proposalId: params.proposalId, proposalDigest: JSON.stringify(params), params,
            details: { type: 'info', title: '套图确认', spaceId: h.state.spaceId, productImageSetReference: product, replanRequest: { message: '给此商品做五张套图' } } });
    };
    const create = () => h.api.createProductImageSet(proposal);
    const edit = (snapshot: any, mutate: (set: any) => void) => {
        const document = structuredClone(snapshot.document);
        mutate(document.productImageSet);
        return h.api.saveXhsNoteProject({ path: snapshot.projectPath, expectedRevision: snapshot.version, document });
    };
    const generate = (snapshot: any, requestId: string, pageId = 'page-0') => h.api.generateProductImagePage({ path: snapshot.projectPath, expectedRevision: snapshot.version,
        pageId, requestId, confirmed: true, reviewedConfigurationKey: h.api.getProductImageGenerationConfig().configurationKey });
    return { h, product, proposal, ground, approve, create, edit, generate };
}

function zipNames(data: Buffer): string[] {
    const result: string[] = [];
    for (let i = 0; i + 46 < data.length; i++) {
        if (data.readUInt32LE(i) !== 0x02014b50) continue;
        const length = data.readUInt16LE(i + 28);
        result.push(data.subarray(i + 46, i + 46 + length).toString());
        i += 45 + length + data.readUInt16LE(i + 30) + data.readUInt16LE(i + 32);
    }
    return result;
}

test('structured image-set routing uses product metadata, foreground planning and the shared visual preflight', () => {
    const route: IntentRoute = { intent: 'image_creation', goal: '套图', recommendedRole: 'image-director', requiredCapabilities: [], requiresHumanApproval: false,
        requiresLongRunningTask: true, requiresMultiAgent: true, confidence: 1, reasoning: 'fixture', source: 'llm' };
    const refs = [{ productId: 'p1', name: '商品', updatedAt: 'v1' }];
    const context = { sessionId: 's1', runtimeMode: 'gardenflow' as const, userInput: '随意文本，无关键词', metadata: { platform: 'xiaohongshu', xhsNoteType: 'image', explicitProductRefs: refs } };
    const result = applyProductImageSetWorkflowPolicy(route, context);
    assert.equal(result.workflowKind, 'product-image-set-compose');
    assert.equal(result.requiresHumanApproval, true);
    assert.equal(shouldRunSubagentOrchestration(result, context), false);
    assert.equal(shouldUseCoordinator(result, context), false);
    assert.equal(resolveProductVideoVisualPreparation({ workflowKind: result.workflowKind, metadata: context.metadata }).action, 'prepare');
    assert.equal(applyProductImageSetWorkflowPolicy(route, { ...context, metadata: { ...context.metadata, activeXhsNotePath: 'note.redpost' } }).workflowKind, undefined);
    assert.equal(applyProductImageSetWorkflowPolicy(route, { ...context, metadata: {}, userInput: '给商品做套图' }).workflowKind, undefined);
    assert.equal(resolveProductVideoVisualPreparation({ workflowKind: result.workflowKind, metadata: { explicitProductRefs: [...refs, { ...refs[0], productId: 'p2' }] } }).action, 'require-product-selection');
});

test('pending approval survives restart, duplicate confirmation creates one independent project and no paid media', async (t) => {
    const { h, product, approve } = await fixture(t);
    h.state.settings = { ...imageSettings };
    approve();
    h.restart();
    const request = await h.api.getProductImageSetApprovalRequest('image-session');
    assert.equal(request.status, 'pending');
    assert.equal(request.params.pages.length, 5);
    const [one, two] = await Promise.all([h.api.resolveProductImageSetApproval('approval-image-1', true), h.api.resolveProductImageSetApproval('approval-image-1', true)]);
    assert.equal(one.status, 'completed', one.error); assert.equal(two.projectId, one.projectId);
    assert.equal((await h.api.resolveProductImageSetApproval('approval-image-1', true)).projectId, one.projectId);
    const snapshot = await h.api.getXhsNoteProject(one.projectId);
    assert.equal(snapshot.document.productImageSet.productSnapshot.id, product.id);
    assert.equal(snapshot.document.mediaSlots.length, 5);
    assert.equal(h.state.tasks.get('task-approval-image-1').artifacts.length, 1);
    assert.equal(JSON.parse(h.state.sessions.get('image-session').metadata).activeXhsNoteUri, snapshot.uri);
    assert.equal((await fs.readdir(path.dirname(snapshot.projectPath))).filter((name) => name.endsWith('.redpost')).length, 1);
    const sourceBytes = await fs.readFile(path.join(snapshot.projectPath, snapshot.document.productImageSet.assets[0].relativePath));
    await h.store.deleteProduct(product.id);
    h.restart();
    assert.deepEqual(await fs.readFile(path.join(snapshot.projectPath, snapshot.document.productImageSet.assets[0].relativePath)), sourceBytes);
    assert.equal((await h.api.getXhsNoteProject(one.projectId)).document.productImageSet.productSnapshot.name, product.name);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('product update or deletion invalidates pending plan; cancellation never creates a project', async (t) => {
    const { h, product, approve, proposal } = await fixture(t);
    approve();
    await h.store.upsertSku({ productId: product.id, name: '新规格' });
    assert.equal((await h.api.getProductImageSetApprovalRequest('image-session')).status, 'invalidated');
    assert.equal((await h.api.resolveProductImageSetApproval('approval-image-1', true)).status, 'invalidated');
    assert.equal((await h.api.getProductImageSetReplanInput('image-session', 'approval-image-1')).message, '给此商品做五张套图');
    assert.equal((await h.api.resolveProductImageSetApproval('approval-image-1', false)).status, 'cancelled');
    assert.equal((await fs.readdir(path.join(h.root, 'default/manuscripts/xiaohongshu')).catch(() => [])).length, 0);
    const fresh = await h.store.getProductCreativeReference(product.id);
    const params = { ...proposal, proposalId: 'delete-plan', productId: fresh.id, productUpdatedAt: fresh.updatedAt, productName: fresh.name };
    // This approval only exercises invalidation; its stale visual evidence cannot authorize a creation.
    approve('delete-card', params);
    await h.store.deleteProduct(product.id);
    assert.equal((await h.api.resolveProductImageSetApproval('delete-card', true)).status, 'invalidated');
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('ownership, product version, visual evidence and space isolation gate creation', async (t) => {
    const { h, product, proposal, ground, create, approve } = await fixture(t);
    for (const toolName of ['image_generate', 'video_generate', 'audio_generate', 'bash', 'app_cli']) assert.equal(evaluateProductImageSetToolPolicy({ workflowKind: 'product-image-set-compose', toolName, args: {} })?.outcome, 'deny');
    const policy = { workflowKind: 'product-image-set-compose' as const, toolName: 'product_image_set_compose', args: proposal,
        explicitProductRefs: [{ productId: product.id, name: product.name, updatedAt: product.updatedAt }], productAssetVisualGrounding: ground as any };
    assert.equal(evaluateProductImageSetToolPolicy(policy), null);
    assert.equal(evaluateProductImageSetToolPolicy({ ...policy, args: { ...proposal, productUpdatedAt: 'old-version' } })?.outcome, 'deny');
    assert.equal(evaluateProductImageSetToolPolicy({ ...policy, args: { ...proposal, pages: [{ ...proposal.pages[0], productAssetIds: ['foreign-asset'] }] } })?.outcome, 'deny');
    await assert.rejects(h.api.createProductImageSet({ ...proposal, pages: [{ ...proposal.pages[0], productAssetIds: ['foreign-asset'] }] }), /不属于/);
    const snapshot = await create(); approve();
    const invalid = { path: snapshot.projectPath, pageId: 'page-0' };
    for (const name of ['getProductImagePagePreview', 'renderProductImagePage', 'generateProductImagePage', 'importProductImageAsset', 'exportProductImageSet']) {
        await assert.rejects(async () => h.api[name]({ ...invalid, confirmed: true, requestId: 'missing-revision', reviewedConfigurationKey: 'fixture', assetId: product.assets[0].id, format: 'zip', outputPath: path.join(h.root, 'invalid.zip') }), /expectedRevision/);
    }
    assert.equal(h.state.renderCalls + h.state.imageCalls, 0);
    h.state.spaceId = 'other';
    assert.equal(await h.api.getProductImageSetApprovalRequest('image-session'), null);
    assert.equal((await h.api.resolveProductImageSetApproval('approval-image-1', true)).success, false);
    await assert.rejects(h.api.getXhsNoteProject(snapshot.projectPath), /超出/);
    await assert.rejects(h.api.createProductImageSet({ ...proposal, proposalId: 'other-plan' }), /不存在/);
    h.state.spaceId = 'default';
    await fs.symlink(path.dirname(snapshot.projectPath), path.join(h.root, 'other/manuscripts/outside')).catch(async () => {
        await fs.mkdir(path.join(h.root, 'other/manuscripts'), { recursive: true });
        await fs.symlink(path.dirname(snapshot.projectPath), path.join(h.root, 'other/manuscripts/outside'));
    });
    h.state.spaceId = 'other';
    await assert.rejects(h.api.getXhsNoteProject(`outside/${path.basename(snapshot.projectPath)}`), /符号链接|超出/);
});

test('local export binds every slot, reuses PNGs and rerenders only edited pages; ZIP follows page order', async (t) => {
    const { h, create, edit } = await fixture(t);
    let snapshot = await create();
    const output = path.join(h.root, 'images.zip');
    snapshot = (await h.api.exportProductImageSet({ path: snapshot.projectPath, expectedRevision: snapshot.version, format: 'zip', outputPath: output })).snapshot;
    assert.equal(h.state.renderCalls, 5);
    assert.equal(snapshot.document.generationStatus, 'generated');
    assert.ok(snapshot.document.mediaSlots.every((slot: any) => slot.status === 'ready' && slot.assetId));
    const firstIds = snapshot.document.mediaSlots.map((slot: any) => slot.assetId);
    snapshot = (await h.api.exportProductImageSet({ path: snapshot.projectPath, expectedRevision: snapshot.version, format: 'zip', outputPath: output })).snapshot;
    assert.equal(h.state.renderCalls, 5); assert.deepEqual(snapshot.document.mediaSlots.map((slot: any) => slot.assetId), firstIds);
    snapshot = await edit(snapshot, (set) => { set.pages[2].copy = '改过的页面文案'; [set.pages[1], set.pages[2]] = [set.pages[2], set.pages[1]]; });
    assert.equal(snapshot.document.mediaSlots[1].status, 'stale');
    await assert.rejects(h.api.exportXhsMaterialPackage({ path: snapshot.projectPath, outputPath: output, allowExternalOutput: true }), /过期/);
    snapshot = (await h.api.exportProductImageSet({ path: snapshot.projectPath, expectedRevision: snapshot.version, format: 'zip', outputPath: output })).snapshot;
    assert.equal(h.state.renderCalls, 6);
    const names = zipNames(await fs.readFile(output));
    assert.deepEqual(names.filter((name) => name.startsWith('assets/')), ['assets/01-封面.png', 'assets/02-内容页.png', 'assets/03-内容页.png', 'assets/04-内容页.png', 'assets/05-内容页.png']);
    assert.ok(names.includes('content.md') && names.includes('manifest.json'));
    assert.equal(snapshot.document.mediaSlots[1].pageId, 'page-2');
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
    h.restart();
    snapshot = await h.api.recoverProductImageSet(snapshot.projectPath);
    assert.equal(snapshot.document.generationStatus, 'generated');
    await h.api.exportProductImageSet({ path: snapshot.projectPath, expectedRevision: snapshot.version, format: 'directory', outputPath: path.join(h.root, 'images') });
    assert.equal(h.state.renderCalls, 6);
    assert.equal((await fs.readdir(path.join(h.root, 'images'))).length, 5);
});

test('preview, import and recovery keep the originating space across asynchronous reads', async (t) => {
    const { h, create } = await fixture(t);
    let snapshot = await create();
    const upload = await h.api.createGeneratedMediaAsset({ dataBuffer: bytes, prompt: 'fixture upload', mimeType: 'image/png', provider: 'fixture' });
    const preview = h.api.getProductImagePagePreview({ path: snapshot.relativePath, pageId: 'page-0', expectedRevision: snapshot.version });
    h.state.spaceId = 'other';
    assert.ok((await preview).html.includes('商品展示'));
    h.state.spaceId = 'default';
    const imported = h.api.importProductImageAsset({ path: snapshot.relativePath, pageId: 'page-0', expectedRevision: snapshot.version, assetId: upload.id });
    h.state.spaceId = 'other';
    snapshot = await imported;
    assert.equal(snapshot.document.productImageSet.spaceId, 'default');
    assert.equal(snapshot.document.productImageSet.assets.at(-1).kind, 'upload');
    h.state.spaceId = 'default';
    snapshot = await h.api.mutateProductImageSetProject(snapshot.projectPath, (current: any) => {
        const generation = { requestId: 'origin-recovery', inputKey: 'before-exit', startedAt: new Date().toISOString(), status: 'generating' };
        current.document.productImageSet.pages[0].generation = generation;
        current.document.productImageSet.generationHistory.push({ ...generation, pageId: 'page-0' });
    });
    const recovered = h.api.recoverProductImageSet(snapshot.relativePath);
    h.state.spaceId = 'other';
    snapshot = await recovered;
    assert.equal(snapshot.document.productImageSet.pages[0].generation.status, 'interrupted');
    assert.equal((await fs.readdir(path.join(h.root, 'other/manuscripts')).catch(() => [])).length, 0);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('multi-page export continues in its originating space after a space switch', async (t) => {
    const { h, create } = await fixture(t);
    const snapshot = await create();
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    h.state.renderHook = async () => {
        h.state.renderHook = null;
        started(); await new Promise<void>((resolve) => { release = resolve; });
    };
    const exported = h.api.exportProductImageSet({ path: snapshot.relativePath, expectedRevision: snapshot.version, format: 'zip', outputPath: path.join(h.root, 'origin.zip') });
    await entered;
    h.state.spaceId = 'other'; release();
    const result = await exported;
    assert.equal(result.snapshot.document.productImageSet.spaceId, 'default');
    assert.equal(result.snapshot.document.generationStatus, 'generated');
    assert.equal(h.state.renderCalls, 5);
    assert.equal(zipNames(await fs.readFile(result.outputPath)).filter((name) => name.startsWith('assets/')).length, 5);
    assert.equal((await fs.readdir(path.join(h.root, 'other/media')).catch(() => [])).length, 0);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('template rendering escapes user text; schema and document guards preserve old notes and protected records', async (t) => {
    const { h, proposal, create, edit } = await fixture(t);
    const snapshot = await create(); const set = snapshot.document.productImageSet;
    const page = { ...set.pages[0], title: '<script>alert(1)</script>', copy: '<img src=x>' };
    const html = renderProductImageHtml(set, page, { [page.productAssetIds[0]]: picture });
    assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(html.includes("script-src 'none'"));
    assert.throws(() => renderProductImageHtml(set, page, { [page.productAssetIds[0]]: 'https://evil.invalid/image.png' }), /不可用/);
    assert.equal(ProductImageSetSchema.safeParse({ ...set, pages: [...set.pages].reverse() }).success, false);
    await assert.rejects(edit(snapshot, (next) => { next.productSnapshot.name = '篡改'; }), /快照/);
    await assert.rejects(edit(snapshot, (next) => { next.pages[0].render = { assetId: 'foreign', inputKey: 'fake' }; }), /记录/);
    await assert.rejects(edit(snapshot, (next) => { next.generationHistory.push({ pageId: 'page-0' }); }), /快照/);
    await assert.rejects(h.api.saveXhsNoteProject({ path: snapshot.projectPath, document: snapshot.document }), /expectedRevision/);
    const plain = normalizeXhsNoteDocument({ finalTitle: '旧图文', body: '旧正文' }, 'image');
    const video = normalizeXhsNoteDocument({ finalTitle: '旧视频' }, 'video');
    assert.equal(plain.productImageSet, undefined); assert.equal(video.productImageSet, undefined);
    assert.equal(normalizeXhsNoteDocument({ ...snapshot.document, noteType: 'video' }, 'video').productImageSet, undefined);
    const edited = await edit(snapshot, (next) => { next.pages.pop(); next.pages.push({ ...proposal.pages[1], id: 'new-page' }); });
    assert.equal(edited.document.mediaSlots.at(-1).pageId, 'new-page');
});

test('render result cannot overwrite concurrent edits or mark a partial set complete', async (t) => {
    const { h, create, edit } = await fixture(t);
    let snapshot = await create();
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    h.state.renderHook = async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); };
    const render = h.api.renderProductImagePage({ path: snapshot.projectPath, pageId: 'page-0', expectedRevision: snapshot.version });
    await entered;
    snapshot = await edit(snapshot, (set) => { set.pages[0].title = '并发修改标题'; });
    release(); await assert.rejects(render, /渲染期间已修改/);
    snapshot = await h.api.getXhsNoteProject(snapshot.projectPath);
    assert.equal(snapshot.document.productImageSet.pages[0].title, '并发修改标题');
    assert.equal(snapshot.document.productImageSet.pages[0].render, undefined);
    assert.equal(snapshot.document.generationStatus, 'draft');
    assert.equal((await h.api.listMediaAssets()).length, 1);
});

test('missing exported media is rerendered and corrupt copied sources identify their page', async (t) => {
    const { h, create } = await fixture(t);
    let snapshot = await create();
    snapshot = await h.api.renderProductImagePage({ path: snapshot.projectPath, pageId: 'page-0', expectedRevision: snapshot.version });
    const firstId = snapshot.document.productImageSet.pages[0].render.assetId;
    const media = (await h.api.listMediaAssets()).find((asset: any) => asset.id === firstId);
    await fs.rm(h.api.getAbsoluteMediaPath(media.relativePath));
    snapshot = await h.api.getXhsNoteProject(snapshot.projectPath);
    assert.equal(snapshot.document.mediaSlots[0].status, 'missing');
    snapshot = await h.api.renderProductImagePage({ path: snapshot.projectPath, pageId: 'page-0', expectedRevision: snapshot.version });
    assert.equal(h.state.renderCalls, 2);
    assert.notEqual(snapshot.document.productImageSet.pages[0].render.assetId, firstId);
    const source = snapshot.document.productImageSet.assets[0];
    await fs.writeFile(path.join(snapshot.projectPath, source.relativePath), 'corrupt source');
    await assert.rejects(h.api.getProductImagePagePreview({ path: snapshot.projectPath, pageId: 'page-0', expectedRevision: snapshot.version }), /封面.*图片.*外部修改/);
    assert.equal(snapshot.document.generationStatus, 'draft');
});

test('rendered media linked outside its space cannot be reused or included in an export', async (t) => {
    const { h, create } = await fixture(t);
    let snapshot = await create();
    snapshot = await h.api.renderProductImagePage({ path: snapshot.projectPath, pageId: 'page-0', expectedRevision: snapshot.version });
    const previousId = snapshot.document.productImageSet.pages[0].render.assetId;
    const media = (await h.api.listMediaAssets()).find((asset: any) => asset.id === previousId);
    const outside = path.join(h.root, 'other/media/outside.png');
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, bytes);
    const local = h.api.getAbsoluteMediaPath(media.relativePath);
    await fs.rm(local); await fs.symlink(outside, local);
    snapshot = await h.api.getXhsNoteProject(snapshot.projectPath);
    assert.equal(snapshot.document.mediaSlots[0].status, 'missing');
    const result = await h.api.exportProductImageSet({ path: snapshot.projectPath, expectedRevision: snapshot.version, format: 'zip', outputPath: path.join(h.root, 'safe.zip') });
    assert.notEqual(result.snapshot.document.productImageSet.pages[0].render.assetId, previousId);
    assert.equal(h.state.renderCalls, 6);
    assert.deepEqual(await fs.readFile(outside), bytes);
    assert.equal(result.snapshot.document.generationStatus, 'generated');
});

test('AI submits one referenced image per page, persists failures and history, and rejects unreviewed or unsupported models', async (t) => {
    const { h, create, generate } = await fixture(t);
    h.state.settings = { ...imageSettings };
    let snapshot = await create();
    await assert.rejects(h.api.generateProductImagePage({ path: snapshot.projectPath, pageId: 'page-0', expectedRevision: snapshot.version, requestId: 'unreviewed', confirmed: true }), /重新确认/);
    h.state.settings.image_provider_template = 'gemini-imagen-native';
    await assert.rejects(generate(snapshot, 'unsupported'), /不支持/);
    h.state.settings = { ...imageSettings };
    h.state.imageHook = async (input) => { assert.equal(input.count, 1); assert.equal(input.generationMode, 'reference-guided'); assert.equal(input.referenceImages.length, 1); throw new Error('fixture-provider-failure'); };
    await assert.rejects(generate(snapshot, 'request-failed'), /fixture-provider-failure/);
    snapshot = await h.api.getXhsNoteProject(snapshot.projectPath);
    assert.equal(snapshot.document.productImageSet.pages[0].generation.status, 'failed');
    await generate(snapshot, 'request-failed'); assert.equal(h.state.imageCalls, 1);
    h.state.imageHook = async (input) => ({ success: true, assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: bytes, prompt: input.prompt, mimeType: 'image/png', provider: 'fixture-ai' })] });
    const [one, two] = await Promise.all([generate(snapshot, 'request-success'), generate(snapshot, 'request-success')]);
    snapshot = one; assert.equal(two.version, one.version); assert.equal(h.state.imageCalls, 2);
    assert.ok(snapshot.document.productImageSet.pages[0].backgroundAssetId?.startsWith('ai-'));
    assert.equal(snapshot.document.productImageSet.generationHistory.length, 2);
    await generate(snapshot, 'request-failed'); assert.equal(h.state.imageCalls, 2);
    h.restart(); snapshot = await h.api.recoverProductImageSet(snapshot.projectPath);
    await generate(snapshot, 'request-success'); assert.equal(h.state.imageCalls, 2);
    assert.equal(h.state.videoCalls + h.state.ttsCalls, 0);
});

test('AI result after page editing remains a selectable asset and space switch cannot redirect its files', async (t) => {
    const { h, create, edit, generate } = await fixture(t);
    h.state.settings = { ...imageSettings };
    let snapshot = await create();
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    h.state.imageHook = async (input) => {
        started(); await new Promise<void>((resolve) => { release = resolve; });
        return { success: true, assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: bytes, prompt: input.prompt, mimeType: 'image/png', provider: 'fixture-ai' })] };
    };
    const alias = path.join(path.dirname(snapshot.projectPath), 'alias.redpost');
    await fs.symlink(snapshot.projectPath, alias);
    const pending = generate(snapshot, 'stale-request');
    assert.equal(generate({ ...snapshot, projectPath: alias }, 'stale-request'), pending);
    await entered;
    for (let attempt = 0; attempt < 100; attempt++) {
        snapshot = await h.api.getXhsNoteProject(snapshot.projectPath);
        if (snapshot.document.productImageSet.pages[0].generation.jobId) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const active = await h.api.recoverProductImageSet(alias);
    assert.equal(active.document.productImageSet.pages[0].generation.status, 'generating');
    assert.equal(active.document.productImageSet.generationHistory[0].status, 'generating');
    snapshot = await edit(snapshot, (set) => { set.pages[0].copy = '生成中编辑的文案'; });
    h.state.spaceId = 'other'; release(); snapshot = await pending;
    assert.equal(snapshot.document.productImageSet.pages[0].backgroundAssetId, undefined);
    assert.match(snapshot.document.productImageSet.pages[0].generation.error, /已修改/);
    assert.equal(snapshot.document.productImageSet.pages[0].copy, '生成中编辑的文案');
    assert.equal(snapshot.document.productImageSet.assets.filter((asset: any) => asset.kind === 'ai').length, 1);
    assert.equal((await fs.readdir(path.join(h.root, 'other/media')).catch(() => [])).length, 0);
    assert.equal(h.state.imageCalls, 1);
});

test('restart marks a paid interrupted request without resubmission and editor policy blocks generation bypasses', async (t) => {
    const { h, create, generate } = await fixture(t);
    h.state.settings = { ...imageSettings };
    let snapshot = await create();
    snapshot = await h.api.mutateProductImageSetProject(snapshot.projectPath, (current: any) => {
        const set = current.document.productImageSet;
        const generation = { requestId: 'interrupted-request', inputKey: 'before-exit', startedAt: new Date().toISOString(), status: 'generating' };
        set.pages[0].generation = generation; set.generationHistory.push({ ...generation, pageId: 'page-0' });
    });
    h.restart(); snapshot = await h.api.recoverProductImageSet(snapshot.projectPath);
    assert.equal(snapshot.document.productImageSet.pages[0].generation.status, 'interrupted');
    assert.equal(snapshot.document.productImageSet.generationHistory[0].status, 'interrupted');
    await generate(snapshot, 'interrupted-request'); assert.equal(h.state.imageCalls, 0);
    const tool = new h.api.ProductImageSetComposeTool();
    const context = { sessionId: 's1', toolPack: 'gardenflow', productImageSetEditing: true };
    for (const [toolName, args] of [['image_generate', {}], ['audio_generate', {}], ['video_generate', {}], ['bash', { command: 'anything' }], ['app_cli', { command: 'image generate --prompt scene' }]] as const) {
        assert.equal(h.api.evaluateRuntimeToolPermission({ tool, toolName, args, context }).outcome, 'deny');
    }
});
