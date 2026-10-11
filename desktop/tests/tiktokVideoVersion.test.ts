import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { productVideoHarness, makeProposal, sineWav } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';

test('TikTok localization requires confirmation, rejects stale proposals, survives reopen and isolates other platform cuts', async (t) => {
    const h = await productVideoHarness({ platformVersions: true });
    t.after(() => h.close());
    const picture = createProductVideoVerificationPng('GF-ABC123DEF456').toString('base64');
    const bundle = await h.store.upsertProduct({ name: '商品版本隔离', images: [{ dataUrl: 'data:image/png;base64,' + picture }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    await h.approveFixture(makeProposal(product));
    const approved = await h.api.resolveProductVideoApproval('approval-1', true);
    assert.equal(approved.success, true);
    const sourceId = approved.projectId;
    const voice = h.root + '/voice.wav';
    await fs.writeFile(voice, sineWav(1));
    await h.api.applyProductVideoEditCommand({ projectId: sourceId, command: { type: 'scene.narration-text', sceneId: 'scene-0', text: '商品介绍' } });
    await h.api.attachProductVideoVoiceoverAsset({ projectId: sourceId, sceneId: 'scene-0', absolutePath: voice, source: 'imported' });
    const source = await h.api.getVideoEditorV2Project(sourceId);
    const douyin = await h.api.createDouyinVideoVersion({ sourceProjectId: sourceId });
    const [first, same] = await Promise.all([
        h.api.createTikTokVideoVersion({ sourceProjectId: sourceId }),
        h.api.createTikTokVideoVersion({ sourceProjectId: sourceId }),
    ]);
    assert.equal(first.id, same.id);
    assert.notEqual(first.projectId, sourceId);
    assert.notEqual(first.projectId, douyin.projectId);
    let copy = await h.api.getVideoEditorV2Project(first.projectId);
    assert.equal(copy.renderOutputs.length, 0);
    assert.equal(copy.productVideo.voiceoverAutoApprovedAt, undefined);
    for (const asset of copy.assets) assert.ok(asset.projectPath.startsWith(copy.projectDir));
    const edit = { versionId: first.id, expectedRevision: 1, title: 'Product video', description: 'Product introduction', hashtags: ['Product'], language: 'en', market: 'International' };
    const saved = await h.api.saveTikTokVideoVersion(edit);
    await assert.rejects(h.api.saveTikTokVideoVersion(edit), /已更新/);
    h.state.localizationResponse = { title: 'English product', description: 'Product details', hashtags: ['Product'],
        scenes: copy.productVideo.scenes.map((scene: any, i: number) => ({ sceneId: scene.id, overlayText: 'Product picture ' + i, narrationText: i === 0 ? 'Product introduction' : '' })) };
    const request = { versionId: saved.id, expectedRevision: 2, language: 'en', market: 'International', llm: { baseURL: 'https://text.invalid/v1', apiKey: 'fixture', modelName: 'fixture' } };
    const proposal = await h.api.suggestTikTokLocalization(request);
    assert.equal((await h.api.getVideoEditorV2Project(copy.id)).productVideo.scenes[0].overlayText, copy.productVideo.scenes[0].overlayText);
    const applied = await h.api.applyTikTokLocalization(proposal.id);
    assert.equal(applied.version.revision, 3);
    assert.equal(applied.project.productVideo.scenes[0].overlayText, 'Product picture 0');
    assert.equal(applied.project.productVideo.scenes[0].voiceoverStatus, 'stale');
    assert.equal(JSON.stringify(applied.project.productVideo.productSnapshot), JSON.stringify(source.productVideo.productSnapshot));
    await assert.rejects(h.api.applyTikTokLocalization(proposal.id), /过期/);
    const staleProject = await h.api.suggestTikTokLocalization({ ...request, expectedRevision: 3 });
    await h.api.applyProductVideoEditCommand({ projectId: copy.id, command: { type: 'scene.text', sceneId: 'scene-1', text: 'Manual edit' } });
    await assert.rejects(h.api.applyTikTokLocalization(staleProject.id), /更新/);
    const staleVersion = await h.api.suggestTikTokLocalization({ ...request, expectedRevision: 3 });
    const latest = await h.api.saveTikTokVideoVersion({ ...edit, expectedRevision: 3, title: 'Latest title' });
    await assert.rejects(h.api.applyTikTokLocalization(staleVersion.id), /变化/);
    copy = await h.api.getVideoEditorV2Project(copy.id);
    await assert.rejects(h.api.applyProductVideoLocalization({ projectId: copy.id, expectedUpdatedAt: copy.updatedAt, scenes: proposal.scenes,
        validateVersion: () => {}, commitVersion: () => { throw new Error('fixture commit failure'); } }), /commit failure/);
    assert.equal((await h.api.getVideoEditorV2Project(copy.id)).productVideo.scenes[1].overlayText, 'Manual edit');
    const duplicate = await h.api.createTikTokVideoVersion({ sourceProjectId: copy.id, duplicate: true });
    assert.notEqual(duplicate.projectId, copy.id);
    assert.equal(duplicate.sourceProjectId, sourceId);
    assert.equal(duplicate.language, 'en');
    h.restart();
    assert.equal(h.api.getTikTokVideoVersion(first.id).revision, latest.revision);
    assert.equal((await h.api.getVideoEditorV2Project(copy.id)).productVideo.scenes[1].overlayText, 'Manual edit');
    assert.equal((await h.api.getVideoEditorV2Project(sourceId)).productVideo.scenes[0].overlayText, source.productVideo.scenes[0].overlayText);
    assert.equal((await h.api.getVideoEditorV2Project(douyin.projectId)).productVideo.scenes[0].overlayText, source.productVideo.scenes[0].overlayText);
    assert.equal(h.state.videoCalls, 0);
    assert.equal(h.state.ttsCalls, 0);
    h.state.spaceId = 'other';
    assert.equal(h.api.getTikTokVideoVersion(first.id), null);
    await assert.rejects(h.api.saveTikTokVideoVersion({ ...edit, expectedRevision: latest.revision }), /不属于/);
});
