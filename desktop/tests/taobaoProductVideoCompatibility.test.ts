import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { productVideoHarness, makeProposal } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { resolveSubmittedAssetMentions } from '../shared/chatAssetReferences.ts';

// Actual catalog, SQLite confirmation and durable composition stores; no live pages/providers.
test('Taobao/Tmall @ references and confirmed image projects stay isolated through linking, edits and reopen', async (t) => {
    const h = await productVideoHarness(); t.after(() => h.close());
    const image = `data:image/png;base64,${createProductVideoVerificationPng('GF-ABC123DEF456').toString('base64')}`;
    const captures = [];
    for (const platform of ['taobao', 'tmall']) {
        captures.push(await h.store.ingestProduct({ platform, externalId: '123', sourceUrl: `https://${platform === 'taobao' ? 'item.taobao.com' : 'detail.tmall.com'}/item.htm?id=123`, title: `${platform} A1`, images: [{ sourceUrl: 'https://img.alicdn.com/a.png', dataUrl: image }] }));
    }
    const references = await Promise.all(captures.map((capture) => h.store.getProductCreativeReference(capture.product.product.id)));
    const [a, b] = references;
    const options = references.map((product) => ({ id: product.id, name: product.name, referenceType: 'product' }));
    assert.deepEqual(resolveSubmittedAssetMentions([a.id], options, []), [options[0]]);
    const input = { productId: a.id, relatedProductId: b.id, productVersion: a.updatedAt, relatedProductVersion: b.updatedAt, reason: '用户确认' };
    await h.approveFixture({ ...makeProposal(a, 'tb-proposal'), voiceoverEnabled: false }, 'tb-call', 'tb-session');
    await h.store.linkProducts(input);
    assert.equal(h.api.getPendingToolApproval('tb-call').status, 'pending');
    await h.store.upsertSku({ productId: b.id, name: '天猫新规格' });
    assert.equal(h.api.getPendingToolApproval('tb-call').status, 'pending');
    const first = await h.api.resolveProductVideoApproval('tb-call', true); assert.equal(first.success, true, first.error);
    const newestB = await h.store.getProductCreativeReference(b.id);
    await h.approveFixture({ ...makeProposal(newestB, 'tm-proposal'), voiceoverEnabled: false }, 'tm-call', 'tm-session');
    const second = await h.api.resolveProductVideoApproval('tm-call', true); assert.equal(second.success, true, second.error);
    const before = await h.api.getVideoEditorV2Project(first.projectId);
    await h.store.unlinkProducts({ productId: a.id, relatedProductId: b.id });
    await h.store.upsertProduct({ id: b.id, name: '天猫人工更新' });
    assert.deepEqual(await h.api.getVideoEditorV2Project(first.projectId), before);
    assert.deepEqual(await h.store.getProductCreativeReference(a.id), a);
    for (const [index, result] of [first, second].entries()) {
        const source = await h.api.getVideoEditorV2Project(result.projectId);
        const cut = await h.api.cloneProductVideoProject(source.id, `${index === 0 ? '淘宝' : '天猫'}商品｜抖音独立版本`);
        await h.api.applyProductVideoEditCommand({ projectId: cut.id, command: { type: 'scene.text', sceneId: 'scene-0', text: '仅修改抖音版本' } });
        assert.deepEqual(await h.api.getVideoEditorV2Project(source.id), source);
        assert.notEqual(cut.id, source.id);
        if (process.env.GARDENFLOW_STAGE4_RENDER_QA_DIR) {
            const outputDir = path.resolve(process.env.GARDENFLOW_STAGE4_RENDER_QA_DIR);
            await fs.mkdir(outputDir, { recursive: true });
            const rendered = await h.api.renderVideoEditorV2Project({ projectId: source.id, outputPath: path.join(outputDir, `${index === 0 ? 'taobao' : 'tmall'}-pure-images.mp4`) });
            const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', rendered.outputPath], { encoding: 'utf8' }));
            const video = probe.streams.filter((stream: any) => stream.codec_type === 'video');
            assert.equal(video.length, 1);
            assert.equal(video[0].width, 1080); assert.equal(video[0].height, 1920); assert.equal(video[0].r_frame_rate, '30/1');
            assert.ok(probe.streams.every((stream: any) => ['video', 'audio'].includes(stream.codec_type)));
            // Remotion may mux an AAC silence track even when the project has no audio.
            if (probe.streams.some((stream: any) => stream.codec_type === 'audio')) {
                const silence = spawnSync('ffmpeg', ['-i', rendered.outputPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
                assert.equal(silence.status, 0);
                const maximum = Number(silence.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
                assert.ok(Number.isFinite(maximum) && maximum <= -80, `Unexpected sound: ${maximum} dB`);
            }
            assert.ok(Math.abs(Number(probe.format.duration) - 15) < 0.1);
            execFileSync('ffmpeg', ['-v', 'error', '-i', rendered.outputPath, '-f', 'null', '-']);
            await fs.writeFile(path.join(outputDir, `${index === 0 ? 'taobao' : 'tmall'}-render-result.json`), JSON.stringify({ rendered, probe, pureImageSource: true, generationRequests: h.state.videoCalls + h.state.ttsCalls }, null, 2));
        }
        h.restart();
        const reopenedCut = await h.api.getVideoEditorV2Project(cut.id);
        assert.equal(reopenedCut.productVideo.scenes[0].overlayText, '仅修改抖音版本');
        assert.notEqual((await h.api.getVideoEditorV2Project(source.id)).productVideo.scenes[0].overlayText, '仅修改抖音版本');
        const output = await h.api.renderVideoEditorV2Project({ projectId: result.projectId, renderVideo: false });
        await fs.access(output.compositionPath);
    }
    h.restart();
    assert.equal((await h.api.getVideoEditorV2Project(first.projectId)).productVideo.proposal.productId, a.id);
    assert.equal((await h.api.getVideoEditorV2Project(second.projectId)).productVideo.proposal.productId, b.id);
    assert.equal(h.state.videoCalls + h.state.ttsCalls, 0);
});
