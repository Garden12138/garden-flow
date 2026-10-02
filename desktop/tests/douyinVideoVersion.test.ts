import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { productVideoHarness, makeProposal, sineWav } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';

test('Douyin cut copies media and dual tracks while clearing old exports and isolating edits', async (t) => {
    const h = await productVideoHarness();
    t.after(() => h.close());
    const picture = createProductVideoVerificationPng('GF-ABC123DEF456').toString('base64');
    const bundle = await h.store.upsertProduct({ name: '版本隔离商品', images: [{ dataUrl: `data:image/png;base64,${picture}` }] });
    const product = await h.store.getProductCreativeReference(bundle.product.id);
    await h.approveFixture(makeProposal(product, 'proposal-douyin-copy'));
    const approved = await h.api.resolveProductVideoApproval('approval-1', true);
    assert.equal(approved.success, true);
    const sourceId = approved.projectId;
    const music = `${h.root}/music.wav`;
    const voice = `${h.root}/voice.wav`;
    await fs.writeFile(music, sineWav(15, 220));
    await fs.writeFile(voice, sineWav(1, 440));
    await h.api.setProductVideoMusic({ projectId: sourceId, sourcePath: music });
    await h.api.attachProductVideoVoiceoverAsset({ projectId: sourceId, sceneId: 'scene-0', absolutePath: voice, source: 'imported' });
    const source = await h.api.getVideoEditorV2Project(sourceId);
    await h.api.saveVideoEditorV2Project({ ...source, status: 'exported', renderOutputs: [{ id: 'old-render', path: `${source.projectDir}/renders/old.mp4`, mediaAssetId: 'old-media', createdAt: new Date().toISOString() }] });
    const copy = await h.api.cloneProductVideoProject(sourceId);
    assert.notEqual(copy.id, sourceId);
    assert.equal(copy.status, 'ready');
    assert.equal(copy.renderOutputs.length, 0);
    assert.equal(copy.undoStack.length, 0);
    assert.equal(copy.timeline.tracks.find((track: any) => track.kind === 'music')?.clips.length, 1);
    assert.equal(copy.timeline.tracks.find((track: any) => track.kind === 'voiceover')?.clips.length, 1);
    for (const asset of copy.assets) {
        assert.ok(asset.projectPath.startsWith(copy.projectDir));
        assert.ok((await fs.stat(asset.projectPath)).isFile());
    }
    await h.api.applyProductVideoEditCommand({ projectId: copy.id, command: { type: 'scene.text', sceneId: 'scene-1', text: '仅抖音版本修改' } });
    const freshSource = await h.api.getVideoEditorV2Project(sourceId);
    assert.notEqual(freshSource.productVideo.scenes[1].overlayText, '仅抖音版本修改');
    assert.equal(freshSource.renderOutputs[0].id, 'old-render');
    h.restart();
    const reopenedCopy = await h.api.getVideoEditorV2Project(copy.id);
    assert.equal(reopenedCopy.productVideo.scenes[1].overlayText, '仅抖音版本修改');
    assert.equal(reopenedCopy.renderOutputs.length, 0);
});
