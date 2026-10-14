import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { productVideoHarness, makeProposal } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { resolveProductCreationTarget } from '../shared/productCreationTarget.ts';
import { ProductVideoComposeParamsSchema } from '../shared/productVideoProposal.ts';
import { ProductImageSetProposalSchema } from '../shared/productImageSet.ts';

// A valid deterministic PNG fixture; production decoding is exercised in Electron acceptance.
function png(width = 1440, height = 1920) {
    const chunk = (name: string, bytes: Buffer) => {
        const data = Buffer.concat([Buffer.from(name), bytes]); let crc = 0xffffffff;
        for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
        const result = Buffer.alloc(data.length + 8); result.writeUInt32BE(bytes.length); data.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
const settings = { visibility: 'everyone', allowComments: true, allowReuse: false, allowRemix: false, audience18Plus: false, commercialContent: 'none', aiGenerated: false };
async function fixture(t: any) {
    const h = await productVideoHarness({ publication: true, platformVersions: true, productImageSets: true }); t.after(() => h.close());
    h.state.renderBytes = png();
    const original = createProductVideoVerificationPng('GF-ABC123DEF456');
    const bundle = await h.store.upsertProduct({ name: '统一发布隔离商品', images: [{ dataUrl: `data:image/png;base64,${original.toString('base64')}` }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    const video = async (platform: 'xiaohongshu' | 'douyin' | 'tiktok') => {
        const proposal = ProductVideoComposeParamsSchema.parse({ ...makeProposal(product, `pub-${platform}`), creationTarget: resolveProductCreationTarget({ platform }), voiceoverEnabled: false,
            publicationCopy: { title: 'Product', description: 'Verified product details', hashtags: ['product'] } });
        await h.approveFixture(proposal, proposal.proposalId);
        const approved = await h.api.resolveProductVideoApproval(proposal.proposalId, true); assert.equal(approved.success, true, approved.message);
        let project = await h.api.getVideoEditorV2Project(approved.projectId);
        if (platform === 'tiktok') {
            const version = h.api.getTikTokVideoVersionByProject(project.id);
            await h.api.saveTikTokVideoVersion({ ...version, versionId: version.id, expectedRevision: version.revision, publishSettings: settings });
            project = await h.api.getVideoEditorV2Project(project.id);
        }
        const asset = await h.api.createGeneratedMediaAsset({ prompt: 'local fixture', dataBuffer: Buffer.from('local video bytes'), mimeType: 'video/mp4' });
        project = await h.api.saveVideoEditorV2Project({ ...project, status: 'exported', renderOutputs: [{ id: 'render-fixture', mediaAssetId: asset.id, path: h.api.getAbsoluteMediaPath(asset.relativePath), createdAt: new Date().toISOString(), durationMs: project.timeline.durationMs, renderFingerprint: h.api.videoRenderFingerprint(project) }] });
        await h.api.syncProductVideoTargetExport(project);
        return { kind: 'video', projectId: project.id };
    };
    const images = async (count = 5) => {
        const proposal = ProductImageSetProposalSchema.parse({ proposalId: `pub-images-${count}`, productId: product.id, productUpdatedAt: product.updatedAt, productName: product.name,
            creationTarget: resolveProductCreationTarget({ contentKind: 'image-set', pageCount: count }), finalTitle: '商品套图', body: '真实商品原图', hashtags: ['商品'],
            pages: Array.from({ length: count }, (_, i) => ({ id: `page-${i}`, role: i === 0 ? 'cover' : 'content', title: '商品', copy: '原图展示', layout: i === 0 ? 'cover' : 'split', productAssetIds: [product.assets[0].id] })) });
        let note = await h.api.createProductImageSet(proposal);
        for (const page of note.document.productImageSet.pages) note = await h.api.renderProductImagePage({ path: note.relativePath, pageId: page.id, expectedRevision: note.version });
        return { kind: 'image-set', path: note.relativePath };
    };
    const prepare = async (source: any, extra = {}) => {
        const snapshot = await h.api.readPublicationSource(source); return h.api.preparePublication({ source, expectedRevision: snapshot.revision, ...extra });
    };
    const action = (job: any, name: string, acknowledged = false) => h.api.withPublicationButton(name, job.id, () => h.api.actOnPublication({ platform: job.platform, jobId: job.id, expectedDigest: job.contentDigest, acknowledged }, name));
    const settle = async (job: any) => {
        const service = job.platform === 'xiaohongshu' ? h.api.getXhsPublisherService() : job.platform === 'douyin' ? h.api.getDouyinPublisherService() : h.api.getTikTokPublisherService();
        await service.queue; return h.api.readPublicationJob(job.platform, job.id);
    };
    const enable = async (platform: string, enabled = true) => {
        const directory = path.join(h.root, 'default/gardenflow'); await fs.mkdir(directory, { recursive: true });
        const file = path.join(directory, 'background-runner.json'); const config = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({ builtinTasks: {} }));
        config.builtinTasks[platform === 'xiaohongshu' ? 'xhs-auto-publish' : `${platform}-auto-publish`] = { enabled };
        await fs.writeFile(file, JSON.stringify(config));
    };
    return { h, video, images, prepare, action, settle, enable };
}
for (const platform of ['xiaohongshu', 'douyin', 'tiktok', 'image-set'] as const) test(`${platform}: prepare stays local, separate buttons and restart retain the uploaded checkpoint`, async t => {
    const { h, video, images, prepare, action, settle } = await fixture(t);
    const source = platform === 'image-set' ? await images() : await video(platform);
    const [one, two] = await Promise.all([prepare(source), prepare(source)]); assert.equal(one.id, two.id); assert.equal(one.phase, 'awaiting-upload');
    assert.equal(h.state.publisherCalls.filter(call => call.method === 'publisher.publish').length, 0);
    await assert.rejects(action(one, 'submit'), /先点击上传/);
    await assert.rejects(h.api.actOnPublication({ platform: one.platform, jobId: one.id, expectedDigest: one.contentDigest }, 'upload'), /按钮/);
    const [uploaded, duplicate] = await Promise.all([action(one, 'upload'), action(one, 'upload')]); assert.equal(uploaded.id, duplicate.id); assert.equal(uploaded.phase, 'awaiting-submit', uploaded.errorMessage);
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'prepare').length, 1);
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
    h.restart(); const reopened = h.api.readPublicationJob(one.platform, one.id); assert.equal(reopened.phase, 'awaiting-submit');
    await action(reopened, 'submit'); const done = await settle(reopened); assert.equal(done.publishStatus, 'published');
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 1);
    await assert.rejects(action(done, 'submit')); assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 1);
    assert.deepEqual([h.state.imageCalls, h.state.videoCalls, h.state.ttsCalls], [0, 0, 0]);
});
for (const count of [18, 19, 20]) test(`image-set ${count}: application limit blocks only publication, identical images retain page order`, async t => {
    const { h, images, prepare, action } = await fixture(t); const source = await images(count);
    if (count > 18) { await assert.rejects(prepare(source), /应用发布限制.*18/); assert.equal(h.api.listPublicationJobs().length, 0); return; }
    const job = await prepare(source); assert.equal(job.media.length, count); assert.equal(new Set(job.media.map((media: any) => media.sha256)).size, 1);
    assert.equal(new Set(job.media.map((media: any) => media.path)).size, count); assert.equal(job.media[0].role, 'cover');
    await action(job, 'upload'); const request = h.state.publisherCalls.find(call => call.params.phase === 'prepare')!.params.request;
    assert.deepEqual(Array.from(request.media, (media: any) => media.order), Array.from({ length: count }, (_, i) => i));
});
test('source, account, browser, dirty draft, stale media and foreign-space checks fail before upload or submission', async t => {
    const { h, video, prepare, action } = await fixture(t); const source = await video('douyin'); const job = await prepare(source);
    h.state.accountId = 'other'; await assert.rejects(action(job, 'upload'), /账号/); h.state.accountId = 'fixture_account';
    h.state.connected = false; await assert.rejects(action(job, 'upload'), /插件/); h.state.connected = true;
    h.api.setDouyinPublisherBinding('other-browser'); await assert.rejects(action(job, 'upload'), /浏览器/); h.api.setDouyinPublisherBinding('fixture-browser');
    h.state.spaceId = 'foreign'; assert.equal(h.api.listPublicationJobs().length, 0); await assert.rejects(action(job, 'upload'), /不存在|空间/); h.state.spaceId = 'default';
    await h.api.syncProductEditorDraft(source, true); await assert.rejects(action(job, 'upload'), /保存/); await h.api.syncProductEditorDraft(source, false);
    await action(job, 'upload'); await fs.writeFile(job.media[0].path, 'changed bytes'); await assert.rejects(action(job, 'submit'), /媒体|更新/);
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
});
test('editing during upload and incomplete plugin readback cannot grant final confirmation', async t => {
    const { h, video, prepare, action } = await fixture(t); const source = await video('tiktok'); const job = await prepare(source);
    h.state.publisherHook = async (method, params) => { if (params.phase === 'prepare') { await h.api.syncProductEditorDraft(source, true); return { ok: true, prepared: true, jobId: job.id, contentDigest: job.contentDigest, publishStatus: 'not_submitted' }; } };
    const failed = await action(job, 'upload'); assert.equal(failed.status, 'blocked'); assert.equal(failed.phase, 'awaiting-upload');
    await assert.rejects(action(failed, 'submit')); assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
});
test('copy changes invalidate confirmation while the video remains reusable; protected published history stays frozen', async t => {
    const { h, video, prepare, action, settle } = await fixture(t); const source = await video('douyin'); const first = await prepare(source); await action(first, 'upload');
    const snapshot = await h.api.readProductProjectEditor(source);
    await h.api.applyProductProjectEdit({ binding: snapshot.binding, requestId: 'copy-edit', expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch, operations: [{ type: 'publication.copy', title: 'Updated', description: 'Updated details', hashtags: ['product'] }] });
    await assert.rejects(action(first, 'submit'), /更新|失效/); const updated = await prepare(source); assert.notEqual(updated.id, first.id); assert.equal(updated.media[0].sha256, first.media[0].sha256);
    await action(updated, 'upload'); await action(updated, 'submit'); await settle(updated); const saved = JSON.stringify(h.api.readPublicationJob(updated.platform, updated.id).context);
    h.restart(); assert.equal(JSON.stringify(h.api.readPublicationJob(updated.platform, updated.id).context), saved);
});
test('completion is offline, independent per platform, semantic idempotent, dismissible and delivered only to its editor session', async t => {
    const { h, video, enable } = await fixture(t); const source = await video('douyin'); h.state.connected = false;
    await h.api.recordCompletedPublication(source); assert.equal(h.state.messages.filter(message => JSON.parse(message.metadata || '{}').publicationOffer).length, 0);
    await enable('douyin'); await h.api.recoverPublicationCompletions(); assert.equal(h.state.messages.filter(message => JSON.parse(message.metadata || '{}').publicationOffer).length, 0);
    await h.api.recordCompletedPublication(source); await h.api.recordCompletedPublication(source);
    let offers = h.api.listPublicationCompletions(); assert.equal(offers.filter((event: any) => event.state === 'offered').length, 1);
    const event = offers[0]; const message = h.state.messages.find(message => message.id === event.messageId)!;
    assert.equal(message.session_id, (await h.api.getProductProjectEditorSession(source)).sessionId);
    h.api.dismissPublicationOffer(event.id); h.restart(); await h.api.recoverPublicationCompletions(); await h.api.recordCompletedPublication(source);
    assert.equal(h.api.listPublicationCompletions()[0].state, 'dismissed'); assert.equal(h.state.messages.filter(message => JSON.parse(message.metadata || '{}').publicationOffer).length, 1);
    const snapshot = await h.api.readProductProjectEditor(source);
    await h.api.applyProductProjectEdit({ binding: snapshot.binding, requestId: 'new-copy', expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch, operations: [{ type: 'publication.copy', title: 'New', description: 'New description', hashtags: [] }] });
    await h.api.recordCompletedPublication(source); offers = h.api.listPublicationCompletions(); assert.equal(offers.filter((event: any) => event.state === 'offered').length, 1);
    assert.equal(h.state.publisherCalls.length, 0); assert.deepEqual([h.state.imageCalls, h.state.videoCalls, h.state.ttsCalls], [0, 0, 0]);
});
test('pending delivery resumes exactly once; switching off cancels automatic jobs while keeping manual and submitted snapshots', async t => {
    const { h, video, enable, prepare, action } = await fixture(t); const source = await video('tiktok'); await enable('tiktok');
    await h.api.recordCompletedPublication(source); const event = h.api.listPublicationCompletions()[0];
    h.api.updatePublicationCompletion({ ...event, state: 'pending' }); h.restart(); await h.api.recoverPublicationCompletions(); await h.api.recoverPublicationCompletions();
    assert.equal(h.state.messages.filter(message => message.id === event.messageId).length, 1);
    const auto = await prepare(source, { origin: 'completion', promptId: event.id }); await enable('tiktok', false); await h.api.cancelAutomaticPublications('tiktok-auto-publish'); assert.equal(h.api.readPublicationJob('tiktok', auto.id).status, 'cancelled');
    const manual = await prepare(source); await h.api.cancelAutomaticPublications('tiktok-auto-publish'); assert.equal(h.api.readPublicationJob('tiktok', manual.id).status, 'awaiting_confirmation');
    await action(manual, 'upload'); h.state.submitStatus = 'unknown'; await action(manual, 'submit'); await h.api.getTikTokPublisherService().queue;
    const frozen = JSON.stringify(h.api.readPublicationJob('tiktok', manual.id).context); h.restart(); await h.api.cancelAutomaticPublications('tiktok-auto-publish');
    assert.equal(h.api.readPublicationJob('tiktok', manual.id).publishStatus, 'unknown'); assert.equal(JSON.stringify(h.api.readPublicationJob('tiktok', manual.id).context), frozen);
});
test('full-suite export triggers once; single PNG, save and failed export do not ask', async t => {
    const { h, images, enable } = await fixture(t); const source = await images(); await enable('xiaohongshu');
    let note = await h.api.getXhsNoteProject(source.path);
    await h.api.exportProductImageSet({ path: source.path, expectedRevision: note.version, format: 'png', pageId: 'page-0', outputPath: path.join(h.root, 'single.png') }); assert.equal(h.api.listPublicationCompletions().length, 0);
    await assert.rejects(h.api.exportProductImageSet({ path: source.path, expectedRevision: note.version, format: 'directory', outputPath: '/dev/null/fail' })); assert.equal(h.api.listPublicationCompletions().length, 0);
    await h.api.exportProductImageSet({ path: source.path, expectedRevision: note.version, format: 'directory', outputPath: path.join(h.root, 'suite') });
    note = await h.api.getXhsNoteProject(source.path); await h.api.exportProductImageSet({ path: source.path, expectedRevision: note.version, format: 'zip', outputPath: path.join(h.root, 'suite.zip') });
    assert.equal(h.api.listPublicationCompletions().length, 1); assert.equal(h.state.publisherCalls.length, 0);
});
test('legacy confirmation cannot submit after upgrade; re-preparing restores only upload permission', async t => {
    const { h, video, prepare, action } = await fixture(t); const source = await video('douyin'); const original = await prepare(source);
    h.sql.prepare('DELETE FROM publication_job_contexts WHERE job_id = ?').run(original.id);
    const legacy = h.api.readPublicationJob('douyin', original.id); assert.equal(legacy.phase, 'legacy'); await assert.rejects(action(legacy, 'submit'), /旧确认/);
    const fresh = await prepare(source); assert.equal(fresh.phase, 'awaiting-upload'); await assert.rejects(action(fresh, 'submit'), /先点击上传/);
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
});
test('unsupported combinations, overwritten source identity, missing or damaged pages, and absent TikTok settings fail closed', async t => {
    const { h, images, video, prepare } = await fixture(t);
    assert.throws(() => resolveProductCreationTarget({ platform: 'douyin', contentKind: 'image-set' }));
    assert.throws(() => resolveProductCreationTarget({ platform: 'tiktok', contentKind: 'image-set' }));
    const source = await images(); const snapshot = await h.api.readPublicationSource(source);
    await assert.rejects(h.api.preparePublication({ source, expectedRevision: snapshot.revision, platform: 'douyin', accountId: 'spoof' }));
    await fs.writeFile(snapshot.media[2].path, 'broken'); await assert.rejects(prepare(source), /PNG|损坏/);
    const target = await video('tiktok'); const version = h.api.getTikTokVideoVersionByProject(target.projectId);
    h.sql.prepare('UPDATE tiktok_video_versions SET document_json = ? WHERE id = ?').run(JSON.stringify({ ...version, publishSettings: undefined }), version.id);
    await assert.rejects(prepare(target), /明确选择/); assert.equal(h.api.listPublicationJobs().length, 0);
});
test('failed upload readback retries only after fresh checks and never automatically submits', async t => {
    const { h, images, prepare, action } = await fixture(t); const source = await images(); const job = await prepare(source);
    h.state.publisherHook = async (_method, params) => params.phase === 'prepare' ? { ok: true, prepared: true, jobId: job.id, contentDigest: job.contentDigest, publishStatus: 'not_submitted', uploadReview: { jobId: job.id, contentDigest: job.contentDigest, accountId: h.state.accountId, pageFingerprint: 'bad count', mediaCount: 4 } } : undefined;
    const failed = await action(job, 'upload'); assert.equal(failed.status, 'blocked'); assert.equal(failed.phase, 'awaiting-upload');
    await assert.rejects(action(failed, 'submit'), /先点击上传/); h.state.publisherHook = null; const retry = await action(failed, 'upload'); assert.equal(retry.phase, 'awaiting-submit');
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'prepare').length, 2); assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
});
test('platform upload errors preserve the concrete page failure without granting final permission', async t => {
    const { h, images, prepare, action } = await fixture(t); const job = await prepare(await images());
    h.state.publisherHook = async (_method, params) => params.phase === 'prepare' ? { ok: false, jobId: job.id, code: 'IMAGE_ORDER_UNVERIFIED', message: '第 2 张图片的顺序无法核对', publishStatus: 'not_submitted' } : undefined;
    const failed = await action(job, 'upload'); assert.equal(failed.phase, 'awaiting-upload'); assert.equal(failed.status, 'blocked'); assert.match(failed.errorMessage, /IMAGE_ORDER_UNVERIFIED.*第 2 张/);
    await assert.rejects(action(failed, 'submit'), /先点击上传/); assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
});
test('XHS visibility and immediate-publish settings are required, retained and absent from legacy submit permission', async t => {
    const { h, images, prepare, action } = await fixture(t); const job = await prepare(await images());
    for (const pageSettings of [undefined, { visibilityLabel: '公开可见' }, { visibilityLabel: '公开可见', scheduled: true }]) {
        h.state.publisherHook = async (_method, params) => params.phase === 'prepare' ? { ok: true, prepared: true, jobId: job.id, contentDigest: job.contentDigest, publishStatus: 'not_submitted', uploadReview: { jobId: job.id, contentDigest: job.contentDigest, accountId: h.state.accountId, pageFingerprint: 'page', mediaCount: 5, pageSettings } } : undefined;
        const failed = await action(job, 'upload'); assert.equal(failed.phase, 'awaiting-upload'); assert.equal(failed.status, 'blocked'); await assert.rejects(action(failed, 'submit'), /先点击上传/);
    }
    h.state.publisherHook = null; const uploaded = await action(job, 'upload'); assert.equal(uploaded.context.uploadReview.pageSettings.visibilityLabel, '公开可见'); assert.equal(uploaded.context.uploadReview.pageSettings.scheduled, false);
    const original = uploaded.context; h.sql.prepare('UPDATE publication_job_contexts SET document_json = ? WHERE job_id = ?').run(JSON.stringify({ ...original, uploadReview: { ...original.uploadReview, pageSettings: undefined } }), job.id);
    await assert.rejects(action(uploaded, 'submit'), /旧上传核验/); assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 0);
});
test('unknown and review states stay frozen across reopen and require explicit review before further attempts', async t => {
    const { h, video, prepare, action, settle } = await fixture(t); const source = await video('xiaohongshu'); const job = await prepare(source);
    await action(job, 'upload'); h.state.submitStatus = 'pending_review'; await action(job, 'submit'); const pending = await settle(job); assert.equal(pending.publishStatus, 'pending_review');
    h.restart(); const saved = h.api.readPublicationJob('xiaohongshu', job.id); assert.equal(saved.publishStatus, 'pending_review'); await assert.rejects(action(saved, 'submit'));
    await assert.rejects(action(saved, 'review', false), /核实/); const reviewed = await action(saved, 'review', true); assert.equal(reviewed.publishStatus, 'published'); assert.equal(reviewed.receiptSource, 'user-verified');
    assert.equal(JSON.stringify(reviewed.context.snapshot), JSON.stringify(saved.context.snapshot)); assert.equal(reviewed.receiptUrl, undefined);
    assert.equal(h.state.publisherCalls.filter(call => call.params.phase === 'submit').length, 1);
});
test('explicit manual preparation promotes an automatic pending task and disabling the switch preserves it', async t => {
    const { h, video, enable, prepare } = await fixture(t); const source = await video('douyin'); await enable('douyin'); await h.api.recordCompletedPublication(source);
    const event = h.api.listPublicationCompletions()[0]; const auto = await prepare(source, { origin: 'completion', promptId: event.id }); assert.equal(auto.context.origin, 'completion');
    const manual = await prepare(source); assert.equal(manual.id, auto.id); assert.equal(manual.context.origin, 'manual');
    await enable('douyin', false); await h.api.cancelAutomaticPublications('douyin-auto-publish'); assert.equal(h.api.readPublicationJob('douyin', manual.id).status, 'awaiting_confirmation');
});
test('legacy XHS confirmation in an original creation chat is superseded by a fresh editor-bound upload confirmation', async t => {
    const { h, video, prepare } = await fixture(t); const source = await video('xiaohongshu'); const project = await h.api.getVideoEditorV2Project(source.projectId);
    const legacy = await h.api.getXhsPublisherService().requestPublication('original-creation-chat', project.workVersion.publicationBinding.notePath, 'explicit-request');
    const fresh = await prepare(source); assert.equal(fresh.id, legacy.id); assert.equal(fresh.sessionId, (await h.api.getProductProjectEditorSession(source)).sessionId);
    assert.equal(h.api.getXhsPublishJob(legacy.id).sessionId, legacy.sessionId); assert.equal(fresh.phase, 'awaiting-upload');
});
