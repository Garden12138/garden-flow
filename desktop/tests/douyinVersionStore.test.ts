import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { transform } from 'esbuild';

test('real Douyin version and publication SQL preserves revisions and space isolation', async () => {
    const source = await fs.readFile(new URL('../electron/db.ts', import.meta.url), 'utf8');
    const database = new DatabaseSync(':memory:');
    try {
        for (const table of ['douyin_video_versions', 'douyin_publish_jobs', 'douyin_publisher_config']) {
            const sql = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`))?.[0];
            assert.ok(sql, `missing ${table} schema`);
            database.exec(sql);
        }
        database.exec("INSERT INTO douyin_publisher_config (id, bound_extension_instance_id, updated_at) VALUES (1, '', 0)");
        const snippet = source.slice(source.indexOf('type DouyinVersionRow ='), source.indexOf('export const findXhsPublishJobByCandidate'));
        const compiled = await transform(`const db=globalThis.fixtureDb;
            const getActiveSpaceId=()=>globalThis.fixtureSpace;
            const safeJsonParse=(value,fallback)=>{try{return JSON.parse(value)}catch{return fallback}};
            ${snippet}`, { loader: 'ts', format: 'cjs' });
        const module = { exports: {} as any };
        const context = { module, exports: module.exports, fixtureDb: database, fixtureSpace: 'space-a' };
        vm.runInNewContext(compiled.code, context);
        const api = module.exports;
        const version = {
            id: 'version-1', spaceId: 'space-a', sourceProjectId: 'source-1',
            sourceProductId: 'product-1', sourceProductUpdatedAt: '2026-09-29', projectId: 'cut-1',
            title: '抖音初稿', description: '介绍商品', hashtags: ['猫粮'], revision: 1, createdAt: 1, updatedAt: 1,
        };
        api.insertDouyinVideoVersion(version);
        assert.equal(api.getDouyinVideoVersion(version.id).projectId, 'cut-1');
        assert.equal(api.getDouyinVideoVersionByProject('cut-1').id, version.id);
        assert.equal(api.listDouyinVideoVersions('source-1').length, 1);
        assert.equal(api.updateDouyinVideoVersion({ ...version, title: '抖音二稿', revision: 2, updatedAt: 2 }, 1), true);
        assert.equal(api.updateDouyinVideoVersion({ ...version, title: '过期覆盖', revision: 2 }, 1), false);
        assert.equal(api.getDouyinVideoVersion(version.id).title, '抖音二稿');
        const job = {
            id: 'job-1', platform: 'douyin', spaceId: 'space-a', sessionId: 'session-1', versionId: version.id,
            versionRevision: 2, projectId: 'cut-1', renderId: 'render-1', mediaAssetId: 'media-1',
            mediaPath: '/fixture/video.mp4', contentDigest: 'a'.repeat(64), title: '抖音二稿', description: '介绍商品',
            hashtags: ['猫粮'], accountId: 'account-1', accountLabel: '测试账号', extensionInstanceId: 'browser-1',
            status: 'awaiting_confirmation', publishStatus: 'not_submitted', resetStatus: 'not_started',
            errorCode: '', errorMessage: '', createdAt: 3, updatedAt: 3,
        };
        api.upsertDouyinPublishJob(job);
        assert.equal(api.getDouyinPublishJob(job.id).status, 'awaiting_confirmation');
        api.upsertDouyinPublishJob({ ...job, status: 'submitted_pending_review', publishStatus: 'pending_review', updatedAt: 4 });
        assert.equal(api.getDouyinPublishJob(job.id).publishStatus, 'pending_review');
        const publishedReview = { kind: 'user-verified-published', reviewedAt: 5, accountId: 'account-1', title: '抖音二稿' };
        api.upsertDouyinPublishJob({ ...job, status: 'completed', publishStatus: 'published', resetStatus: 'ready',
            publishedReview, updatedAt: 5 });
        assert.deepEqual(JSON.parse(JSON.stringify(api.getDouyinPublishJob(job.id).publishedReview)), publishedReview);
        const imageCover = { assetId: 'image-1', sourceSha256: 'c'.repeat(64), crop: 'center', files: [
            { orientation: 'portrait', path: '/fixture/portrait.jpg', sha256: 'd'.repeat(64), width: 1080, height: 1440 },
            { orientation: 'landscape', path: '/fixture/landscape.jpg', sha256: 'e'.repeat(64), width: 1440, height: 1080 },
        ] };
        assert.equal(api.getDouyinPublishJob(job.id).imageCover, undefined);
        api.upsertDouyinPublishJob({ ...job, imageCover });
        assert.deepEqual(JSON.parse(JSON.stringify(api.getDouyinPublishJob(job.id).imageCover)), imageCover);
        assert.equal(api.listDouyinPublishJobs().length, 1);
        api.setDouyinPublisherBinding('browser-1');
        assert.equal(api.getDouyinPublisherBinding(), 'browser-1');
        context.fixtureSpace = 'space-b';
        assert.equal(api.getDouyinVideoVersion(version.id), null);
        assert.equal(api.getDouyinPublishJob(job.id), null);
        assert.equal(api.listDouyinPublishJobs().length, 0);
    } finally { database.close(); }
});
