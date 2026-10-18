import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('the startup migration adds legacy product sources idempotently without changing frozen publish jobs', async t => {
    const source = await fs.readFile(new URL('../electron/db.ts', import.meta.url), 'utf8');
    const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
    for (const table of ['tiktok_video_versions', 'tiktok_publish_jobs']) {
        const schema = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`))?.[0];
        assert.ok(schema); sql.exec(schema);
    }
    const legacy = { id: 'old', revision: 4, sourceProductId: 'product', sourceProductUpdatedAt: '2026-10-01', title: 'Old title', description: 'Original copy' };
    const dream = { id: 'dream', source: { kind: 'dream-story', projectId: 'dream-project', revision: 'r', targetDigest: 'digest' } };
    const insert = sql.prepare('INSERT INTO tiktok_video_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('old', 'default', 'product-work', 'old-project', 4, JSON.stringify(legacy), 1, 2);
    insert.run('dream', 'default', 'dream-work', 'dream-project', 1, JSON.stringify(dream), 1, 2);
    const frozen = JSON.stringify({ id: 'submitted-job', contentDigest: 'unchanged-media-digest', publishStatus: 'unknown', mediaAssetId: 'old-media', submittedAt: 7 });
    sql.prepare('INSERT INTO tiktok_publish_jobs VALUES (?, ?, ?, ?, ?, ?, ?)').run('submitted-job', 'default', 'old', 4, 'unchanged-media-digest', frozen, 7);
    const migration = source.match(/UPDATE tiktok_video_versions SET document_json = json_set\([\s\S]*?;/)?.[0];
    assert.ok(migration); sql.exec(migration);
    const first = sql.prepare('SELECT * FROM tiktok_video_versions ORDER BY id').all();
    sql.exec(migration);
    assert.deepEqual(sql.prepare('SELECT * FROM tiktok_video_versions ORDER BY id').all(), first);
    const migrated = JSON.parse(String(sql.prepare('SELECT document_json FROM tiktok_video_versions WHERE id = ?').get('old')!.document_json));
    assert.deepEqual(migrated, { ...legacy, source: { kind: 'product', productId: 'product', productUpdatedAt: '2026-10-01' } });
    assert.equal(sql.prepare('SELECT document_json FROM tiktok_video_versions WHERE id = ?').get('dream')!.document_json, JSON.stringify(dream));
    assert.equal(sql.prepare('SELECT document_json FROM tiktok_publish_jobs').get()!.document_json, frozen);
});
