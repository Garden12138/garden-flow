import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { readyDream, dreamRequest, dreamDirector } from './helpers/dreamStoryFixture.ts';
import { DreamDirectorPackageSchema, DreamReferenceCropSchema, dreamReferenceAssets, dreamCanonical, dreamSceneInput, type DreamStoryDocument } from '../shared/dreamStory.ts';
import { dreamShareDocument, dreamMarkdown } from '../shared/dreamStoryExport.ts';
import { getImageProviderCapabilities } from '../electron/core/imageProviderAdapters.ts';

const portrait = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
const background = { x: 0, y: 0, width: 0.25, height: 1 };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: any) {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    h.state.settings = { image_endpoint: 'https://fixture.invalid/v1', image_api_key: 'fixture', image_model: 'qwen-image-2.0-pro-2026-06-22', image_provider: 'dashscope', image_provider_template: 'dashscope-wan-native' };
    let project = await readyDream(h);
    const file = path.join(h.root, 'reference.png');
    const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
    const result = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=s=128x128', '-frames:v', '1', file]);
    assert.equal(result.status, 0, result.stderr?.toString());
    await h.api.bindDreamMedia(project.id, 'scene_0', 'image', file);
    project = await h.api.readDreamStory(project.id);
    await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_0' });
    project = await h.api.readDreamStory(project.id);
    const assetId = project.dreamStory.media.scene_0.image.assetId;
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [
        { type: 'director.update', characters: [{ id: 'student', description: 'A student', referenceAssetIds: [], revision: 1 }] },
        { type: 'scene.update', sceneId: 'scene_1', changes: { characterIds: ['student'], continuity: 'continue' } },
        { type: 'storyboard.adopt' },
    ] });
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [
        { type: 'reference.bind', ownerKind: 'character', ownerId: 'student', assetIds: [assetId], crops: { [assetId]: portrait } },
        { type: 'reference.bind', ownerKind: 'setting', ownerId: 'sea', assetIds: [assetId], crops: { [assetId]: background } },
    ] });
    return { h, project: await h.api.readDreamStory(project.id), assetId };
}

test('per-owner crops remain separate, equal crops merge, cuts retain character identity without previous background', () => {
    const director = dreamDirector('remembered');
    director.characters = [{ id: 'student', description: 'Student', referenceAssetIds: ['anchor'], referenceCrops: { anchor: portrait }, revision: 1 }];
    director.settings![0].referenceAssetIds = ['anchor']; director.settings![0].referenceCrops = { anchor: background };
    const scene = { ...director.scenes[1], characterIds: ['student'], continuity: 'continue' as const };
    const doc = { schemaVersion: 2, director, media: { scene_0: { image: { assetId: 'anchor' } } } } as DreamStoryDocument;
    assert.equal(dreamReferenceAssets(doc, scene).length, 3);
    director.settings![0].referenceCrops = { anchor: portrait };
    const refs = dreamReferenceAssets(doc, scene); assert.equal(refs.length, 2); assert.equal(refs[0].role, 'character:student,setting:sea');
    const cut = dreamReferenceAssets(doc, { ...scene, settingId: 'another', continuity: 'cut' });
    assert.equal(cut.length, 1); assert.deepEqual(cut[0].crop, portrait);
    // Adding optional undefined fields must not invalidate existing approval digests.
    assert.equal(dreamCanonical({ assetId: 'anchor', role: 'character:student', crop: undefined }), dreamCanonical({ assetId: 'anchor', role: 'character:student' }));
});

test('malformed crops, unbound crop records and duplicate spatial anchors are rejected', () => {
    for (const crop of [{ ...portrait, x: 0.8 }, { ...portrait, width: 0 }, { ...portrait, y: -0.1 }]) assert.equal(DreamReferenceCropSchema.safeParse(crop).success, false);
    const director = dreamDirector('remembered'); director.settings![0].referenceCrops = { unbound: portrait };
    assert.throws(() => DreamDirectorPackageSchema.parse(director), /裁切/);
    delete director.settings![0].referenceCrops;
    const anchor = { id: 'chair', object: 'chair', count: 1, location: 'front', state: 'occupied' };
    director.scenes[0].spatialAnchors = [anchor, anchor]; assert.throws(() => DreamDirectorPackageSchema.parse(director), /ID 重复/);
    director.scenes[0].spatialAnchors = [{ ...anchor, count: 21 }]; assert.throws(() => DreamDirectorPackageSchema.parse(director));
    delete director.scenes[0].spatialAnchors;
    director.scenes[0].imageReferenceMode = 'previous'; assert.throws(() => DreamDirectorPackageSchema.parse(director), /仅上一幕/);
    delete director.scenes[0].imageReferenceMode;
    director.scenes[1].imageReferenceMode = 'previous'; assert.throws(() => DreamDirectorPackageSchema.parse(director), /仅上一幕/);
});

test('previous-only editing submits one approved full previous frame and preserves baseline configuration', async t => {
    const { h, project: initial } = await fixture(t); let project = initial;
    const baselines = JSON.stringify([project.dreamStory.director.characters, project.dreamStory.director.settings]);
    const firstImage = JSON.stringify(project.dreamStory.media.scene_0.image);
    const previousAsset = project.assets.find((asset: any) => asset.id === project.dreamStory.media.scene_0.image.assetId);
    const bytes = await fs.readFile(previousAsset.projectPath);
    const old = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] });
    assert.equal(old.referencesByScene.scene_1.length, 3);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_1', changes: { imageReferenceMode: 'previous', imagePromptMode: 'scene', imagePrompt: 'Same student in blue, now seated on the original chair. Soft ink.' } }, { type: 'storyboard.adopt' }] });
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: old.id }), /变化/);
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] });
    assert.equal(batch.imageReferenceModesByScene.scene_1, 'previous');
    assert.equal(batch.referencesByScene.scene_1.length, 1);
    assert.equal(batch.referencesByScene.scene_1[0].role, 'previous:scene_0');
    assert.equal(batch.referencesByScene.scene_1[0].sha256, hash(bytes));
    assert.equal(batch.referencesByScene.scene_1[0].crop, undefined);
    assert.ok(batch.imagePromptsByScene.scene_1.includes('Edit Image 1 into the current moment'));
    h.restart(); project = await h.api.readDreamStory(project.id);
    assert.equal(h.state.imageCalls, 0);
    assert.equal(JSON.stringify([project.dreamStory.director.characters, project.dreamStory.director.settings]), baselines);
    assert.equal(JSON.stringify(project.dreamStory.media.scene_0.image), firstImage);
    h.state.imageHook = async input => {
        assert.equal(input.referenceImages.length, 1);
        assert.deepEqual(Buffer.from(input.referenceImages[0].split(',')[1], 'base64'), bytes);
        assert.equal(input.prompt, batch.imagePromptsByScene.scene_1);
        return { assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: bytes, mimeType: 'image/png', projectId: input.projectId, privacyScope: 'project' })] };
    };
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id });
    for (let i = 0; i < 150; i++) { const status = await h.api.reconcileDreamMedia(project.id); if (status.batches.find((b: any) => b.id === batch.id)?.state === 'completed') break; await new Promise(resolve => setTimeout(resolve, 40)); }
    assert.equal(h.state.imageCalls, 1);
    assert.equal((await h.api.readDreamStory(project.id)).dreamStory.media.scene_1.image.status, 'ready');
});

test('authorization freezes the cropped bytes and rejects cache damage before any supplier call', async t => {
    const { h, project } = await fixture(t);
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] });
    const refs = batch.referencesByScene.scene_1; assert.equal(refs.length, 3); assert.equal(batch.referenceAssetIds.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.referenceCropRects)), [{ x: 32, y: 32, width: 64, height: 64 }, { x: 0, y: 0, width: 32, height: 128 }]);
    assert.notEqual(refs[0].contentSha256, refs[1].contentSha256);
    const file = path.join(project.projectDir, refs[0].previewRelativePath);
    assert.equal(hash(await fs.readFile(file)), refs[0].contentSha256);
    assert.ok(!JSON.stringify(batch).includes(h.root));
    await fs.writeFile(file, 'corrupt'); h.restart();
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /裁切参考文件/);
    assert.equal(h.state.imageCalls, 0);
});

test('three actual references are delivered once; crop edits invalidate prior authorization and dependent images only', async t => {
    const { h, project: initial, assetId } = await fixture(t); let project = initial;
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] });
    const expected = await Promise.all(batch.referencesByScene.scene_1.map(async (ref: any) => fs.readFile(ref.previewRelativePath ? path.join(project.projectDir, ref.previewRelativePath) : project.assets.find((asset: any) => asset.id === ref.assetId).projectPath)));
    h.state.imageHook = async input => {
        assert.equal(input.referenceImages.length, 3);
        input.referenceImages.forEach((url: string, index: number) => assert.deepEqual(Buffer.from(url.split(',')[1], 'base64'), expected[index]));
        assert.equal(input.privacyScope, 'project');
        return { assets: [await h.api.createGeneratedMediaAsset({ dataBuffer: expected[2], mimeType: 'image/png', projectId: input.projectId, privacyScope: 'project' })] };
    };
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id });
    for (let i = 0; i < 150; i++) { const result = await h.api.reconcileDreamMedia(project.id); if (result.batches.find((b: any) => b.id === batch.id)?.state === 'completed') break; await new Promise(resolve => setTimeout(resolve, 40)); }
    project = await h.api.readDreamStory(project.id); assert.equal(project.dreamStory.media.scene_1.image.status, 'ready'); assert.equal(h.state.imageCalls, 1);
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }); assert.equal(h.state.imageCalls, 1);
    const pending = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] });
    const audioBefore = dreamCanonical(dreamSceneInput(project.dreamStory, project.dreamStory.director.scenes[1], 'audio'));
    const request = { ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'character', ownerId: 'student', assetIds: [assetId], crops: { [assetId]: { ...portrait, x: 0 } } }] };
    project = await h.api.applyDreamEdit(request); const revision = project.dreamStory.revision;
    assert.equal((await h.api.applyDreamEdit(request)).dreamStory.revision, revision);
    assert.equal(project.dreamStory.media.scene_1.image.status, 'stale');
    assert.equal(dreamCanonical(dreamSceneInput(project.dreamStory, project.dreamStory.director.scenes[1], 'audio')), audioBefore);
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: pending.id }), /变化/);
    assert.equal(h.state.imageCalls, 1);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'undo' }] });
    assert.deepEqual(project.dreamStory.director.characters[0].referenceCrops[assetId], portrait);
    assert.equal(project.dreamStory.media.scene_1.image.status, 'ready');
});

test('model-specific reference limit rejects four references without silently dropping a crop', async t => {
    const { h, project: initial, assetId } = await fixture(t); let project = initial;
    assert.equal(getImageProviderCapabilities('dashscope-wan-native', 'dashscope', 'qwen-image-2.0-pro-2026-06-22').maxReferenceImages, 3);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [
        { type: 'director.update', characters: [...project.dreamStory.director.characters, { id: 'classmates', description: 'Classmates', referenceAssetIds: [assetId], referenceCrops: { [assetId]: { x: 0.75, y: 0, width: 0.25, height: 1 } }, revision: 1 }] },
        { type: 'scene.update', sceneId: 'scene_1', changes: { characterIds: ['student', 'classmates'] } }, { type: 'storyboard.adopt' },
    ] });
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] }), /参考图数量/);
    assert.equal(h.state.imageCalls, 0);
});

test('spatial constraints invalidate pictures while share exports keep them and exclude private crop records', async t => {
    const { h, project: initial } = await fixture(t); let project = initial;
    const anchor = { id: 'chair', object: 'invigilator chair', count: 1, location: 'front platform', state: 'student seated in the existing chair' };
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { referenceFraming: 'new-shot', spatialAnchors: [anchor] } }] });
    assert.equal(project.dreamStory.media.scene_0.image.status, 'stale');
    const share = JSON.stringify(dreamShareDocument(project.dreamStory)); const markdown = dreamMarkdown(project.dreamStory);
    assert.ok(share.includes('front platform')); assert.ok(markdown.includes('invigilator chair × 1')); assert.ok(markdown.includes('换机位'));
    assert.ok(!share.includes('referenceCrops')); assert.ok(!share.includes('private/reference-crops'));
});


test('locked scenes protect owner crops and undersized crops never reach a supplier', async t => {
    const { h, project: initial, assetId } = await fixture(t); let project = initial;
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_1', changes: { locked: true } }] });
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'character', ownerId: 'student', assetIds: [assetId], crops: {} }] }), /解锁/);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [
        { type: 'scene.update', sceneId: 'scene_1', changes: { locked: false } },
        { type: 'reference.bind', ownerKind: 'character', ownerId: 'student', assetIds: [assetId], crops: { [assetId]: { ...portrait, width: 0.1 } } },
        { type: 'storyboard.adopt' },
    ] });
    await assert.rejects(h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_1'] }), /32×32/);
    assert.equal(h.state.imageCalls, 0);
});


test('format-3 edits cannot persist new crop or spatial fields in the old project format', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    let project = await readyDream(h); project.version = 3; project.dreamStory.schemaVersion = 1; project.dreamStory.target.profileVersion = 1;
    project = await h.api.persistDreamProject(project);
    const before = await fs.readFile(path.join(project.projectDir, 'project.json'), 'utf8');
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { referenceFraming: 'new-shot' } }] }), /副本/);
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { imagePromptMode: 'scene' } }] }), /副本/);
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_1', changes: { imageReferenceMode: 'previous', continuity: 'continue' } }] }), /副本/);
    await assert.rejects(h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'director.update', characters: [{ id: 'student', description: 'Student', referenceAssetIds: [], referenceCrops: {}, revision: 1 }] }] }), /副本/);
    assert.equal(await fs.readFile(path.join(project.projectDir, 'project.json'), 'utf8'), before);
});

test('explicit local reuse preserves image bytes, clears approval and requires a new visual confirmation', async t => {
    const { h, project: initial, assetId } = await fixture(t); let project = initial;
    const source = project.assets.find((asset: any) => asset.id === assetId).projectPath;
    await h.api.bindDreamMedia(project.id, 'scene_1', 'image', source); project = await h.api.readDreamStory(project.id);
    await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_1' }); project = await h.api.readDreamStory(project.id);
    const original = project.dreamStory.media.scene_1.image;
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'character', ownerId: 'student', assetIds: [assetId], crops: { [assetId]: { ...portrait, x: 0 } } }] });
    assert.equal(project.dreamStory.media.scene_1.image.status, 'stale');
    const file = project.assets.find((asset: any) => asset.id === original.assetId).projectPath;
    await h.api.bindDreamMedia(project.id, 'scene_1', 'image', file, undefined, undefined, undefined, dreamRequest(project));
    project = await h.api.readDreamStory(project.id); const reused = project.dreamStory.media.scene_1.image;
    assert.equal(reused.status, 'ready'); assert.equal(reused.fileSha256, original.fileSha256);
    assert.equal(reused.approvedDigest, undefined); assert.equal(reused.jobId, undefined); assert.equal(h.state.imageCalls, 0);
    await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_1' }); project = await h.api.readDreamStory(project.id);
    assert.ok(project.dreamStory.media.scene_1.image.approvedDigest); assert.equal(h.state.imageCalls, 0);
});
