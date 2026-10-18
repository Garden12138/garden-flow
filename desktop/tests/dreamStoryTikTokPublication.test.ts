import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { productVideoHarness } from './helpers/productVideoHarness.ts';
import { readyDream, dreamRequest, dreamPng } from './helpers/dreamStoryFixture.ts';
const settings = { visibility: 'only_me', allowComments: false, allowReuse: false, allowRemix: false,
    audience18Plus: false, commercialContent: 'none', aiGenerated: true };
async function publicationFixture(h: any) {
    let project = await readyDream(h); const file = path.join(h.root, 'key.png'); await fs.writeFile(file, dreamPng);
    for (let index = 0; index < 8; index++) { await h.api.bindDreamMedia(project.id, 'scene_' + index, 'image', file); project = await h.api.readDreamStory(project.id); await h.api.approveDreamImage({ ...dreamRequest(project), sceneId: 'scene_' + index }); }
    const frozen = await h.api.validateDreamRender(project.id); const video = path.join(project.projectDir, 'fixture.mp4');
    await fs.writeFile(video, 'synthetic render boundary fixture');
    const asset = await h.api.registerRenderedVideoAsset({ projectId: project.id, renderId: 'fixture-render', sourcePath: video, title: 'Synthetic Dream' });
    project = await h.api.persistDreamProject({ ...await h.api.readDreamStory(project.id), status: 'exported', renderOutputs: [{ id: 'fixture-render', path: video,
        mediaAssetId: asset.id, renderFingerprint: h.api.dreamRenderFingerprint(frozen), outputSha256: await h.api.dreamFileSha256(video), createdAt: new Date().toISOString(), durationMs: 72000 }] });
    const version = h.api.getTikTokVideoVersionByProject(project.id);
    await h.api.saveTikTokVideoVersion({ ...version, versionId: version.id, expectedRevision: version.revision, publishSettings: settings });
    return project;
}
test('dream source needs no product; prepare never uploads and upload/submit keep separate button scopes', async t => {
    const h = await productVideoHarness({ dreamStory: true, publication: true, platformVersions: true }); t.after(() => h.close());
    const project = await publicationFixture(h); const source = { kind: 'dream-story', projectId: project.id };
    const snapshot = await h.api.readPublicationSource(source); assert.equal(snapshot.source.kind, 'dream-story');
    assert.equal(snapshot.coverCandidates.length, 8); assert.equal(snapshot.coverCandidates[0].timeMs, 4500);
    assert.equal(snapshot.coverCandidates[0].imageSha256, project.dreamStory.media.scene_0.image.fileSha256);
    assert.ok(!JSON.stringify(snapshot).includes('合成梦境：')); assert.ok(!JSON.stringify(snapshot).includes('imagePrompt'));
    const job = await h.api.preparePublication({ source, expectedRevision: snapshot.revision });
    assert.equal(job.phase, 'awaiting-upload'); assert.ok(!h.state.publisherCalls.some((call: any) => call.params.phase === 'prepare' || call.phase === 'submit'));
    await assert.rejects(h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest }, 'upload'), /按钮/);
    const uploaded = await h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest }, 'upload'));
    assert.equal(uploaded.phase, 'awaiting-submit'); assert.ok(!h.state.publisherCalls.some((call: any) => call.params.phase === 'submit'));
    const version = h.api.getTikTokVideoVersionByProject(project.id);
    await h.api.saveTikTokVideoVersion({ ...version, versionId: version.id, expectedRevision: version.revision, description: 'A changed description.', publishSettings: settings });
    await assert.rejects(h.api.withPublicationButton('submit', job.id, () => h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest }, 'submit')), /变化|更新|重新/);
    assert.ok(!h.state.publisherCalls.some((call: any) => call.params.phase === 'submit'));
});
test('cover-only review requires its button and acknowledgement and never uploads or submits', async t => {
    const h = await productVideoHarness({ dreamStory: true, publication: true, platformVersions: true }); t.after(() => h.close());
    const project = await publicationFixture(h); const source = { kind: 'dream-story', projectId: project.id };
    const snapshot = await h.api.readPublicationSource(source); const job = await h.api.preparePublication({ source, expectedRevision: snapshot.revision });
    const request = { platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest, coverOnly: true, acknowledged: true };
    await assert.rejects(h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication(request, 'upload')), /先完成/);
    await h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication({ ...request, coverOnly: undefined, acknowledged: false }, 'upload'));
    const before = h.state.publisherCalls.filter((call: any) => ['prepare', 'submit'].includes(call.params.phase)).length;
    await assert.rejects(h.api.actOnPublication(request, 'upload'), /按钮/);
    await assert.rejects(h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication({ ...request, acknowledged: false }, 'upload')), /明确确认/);
    const reviewed = await h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication(request, 'upload'));
    assert.equal(reviewed.phase, 'awaiting-submit'); assert.equal(reviewed.context.uploadReview.pageFingerprint, 'reviewed cover page');
    assert.equal(h.state.publisherCalls.filter((call: any) => ['prepare', 'submit'].includes(call.params.phase)).length, before);
    const calls = h.state.publisherCalls.filter((call: any) => call.params.phase === 'review-cover');
    assert.equal(calls.length, 1); assert.equal(calls[0].params.acknowledgedCoverOnly, true);
    const version = h.api.getTikTokVideoVersionByProject(project.id);
    await h.api.saveTikTokVideoVersion({ ...version, versionId: version.id, expectedRevision: version.revision, description: 'Changed after cover selection.', publishSettings: settings });
    await assert.rejects(h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication(request, 'upload')), /更新|变化/);
    assert.equal(h.state.publisherCalls.filter((call: any) => call.params.phase === 'review-cover').length, 1);
});
test('an unknown dream submission remains frozen across restart', async t => {
    const h = await productVideoHarness({ dreamStory: true, publication: true, platformVersions: true }); t.after(() => h.close());
    const project = await publicationFixture(h); const source = { kind: 'dream-story', projectId: project.id };
    const snapshot = await h.api.readPublicationSource(source); const job = await h.api.preparePublication({ source, expectedRevision: snapshot.revision });
    await h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest }, 'upload'));
    h.state.submitStatus = 'unknown';
    await h.api.withPublicationButton('submit', job.id, () => h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest }, 'submit'));
    const deadline = Date.now() + 10000;
    while (h.api.readPublicationJob('tiktok', job.id).publishStatus !== 'unknown' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(h.api.readPublicationJob('tiktok', job.id).publishStatus, 'unknown'); const count = h.state.publisherCalls.filter((call: any) => call.params.phase === 'submit').length;
    h.restart(); assert.equal(h.api.readPublicationJob('tiktok', job.id).publishStatus, 'unknown');
    await assert.rejects(h.api.withPublicationButton('upload', job.id, () => h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest, acknowledged: true, coverOnly: true }, 'upload')), /确认|失效|状态/);
    await assert.rejects(h.api.withPublicationButton('submit', job.id, () => h.api.actOnPublication({ platform: 'tiktok', jobId: job.id, expectedDigest: job.contentDigest }, 'submit')));
    assert.equal(h.state.publisherCalls.filter((call: any) => call.params.phase === 'submit').length, count);
});
