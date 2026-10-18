import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness, sineWav } from './helpers/productVideoHarness.ts';
import { readyDream, dreamRequest, dreamPng } from './helpers/dreamStoryFixture.ts';

async function waitBatch(h: any, projectId: string, id: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const result = await h.api.reconcileDreamMedia(projectId); const batch = result.batches.find((item: any) => item.id === id);
        if (batch?.state === 'completed') return batch;
        await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('batch did not settle');
}
test('batch preview submits nothing, duplicate confirmation submits once, private prompts stay project scoped', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid/v1', image_api_key: 'fixture', image_model: 'fixture-image', image_provider_template: 'openai-images' };
    h.state.imageHook = async input => ({ assets: [await h.api.createGeneratedMediaAsset({ prompt: input.prompt, dataBuffer: dreamPng,
        projectId: input.projectId, mimeType: 'image/png', privacyScope: input.privacyScope, title: '梦境画面' })] });
    const req = dreamRequest(project);
    const batch = await h.api.previewDreamBatch({ ...req, kind: 'image', sceneIds: ['scene_0'] }); assert.equal(h.state.imageCalls, 0);
    await Promise.all([h.api.confirmDreamBatch({ ...req, batchId: batch.id }), h.api.confirmDreamBatch({ ...req, batchId: batch.id })]);
    await waitBatch(h, project.id, batch.id); assert.equal(h.state.imageCalls, 1);
    const current = await h.api.readDreamStory(project.id); assert.equal(current.dreamStory.media.scene_0.image.status, 'ready');
    assert.equal((await h.api.listMediaAssets()).find((asset: any) => asset.projectId === project.id).prompt, undefined);
    assert.equal((await new h.api.MediaGenerationJobRegistry().listJobs({ source: 'dream-story' })).items.length, 0);
    const privateJobs = await fs.readFile(path.join(project.projectDir, 'private/media-jobs.json'), 'utf8'); assert.ok(privateJobs.includes('Portrait luminous key'));
    assert.ok(!privateJobs.includes('合成梦境：')); assert.ok(!privateJobs.includes('image_api_key'));
    h.restart(); await h.api.confirmDreamBatch({ ...dreamRequest(await h.api.readDreamStory(project.id)), batchId: batch.id });
    await h.api.reconcileDreamMedia(project.id); assert.equal(h.state.imageCalls, 1);
});
test('audio binds measured duration and editing narration expires only that scene audio', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close());
    let project = await readyDream(h, true);
    h.state.settings = { tts_endpoint: 'https://tts.invalid/v1', tts_api_key: 'fixture', tts_model: 'tts-1' }; h.state.audio = sineWav(1.2);
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'audio', sceneIds: ['scene_0', 'scene_1'] });
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }); await waitBatch(h, project.id, batch.id);
    project = await h.api.readDreamStory(project.id); assert.equal(h.state.ttsCalls, 2);
    assert.ok(Math.abs(project.dreamStory.media.scene_0.audio.durationMs - 1200) < 50);
    const preserved = project.dreamStory.media.scene_1.audio.assetId;
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'scene.update', sceneId: 'scene_0', changes: { narration: 'A different quiet shore.' } }] });
    assert.equal(project.dreamStory.media.scene_0.audio.status, 'stale'); assert.equal(project.dreamStory.media.scene_1.audio.assetId, preserved);
    h.restart(); await h.api.reconcileDreamMedia(project.id); assert.equal(h.state.ttsCalls, 2);
});
test('changed provider or target prevents use of an old generation authorization', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid', image_api_key: 'fixture', image_model: 'fixture-image' };
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    h.state.settings.image_model = 'another-model';
    await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }), /变化/); assert.equal(h.state.imageCalls, 0);
});
test('a late image never replaces a manual selection, including after restart', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid/v1', image_api_key: 'fixture', image_model: 'fixture-image', image_provider_template: 'openai-images' };
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    h.state.imageHook = async input => { await held; return { assets: [await h.api.createGeneratedMediaAsset({ prompt: input.prompt, dataBuffer: dreamPng, projectId: input.projectId, mimeType: 'image/png', privacyScope: 'project' })] }; };
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id });
    while (!h.state.imageCalls) await new Promise(resolve => setTimeout(resolve, 10));
    const manual = path.join(h.root, 'manual.png'); await fs.writeFile(manual, Buffer.concat([dreamPng, Buffer.from('manual-selection')]));
    await h.api.bindDreamMedia(project.id, 'scene_0', 'image', manual);
    const selectedId = (await h.api.readDreamStory(project.id)).dreamStory.media.scene_0.image.assetId;
    release(); await waitBatch(h, project.id, batch.id);
    assert.equal((await h.api.readDreamStory(project.id)).dreamStory.media.scene_0.image.assetId, selectedId);
    h.restart(); await h.api.reconcileDreamMedia(project.id);
    assert.equal((await h.api.readDreamStory(project.id)).dreamStory.media.scene_0.image.assetId, selectedId); assert.equal(h.state.imageCalls, 1);
});
test('an accepted checkpoint without a recorded job is interrupted without resubmission', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid', image_api_key: 'fixture', image_model: 'fixture-image' };
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    const file = path.join(project.projectDir, 'private/batches.json'); const list = JSON.parse(await fs.readFile(file, 'utf8')); list[0].state = 'accepted'; await fs.writeFile(file, JSON.stringify(list));
    h.restart(); await h.api.confirmDreamBatch({ ...dreamRequest(await h.api.readDreamStory(project.id)), batchId: batch.id });
    assert.equal((await h.api.reconcileDreamMedia(project.id)).batches[0].state, 'interrupted'); assert.equal(h.state.imageCalls, 0);
});
test('reopening a submitted request without a receipt shows unknown and never resubmits', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid', image_api_key: 'fixture', image_model: 'fixture-image' };
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    const file = path.join(project.projectDir, 'private/batches.json'); const list = JSON.parse(await fs.readFile(file, 'utf8'));
    list[0].state = 'accepted'; list[0].jobs.scene_0 = 'fixture-interrupted-submission'; await fs.writeFile(file, JSON.stringify(list));
    for (const phase of ['submitting', 'submitted', 'persisting', 'queued']) {
        await fs.writeFile(path.join(project.projectDir, 'private/media-jobs.json'), JSON.stringify({ version: 1, jobs: [{ jobId: 'fixture-interrupted-submission', kind: 'image', status: phase, artifacts: [] }] }));
        h.restart(); await h.api.reconcileDreamMedia(project.id);
        const current = await h.api.readDreamStory(project.id);
        assert.equal(current.dreamStory.media.scene_0.image.status, phase === 'queued' ? 'interrupted' : 'unknown');
        assert.equal(current.dreamStory.media.scene_0.image.approvedDigest, undefined);
        await h.api.confirmDreamBatch({ ...dreamRequest(current), batchId: batch.id });
        assert.equal(h.state.imageCalls, 0);
        const stored = JSON.parse(await fs.readFile(path.join(project.projectDir, 'private/media-jobs.json'), 'utf8'));
        assert.equal(stored.jobs[0].status, phase); // The persisted supplier fact is preserved.
    }
});
test('a preview created with older image rules requires fresh authorization before submitting', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid', image_api_key: 'fixture', image_model: 'fixture-image' };
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    const file = path.join(project.projectDir, 'private/batches.json'); const list = JSON.parse(await fs.readFile(file, 'utf8'));
    delete list[0].imagePromptVersion; await fs.writeFile(file, JSON.stringify(list));
    h.restart(); await assert.rejects(h.api.confirmDreamBatch({ ...dreamRequest(await h.api.readDreamStory(project.id)), batchId: batch.id }), /提示规则已更新/);
    assert.equal(h.state.imageCalls, 0);
});
test('private provider errors and task summaries cannot echo the submitted prompt', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); const project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid', image_api_key: 'fixture', image_model: 'fixture-image' };
    h.state.imageHook = async input => { throw new Error('Provider echoed: ' + input.prompt); };
    const batch = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] });
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: batch.id }); await waitBatch(h, project.id, batch.id);
    const registry = new h.api.MediaGenerationJobRegistry('default', 'media-jobs.json', project.id);
    const summaries = await registry.listJobSummaries();
    assert.ok(!JSON.stringify(summaries).includes('Portrait luminous key'));
    const job = await registry.getJob(summaries.items[0].jobId);
    assert.equal(job.status, 'submission_unknown');
    assert.ok(!JSON.stringify(job.recentEvents).includes('Portrait luminous key'));
    assert.ok(!job.attempt.lastError.includes('Provider echoed'));
    assert.equal(h.state.imageCalls, 1);
});
test('simultaneously authorized batches share the two-image concurrency limit', async t => {
    const h = await productVideoHarness({ dreamStory: true }); t.after(() => h.close()); let project = await readyDream(h);
    h.state.settings = { image_endpoint: 'https://images.invalid', image_api_key: 'fixture', image_model: 'fixture-image' };
    const referenceFile = path.join(h.root, 'fixed-reference.png'); await fs.writeFile(referenceFile, dreamPng);
    await h.api.bindDreamMedia(project.id, 'scene_0', 'image', referenceFile); project = await h.api.readDreamStory(project.id);
    await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_0' }); project = await h.api.readDreamStory(project.id);
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'reference.bind', ownerKind: 'setting', ownerId: 'sea', assetIds: [project.dreamStory.media.scene_0.image.assetId] }] });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
    let active = 0; let peak = 0;
    h.state.imageHook = async input => { active++; peak = Math.max(peak, active); await held;
        const asset = await h.api.createGeneratedMediaAsset({ prompt: input.prompt, dataBuffer: dreamPng, projectId: input.projectId, mimeType: 'image/png', privacyScope: 'project' });
        active--; return { assets: [asset] }; };
    const first = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0', 'scene_1'] });
    const second = await h.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_2', 'scene_3'] });
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: first.id });
    await h.api.confirmDreamBatch({ ...dreamRequest(project), batchId: second.id });
    const deadline = Date.now() + 5000;
    while (h.state.imageCalls < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(h.state.imageCalls, 2);
    release(); await waitBatch(h, project.id, first.id); await waitBatch(h, project.id, second.id);
    assert.equal(h.state.imageCalls, 4); assert.equal(peak, 2);
});
