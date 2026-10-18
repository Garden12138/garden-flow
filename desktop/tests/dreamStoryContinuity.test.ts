import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { readyDream, dreamRequest, dreamPng } from './helpers/dreamStoryFixture.ts';
import { dreamReferenceAssets, dreamSceneInput, validateDreamDirector } from '../shared/dreamStory.ts';
import { resolveDreamStoryTarget } from '../shared/contentCreationTarget.ts';
import { dreamStoryTimeline } from '../shared/dreamStoryTimeline.ts';
import { dreamShareDocument, dreamMarkdown } from '../shared/dreamStoryExport.ts';

async function image(h: any, project: any, id: string, suffix = '') {
    const file = path.join(h.root, 'key' + suffix + '.png'); await fs.writeFile(file, Buffer.concat([dreamPng, Buffer.from(suffix)]));
    await h.api.bindDreamMedia(project.id, id, 'image', file);
    project = await h.api.readDreamStory(project.id); await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: id });
    return h.api.readDreamStory(project.id);
}
function config(h: any) { h.state.settings = { image_endpoint: 'https://fixture.invalid/v1', image_api_key: 'fixture', image_model: 'fixture', image_provider_template: 'openai-images', video_endpoint: 'https://fixture.invalid/v1', video_api_key: 'fixture', video_model: 'fixture-video' }; }
async function adopt(h: any, project: any) { return h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'storyboard.adopt' }] }); }
async function wait(h: any, id: string, batchId: string) { for (let i = 0; i < 150; i++) { const result = await h.api.reconcileDreamMedia(id); if (result.batches.find((item: any) => item.id === batchId)?.state === 'completed') return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('batch timeout'); }

test('new target defaults hybrid while all-image/all-video enforce actual scene types', () => {
    assert.equal(resolveDreamStoryTarget().compositionMode, 'story-hybrid'); assert.equal(resolveDreamStoryTarget().profileVersion, 2);
    const target = resolveDreamStoryTarget({ compositionMode: 'story-video' });
    assert.throws(() => validateDreamDirector({ schemaVersion: 1 }, [], target));
});
test('continuity waits for an approved predecessor, freezes hashes and never preauthorizes unknown output', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); config(h);
    let project = await readyDream(h);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_1', changes: { continuity: 'continue' } }] }); project = await adopt(h, project);
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] }), /上一幕/);
    project = await image(h, project, 'scene_0');
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'setting', ownerId: 'sea', assetIds: [project.dreamStory.media.scene_0.image.assetId] }] });
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] });
    assert.ok(batch.referencesByScene.scene_1[0].role.includes('previous:scene_0')); assert.ok(batch.referencesByScene.scene_1[0].sha256);
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0', 'scene_1'] }), /未知参考/);
    const asset = project.assets.find((item: any) => item.id === batch.referenceAssetIds[0]); await fs.writeFile(asset.projectPath, 'corrupted');
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /参考图/); assert.equal(h.state.imageCalls, 0);
});
test('fixed setting anchors preserve their source frame, downstream invalidation follows actual dependencies and narration preserves images', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); let project = await readyDream(h);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_1', changes: { continuity: 'continue' } }] }); project = await adopt(h, project);
    project = await image(h, project, 'scene_0'); const anchor = project.dreamStory.media.scene_0.image.assetId;
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'setting', ownerId: 'sea', assetIds: [anchor] }] });
    assert.equal(project.dreamStory.media.scene_0.image.status, 'ready');
    project = await image(h, project, 'scene_1', 'second'); project = await image(h, project, 'scene_2', 'third');
    const before = JSON.stringify(dreamSceneInput(project.dreamStory, project.dreamStory.director.scenes[1], 'image'));
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { narration: 'Different narration' } }] });
    assert.equal(project.dreamStory.media.scene_1.image.status, 'ready'); assert.equal(JSON.stringify(dreamSceneInput(project.dreamStory, project.dreamStory.director.scenes[1], 'image')), before);
    project = await image(h, project, 'scene_0', 'replacement');
    assert.equal(project.dreamStory.media.scene_1.image.status, 'stale');
    assert.equal(project.dreamStory.media.scene_2.image.status, 'ready');
    assert.equal(dreamReferenceAssets(project.dreamStory, project.dreamStory.director.scenes[2]).some(item => item.role.startsWith('previous:')), false);
});
test('unsupported reference providers cannot silently drop continuity references', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); config(h); let project = await readyDream(h);
    project = await image(h, project, 'scene_0'); project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_1', changes: { continuity: 'continue' } }] }); project = await adopt(h, project);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'setting', ownerId: 'sea', assetIds: [project.dreamStory.media.scene_0.image.assetId] }] });
    h.state.settings.image_provider_template = 'gemini-imagen-native';
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] }), /参考/);
    assert.equal(h.state.imageCalls, 0);
});
test('video preview freezes one keyframe, supported duration and one-call authorization; result remains private and requires confirmation', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); config(h); let project = await readyDream(h);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { mediaType: 'video', videoReason: 'The key begins moving' } }] });
    project.dreamStory.target = resolveDreamStoryTarget({ narration: false, compositionMode: 'story-hybrid' }); project = await h.api.persistDreamProject(project); project = await adopt(h, project);
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'video', sceneIds: ['scene_0'] }), /关键帧/);
    project = await image(h, project, 'scene_0');
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'video', sceneIds: ['scene_0'] }); assert.equal(batch.videoSeconds.scene_0, 12); assert.equal(batch.maxRequests, 1); assert.equal(h.state.videoCalls, 0);
    const file = path.join(h.root, 'clip.mp4'); const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
    const generated = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=90x160:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]); assert.equal(generated.status, 0, generated.stderr?.toString());
    h.state.videoHook = async (input: any) => { assert.equal(input.privacyScope, 'project'); assert.equal(input.generateAudio, false); assert.equal(input.generationMode, 'reference-guided'); assert.equal(input.referenceImages.length, 1); return { assets: [await h.api.createGeneratedMediaAsset({ prompt: input.prompt, dataBuffer: await fs.readFile(file), mimeType: 'video/mp4', projectId: input.projectId, privacyScope: input.privacyScope })] }; };
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }); await wait(h, project.id, batch.id);
    project = await h.api.readDreamStory(project.id); assert.equal(h.state.videoCalls, 1); assert.equal(project.dreamStory.media.scene_0.video.status, 'ready'); assert.equal(project.dreamStory.media.scene_0.video.approvedDigest, undefined);
    await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_0', kind: 'video' }); h.restart(); project = await h.api.readDreamStory(project.id);
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }); assert.equal(h.state.videoCalls, 1);
    assert.equal((await h.api.listMediaAssets()).some((item: any) => item.kind === 'video'), false);
    const catalog = await fs.readFile(path.join(h.root, 'default/media/catalog.json'), 'utf8'); assert.ok(!catalog.includes('The luminous key floats slowly'));
    const clip = dreamStoryTimeline(project).tracks[0].clips[0]; assert.equal(clip.assetId, project.dreamStory.media.scene_0.video.assetId); assert.equal(clip.motionPreset, 'static'); assert.equal(clip.volume, 0);
    const share = JSON.stringify(dreamShareDocument(project.dreamStory)); assert.ok(share.includes('story-hybrid')); assert.ok(!share.includes('The luminous key floats slowly'));
});
test('too-long scenes and narration awaiting measurement do not submit video requests', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); config(h); let project = await readyDream(h);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { mediaType: 'video', videoReason: 'Motion', plannedDurationMs: 13000 } }] });
    project.dreamStory.target = resolveDreamStoryTarget({ narration: false }); project = await h.api.persistDreamProject(project); project = await adopt(h, project); project = await image(h, project, 'scene_0');
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'video', sceneIds: ['scene_0'] }), /上限/);
    project.dreamStory.target.narration = true; project = await h.api.persistDreamProject(project);
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'video', sceneIds: ['scene_0'] }), /旁白/); assert.equal(h.state.videoCalls, 0);
});

test('format-3 projects remain readable and upgrading creates an idempotent separate format-4 copy', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    let original = await readyDream(h); original.version = 3; original.dreamStory.schemaVersion = 1; original.dreamStory.target.profileVersion = 1;
    original = await h.api.persistDreamProject(original);
    const file = path.join(original.projectDir, 'project.json'); const before = await fs.readFile(file, 'utf8');
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(original), operations: [{ type: 'target.confirm', target: resolveDreamStoryTarget() }] }), /副本/);
    const input = { ...dreamRequest(original), target: resolveDreamStoryTarget() };
    const copy = await h.api.copyDreamStoryTarget(input); const repeated = await h.api.copyDreamStoryTarget(input);
    assert.equal(copy.id, repeated.id); assert.notEqual(copy.id, original.id); assert.equal(copy.version, 4); assert.equal(copy.dreamStory.schemaVersion, 2);
    assert.equal(copy.dreamStory.target.compositionMode, 'story-hybrid'); assert.equal(copy.dreamStory.storyboardAdopted, false);
    assert.equal(await fs.readFile(file, 'utf8'), before); h.restart(); assert.equal((await h.api.readDreamStory(original.id)).version, 3);
    const unsupported = JSON.parse(before); unsupported.version = 5; await fs.writeFile(file, JSON.stringify(unsupported)); await assert.rejects(h.api.readDreamStory(original.id), /不支持/);
});
test('all-video mode cannot render with image-only media or short videos and a changed image invalidates its video', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); let project = await readyDream(h);
    const director = project.dreamStory.director;
    director.scenes.forEach((scene: any) => { scene.mediaType = 'video'; scene.videoReason = 'Full-video plan'; });
    project.dreamStory.target = resolveDreamStoryTarget({ narration: false, compositionMode: 'story-video' }); project = await h.api.persistDreamProject(project);
    for (const scene of director.scenes) project = await image(h, project, scene.id);
    await assert.rejects(h.api.validateDreamRender(project.id), /缺失/);
    const scene = project.dreamStory.director.scenes[0];
    const file = path.join(h.root, 'short.mp4'); const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
    assert.equal(spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=90x160:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]).status, 0);
    await h.api.bindDreamMedia(project.id, scene.id, 'video', file); project = await h.api.readDreamStory(project.id);
    await assert.rejects(h.api.validateDreamRender(project.id), /不足/);
    project = await image(h, project, scene.id, 'new-image'); assert.equal(project.dreamStory.media[scene.id].video.status, 'stale');
    const timeline = dreamStoryTimeline(project); assert.ok(timeline.tracks[0].clips.every(item => item.motionPreset === 'static'));
});

test('corrupt provider video is a terminal local validation failure and reconciliation never resubmits it', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); config(h); let project = await readyDream(h);
    project.dreamStory.target = resolveDreamStoryTarget({ narration: false }); project.dreamStory.director.scenes[0].mediaType = 'video'; project.dreamStory.director.scenes[0].videoReason = 'Motion trial';
    project = await h.api.persistDreamProject(project); project = await image(h, project, 'scene_0');
    h.state.videoHook = async (input: any) => ({ assets: [await h.api.createGeneratedMediaAsset({ prompt: input.prompt, dataBuffer: Buffer.alloc(128), mimeType: 'video/mp4', projectId: input.projectId, privacyScope: 'project' })] });
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'video', sceneIds: ['scene_0'] });
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }); await wait(h, project.id, batch.id);
    project = await h.api.readDreamStory(project.id); assert.equal(project.dreamStory.media.scene_0.video.status, 'failed');
    assert.ok(project.dreamStory.reconciledMediaJobIds.includes(batch.jobs.scene_0 || project.dreamStory.media.scene_0.video.jobId));
    await h.api.reconcileDreamMedia(project.id); assert.equal(h.state.videoCalls, 1);
});

test('default sharing excludes reference-only originals while explicit private archives and full backups retain them', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); let project = await readyDream(h);
    project = await image(h, project, 'scene_0'); const selectedId = project.dreamStory.media.scene_0.image.assetId;
    const ref = path.join(h.root, 'reference-only.png'); await fs.writeFile(ref, Buffer.concat([dreamPng, Buffer.from('reference-only-original')]));
    await h.api.bindDreamMedia(project.id, undefined, 'reference', ref, undefined, undefined, undefined, dreamRequest(project), { kind: 'setting', id: 'sea' });
    project = await h.api.readDreamStory(project.id); const referenceId = project.dreamStory.director.settings[0].referenceAssetIds[0]; assert.notEqual(referenceId, selectedId);
    const share = path.join(h.root, 'share.zip'); await h.api.exportDreamStory(project.id, share, 'share', false); const data = await fs.readFile(share);
    assert.ok(data.includes(Buffer.from('media/' + selectedId + '.png'))); assert.equal(data.includes(Buffer.from('media/' + referenceId + '.png')), false);
    assert.equal(JSON.stringify(dreamShareDocument(project.dreamStory)).includes(referenceId), false);
    const markdown = dreamMarkdown(project.dreamStory); assert.ok(markdown.includes('story-keyframes')); assert.ok(markdown.includes('场景：sea')); assert.ok(markdown.includes('衔接：切场'));
    const privateShare = path.join(h.root, 'private-share.zip'); await h.api.exportDreamStory(project.id, privateShare, 'share', true); assert.ok((await fs.readFile(privateShare)).includes(Buffer.from('media/' + referenceId + '.png')));
    const backup = path.join(h.root, 'backup.zip'); await h.api.exportDreamStory(project.id, backup, 'backup', false); assert.ok((await fs.readFile(backup)).includes(Buffer.from('media/' + referenceId + '.png')));
});
