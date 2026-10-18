import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { readyDream, dreamRequest, dreamPng } from './helpers/dreamStoryFixture.ts';

export async function dreamRenderFixture(h: any) {
    let project = await readyDream(h); const file = path.join(h.root, 'scene.png'); await fs.writeFile(file, dreamPng);
    for (let i = 0; i < 8; i++) { await h.api.bindDreamMedia(project.id, 'scene_' + i, 'image', file); project = await h.api.readDreamStory(project.id);
        await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_' + i }); }
    return h.api.readDreamStory(project.id);
}
test('formal rendering refuses missing or unapproved images and corrupted files', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); let project = await readyDream(h);
    await assert.rejects(h.api.validateDreamRender(project.id), /缺失/);
    const file = path.join(h.root, 'scene.png'); await fs.writeFile(file, dreamPng); await h.api.bindDreamMedia(project.id, 'scene_0', 'image', file);
    await assert.rejects(h.api.validateDreamRender(project.id), /确认/);
    project = await h.api.readDreamStory(project.id); await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_0' });
    await fs.writeFile(project.assets[0].projectPath, 'corrupted'); await assert.rejects(h.api.validateDreamRender(project.id), /变化/);
});
test('render identity survives harmless saves, separates previews and invalidates when image input changes', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); let project = await dreamRenderFixture(h);
    const frozen = await h.api.validateDreamRender(project.id); const key = h.api.dreamRenderFingerprint(frozen);
    const content = h.api.dreamRenderContentDigest(project);
    const replaced = structuredClone(project); replaced.dreamStory.media.scene_0.image.assetId = 'replacement';
    assert.notEqual(h.api.dreamRenderContentDigest(replaced), content);
    assert.notEqual(key, h.api.dreamRenderFingerprint(frozen, true));
    await h.api.persistDreamProject(project); assert.equal(h.api.dreamRenderFingerprint(await h.api.validateDreamRender(project.id)), key);
    project = await h.api.applyDreamEdit({ ...dreamRequest(await h.api.readDreamStory(project.id)), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { visual: 'A different shore.' } }] });
    assert.equal(project.dreamStory.media.scene_0.image.status, 'stale'); assert.equal(project.dreamStory.media.scene_1.image.status, 'ready');
});
