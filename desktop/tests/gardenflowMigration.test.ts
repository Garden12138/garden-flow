import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import migration from '../scripts/gardenflow-data-migration.cjs';
import compatibility from '../shared/brandCompatibility.cjs';
import { configureMigratedPaths, resolveMigratedPath } from '../electron/core/legacyPathResolver.ts';
import { resolvePathInWorkspace } from '../electron/core/tools/workspaceGuard.ts';
import { extractLocalAssetPathCandidate } from '../shared/localAsset.ts';
import { migrateChromeStorage } from '../../Plugin/src/brandStorage.js';
import { installRuntimeAliases } from '../../Plugin/src/brandRuntime.js';

function fixture(t: test.TestContext, wal = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gardenflow-migration-'));
    t.after(() => { configureMigratedPaths([]); fs.rmSync(root, { recursive: true, force: true }); });
    const options = Object.fromEntries(['sourceUserData', 'sourceWorkspace', 'targetUserData', 'targetWorkspace', 'backupRoot'].map(key => [key, path.join(root, key)]));
    fs.mkdirSync(options.sourceUserData);
    fs.mkdirSync(path.join(options.sourceWorkspace, 'spaces/default/redclaw'), { recursive: true });
    fs.mkdirSync(path.join(options.sourceWorkspace, 'spaces/default/manuscripts'), { recursive: true });
    fs.writeFileSync(path.join(options.sourceWorkspace, 'spaces/default/manuscripts/note.md'), 'Bojin 博今 redclaw 用户正文');
    fs.writeFileSync(path.join(options.sourceWorkspace, 'spaces/default/redclaw/background-runner.json'), JSON.stringify({ enabled: true, mode: 'redclaw', prompt: '请调用 redclaw，不改正文', completedRounds: 7 }));
    const db = new DatabaseSync(path.join(options.sourceUserData, 'redconvert.db'));
    if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    db.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY, workspace_dir TEXT, model_name_redclaw TEXT, ai_sources_json TEXT, video_models_json TEXT, api_key TEXT); CREATE TABLE chat_messages (id TEXT PRIMARY KEY, content TEXT, metadata TEXT); CREATE TABLE knowledge_vectors (id TEXT PRIMARY KEY, content TEXT, embedding BLOB)');
    db.prepare('INSERT INTO settings VALUES (1, ?, ?, ?, ?, ?)').run(options.sourceWorkspace, 'bojin-max', JSON.stringify([{ id: 'redbox_official_auto', name: 'Bojin官方', apiKey: 'do-not-change-bojin-secret', baseURL: 'https://example.test/bojin/v1', models: ['bojin-vl-embedding', 'qwen3.8-max'] }]), JSON.stringify(['bojin-video-H3']), 'bojin-secret');
    db.prepare('INSERT INTO chat_messages VALUES (?, ?, ?)').run('redclaw-history-id', 'Bojin 用户历史内容', JSON.stringify({ mode: 'redclaw', prompt: 'redclaw 原始提示词' }));
    db.prepare('INSERT INTO knowledge_vectors VALUES (?, ?, ?)').run('vector-id', '原始内容', Buffer.from([1, 2, 3, 255]));
    if (wal) t.after(() => db.close()); else db.close();
    return options;
}

test('migration preserves WAL records, content, credentials and vectors while converting typed settings', t => {
    const options = fixture(t, true);
    const result = migration.migrateData(options, DatabaseSync);
    assert.equal(result.counts.chat_messages, 1);
    const db = new DatabaseSync(path.join(options.targetUserData, 'gardenflow.db'), { readOnly: true });
    try {
        const settings = db.prepare('SELECT * FROM settings').get();
        assert.equal(settings.model_name_gardenflow, 'gardenflow-max');
        assert.equal(settings.workspace_dir, options.targetWorkspace);
        assert.equal(settings.api_key, 'bojin-secret');
        assert.deepEqual(JSON.parse(settings.video_models_json as string), ['gardenflow-video-H3']);
        const source = JSON.parse(settings.ai_sources_json as string)[0];
        assert.equal(source.id, 'gardenflow_official_auto');
        assert.equal(source.name, 'GardenFlow官方');
        assert.deepEqual(source.models, ['gardenflow-vl-embedding', 'qwen3.8-max']);
        assert.equal(source.apiKey, 'do-not-change-bojin-secret');
        assert.equal(source.baseURL, 'https://example.test/bojin/v1');
        const message = db.prepare('SELECT * FROM chat_messages').get();
        assert.equal(message.id, 'redclaw-history-id');
        assert.equal(message.content, 'Bojin 用户历史内容');
        assert.deepEqual(JSON.parse(message.metadata as string), { mode: 'gardenflow', prompt: 'redclaw 原始提示词' });
        assert.deepEqual([...db.prepare('SELECT embedding FROM knowledge_vectors').get().embedding as Uint8Array], [1, 2, 3, 255]);
    } finally { db.close(); }
    assert.equal(fs.readFileSync(path.join(options.targetWorkspace, 'spaces/default/manuscripts/note.md'), 'utf8'), 'Bojin 博今 redclaw 用户正文');
    const runner = JSON.parse(fs.readFileSync(path.join(options.targetWorkspace, 'spaces/default/gardenflow/background-runner.json'), 'utf8'));
    assert.equal(runner.completedRounds, 7);
    assert.equal(runner.prompt, '请调用 redclaw，不改正文');
    assert.equal(result.marker.automationHold, true);
    assert.equal(migration.migrateData(options, DatabaseSync).status, 'already_migrated');
});

test('target conflicts require explicit archiving, and rollback preserves both old and new data', t => {
    const options = fixture(t);
    fs.mkdirSync(options.targetWorkspace);
    fs.writeFileSync(path.join(options.targetWorkspace, 'existing.txt'), 'unrelated copy');
    assert.throws(() => migration.migrateData(options, DatabaseSync), /Target contains data/);
    const result = migration.migrateData({ ...options, archiveConflicts: true }, DatabaseSync);
    fs.writeFileSync(path.join(options.targetWorkspace, 'new-user-work.txt'), 'new work');
    const journal = migration.rollback(result.journalPath);
    assert.equal(fs.readFileSync(path.join(options.targetWorkspace, 'existing.txt'), 'utf8'), 'unrelated copy');
    assert.ok(fs.readdirSync(journal.backup).some(name => name.startsWith('rolled-back-workspace')));
    assert.ok(fs.existsSync(path.join(options.sourceUserData, 'redconvert.db')));
});

test('interrupted cutover restores archived target without activating a partial migration', t => {
    const options = fixture(t);
    fs.mkdirSync(options.targetWorkspace);
    fs.writeFileSync(path.join(options.targetWorkspace, 'existing.txt'), 'keep');
    assert.throws(() => migration.migrateData({ ...options, archiveConflicts: true, failAt: 'archived_userData' }, DatabaseSync), /Injected/);
    assert.equal(fs.readFileSync(path.join(options.targetWorkspace, 'existing.txt'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(path.join(options.targetUserData, 'gardenflow.db')), false);
});

test('new storage preferences take precedence while historic raw text remains unchanged', () => {
    const data = new Map([['redbox:app-onboarding:v2:seen', '1'], ['redbox:theme', 'dark'], ['gardenflow:theme', 'light']]);
    const storage = { get length() { return data.size; }, key: (i: number) => [...data.keys()][i], getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
    compatibility.migrateStorage(storage as unknown as Storage);
    assert.equal(data.get('gardenflow:app-onboarding:v2:seen'), '1');
    assert.equal(data.get('gardenflow:theme'), 'light');
    assert.equal(data.get('redbox:theme'), 'dark');
    assert.equal(compatibility.migrateStructured({ prompt: 'bojin-max redbox' }).prompt, 'bojin-max redbox');
});

test('extension storage is copied under new keys without dropping existing settings', async () => {
    const state = { redboxPluginSettings: { saveToRedboxByDefault: true }, gardenflowCaptureCheckpoints: { keep: true } } as Record<string, unknown>;
    await migrateChromeStorage({ get: async () => state, set: async (patch: object) => Object.assign(state, patch) });
    assert.deepEqual(state.gardenflowPluginSettings, { saveToGardenFlowByDefault: true });
    assert.deepEqual(state.gardenflowCaptureCheckpoints, { keep: true });
    assert.ok(state.redboxPluginSettings);
});

test('legacy asset paths resolve to the new workspace and symlink escapes are rejected', t => {
    const options = fixture(t);
    migration.migrateData(options, DatabaseSync);
    configureMigratedPaths([{ from: options.sourceWorkspace, to: options.targetWorkspace }]);
    const oldPath = path.join(options.sourceWorkspace, 'spaces/default/redclaw/background-runner.json');
    const parsed = extractLocalAssetPathCandidate('redbox-asset://asset' + oldPath);
    const expected = path.join(options.targetWorkspace, 'spaces/default/gardenflow/background-runner.json');
    assert.equal(resolveMigratedPath(parsed), expected);
    assert.equal(resolvePathInWorkspace(oldPath, options.targetWorkspace), expected);
    fs.symlinkSync(options.sourceUserData, path.join(options.targetWorkspace, 'escape'));
    assert.throws(() => resolvePathInWorkspace('escape/new-file.json', options.targetWorkspace), /outside workspace/);
    assert.throws(() => resolveMigratedPath(path.join(options.sourceWorkspace, 'escape/new-file.json')), /outside workspace/);
});

test('environment aliases do not override explicitly configured GardenFlow values', () => {
    const env = { REDCONVERT_FFMPEG_PATH: '/old', GARDENFLOW_FFMPEG_PATH: '/new' };
    compatibility.applyEnvironmentAliases(env);
    assert.equal(env.GARDENFLOW_FFMPEG_PATH, '/new');
    const shell = spawnSync('bash', ['-uc', 'source "$1"; printf "%s" "$GARDENFLOW_NODE_VERSION"', 'test', path.resolve(import.meta.dirname, '../shared/brandEnvironment.sh')], {
        encoding: 'utf8', env: { PATH: process.env.PATH, REDBOX_NODE_VERSION: '22.23.2' },
    });
    assert.equal(shell.status, 0, shell.stderr);
    assert.equal(shell.stdout, '22.23.2');
});

test('session bindings and active modes migrate without rewriting request history', t => {
    const options = fixture(t);
    const source = new DatabaseSync(path.join(options.sourceUserData, 'redconvert.db'));
    const history = '{ "model": "bojin-max", "contextType": "redclaw", "prompt": "Bojin 用户请求" }';
    source.exec('CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, title TEXT, metadata TEXT); CREATE TABLE runtime_events (id TEXT PRIMARY KEY, payload_json TEXT); CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, runtime_mode TEXT, metadata_json TEXT)');
    source.prepare('INSERT INTO chat_sessions VALUES (?, ?, ?)').run('session_redclaw_main_default', 'RedClaw 历史标题', JSON.stringify({ contextId: 'redclaw-singleton:default', contextType: 'redclaw' }));
    source.prepare('INSERT INTO runtime_events VALUES (?, ?)').run('event-id', history);
    source.prepare('INSERT INTO agent_tasks VALUES (?, ?, ?)').run('task-id', 'redclaw', JSON.stringify({ contextId: 'redclaw-schedule-task-id', model: 'bojin-max', status: 'running', completedRounds: 9 }));
    source.close();
    migration.migrateData(options, DatabaseSync);
    const db = new DatabaseSync(path.join(options.targetUserData, 'gardenflow.db'), { readOnly: true });
    try {
        const session = db.prepare('SELECT * FROM chat_sessions').get();
        assert.equal(session.id, 'session_redclaw_main_default');
        assert.equal(session.title, 'RedClaw 历史标题');
        assert.deepEqual(JSON.parse(session.metadata as string), { contextId: 'gardenflow-singleton:default', contextType: 'gardenflow' });
        assert.equal(db.prepare('SELECT payload_json FROM runtime_events').get().payload_json, history);
        const task = db.prepare('SELECT * FROM agent_tasks').get();
        assert.equal(task.runtime_mode, 'gardenflow');
        assert.deepEqual(JSON.parse(task.metadata_json as string), { contextId: 'gardenflow-schedule-task-id', model: 'gardenflow-max', status: 'running', completedRounds: 9 });
    } finally { db.close(); }
});

test('unfinished journal requires recovery before retrying migration', t => {
    const options = fixture(t);
    const result = migration.migrateData(options, DatabaseSync);
    const journal = JSON.parse(fs.readFileSync(result.journalPath, 'utf8'));
    journal.phase = 'installed_workspace';
    fs.writeFileSync(result.journalPath, JSON.stringify(journal));
    fs.renameSync(options.targetUserData, path.join(journal.backup, 'interrupted-userData'));
    assert.throws(() => migration.migrateData({ ...options, archiveConflicts: true }, DatabaseSync), /Unfinished migration/);
    migration.rollback(result.journalPath);
    assert.equal(migration.migrateData(options, DatabaseSync).status, 'migrated');
});

test('legacy extension messages use one original handler with identical sender permissions', () => {
    const listeners = new Set<Function>();
    const event = { addListener: (listener: Function) => listeners.add(listener), removeListener: (listener: Function) => listeners.delete(listener), hasListener: (listener: Function) => listeners.has(listener) };
    installRuntimeAliases({ onMessage: event });
    let executions = 0;
    const handler = (message: any, sender: any) => {
        assert.equal(message.type, 'gardenflow-data-ai:get-status');
        if (sender.id !== 'allowed-extension') return 'denied';
        executions++;
        return 'allowed';
    };
    event.addListener(handler);
    event.addListener(handler);
    assert.equal(listeners.size, 1);
    const dispatch = [...listeners][0];
    assert.equal(dispatch({ type: 'xwow-data-ai:get-status' }, { id: 'untrusted-extension' }), 'denied');
    assert.equal(dispatch({ type: 'xwow-data-ai:get-status' }, { id: 'allowed-extension' }), 'allowed');
    assert.equal(executions, 1);
    event.removeListener(handler);
    assert.equal(listeners.size, 0);
});
