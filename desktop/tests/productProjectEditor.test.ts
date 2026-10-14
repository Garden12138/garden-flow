import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { productVideoHarness, makeProposal, sineWav } from './helpers/productVideoHarness.ts';
import { resolveProductCreationTarget } from '../shared/productCreationTarget.ts';
import { ProductVideoComposeParamsSchema } from '../shared/productVideoProposal.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { videoRenderFingerprint } from '../electron/core/video-editor-v2/videoPublicationPolicy.ts';
import { applyProductProjectEditWorkflowPolicy } from '../electron/core/ai/productProjectEditWorkflowPolicy.ts';
import type { ProductProjectEditOperation, ProductProjectEditorSnapshot } from '../shared/productProjectEditor.ts';
import { productVideoNarrationHash } from '../shared/productVideoVoiceoverTimeline.ts';
import { resolveModelScopeFromContextType } from '../electron/core/modelScopeSettings.ts';

async function fixture(t: any) {
    const h = await productVideoHarness({ platformVersions: true, productImageSets: true });
    t.after(() => h.close());
    const png = createProductVideoVerificationPng('GF-ABC123DEF456'); h.state.renderBytes = png;
    const bundle = await h.store.upsertProduct({ name: '持续编辑隔离商品', images: [{ dataUrl: `data:image/png;base64,${png.toString('base64')}` }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    const create = async (platform = 'xiaohongshu', id = `editor-${platform}`) => {
        const params = ProductVideoComposeParamsSchema.parse({ ...makeProposal(product, id), voiceoverEnabled: false,
            creationTarget: resolveProductCreationTarget({ platform: platform as any }), publicationCopy: { title: '商品细节', description: '已核验商品资料', hashtags: ['product'] } });
        await h.approveFixture(params, id, `source-${id}`);
        const result = await h.api.resolveProductVideoApproval(id, true);
        assert.equal(result.success, true, result.message);
        return h.api.getVideoEditorV2Project(result.projectId);
    };
    const images = async () => {
        const params = { proposalId: 'editor-images', productId: product.id, productUpdatedAt: product.updatedAt, productName: product.name,
            creationTarget: resolveProductCreationTarget({ contentKind: 'image-set' }), finalTitle: '商品细节', body: '原图排版', hashtags: [], style: {},
            pages: Array.from({ length: 5 }, (_, i) => ({ id: `page-${i}`, role: i ? 'content' : 'cover', title: `页面 ${i + 1}`, copy: '中文文案', productAssetIds: [product.assets[0].id] })) };
        const result = await new h.api.ProductImageSetComposeTool().execute(params, new AbortController().signal);
        assert.equal(result.success, true, result.llmContent);
        return h.api.getXhsNoteProject(result.data.projectId);
    };
    const read = (project: any) => h.api.readProductProjectEditor(project.document ? { kind: 'image-set', path: project.relativePath } : { kind: 'video', projectId: project.id });
    const apply = (snapshot: ProductProjectEditorSnapshot, operations: ProductProjectEditOperation[], requestId = `edit-${crypto.randomUUID()}`) => h.api.applyProductProjectEdit({ binding: snapshot.binding, expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch, requestId, operations });
    return { h, product, create, images, read, apply };
}

test('verified editor routing and runtime deny every creation, raw write, shell and unrelated tool', async t => {
    assert.equal(resolveModelScopeFromContextType('product-project'), 'gardenflow');
    const { h, create, read } = await fixture(t);
    const snapshot = await read(await create());
    const route = applyProductProjectEditWorkflowPolicy({ intent: 'video_creation', goal: '编辑', confidence: 1, reasoning: '', source: 'rule' },
        { runtimeMode: 'gardenflow', userInput: '改文案', metadata: { workflowKind: 'product-project-edit', productProjectEditorTurn: { binding: snapshot.binding } } } as any);
    assert.equal(route.workflowKind, 'product-project-edit'); assert.equal(route.requiresHumanApproval, false);
    const schema = new h.api.ProductProjectEditTool().getFunctionSchema().function.parameters;
    assert.equal(schema.properties.operations.items.anyOf[0].anyOf[0].type, 'object', 'Video commands retain their structured schema');
    for (const name of ['bash', 'app_cli', 'image_generate', 'video_generate', 'audio_generate', 'product_video_compose', 'product_image_set_compose', 'xhs_publish_prepare', 'write_file', 'read_file']) {
        const decision = h.api.evaluateRuntimeToolPermission({ toolName: name, args: {}, tool: { name, kind: 'edit' }, context: { workflowKind: 'product-project-edit', runtimeMode: 'gardenflow', sessionId: 'editor', toolPack: 'gardenflow' } });
        assert.equal(decision.outcome, 'deny', name);
    }
});

test('model read and edit receipts keep valid compact JSON with authoritative credentials', async t => {
    const { h, create, read } = await fixture(t);
    const project = await create('tiktok'); const snapshot = await read(project);
    const _editorTurn = { binding: snapshot.binding, requestId: 'compact-receipt', expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch };
    const result = await new h.api.ProductProjectReadTool().execute({ _editorTurn });
    const context = JSON.parse(result.llmContent);
    assert.equal(context.scenes.length, project.productVideo.scenes.length);
    assert.equal(context.assets[0].id, project.assets[0].id); assert.ok(result.llmContent.length < 8000);
    const edited = await new h.api.ProductProjectEditTool().execute({ _editorTurn, operations: [{ type: 'scene.text', sceneId: 'scene-0', text: 'compact' }] });
    assert.equal(edited.success, true, edited.llmContent);
    const receipt = JSON.parse(edited.llmContent); assert.equal(receipt.requestId, 'compact-receipt'); assert.ok(receipt.revision);
    assert.ok(edited.llmContent.length < 5000);
});

test('unchanged product exports reuse verified library bytes without changing the project or publication credential', async t => {
    const { h, create, read } = await fixture(t);
    let project = await create('douyin');
    const source = path.join(h.root, 'previous-export.mp4');
    await fs.writeFile(source, Buffer.from('completed-render-fixture'));
    const asset = await h.api.registerRenderedVideoAsset({ projectId: project.id, renderId: 'cached-render', sourcePath: source, title: project.title });
    project = await h.api.saveVideoEditorV2Project({ ...project, status: 'exported', renderOutputs: [{ id: 'cached-render', path: source,
        mediaAssetId: asset.id, renderFingerprint: videoRenderFingerprint(project), outputSha256: await h.api.renderedVideoSha256(source), createdAt: new Date().toISOString() }] });
    const before = await read(project);
    await fs.rm(source);
    const outputPath = path.join(h.root, 'another-export.mp4');
    const reused = await h.api.renderVideoEditorV2Project({ projectId: project.id, outputPath });
    assert.equal(reused.mediaAssetId, asset.id);
    assert.equal(await fs.readFile(outputPath, 'utf8'), 'completed-render-fixture');
    assert.equal(JSON.stringify(reused.project), JSON.stringify(project));
    assert.equal((await read(reused.project)).revision, before.revision);
    assert.equal((await read(reused.project)).undoCount, before.undoCount);
});

test('product export cache rejects changed content, corrupted bytes, wrong owner, escaped paths and legacy records', async t => {
    const { h, create } = await fixture(t);
    const project = await create('douyin');
    const source = path.join(h.root, 'valid-export.mp4');
    await fs.writeFile(source, 'completed-video');
    const asset = await h.api.registerRenderedVideoAsset({ projectId: project.id, renderId: 'cache-check', sourcePath: source, title: project.title });
    const output = { id: 'cache-check', path: source, mediaAssetId: asset.id, renderFingerprint: videoRenderFingerprint(project), outputSha256: await h.api.renderedVideoSha256(source), createdAt: new Date().toISOString() };
    const cachedProject = { ...project, renderOutputs: [output] };
    assert.ok(await h.api.findReusableProductVideoExport(cachedProject));
    assert.equal(await h.api.findReusableProductVideoExport({ ...cachedProject, id: 'another-project' }), null);
    assert.equal(await h.api.findReusableProductVideoExport({ ...cachedProject, renderOutputs: [{ ...output, outputSha256: undefined }] }), null);
    const changed = structuredClone(cachedProject); changed.timeline.tracks.find(track => track.kind === 'subtitle').clips[0].text = 'new caption';
    assert.equal(await h.api.findReusableProductVideoExport(changed), null);
    const ownedPath = h.api.getAbsoluteMediaPath(asset.relativePath);
    await fs.writeFile(ownedPath, 'corrupted');
    assert.equal(await h.api.findReusableProductVideoExport(cachedProject), null);
    await fs.rm(ownedPath); await fs.symlink(source, ownedPath);
    assert.equal(await h.api.findReusableProductVideoExport(cachedProject), null);
    h.state.spaceId = 'other-space';
    assert.equal(await h.api.findReusableProductVideoExport(cachedProject), null);
});

test('long atomic batches return complete JSON within the tool result budget', async t => {
    const { h, create, read } = await fixture(t);
    const snapshot = await read(await create('douyin'));
    const _editorTurn = { binding: snapshot.binding, requestId: 'long-receipt', expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch };
    const operations = Array.from({ length: 80 }, () => ({ type: 'scene.narration-text', sceneId: 'scene-0', text: '长文字'.repeat(150) }));
    const result = await new h.api.ProductProjectEditTool().execute({ _editorTurn, operations });
    assert.equal(result.success, true, result.llmContent);
    assert.equal(JSON.parse(result.llmContent).summaryCount, 80);
    assert.ok(result.llmContent.length <= 4500); assert.equal(result.data.summary.length, 80);
    assert.equal(result.data.undoCount, 1);
});

test('one durable conversation per version; image editor reuses the original file session', async t => {
    const { h, create, images } = await fixture(t);
    const ids: string[] = [];
    for (const platform of ['xiaohongshu', 'douyin', 'tiktok']) {
        const project = await create(platform);
        const ref = { kind: 'video', projectId: project.id };
        const sessions = await Promise.all([h.api.getProductProjectEditorSession(ref), h.api.getProductProjectEditorSession(ref)]);
        assert.equal(sessions[0].sessionId, sessions[1].sessionId); ids.push(sessions[0].sessionId);
        h.restart(); assert.equal((await h.api.getProductProjectEditorSession(ref)).sessionId, ids.at(-1));
    }
    assert.equal(new Set(ids).size, 3);
    const image = await images();
    h.state.sessions.set('existing-image-chat', { id: 'existing-image-chat', metadata: JSON.stringify({ associatedFilePath: image.projectPath }) });
    const editor = await h.api.getProductProjectEditorSession({ kind: 'image-set', path: image.relativePath });
    assert.equal(editor.sessionId, 'existing-image-chat');
});

test('formal product notes resolve the same video conversation and compatibility saves share project publication history', async t => {
    const { h, create, read } = await fixture(t);
    const project = await create('xiaohongshu');
    const path = project.workVersion.publicationBinding.notePath;
    const ref = await h.api.resolveProductNoteEditor(path);
    assert.equal(ref.projectId, project.id);
    assert.equal((await h.api.getProductProjectEditorSession(ref)).sessionId, (await h.api.getProductProjectEditorSession({ kind: 'video', projectId: project.id })).sessionId);
    const note = await h.api.getXhsNoteProject(path);
    await h.api.saveXhsNoteProject({ path, expectedRevision: note.version, document: { ...note.document, finalTitle: '正式稿件新文案', body: '共享事务保存正文' } });
    const saved = await read(project);
    assert.equal(saved.publicationCopy.title, '正式稿件新文案');
    assert.equal(saved.video.productVideo.proposal.publicationCopy.title, '正式稿件新文案');
    assert.equal(saved.undoCount, 1);
    const latest = await h.api.getXhsNoteProject(path);
    await assert.rejects(h.api.saveXhsNoteProject({ path, expectedRevision: latest.version, document: { ...latest.document, storyboard: [] } }), /工作台/);
});

test('ambiguous legacy formal note links allow scene editing while blocking publication copy edits', async t => {
    const { h, create, read, apply } = await fixture(t);
    let project = await create('xiaohongshu');
    const note = await h.api.getXhsNoteProject(project.workVersion.publicationBinding.notePath);
    await h.api.saveXhsNoteProject({ path: 'xiaohongshu/another-formal.redvideo', noteType: 'video', document: note.document });
    delete project.creationTarget; delete project.workVersion; delete project.sourceManuscriptPath;
    await fs.writeFile(path.join(project.projectDir, 'project.json'), JSON.stringify(project));
    project = await h.api.getVideoEditorV2Project(project.id);
    assert.equal((await h.api.resolveProductWorkVariant(project)).resolution, 'conflict');
    const snapshot = await read(project);
    await assert.rejects(apply(snapshot, [{ type: 'publication.copy', title: '不能猜绑定', description: '必须明确', hashtags: [] }]), /唯一/);
    const saved = await apply(snapshot, [{ type: 'scene.text', sceneId: 'scene-0', text: '旧工程仍可编辑' }]);
    assert.equal(saved.video.productVideo.scenes[0].overlayText, '旧工程仍可编辑');
});

test('batch validation is atomic, request replay is idempotent, and revision conflicts preserve the newer work', async t => {
    const { h, create, read, apply } = await fixture(t);
    const project = await create('douyin'); const snapshot = await read(project);
    await assert.rejects(apply(snapshot, [{ type: 'scene.text', sceneId: 'scene-0', text: '不应留下' }, { type: 'scene.asset', sceneId: 'scene-1', assetId: 'foreign' }]), /素材/);
    assert.equal((await read(project)).revision, snapshot.revision);
    const ops: ProductProjectEditOperation[] = [{ type: 'scene.text', sceneId: 'scene-0', text: '新字幕' }, { type: 'scene.duration', sceneId: 'scene-1', durationMs: 1200 }];
    const [one, two] = await Promise.all([apply(snapshot, ops, 'same-batch'), apply(snapshot, ops, 'same-batch')]);
    assert.equal(one.video.updatedAt, two.video.updatedAt); assert.equal(two.reused, true);
    assert.equal(one.video.productVideo.scenes[0].overlayText, '新字幕');
    assert.equal((await read(project)).undoCount, 1);
    await assert.rejects(apply(snapshot, [{ type: 'scene.delete', sceneId: 'scene-0' }], 'same-batch'), /请求 ID/);
    await assert.rejects(apply(snapshot, [{ type: 'scene.text', sceneId: 'scene-0', text: '旧请求' }]), /最新工程重试/);
    const fresh = await read(project);
    const results = await Promise.allSettled([apply(fresh, [{ type: 'scene.text', sceneId: 'scene-0', text: '并发一' }]), apply(fresh, [{ type: 'scene.text', sceneId: 'scene-0', text: '并发二' }])]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('draft epoch blocks waiting models even after input is saved, and binding cannot cross space/product/target', async t => {
    const { h, create, read, apply } = await fixture(t);
    const project = await create('tiktok'); const snapshot = await read(project);
    await h.api.syncProductEditorDraft(snapshot.binding.project, true);
    await assert.rejects(apply(snapshot, [{ type: 'scene.text', sceneId: 'scene-0', text: '旧模型回复' }]), /最新工程重试/);
    await h.api.syncProductEditorDraft(snapshot.binding.project, false);
    await assert.rejects(apply(snapshot, [{ type: 'scene.text', sceneId: 'scene-0', text: '仍是旧请求' }]), /最新工程重试/);
    const fresh = await read(project);
    await assert.rejects(apply({ ...fresh, binding: { ...fresh.binding, productId: 'another-product' } }, [{ type: 'scene.text', sceneId: 'scene-0', text: '越权' }]), /绑定/);
    await assert.rejects(apply({ ...fresh, binding: { ...fresh.binding, target: resolveProductCreationTarget({ platform: 'douyin' }) } }, [{ type: 'scene.text', sceneId: 'scene-0', text: '越权' }]), /绑定/);
    h.state.spaceId = 'other'; await assert.rejects(apply(fresh, [{ type: 'scene.text', sceneId: 'scene-0', text: '跨空间' }]), /空间/);
});

test('publication edits preserve reusable media and invalidate pending confirmations while protecting history', async t => {
    const { h, create, read, apply } = await fixture(t);
    for (const platform of ['xiaohongshu', 'douyin', 'tiktok']) {
        const project = await create(platform); const snapshot = await read(project);
        const fingerprint = videoRenderFingerprint(project);
        const jobs = ['awaiting_confirmation', 'preflighting', 'submitting', 'submit_result_unknown', 'completed'].map((status, i) => ({
            id: `job-${platform}-${i}`, platform, spaceId: 'default', sessionId: 'editor', projectId: project.id,
            versionId: project.workVersion.publicationBinding.versionId, versionRevision: 1, renderId: 'render', mediaAssetId: 'asset', mediaPath: '/fixture.mp4', contentDigest: `digest-${i}`,
            projectPath: path.join(h.root, 'default/manuscripts', project.workVersion.publicationBinding.notePath || 'unused'), revision: 1, noteType: 'video',
            title: '原标题', description: '原正文', body: '原正文', hashtags: [], media: [], accountId: 'account', accountLabel: '账号', extensionInstanceId: 'plugin', messageId: 'message',
            status, publishStatus: i < 2 ? 'not_submitted' : i === 2 ? 'submitted' : i === 3 ? 'unknown' : 'published', resetStatus: 'not_started', errorCode: '', errorMessage: '', createdAt: i + 1, updatedAt: i + 1,
        }));
        const save = platform === 'douyin' ? h.api.upsertDouyinPublishJob : platform === 'tiktok' ? h.api.upsertTikTokPublishJob : h.api.upsertXhsPublishJob;
        const get = platform === 'douyin' ? h.api.getDouyinPublishJob : platform === 'tiktok' ? h.api.getTikTokPublishJob : h.api.getXhsPublishJob;
        jobs.forEach(save); const protectedJobs = jobs.slice(2).map(job => JSON.stringify(get(job.id)));
        const result = await apply(snapshot, [{ type: 'publication.copy', title: '新的发布标题', description: '新的发布正文', hashtags: ['detail'] }]);
        assert.equal(videoRenderFingerprint(result.video), fingerprint); assert.equal(result.expiredOutputIds.length, 0);
        assert.equal((await read(project)).publicationCopy.title, '新的发布标题');
        assert.equal(get(jobs[0].id).status, 'superseded'); assert.equal(get(jobs[1].id).status, 'superseded');
        assert.deepEqual(jobs.slice(2).map(job => JSON.stringify(get(job.id))), protectedJobs);
        const next = await read(project);
        await h.api.undoProductProjectEdit({ binding: next.binding, requestId: `undo-copy-${platform}`, expectedRevision: next.revision, expectedDraftEpoch: next.draftEpoch });
        assert.equal((await read(project)).publicationCopy.title, snapshot.publicationCopy.title);
        assert.equal(get(jobs[0].id).status, 'superseded');
    }
});

test('image editing stales only affected pages, supports atomic add/order/undo, and rejects cover or foreign material', async t => {
    const { h, images, read, apply } = await fixture(t);
    const project = await images(); let snapshot = await read(project);
    const failed = [{ type: 'page.add', page: { ...project.document.productImageSet.pages[1], id: 'new-page' } }, { type: 'page.update', pageId: 'page-2', changes: { productAssetIds: ['foreign'] } }];
    await assert.rejects(apply(snapshot, failed as any), /工程外素材/);
    assert.equal((await read(project)).imageSet.document.productImageSet.pages.length, 5);
    const changed = await apply(snapshot, [{ type: 'page.update', pageId: 'page-2', changes: { title: '只改本页' } }]);
    assert.deepEqual([...changed.expiredOutputIds], ['page-2']);
    snapshot = await read(project);
    await assert.rejects(apply(snapshot, [{ type: 'page.order', pageIds: ['page-1', 'page-0', 'page-2', 'page-3', 'page-4'] }]), /封面/);
    const result = await h.api.undoProductProjectEdit({ binding: snapshot.binding, expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch, requestId: 'undo-page' });
    assert.equal(result.imageSet.document.productImageSet.pages[2].title, '页面 3');
});

test('manual and conversation edits share 20-step history; stale bound voice blocks export without a paid call', async t => {
    const { h, create, read, apply } = await fixture(t);
    let project = await create('douyin');
    const audio = path.join(h.root, 'voice.wav'); await fs.writeFile(audio, sineWav(0.5));
    project = await h.api.attachProductVideoVoiceoverAsset({ projectId: project.id, sceneId: 'scene-0', absolutePath: audio, source: 'imported' });
    let snapshot = await read(project);
    const result = await apply(snapshot, [{ type: 'scene.narration-text', sceneId: 'scene-0', text: '修改朗读文字' }]);
    assert.deepEqual([...result.staleVoiceSceneIds], ['scene-0']);
    await assert.rejects(h.api.renderVideoEditorV2Project({ projectId: project.id }), /配音已过期/);
    for (let i = 0; i < 22; i++) project = await h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.text', sceneId: 'scene-0', text: `手动 ${i}` } });
    snapshot = await read(project); assert.equal(snapshot.undoCount, 20);
    const undo = await h.api.undoProductProjectEdit({ binding: snapshot.binding, requestId: 'undo-last', expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch });
    assert.equal(undo.video.productVideo.scenes[0].overlayText, '手动 20');
    assert.equal(undo.video.assets.length, project.assets.length); assert.equal(undo.video.workVersion.versionId, project.workVersion.versionId);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('existing audio selection and per-scene volume stay owned, reversible and stable after visual edits', async t => {
    const { h, create, read, apply } = await fixture(t);
    let project = await create('douyin');
    const audio = path.join(h.root, 'existing-voice.wav'); await fs.writeFile(audio, sineWav(0.5));
    project = await h.api.attachProductVideoVoiceoverAsset({ projectId: project.id, sceneId: 'scene-0', absolutePath: audio, source: 'imported' });
    const assetId = project.productVideo.scenes[0].voiceoverAssetId;
    const changed = await apply(await read(project), [{ type: 'voiceover.asset', sceneId: 'scene-1', assetId }, { type: 'audio.volume', track: 'voiceover', sceneId: 'scene-0', volume: 0.25 }, { type: 'scene.text', sceneId: 'scene-0', text: '保留音量' }]);
    const clips = changed.video.timeline.tracks.find(track => track.kind === 'voiceover').clips;
    assert.equal(clips.find(clip => clip.sceneId === 'scene-0').volume, 0.25);
    assert.equal(clips.find(clip => clip.sceneId === 'scene-1').volume, 1);
    await assert.rejects(apply(await read(project), [{ type: 'voiceover.asset', sceneId: 'scene-1', assetId: 'foreign' }]), /素材/);
    const shortened = await apply(await read(project), [{ type: 'scene.duration', sceneId: 'scene-0', durationMs: 100 }]);
    assert.equal(shortened.video.productVideo.scenes[0].voiceoverStatus, 'duration-conflict');
    await assert.rejects(h.api.renderVideoEditorV2Project({ projectId: project.id }), /长于镜头/);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('interrupted joint file/SQLite transaction rolls forward after restart without model or media replay', async t => {
    const { h, create, read, apply } = await fixture(t);
    const project = await create('tiktok'); const snapshot = await read(project);
    const result = await apply(snapshot, [{ type: 'publication.copy', title: 'Recovered edit', description: 'Saved once', hashtags: ['detail'] }], 'recover-request');
    const row = h.api.getProductEditJournal('default', `video:${project.id}`, 'recover-request');
    const payload = JSON.parse(row.payload_json);
    // Reproduce a process exit after the file rename, before the SQLite commit.
    assert.equal(h.api.updateTikTokVideoVersion(payload.nativeBefore, payload.nativeAfter.revision), true);
    h.sql.prepare("UPDATE product_project_edits SET state = 'prepared', result_json = NULL WHERE request_id = ?").run('recover-request');
    assert.throws(() => h.api.assertProductEditsSettled(`video:${project.id}`), /事务尚在/);
    assert.equal((await read(project)).dirty, true, 'A pending local transaction cannot start another model edit');
    h.restart(); await h.api.recoverProductProjectEdits();
    const current = await read(project);
    assert.equal(current.publicationCopy.title, 'Recovered edit'); assert.equal(current.video.updatedAt, result.video.updatedAt);
    const replay = await apply(snapshot, [{ type: 'publication.copy', title: 'Recovered edit', description: 'Saved once', hashtags: ['detail'] }], 'recover-request');
    assert.equal(replay.reused, true); assert.equal(replay.revision, current.revision);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('late generated video and speech remain assets and do not overwrite edited scene bindings', async t => {
    const { h, create, read, apply } = await fixture(t);
    let project = await create('douyin');
    project.productVideo.scenes[0].source = 'ai-motion';
    await h.api.saveVideoEditorV2Project(project);
    await h.api.setProductVideoSceneGenerationState({ projectId: project.id, sceneId: 'scene-0', status: 'generating' });
    await apply(await read(project), [{ type: 'scene.text', sceneId: 'scene-0', text: '更新后的屏幕文字' }]);
    project = (await read(project)).video;
    const originalAsset = project.timeline.tracks.find(track => track.kind === 'primary-video').clips[0].assetId;
    const video = path.join(h.root, 'late.mp4');
    const ffmpeg = createRequire(new URL('../package.json', import.meta.url))('ffmpeg-static');
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x480:r=30', '-t', '1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: 'ignore' });
    project = await h.api.attachGeneratedProductVideoScene({ projectId: project.id, sceneId: 'scene-0', absolutePath: video, generationJobId: 'late-video' });
    assert.equal(project.timeline.tracks.find(track => track.kind === 'primary-video').clips[0].assetId, originalAsset);
    assert.ok(project.assets.some(asset => asset.provenance?.generationJobId === 'late-video'));
    project.productVideo.scenes[0].narrationText = '旧朗读文字';
    project.productVideo.scenes[0].voiceoverJobId = 'late-voice';
    project.productVideo.scenes[0].voiceoverStatus = 'generating';
    project.productVideo.voiceoverAutoApprovedAt = new Date().toISOString();
    await h.api.saveVideoEditorV2Project(project);
    await apply(await read(project), [{ type: 'scene.narration-text', sceneId: 'scene-0', text: '最新朗读文字' }]);
    const audio = path.join(h.root, 'late.wav'); await fs.writeFile(audio, sineWav(0.5));
    project = await h.api.attachProductVideoVoiceoverAsset({ projectId: project.id, sceneId: 'scene-0', absolutePath: audio, source: 'tts', jobId: 'late-voice', textHash: productVideoNarrationHash('旧朗读文字') });
    assert.equal(project.productVideo.scenes[0].voiceoverAssetId, undefined);
    assert.ok(project.assets.some(asset => asset.provenance?.generationJobId === 'late-voice'));
    assert.equal(project.productVideo.voiceoverAutoApprovedAt, undefined);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('twenty successive undos exhaust the shared window without undoing an undo', async t => {
    const { h, create, read, apply } = await fixture(t);
    const project = await create('douyin');
    for (let i = 0; i < 22; i++) await apply(await read(project), [{ type: 'scene.text', sceneId: 'scene-0', text: `history-${i}` }]);
    for (let i = 0; i < 20; i++) {
        const current = await read(project);
        assert.equal(current.undoCount, 20 - i);
        const result = await h.api.undoProductProjectEdit({ binding: current.binding, requestId: `history-undo-${i}`, expectedRevision: current.revision, expectedDraftEpoch: current.draftEpoch });
        assert.equal(result.video.productVideo.scenes[0].overlayText, `history-${20 - i}`);
    }
    const last = await read(project); assert.equal(last.undoCount, 0);
    await assert.rejects(h.api.undoProductProjectEdit({ binding: last.binding, requestId: 'exhausted', expectedRevision: last.revision, expectedDraftEpoch: last.draftEpoch }), /没有可撤销/);
});

test('legacy history survives a new edit and restores content without reviving paid work', async t => {
    const { h, create, read, apply } = await fixture(t);
    const project = await create('tiktok');
    const original = structuredClone(project);
    original.productVideo.scenes[0].overlayText = '旧历史字幕';
    original.productVideo.scenes[0].voiceoverStatus = 'queued';
    original.productVideo.voiceoverAutoApprovedAt = new Date().toISOString();
    project.undoStack = [{ id: 'old-history', createdAt: project.updatedAt, label: '旧手动修改', timeline: original.timeline, productVideo: original.productVideo }];
    await h.api.saveVideoEditorV2Project(project);
    assert.equal((await read(project)).undoCount, 1);
    await apply(await read(project), [{ type: 'scene.text', sceneId: 'scene-0', text: '新对话字幕' }]);
    assert.equal((await read(project)).undoCount, 2);
    await h.api.undoVideoEditorV2ProjectTimeline({ projectId: project.id });
    assert.equal((await read(project)).video.productVideo.scenes[0].overlayText, project.productVideo.scenes[0].overlayText);
    await h.api.undoVideoEditorV2ProjectTimeline({ projectId: project.id });
    const current = await read(project);
    assert.equal(current.video.productVideo.scenes[0].overlayText, '旧历史字幕');
    assert.equal(current.video.productVideo.scenes[0].voiceoverStatus, 'needs-configuration');
    assert.equal(current.video.productVideo.voiceoverAutoApprovedAt, undefined);
    assert.equal(current.undoCount, 0);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
});

test('new input arriving after the file commit rolls back video, formal note and native copy atomically', async t => {
    const { h, create, images, read, apply } = await fixture(t);
    for (const project of [await create('xiaohongshu'), await create('tiktok'), await images()]) {
        const before = await read(project);
        h.state.transactionHook = () => {
            h.state.transactionHook = null;
            h.api.updateProductEditorDraft('default', h.api.productEditorKey(before.binding.project), true);
        };
        await assert.rejects(apply(before, [{ type: 'publication.copy', title: '不得留下', description: '新输入阻断旧模型', hashtags: [] }]), /最新工程重试/);
        const current = await read(project);
        assert.equal(current.revision, before.revision);
        assert.deepEqual(current.publicationCopy, before.publicationCopy);
        assert.equal(current.dirty, true); assert.equal(current.undoCount, 0);
        assert.throws(() => h.api.assertProductEditsSettled(h.api.productEditorKey(current.binding.project)), /先保存/);
        await h.api.syncProductEditorDraft(current.binding.project, false);
    }
});

test('every committed edit and undo has a fresh publication credential while untouched legacy projects keep theirs', async t => {
    const { h, create, read, apply } = await fixture(t);
    const project = await create('xiaohongshu'); const before = await read(project);
    assert.equal(h.api.getProductEditorPublicationRevision(project.id), '');
    await apply(before, [{ type: 'scene.text', sceneId: 'scene-0', text: '确认应失效' }], 'visual-change');
    assert.equal(h.api.getProductEditorPublicationRevision(project.id), 'visual-change');
    const current = await read(project);
    await h.api.undoProductProjectEdit({ binding: current.binding, requestId: 'visual-undo', expectedRevision: current.revision, expectedDraftEpoch: current.draftEpoch });
    assert.equal(videoRenderFingerprint((await read(project)).video), videoRenderFingerprint(before.video));
    assert.equal(h.api.getProductEditorPublicationRevision(project.id), 'visual-undo');
    h.restart(); assert.equal(h.api.getProductEditorPublicationRevision(project.id), 'visual-undo');
});
