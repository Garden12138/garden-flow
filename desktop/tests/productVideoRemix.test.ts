import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { ProductVideoComposeParamsSchema } from '../shared/productVideoProposal.ts';
import { snapProductVideoClipRange } from '../shared/productVideoRemix.ts';
import { buildVideoEditorV2RemotionComposition } from '../shared/videoAutoEditRemotion.ts';
import { evaluateProductVideoToolPolicy } from '../electron/core/productVideoRuntimePolicy.ts';
import { resolveProductVideoVisualPreparation } from '../electron/core/ai/productVideoWorkflowPolicy.ts';
import { assertCurrentVideoExport, videoRenderFingerprint } from '../electron/core/video-editor-v2/videoPublicationPolicy.ts';

const run = promisify(execFile);
const ffmpeg = createRequire(new URL('../package.json', import.meta.url))('ffmpeg-static') as string;

async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
    const h = await productVideoHarness({ productImageSets: true });
    t.after(() => h.close());
    const files: string[] = [];
    for (const [index, color] of ['red', 'blue'].entries()) {
        const file = path.join(h.root, `source-${index}.mp4`);
        await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=${index ? 25 : 30}:d=4`, '-f', 'lavfi', '-i', `sine=frequency=${index ? 880 : 440}:sample_rate=48000:duration=4`, '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
        files.push(file);
    }
    const media = await h.api.importMediaFiles(files);
    const refs = await h.api.readProductVideoRemixSources(media.map((item: any) => item.id));
    const bundle = await h.store.upsertProduct({ name: '自有视频混剪商品' });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    const proposal = ProductVideoComposeParamsSchema.parse({
        proposalId: 'remix-fixture-1', productId: product.id, productUpdatedAt: product.updatedAt, referencedProductIds: [product.id], productName: product.name,
        title: '已有片段混剪', compositionMode: 'existing-clips', voiceoverEnabled: false,
        canvas: { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' }, durationMs: 2000,
        scenes: refs.map((ref: any, index: number) => ({ id: `cut-${index}`, title: `片段 ${index + 1}`, source: 'media-clip', productAssetIds: [],
            mediaAssetId: ref.assetId, mediaContentHash: ref.contentHash, sourceStartMs: 500, sourceEndMs: 1500, durationMs: 1000,
            sourceVolume: index ? 0 : 0.5, fitMode: 'contain-blur', motionPreset: 'static', overlayText: `本地片段 ${index + 1}` })),
    });
    const metadata = { productVideoCompositionMode: 'existing-clips', explicitVideoClipRefs: refs, explicitProductRefs: [{ productId: product.id, name: product.name, updatedAt: product.updatedAt }] };
    const approve = (id = 'remix-card', input = proposal) => {
        h.state.tasks.set(`task-${id}`, { id: `task-${id}`, status: 'paused', route: { workflowKind: 'product-video-compose' }, metadata, artifacts: [] });
        return h.api.createOrReusePendingToolApproval({ callId: id, sessionId: 'remix-session', taskId: `task-${id}`, toolName: 'product_video_compose', proposalId: input.proposalId,
            proposalDigest: JSON.stringify(input), params: input, details: { ...new h.api.ProductVideoComposeTool().getConfirmationDetails(input), spaceId: 'default', remixSourceReferences: refs } });
    };
    const create = async () => {
        const result = await new h.api.ProductVideoComposeTool().execute(proposal, new AbortController().signal);
        assert.equal(result.success, true, result.error?.message);
        return h.api.getVideoEditorV2Project(result.data.projectId);
    };
    return { h, refs, media, product, proposal, metadata, approve, create };
}

test('clip schema and structured policy require selected, unchanged sources and accurate intervals', async (t) => {
    const { refs, proposal, metadata } = await fixture(t);
    const input = { workflowKind: 'product-video-compose' as const, toolName: 'product_video_compose', args: proposal, ...metadata };
    assert.equal(evaluateProductVideoToolPolicy(input), null);
    assert.equal(resolveProductVideoVisualPreparation({ workflowKind: input.workflowKind, metadata }).action, 'skip');
    for (const toolName of ['image_generate', 'video_generate', 'audio_generate', 'bash', 'app_cli']) assert.equal(evaluateProductVideoToolPolicy({ ...input, toolName })?.outcome, 'deny');
    assert.equal(evaluateProductVideoToolPolicy({ ...input, explicitVideoClipRefs: [] })?.outcome, 'deny');
    assert.equal(evaluateProductVideoToolPolicy({ ...input, args: { ...proposal, scenes: [{ ...proposal.scenes[0], mediaContentHash: '0'.repeat(64) }] } })?.outcome, 'deny');
    assert.equal(evaluateProductVideoToolPolicy({ ...input, args: { ...proposal, scenes: [{ ...proposal.scenes[0], sourceEndMs: refs[0].durationMs + 1 }] } })?.outcome, 'deny');
    assert.equal(ProductVideoComposeParamsSchema.safeParse({ ...proposal, voiceoverEnabled: true }).success, false);
    assert.equal(ProductVideoComposeParamsSchema.safeParse({ ...proposal, scenes: [{ ...proposal.scenes[0], durationMs: 1500 }, proposal.scenes[1]] }).success, false);
    assert.throws(() => snapProductVideoClipRange(0, 1001, 1000, 30), /超出/);
    assert.equal(snapProductVideoClipRange(1, 1000, 1000, 30).endMs, 1000);
});

test('durable remix confirmation is idempotent and copied sources survive source deletion and restart', async (t) => {
    const { h, refs, media, approve } = await fixture(t);
    approve(); h.restart();
    const card = await h.api.getProductVideoApprovalRequest('remix-session');
    assert.equal(card.details.remixSourceReferences.length, 2);
    const [one, two] = await Promise.all([h.api.resolveProductVideoApproval('remix-card', true), h.api.resolveProductVideoApproval('remix-card', true)]);
    assert.equal(one.success, true, one.error); assert.equal(two.projectId, one.projectId);
    let project = await h.api.getVideoEditorV2Project(one.projectId);
    assert.equal(project.productVideo.proposal.compositionMode, 'existing-clips');
    assert.equal(project.productVideo.voiceoverAutoApprovedAt, undefined);
    assert.equal(project.assets.length, 2);
    for (const asset of project.assets) assert.equal(asset.provenance.kind, 'user-import');
    for (const asset of media) await fs.rm(h.api.getAbsoluteMediaPath(asset.relativePath));
    h.restart(); project = await h.api.getVideoEditorV2Project(one.projectId);
    for (const asset of project.assets) assert.ok((await fs.stat(asset.projectPath)).size > 0);
    const composition = buildVideoEditorV2RemotionComposition(project);
    assert.equal(composition?.scenes[0].trimInFrames, 15);
    assert.equal(composition?.scenes[0].volume, 0.5);
    assert.equal(composition?.scenes[0].muted, false);
    assert.equal(composition?.scenes[1].volume, 0);
    assert.equal((await h.api.resolveProductVideoApproval('remix-card', true)).projectId, one.projectId);
    assert.equal(h.state.imageCalls + h.state.videoCalls + h.state.ttsCalls, 0);
    assert.equal(refs.length, 2);
});

test('source mutation, foreign media and changed product invalidate a pending remix before creation', async (t) => {
    const { h, media, product, proposal, approve } = await fixture(t);
    approve();
    await fs.appendFile(h.api.getAbsoluteMediaPath(media[0].relativePath), 'changed');
    assert.equal(await h.api.getProductVideoApprovalRequest('remix-session'), null);
    assert.equal((await h.api.resolveProductVideoApproval('remix-card', true)).success, false);
    approve('changed-product', { ...proposal, proposalId: 'remix-product-change' });
    await h.store.upsertSku({ productId: product.id, name: '新规格' });
    assert.equal((await h.api.resolveProductVideoApproval('changed-product', true)).status, 'invalidated');
    h.state.spaceId = 'other';
    await assert.rejects(h.api.readProductVideoRemixSources(media.map((asset: any) => asset.id)), /不属于/);
    assert.equal(h.state.videoCalls + h.state.ttsCalls + h.state.imageCalls, 0);
});

test('clip edits preserve cut offsets, reflow subtitles, validate limits, undo and expire exports', async (t) => {
    const { h, create } = await fixture(t);
    let project = await create();
    const initialFingerprint = videoRenderFingerprint(project);
    project = await h.api.saveVideoEditorV2Project({ ...project, status: 'exported', renderOutputs: [{ id: 'original-output', path: 'old.mp4', createdAt: 'fixture', mediaAssetId: 'old-media', renderFingerprint: initialFingerprint }] });
    project = await h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.source-volume', sceneId: 'cut-0', volume: 0.5 } });
    assert.equal(project.status, 'exported', 'an unchanged visual/audio command preserves the valid export');
    project = await h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.trim', sceneId: 'cut-0', sourceStartMs: 1000, sourceEndMs: 2500 } });
    assert.equal(project.status, 'ready', 'edited content must not report the old export as complete');
    assert.equal(project.renderOutputs[0].id, 'original-output', 'the old render remains available as history');
    assert.equal(project.timeline.durationMs, 2500);
    const primary = project.timeline.tracks.find((track: any) => track.kind === 'primary-video');
    assert.equal(primary.clips[0].sourceStartMs, 1000); assert.equal(primary.clips[0].sourceEndMs, 2500);
    assert.equal(primary.clips[1].timelineStartMs, 1500);
    assert.equal(project.timeline.tracks.find((track: any) => track.kind === 'subtitle').clips[0].timelineEndMs, 1500);
    project = await h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.source-volume', sceneId: 'cut-0', volume: 0 } });
    assert.equal(buildVideoEditorV2RemotionComposition(project)?.scenes[0].volume, 0);
    project = await h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.reorder', sceneId: 'cut-1', targetSceneId: 'cut-0', position: 'before' } });
    assert.equal(project.productVideo.scenes[0].id, 'cut-1');
    assert.equal(project.timeline.tracks[0].clips[1].sourceStartMs, 1000);
    await assert.rejects(h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.duration', sceneId: 'cut-0', durationMs: 5000 } }), /超出/);
    await assert.rejects(h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.trim', sceneId: 'cut-0', sourceStartMs: 3000, sourceEndMs: 5000 } }), /超出/);
    await assert.rejects(h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.motion', sceneId: 'cut-0', motionPreset: 'slow-zoom-in' } }), /不使用/);
    h.restart(); project = await h.api.getVideoEditorV2Project(project.id);
    assert.equal(project.timeline.tracks[0].clips[1].sourceStartMs, 1000);
    assert.notEqual(videoRenderFingerprint(project), initialFingerprint);
    assert.throws(() => assertCurrentVideoExport({ ...project, renderOutputs: [{ id: 'old', path: 'old.mp4', createdAt: 'fixture', mediaAssetId: 'old-media', renderFingerprint: initialFingerprint }] }), /重新导出/);
    project = await h.api.undoVideoEditorV2ProjectTimeline({ projectId: project.id });
    assert.equal(project.productVideo.scenes[0].id, 'cut-0');
    assert.equal(project.timeline.tracks[0].clips[0].sourceStartMs, 1000);
    assert.equal(h.state.videoCalls + h.state.ttsCalls + h.state.imageCalls, 0);
});

test('proposal identity cannot be reused for another product and asynchronous source reads stay in their space', async (t) => {
    const { h, media, proposal, create } = await fixture(t);
    const project = await create();
    const other = await h.store.upsertProduct({ name: '另一个商品' });
    const reference = await h.store.getProductCreativeReference(other.product.id);
    const result = await new h.api.ProductVideoComposeTool().execute({ ...proposal, productId: reference.id, productName: reference.name, productUpdatedAt: reference.updatedAt, referencedProductIds: [reference.id] }, new AbortController().signal);
    assert.equal(result.success, false); assert.match(result.error.message, /另一商品/);
    const reading = h.api.readProductVideoRemixSources(media.map((asset: any) => asset.id));
    h.state.spaceId = 'other';
    const refs = await reading;
    assert.equal(refs.length, 2);
    assert.equal(await h.api.getVideoEditorV2Project(project.id), null);
    assert.equal(h.state.videoCalls + h.state.ttsCalls + h.state.imageCalls, 0);
});

test('a longer original audio tail cannot extend a cut beyond the visual track', async (t) => {
    const { h, proposal } = await fixture(t);
    const file = path.join(h.root, 'short-picture-long-audio.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
    const [media] = await h.api.importMediaFiles([file]);
    const [ref] = await h.api.readProductVideoRemixSources([media.id]);
    assert.equal(ref.durationMs, 2000);
    const base = { ...proposal, proposalId: 'short-video-long-audio', scenes: [{ ...proposal.scenes[0], mediaAssetId: ref.assetId, mediaContentHash: ref.contentHash, sourceStartMs: 1000, sourceEndMs: 3000, durationMs: 2000 }], durationMs: 2000 };
    const failed = await new h.api.ProductVideoComposeTool().execute(base, new AbortController().signal);
    assert.equal(failed.success, false); assert.match(failed.error.message, /越界/);
    const result = await new h.api.ProductVideoComposeTool().execute({ ...base, scenes: [{ ...base.scenes[0], sourceStartMs: 0, sourceEndMs: 2000 }] }, new AbortController().signal);
    assert.equal(result.success, true, result.error?.message);
    const project = await h.api.getVideoEditorV2Project(result.data.projectId);
    assert.equal(project.assets[0].durationMs, 2000);
    await assert.rejects(h.api.applyProductVideoEditCommand({ projectId: project.id, command: { type: 'scene.trim', sceneId: base.scenes[0].id, sourceStartMs: 1000, sourceEndMs: 3000 } }), /超出/);
    assert.equal(h.state.videoCalls + h.state.ttsCalls + h.state.imageCalls, 0);
});

test('video duration survives packet output longer than the bounded ffmpeg diagnostic buffer', async (t) => {
    const h = await productVideoHarness({ productImageSets: true });
    t.after(() => h.close());
    const file = path.join(h.root, 'fifteen-second-video.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=purple:s=320x240:r=30:d=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=16', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
    const packets = await run(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'framecrc', 'pipe:1']);
    assert.ok(packets.stdout.length > 12000, 'fixture must discard the time-base header in the old diagnostic tail');
    const [media] = await h.api.importMediaFiles([file]);
    const [ref] = await h.api.readProductVideoRemixSources([media.id]);
    assert.equal(ref.durationMs, 15000);
    assert.equal(ref.hasAudio, true);
    assert.equal(h.state.videoCalls + h.state.ttsCalls + h.state.imageCalls, 0);
});
