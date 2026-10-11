import assert from 'node:assert/strict';
import test from 'node:test';
import { productVideoHarness, makeProposal } from './helpers/productVideoHarness.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';
import { videoRenderFingerprint } from '../electron/core/video-editor-v2/videoPublicationPolicy.ts';

// Real catalog, approval SQL, XHS note projections, Douyin version SQL and project stores.
// Product pages and export receipts are fixtures; this does not exercise online publishing.
test('Taobao/Tmall XHS notes and durable Douyin versions stay independent across product links and restart', async (t) => {
    const h = await productVideoHarness({ platformVersions: true });
    t.after(() => h.close());
    const image = `data:image/png;base64,${createProductVideoVerificationPng('GF-ABC123DEF456').toString('base64')}`;
    const records: any[] = [];
    for (const platform of ['taobao', 'tmall']) {
        const captured = await h.store.ingestProduct({
            platform, externalId: '123', title: `${platform} A1`,
            sourceUrl: `https://${platform === 'taobao' ? 'item.taobao.com' : 'detail.tmall.com'}/item.htm?id=123`,
            images: [{ sourceUrl: 'https://img.alicdn.com/a.png', dataUrl: image }],
        });
        const reference = await h.store.getProductCreativeReference(captured.product.product.id);
        await h.approveFixture({ ...makeProposal(reference, `${platform}-proposal`), voiceoverEnabled: false }, `${platform}-call`);
        const approved = await h.api.resolveProductVideoApproval(`${platform}-call`, true);
        assert.equal(approved.success, true, approved.error);
        const source = await h.api.getVideoEditorV2Project(approved.projectId);
        const note = await h.api.saveXhsNoteProject({
            path: `xiaohongshu/video-${source.id}.redvideo`, noteType: 'video',
            document: { finalTitle: `${platform} 小红书标题`, body: `${platform} 小红书正文`, hashtags: ['A1'],
                sourceVideoExport: { projectId: source.id, renderId: `${platform}-render`, mediaAssetId: `${platform}-media`, renderFingerprint: videoRenderFingerprint(source) } },
        });
        const versions = await Promise.all([0, 1].map(() => h.api.createDouyinVideoVersion({ sourceProjectId: source.id, sourceNotePath: note.relativePath })));
        assert.equal(versions[0].id, versions[1].id, 'repeated requests reuse the same durable version');
        const version = versions[0];
        assert.equal(version.sourceProductId, reference.id);
        assert.equal(version.sourceProductUpdatedAt, reference.updatedAt);
        assert.equal(version.sourceNotePath, note.relativePath);
        assert.equal(version.sourceNoteRevision, note.version);
        assert.equal(version.title, note.document.finalTitle);
        const cut = await h.api.getVideoEditorV2Project(version.projectId);
        assert.notEqual(cut.id, source.id);
        assert.ok(cut.assets.every((asset: any) => asset.projectPath.startsWith(cut.projectDir)));
        await h.api.applyProductVideoEditCommand({ projectId: cut.id, command: { type: 'scene.text', sceneId: 'scene-0', text: `${platform} 仅抖音字幕` } });
        const edited = await h.api.saveDouyinVideoVersion({ versionId: version.id, expectedRevision: version.revision,
            title: `${platform} 抖音标题`, description: `${platform} 抖音正文`, hashtags: ['独立版本'] });
        assert.equal(edited.revision, 2);
        await assert.rejects(h.api.saveDouyinVideoVersion({ versionId: version.id, expectedRevision: 1, title: '过期', description: '覆盖', hashtags: [] }), /更新/);
        assert.deepEqual(await h.api.getVideoEditorV2Project(source.id), source);
        assert.deepEqual(await h.api.getXhsNoteProject(note.relativePath), note);
        records.push({ reference, source, note, version: edited, cut: await h.api.getVideoEditorV2Project(cut.id) });
    }
    const [a, b] = records;
    assert.notEqual(a.reference.id, b.reference.id);
    await h.store.linkProducts({ productId: a.reference.id, relatedProductId: b.reference.id,
        productVersion: a.reference.updatedAt, relatedProductVersion: b.reference.updatedAt, reason: '用户确认 A1' });
    await h.store.upsertProduct({ id: b.reference.id, name: '天猫单独更新' });
    await h.store.unlinkProducts({ productId: a.reference.id, relatedProductId: b.reference.id });
    h.restart();
    for (const record of records) {
        // A restart uses a fresh VM realm; compare persisted values without realm prototypes.
        assert.deepEqual(structuredClone(h.api.getDouyinVideoVersion(record.version.id)), structuredClone(record.version));
        assert.deepEqual(structuredClone(await h.api.getXhsNoteProject(record.note.relativePath)), structuredClone(record.note));
        assert.deepEqual(structuredClone(await h.api.getVideoEditorV2Project(record.source.id)), structuredClone(record.source));
        assert.deepEqual(structuredClone(await h.api.getVideoEditorV2Project(record.cut.id)), structuredClone(record.cut));
        assert.equal((await h.api.createDouyinVideoVersion({ sourceProjectId: record.source.id })).id, record.version.id);
    }
    assert.deepEqual(structuredClone(await h.store.getProductCreativeReference(a.reference.id)), structuredClone(a.reference));
    assert.equal(h.state.videoCalls + h.state.ttsCalls, 0);
});
