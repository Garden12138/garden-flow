import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { normalizeXcliImageAgent, normalizeXcliSource } from '../shared/xcliSource.ts';
import {
    listXcliAgents,
    resolveTrustedXcliExecutable,
    resolveXcliExecutable,
    submitXcliTask,
    XcliCancelledError,
} from '../electron/core/xcliClient.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const unixOnly = { skip: process.platform === 'win32' };
const request = { version: 1, capability: 'image', goal: '猫', timeout_sec: 1200 };

function makeFakeXcli(t: TestContext, mode = 'ok') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-fake-xcli-'));
    const executable = path.join(directory, 'xcli');
    const stdinPath = path.join(directory, 'stdin.json');
    const signalPath = path.join(directory, 'signal.txt');
    const env = { XCLI_FAKE_MODE: mode, XCLI_FAKE_STDIN: stdinPath, XCLI_FAKE_SIGNAL: signalPath };
    for (const [key, value] of Object.entries(env)) {
        const previous = process.env[key];
        process.env[key] = value;
        t.after(() => {
            if (previous === undefined) delete process.env[key];
            else process.env[key] = previous;
        });
    }
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const mode = process.env.XCLI_FAKE_MODE;
const args = process.argv.slice(2).join(' ');
if (args === 'agents --json') {
    console.log(JSON.stringify([
        { name: 'codex', installed: true, available: true, strengths: { image: 2 } },
        { name: 'cursor', installed: true, available: false, strengths: { image: 1 } },
        { name: 'antigravity', installed: false, available: false, strengths: { image: 3 } },
    ]));
} else if (args === 'submit --request - --events') {
    let seq = 0;
    const event = (type, data) => console.log(JSON.stringify({
        v: 1, ts: new Date().toISOString(), task: 't-fake', seq: ++seq, type, step: 'main', agent: 'codex', data,
    }));
    const finish = (status, artifacts = [], error = null) => event('task.finished', {
        version: 1, task_id: 't-fake', summary: '', status, artifacts, error,
    });
    let stdin = '';
    process.stdin.setEncoding('utf8').on('data', (chunk) => { stdin += chunk; });
    process.stdin.on('end', () => {
        fs.writeFileSync(process.env.XCLI_FAKE_STDIN, stdin);
        if (mode === 'hang') {
            const timer = setInterval(() => {}, 1000);
            process.on('SIGTERM', () => {
                fs.writeFileSync(process.env.XCLI_FAKE_SIGNAL, 'SIGTERM');
                finish('cancelled');
                clearInterval(timer);
                process.exitCode = 130;
            });
            event('step.started');
        } else if (mode === 'fail') {
            finish('failed', [], { kind: 'quota', message: 'codex 额度暂不可用' });
            process.exitCode = 1;
        } else if (mode === 'noresult') {
            console.error('boom');
            process.exitCode = 3;
        } else {
            const output = path.join(path.dirname(process.env.XCLI_FAKE_STDIN), 'image.png');
            const image = Buffer.from('${png}', 'base64');
            fs.writeFileSync(output, image);
            event('step.started');
            event('step.progress', { text: 'first' });
            event('step.progress', { text: 'second' });
            finish('completed', [{ path: output, kind: 'image', mime: 'image/png', width: 1, height: 1, bytes: image.length }]);
        }
    });
} else {
    process.exitCode = 2;
}
`, { mode: 0o755 });
    return { directory, executable, stdinPath, signalPath };
}

test('normalizes xcli image agents and defaults legacy aliases to auto', () => {
    assert.equal(normalizeXcliImageAgent(' Codex '), 'codex');
    assert.equal(normalizeXcliImageAgent('xcli/image-default'), 'auto');
    assert.equal(normalizeXcliImageAgent(''), 'auto');
    assert.equal(normalizeXcliImageAgent(undefined), 'auto');
});

test('migrates saved xcli gateway settings to an image-only CLI source', () => {
    const source = normalizeXcliSource({
        id: 'old-source',
        presetId: 'xcli',
        baseURL: 'http://127.0.0.1:18741/v1',
        apiKey: 'fixture-token',
        model: 'xcli/text-default',
    });
    const agents = ['auto', 'codex', 'antigravity', 'cursor'];
    assert.deepEqual(source, {
        id: 'old-source',
        presetId: 'xcli',
        baseURL: 'xcli',
        apiKey: '',
        model: 'auto',
        models: agents,
        modelsMeta: agents.map((id) => ({ id, capabilities: ['image'], inputCapabilities: [] })),
    });
    assert.equal(normalizeXcliSource({ presetId: 'xcli', baseURL: '~/bin/xcli' }).baseURL, '~/bin/xcli');

    const other = { presetId: 'openai', baseURL: 'https://example.test/v1' };
    assert.equal(normalizeXcliSource(other), other);
});

test('resolves the xcli executable in configured, environment, PATH and home order', unixOnly, (t) => {
    const fake = makeFakeXcli(t);
    const home = path.join(fake.directory, 'home');
    const env = { home, pathEnv: '', xcliPathEnv: '' };
    assert.equal(resolveXcliExecutable(env), 'xcli');
    assert.equal(resolveXcliExecutable({ ...env, configured: '~/x/xcli' }), path.join(home, 'x/xcli'));
    const homeExecutable = path.join(home, '.local/bin/xcli');
    fs.mkdirSync(path.dirname(homeExecutable), { recursive: true });
    fs.copyFileSync(fake.executable, homeExecutable);
    assert.equal(resolveXcliExecutable(env), homeExecutable);
    assert.equal(resolveXcliExecutable({ ...env, configured: 'xcli', pathEnv: fake.directory }), fake.executable);
    assert.equal(resolveXcliExecutable({ ...env, pathEnv: fake.directory, xcliPathEnv: homeExecutable }), homeExecutable);
    const command = path.join(fake.directory, 'other');
    fs.copyFileSync(fake.executable, command);
    assert.equal(resolveXcliExecutable({ ...env, configured: 'other', pathEnv: fake.directory, xcliPathEnv: homeExecutable }), command);
});

test('requires the executable name xcli when resolving and before spawning', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const wrongName = path.join(fake.directory, 'other');
    fs.copyFileSync(fake.executable, wrongName);
    assert.throws(() => resolveTrustedXcliExecutable('/bin/sh'), /文件名必须是 xcli/);
    assert.equal(resolveTrustedXcliExecutable('~/x/xcli', { home: fake.directory }), path.join(fake.directory, 'x/xcli'));
    await assert.rejects(submitXcliTask(wrongName, request), /文件名必须是 xcli/);
    await assert.rejects(listXcliAgents(wrongName), /文件名必须是 xcli/);
    assert.equal(fs.existsSync(fake.stdinPath), false);
});

test('sends the request on stdin and returns the finished event result', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const events: string[] = [];
    const result = await submitXcliTask(fake.executable, request, { onEvent: (event) => events.push(event.type) });
    assert.equal(result.status, 'completed');
    assert.deepEqual(JSON.parse(fs.readFileSync(fake.stdinPath, 'utf8')), request);
    assert.deepEqual(events, ['step.started', 'step.progress', 'step.progress', 'task.finished']);
});

test('returns the failed task result despite the nonzero exit code', unixOnly, async (t) => {
    const fake = makeFakeXcli(t, 'fail');
    const result = await submitXcliTask(fake.executable, request);
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.kind, 'quota');
});

test('reports stderr and exit code when the finished event is missing', unixOnly, async (t) => {
    const fake = makeFakeXcli(t, 'noresult');
    await assert.rejects(submitXcliTask(fake.executable, request), /退出码 3.*boom/);
});

test('cancels a running xcli process with SIGTERM', { ...unixOnly, timeout: 5000 }, async (t) => {
    const fake = makeFakeXcli(t, 'hang');
    const controller = new AbortController();
    await assert.rejects(submitXcliTask(fake.executable, request, {
        signal: controller.signal,
        onEvent: (event) => {
            if (event.type === 'step.started') setTimeout(() => controller.abort(), 200);
        },
    }), XcliCancelledError);
    assert.equal(fs.readFileSync(fake.signalPath, 'utf8'), 'SIGTERM');
});

test('does not start xcli when the signal is already aborted', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    await assert.rejects(submitXcliTask(fake.executable, request, { signal: AbortSignal.abort() }), XcliCancelledError);
    assert.equal(fs.existsSync(fake.stdinPath), false);
});

test('reports missing xcli for both supported commands', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const missing = path.join(fake.directory, 'missing/xcli');
    await assert.rejects(submitXcliTask(missing, request), /未找到 xcli/);
    await assert.rejects(listXcliAgents(missing), /未找到 xcli/);
});

test('lists xcli agents from JSON', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const agents = await listXcliAgents(fake.executable);
    assert.deepEqual(agents.map((agent) => agent.name), ['codex', 'cursor', 'antigravity']);
    assert.equal(agents[0].strengths?.image, 2);
});
