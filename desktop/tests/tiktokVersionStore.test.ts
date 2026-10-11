import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { transform } from 'esbuild';

test('real TikTok version and publication SQL preserves revisions and space isolation', async () => {
    const source = await fs.readFile(new URL('../electron/db.ts', import.meta.url), 'utf8');
    const database = new DatabaseSync(':memory:');
    try {
        for (const table of ['tiktok_video_versions', 'tiktok_publish_jobs', 'tiktok_publisher_config']) {
            const sql = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`))?.[0];
            assert.ok(sql, `missing ${table} schema`);
            database.exec(sql);
        }
        database.exec("INSERT INTO tiktok_publisher_config (id, bound_extension_instance_id, updated_at) VALUES (1, '', 0)");
        const snippet = source.slice(source.indexOf('type TikTokDocumentRow ='));
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
            title: 'TikTok初稿', description: '介绍商品', hashtags: ['猫粮'], revision: 1, createdAt: 1, updatedAt: 1,
        };
        api.insertTikTokVideoVersion(version);
        assert.equal(api.getTikTokVideoVersion(version.id).projectId, 'cut-1');
        assert.equal(api.getTikTokVideoVersionByProject('cut-1').id, version.id);
        assert.equal(api.listTikTokVideoVersions('source-1').length, 1);
        assert.equal(api.updateTikTokVideoVersion({ ...version, title: 'TikTok二稿', revision: 2, updatedAt: 2 }, 1), true);
        assert.equal(api.updateTikTokVideoVersion({ ...version, title: '过期覆盖', revision: 2 }, 1), false);
        assert.equal(api.getTikTokVideoVersion(version.id).title, 'TikTok二稿');
        const job = {
            id: 'job-1', platform: 'tiktok', spaceId: 'space-a', sessionId: 'session-1', versionId: version.id,
            versionRevision: 2, projectId: 'cut-1', renderId: 'render-1', mediaAssetId: 'media-1',
            mediaPath: '/fixture/video.mp4', contentDigest: 'a'.repeat(64), title: 'TikTok二稿', description: '介绍商品',
            hashtags: ['猫粮'], accountId: 'account-1', accountLabel: '测试账号', extensionInstanceId: 'browser-1',
            status: 'awaiting_confirmation', publishStatus: 'not_submitted', resetStatus: 'not_started',
            errorCode: '', errorMessage: '', createdAt: 3, updatedAt: 3,
        };
        api.upsertTikTokPublishJob(job);
        assert.equal(api.getTikTokPublishJob(job.id).status, 'awaiting_confirmation');
        api.upsertTikTokPublishJob({ ...job, status: 'submitted_pending_review', publishStatus: 'pending_review', updatedAt: 4 });
        assert.equal(api.getTikTokPublishJob(job.id).publishStatus, 'pending_review');
        const publishedReview = { kind: 'user-verified-published', reviewedAt: 5, accountId: 'account-1', title: 'TikTok二稿' };
        api.upsertTikTokPublishJob({ ...job, status: 'completed', publishStatus: 'published', resetStatus: 'ready',
            publishedReview, updatedAt: 5 });
        assert.deepEqual(JSON.parse(JSON.stringify(api.getTikTokPublishJob(job.id).publishedReview)), publishedReview);
        api.upsertTikTokPublishJob({ ...job, id: 'job-retry', createdAt: 6 });
        assert.equal(api.listTikTokPublishJobs().length, 2);
        assert.equal(api.getTikTokPublishJob(job.id).publishedReview.kind, 'user-verified-published');
        api.setTikTokPublisherBinding('browser-1');
        assert.equal(api.getTikTokPublisherBinding(), 'browser-1');
        context.fixtureSpace = 'space-b';
        assert.equal(api.getTikTokVideoVersion(version.id), null);
        assert.equal(api.getTikTokPublishJob(job.id), null);
        assert.equal(api.listTikTokPublishJobs().length, 0);
    } finally { database.close(); }
});

test('TikTok prototype migration preserves reviewed history and permits a separate retry', async () => {
    const source = await fs.readFile(new URL('../electron/db.ts', import.meta.url), 'utf8');
    const sql = new DatabaseSync(':memory:');
    try {
        const schema = source.match(/CREATE TABLE IF NOT EXISTS tiktok_publish_jobs \([\s\S]*?\);/)![0];
        sql.exec(schema.replace('created_at INTEGER NOT NULL', 'created_at INTEGER NOT NULL, UNIQUE(space_id, version_id, version_revision, content_digest)'));
        const old = { id: 'old', spaceId: 'default', versionId: 'version', versionRevision: 1, contentDigest: 'digest', createdAt: 1, publishedReview: { kind: 'user-verified-published' } };
        sql.prepare('INSERT INTO tiktok_publish_jobs VALUES (?, ?, ?, ?, ?, ?, ?)').run(old.id, old.spaceId, old.versionId, 1, old.contentDigest, JSON.stringify(old), 1);
        const snippet = source.slice(source.indexOf('type TikTokDocumentRow ='));
        const compiled = await transform('const db=globalThis.fixtureDb; const getActiveSpaceId=()=>"default"; const safeJsonParse=JSON.parse;\n' + snippet, { loader: 'ts', format: 'cjs' });
        const module = { exports: {} as any };
        const adapter = { prepare: (query: string) => sql.prepare(query), exec: (query: string) => sql.exec(query), transaction: (fn: Function) => () => {
            sql.exec('BEGIN'); try { fn(); sql.exec('COMMIT'); } catch (error) { sql.exec('ROLLBACK'); throw error; }
        } };
        vm.runInNewContext(compiled.code, { module, exports: module.exports, fixtureDb: adapter });
        module.exports.migrateTikTokPublishHistory();
        module.exports.migrateTikTokPublishHistory();
        module.exports.upsertTikTokPublishJob({ ...old, id: 'retry', createdAt: 2 });
        assert.equal(module.exports.listTikTokPublishJobs().length, 2);
        assert.equal(module.exports.getTikTokPublishJob('old').publishedReview.kind, 'user-verified-published');
    } finally { sql.close(); }
});
