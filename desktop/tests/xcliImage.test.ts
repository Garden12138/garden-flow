import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { normalizeXcliImageAgent, normalizeXcliSource } from '../shared/xcliSource.ts';
import { applyGenerationToolConstraints, ImageGenerateParamsSchema } from '../shared/mediaGenerationContracts.ts';
import {
    listXcliAgents,
    resolveTrustedXcliExecutable,
    resolveXcliExecutable,
    submitXcliTask,
    XcliCancelledError,
} from '../electron/core/xcliClient.ts';
import * as imageProviders from '../electron/core/imageProviderAdapters.ts';
import * as modelRoutes from '../electron/core/aiModelRouteResolver.ts';
import type { MediaJobProjection } from '../electron/core/mediaGenerationJobRegistry.ts';
import { dreamRequest, readyDream } from './helpers/dreamStoryFixture.ts';
import { productVideoHarness } from './helpers/productVideoHarness.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const unixOnly = { skip: process.platform === 'win32' };
const request = { version: 1, capability: 'image', goal: '猫', timeout_sec: 1200 };
const legacyGatewayEndpoint = 'http://127.0.0.1:19471/v1';
const legacyImageAlias = 'xcli/legacy-image';
const legacyChatAlias = 'xcli/legacy-chat';
const officialProxy = {
    id: 'proxy', name: 'GardenFlow 官方', presetId: 'gardenflow-official',
    baseURL: 'https://proxy.example.test/v1', apiKey: 'fixture-key', model: 'gardenflow-max',
    modelsMeta: [{ id: 'gardenflow-image', capabilities: ['image'] }, { id: 'codex', capabilities: ['image'] }],
};

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
            const watchdog = setTimeout(() => process.exit(99), 4000);
            process.on('SIGTERM', () => {
                fs.writeFileSync(process.env.XCLI_FAKE_SIGNAL, 'SIGTERM');
                finish('cancelled');
                clearTimeout(watchdog);
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
            const directory = path.dirname(process.env.XCLI_FAKE_STDIN);
            const output = path.join(directory, 'image-' + process.pid + '.png');
            const image = Buffer.from('${png}', 'base64');
            fs.writeFileSync(output, image);
            const primary = { path: output, kind: 'image', mime: 'image/png', width: 1, height: 1, bytes: image.length };
            const artifacts = [primary];
            if (mode === 'multi') {
                const empty = path.join(directory, 'empty-' + process.pid + '.png');
                const extra = path.join(directory, 'extra-' + process.pid + '.png');
                fs.writeFileSync(empty, '');
                fs.writeFileSync(extra, image);
                artifacts.unshift({ ...primary, path: empty, bytes: 0 });
                artifacts.push({ ...primary, path: extra, width: 2, height: 2 });
            }
            event('step.started');
            event('step.progress', { text: 'first' });
            event('step.progress', { text: 'second' });
            finish('completed', artifacts);
        }
    });
} else {
    process.exitCode = 2;
}
`, { mode: 0o755 });
    return { directory, executable, stdinPath, signalPath };
}

async function loadXcliModule<T>(entryPoint: string, settings: Record<string, unknown>, root?: string) {
    const stubs: Record<string, string> = {
        db: `export const getSettings = () => globalThis.settings;
            export const getWorkspacePaths = () => ({ base: globalThis.root, media: globalThis.root });
            export const getWorkspacePathsForSpace = getWorkspacePaths;`,
        mediaLibraryStore: `export const createGeneratedMediaAsset = async ({ mimeType, size }) => ({ mimeType, size });
            export const getAbsoluteMediaPath = path => path;`,
        videoGenerationService: `export const generateVideosToMediaLibrary = async () => { throw new Error('Unexpected video generation'); };`,
    };
    const compiled = await build({
        entryPoints: [fileURLToPath(new URL(entryPoint, import.meta.url))],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        plugins: [{
            name: 'xcli-fixtures',
            setup(builder) {
                builder.onResolve({ filter: /(?:^|\/)(db|mediaLibraryStore|videoGenerationService)$/ }, (args) => ({
                    path: path.basename(args.path), namespace: 'fixture',
                }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({ loader: 'js', contents: stubs[key] }));
            },
        }],
    });
    const module = { exports: {} as T };
    vm.runInNewContext(compiled.outputFiles[0].text, {
        module, exports: module.exports, require: createRequire(import.meta.url), settings, root,
        Buffer, URL, process, console, AbortController, setTimeout, clearTimeout,
    });
    return module.exports;
}

function loadImageService(settings: Record<string, unknown>) {
    return loadXcliModule<typeof import('../electron/core/imageGenerationService.ts')>('../electron/core/imageGenerationService.ts', settings);
}

function loadJobRegistry(fake: ReturnType<typeof makeFakeXcli>) {
    return loadXcliModule<typeof import('../electron/core/mediaGenerationJobRegistry.ts')>(
        '../electron/core/mediaGenerationJobRegistry.ts', xcliSettings(fake.executable), fake.directory,
    );
}

const xcliSource = (baseURL: string, id = 'cli') => ({ id, presetId: 'xcli', baseURL, model: 'auto' });
const xcliSettings = (executable: string) => ({
    ai_sources_json: [xcliSource(executable)],
    ai_model_routes_json: { image: { mode: 'custom', sourceId: 'cli', model: 'auto' } },
});
const adapterInput = {
    prompt: '猫', model: 'auto', endpoint: 'xcli', apiKey: '', provider: 'xcli', providerTemplate: 'xcli' as const,
};

test('normalizes xcli image agents and defaults legacy aliases to auto', () => {
    assert.equal(normalizeXcliImageAgent(' Codex '), 'codex');
    assert.equal(normalizeXcliImageAgent(legacyImageAlias), 'auto');
    assert.equal(normalizeXcliImageAgent(''), 'auto');
    assert.equal(normalizeXcliImageAgent(undefined), 'auto');
});

test('migrates saved xcli gateway settings to an image-only CLI source', () => {
    const source = normalizeXcliSource({
        id: 'old-source',
        presetId: 'xcli',
        baseURL: legacyGatewayEndpoint,
        apiKey: 'fixture-token',
        model: legacyChatAlias,
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

test('builds the xcli goal from the original prompt and structured generation requirements', () => {
    const { buildXcliImageGoal } = imageProviders;
    assert.equal(buildXcliImageGoal({ prompt: '  猫\n' }), '  猫\n');
    assert.equal(buildXcliImageGoal({ prompt: '猫', aspectRatio: 'auto', size: '2k' }), '猫');
    assert.equal(buildXcliImageGoal({ prompt: '猫', aspectRatio: '16:9', size: '1024x1024', generationMode: 'image-to-image' }), [
        '猫', '', '生成要求：', '- 画面比例：16:9', '- 尺寸约 1024×1024 像素', '- 参考图用法：在参考图基础上修改，保留未要求改动的部分',
    ].join('\n'));
    assert.match(buildXcliImageGoal({ prompt: '猫', generationMode: 'reference-guided' }), /参考所给图片的风格和主体，生成一张新图/);
});

test('sends optional xcli request fields only with a chosen agent and reference images', () => {
    const { buildXcliImageRequest } = imageProviders;
    const base = { version: 1, capability: 'image', goal: '猫', timeout_sec: 1200, metadata: { app: 'gardenflow' } };
    assert.deepEqual(buildXcliImageRequest(adapterInput, [], 1200), base);
    assert.deepEqual(buildXcliImageRequest({ ...adapterInput, model: 'codex' }, ['/images/cat.png'], 1200), {
        ...base, agent: 'codex', images: ['/images/cat.png'],
    });
});

test('formats xcli events for media job progress', () => {
    const { xcliProgressMessage } = imageProviders;
    const event = { v: 1, ts: '', task: 't-fake', seq: 1, agent: 'codex' };
    assert.equal(xcliProgressMessage({ ...event, type: 'step.started' }, 0, 45_000), 'Codex 开始生成图片');
    assert.equal(xcliProgressMessage({ ...event, type: 'step.waiting' }, 0, 45_000), '等待 Codex 空闲');
    assert.equal(xcliProgressMessage({ ...event, type: 'step.progress' }, 0, 45_000), 'Codex 生成中（已 45 秒）');
    assert.equal(xcliProgressMessage({
        ...event, type: 'agent.fallback', data: { from: 'antigravity', reason: 'unavailable', to: 'codex' },
    }, 0, 45_000), 'Antigravity 不可用（unavailable），改用 Codex');
    assert.equal(xcliProgressMessage({ ...event, type: 'notice' }, 0, 45_000), null);
});

test('reads xcli output, cleans temporary input images and throttles progress', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const messages: string[] = [];
    const adapter = imageProviders.getImageProviderAdapter('xcli', 'xcli');
    assert.equal(adapter.supportsMultiCount, false);
    const images = await adapter.generate({
        ...adapterInput,
        endpoint: fake.executable,
        referenceImages: [`data:image/png;base64,${png}`],
        generationMode: 'image-to-image',
        onProgress: (message) => messages.push(message),
    });
    assert.deepEqual(images, [{ imageBuffer: Buffer.from(png, 'base64'), mimeType: 'image/png', size: '1x1' }]);
    const sent = JSON.parse(fs.readFileSync(fake.stdinPath, 'utf8'));
    assert.equal(sent.images.length, 1);
    assert.equal(path.isAbsolute(sent.images[0]), true);
    assert.match(path.basename(path.dirname(sent.images[0])), /^gardenflow-xcli-/);
    assert.equal(fs.existsSync(path.dirname(sent.images[0])), false);
    assert.deepEqual(messages, ['Codex 开始生成图片']);
});

test('reports the xcli failure kind and task ID', unixOnly, async (t) => {
    const fake = makeFakeXcli(t, 'fail');
    const adapter = imageProviders.getImageProviderAdapter('xcli', 'xcli');
    await assert.rejects(adapter.generate({ ...adapterInput, endpoint: fake.executable }), /quota.*t-fake/);
});

test('routes the saved image capability to xcli and migrates the legacy model selection', () => {
    const settings = xcliSettings('');
    settings.ai_model_routes_json.image.model = legacyImageAlias;
    assert.deepEqual(modelRoutes.resolveConfiguredImageRoute(settings), {
        provider: 'xcli', providerTemplate: 'xcli', model: 'auto', apiKey: '', endpoint: 'xcli',
    });
    assert.equal(imageProviders.normalizeImageProviderTemplate('openai-images', 'xcli'), 'xcli');
});

test('selects the saved routed xcli executable before falling back to the first saved xcli', () => {
    const settings = {
        ai_sources_json: [{ id: 'other', presetId: 'openai' }, xcliSource('/first/xcli', 'first'), xcliSource('/routed/xcli', 'routed')],
        ai_model_routes_json: { image: { mode: 'custom', sourceId: 'routed' } },
    };
    assert.equal(modelRoutes.resolveXcliSourceExecutable(settings), '/routed/xcli');
    settings.ai_model_routes_json.image.sourceId = 'other';
    assert.equal(modelRoutes.resolveXcliSourceExecutable(settings), '/first/xcli');
    assert.throws(() => modelRoutes.resolveXcliSourceExecutable({}), /请先在设置中添加 xcli 来源/);
});

test('rejects a private image request before starting xcli', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const service = await loadImageService(xcliSettings(fake.executable));
    await assert.rejects(service.generateImagesToMediaLibrary({ prompt: 'private image', privacyScope: 'project' }), {
        name: 'XcliPrivateProjectError', message: /私密项目暂不支持 xcli 生图/,
    });
    assert.equal(fs.existsSync(fake.stdinPath), false);
});

test('uses the saved xcli executable when an image request supplies a different endpoint', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const service = await loadImageService(xcliSettings(fake.executable));
    const result = await service.generateImagesToMediaLibrary({ ...adapterInput, endpoint: '/bin/sh' });
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].mimeType, 'image/png');
    assert.equal(JSON.parse(fs.readFileSync(fake.stdinPath, 'utf8')).goal, adapterInput.prompt);
});

test('records xcli media progress and cancels the child process through the job registry', unixOnly, async (t) => {
    const fake = makeFakeXcli(t, 'hang');
    const { MediaGenerationJobRegistry } = await loadJobRegistry(fake);
    const registry = new MediaGenerationJobRegistry();
    const deadline = Date.now() + 5000;
    const progress = new Promise<MediaJobProjection>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No xcli start progress from the registry')), 3000);
        registry.on('job-updated', (job: MediaJobProjection) => {
            if (job.recentEvents.some((event) => event.eventType === 'progress' && event.message === 'Codex 开始生成图片')) {
                clearTimeout(timeout);
                resolve(job);
            }
        });
    });
    const { jobId } = await registry.submit('image', { prompt: '猫' });
    assert.equal((await progress).jobId, jobId);
    await registry.cancelJob(jobId);
    const result = await registry.awaitJob(jobId, Math.max(deadline - Date.now(), 0));
    assert.equal(result?.status, 'cancelled');
    assert.equal(result?.artifacts.length, 0);
    assert.equal(fs.readFileSync(fake.signalPath, 'utf8'), 'SIGTERM');
});

test('shows the exact private-project xcli error as a definite job failure', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const { MediaGenerationJobRegistry } = await loadJobRegistry(fake);
    const registry = new MediaGenerationJobRegistry('test-space', 'media-jobs.json', 'private-test');
    const { jobId } = await registry.submit('image', { prompt: 'private prompt', projectId: 'private-test' });
    const result = await registry.awaitJob(jobId, 5000);
    const message = '私密项目暂不支持 xcli 生图：xcli 和各 CLI 会在项目外保存提示词副本。请为私密项目选择其他图片来源。';
    assert.equal(result?.status, 'failed');
    assert.equal(result?.result?.error, message);
    assert.equal(result?.recentEvents.at(-1)?.message, message);
    assert.equal(fs.existsSync(fake.stdinPath), false);
});

test('rejects a legacy xcli chat route with instructions to switch sources', () => {
    const source = {
        ...xcliSource(legacyGatewayEndpoint),
        model: legacyChatAlias,
        apiKey: 'fixture-token',
        modelsMeta: [{ id: legacyChatAlias, capabilities: ['chat'] }],
    };
    const settings = {
        ai_sources_json: JSON.stringify([source]),
        ai_model_routes_json: { chat: { mode: 'custom', sourceId: source.id, model: source.model } },
    };
    assert.throws(() => modelRoutes.resolveSettingsLlm(settings), /xcli 只能作为图片来源.*为对话选择其他模型来源/);
});

test('checks CLI status using the saved source ID and reports only usable image agents', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const { fetchModelsForAiSource } = await loadXcliModule<typeof import('../electron/core/aiSourceService.ts')>(
        '../electron/core/aiSourceService.ts', { ai_sources_json: JSON.stringify([xcliSource(fake.executable, 's1')]) },
    );
    const input = { id: 's1', presetId: 'xcli', baseURL: '/bin/sh', apiKey: '', purpose: 'image' as const };
    const result = await fetchModelsForAiSource(input);
    assert.equal(result.protocol, 'openai');
    assert.deepEqual(Array.from(result.models, (model) => model.id), ['auto', 'codex']);
    assert.ok(result.models.every((model) => model.capabilities?.join() === 'image'));
    await assert.rejects(fetchModelsForAiSource({ ...input, id: 'missing' }), /请先保存设置后再检查 CLI 状态/);
});

test('does not infer chat support for CLI IDs already described as image models', async () => {
    const { getAiSourceModelDescriptors, hasImageGenerationConfig } = await loadXcliModule<typeof import('../src/features/media-generation/audioOptions.ts')>(
        '../src/features/media-generation/audioOptions.ts', {},
    );
    const source = normalizeXcliSource({ ...xcliSource('xcli'), name: 'xcli' });
    const models = getAiSourceModelDescriptors(source);
    assert.deepEqual(Array.from(models, ({ id, capabilities }) => [id, capabilities.join()]), [
        ['auto', 'image'], ['codex', 'image'], ['antigravity', 'image'], ['cursor', 'image'],
    ]);
    assert.equal(hasImageGenerationConfig({}, { ...adapterInput, sourceId: 'cli' }), true);
    assert.equal(hasImageGenerationConfig({}, { endpoint: 'https://example.test/v1', sourceId: 'http' }), false);
});

test('keeps saved proxy presets distinct from xcli in Settings', async () => {
    const { getAiSourcePresetOptions, inferPresetIdByEndpoint } = await loadXcliModule<typeof import('../src/config/aiSources.ts')>(
        '../src/config/aiSources.ts', {},
    );
    const options = getAiSourcePresetOptions(officialProxy, true);
    assert.equal(options.find((option) => option.id === officialProxy.presetId)?.label, officialProxy.name);
    assert.ok(options.some((option) => option.id === 'xcli'));
    assert.equal(inferPresetIdByEndpoint('https://proxy.example.test/xcli/v1'), 'custom');
});

test('keeps the xcli picker selection distinct from the proxy model and routes the locked Agent tool call', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const settings = {
        ai_sources_json: JSON.stringify([officialProxy, xcliSource(fake.executable)]),
        ai_model_routes_json: JSON.stringify({ image: { mode: 'custom', sourceId: 'proxy', model: 'gardenflow-image' } }),
        image_model: 'gardenflow-image',
    };
    const { buildImageModelOptions, getDefaultImageModelSelection, resolveSelectedModelOverride } = await loadXcliModule<typeof import('../src/features/media-generation/audioOptions.ts')>(
        '../src/features/media-generation/audioOptions.ts', {},
    );
    const options = buildImageModelOptions(settings);
    assert.ok(options.some((option) => option.value === 'codex' && option.description === 'GardenFlow 官方'));
    const xcli = options.find((option) => option.label === 'xcli · Codex');
    assert.ok(xcli);
    assert.notEqual(xcli.value, 'codex');
    assert.equal(getDefaultImageModelSelection({ image_provider: 'xcli', image_model: 'codex' }), xcli.value);
    const route = resolveSelectedModelOverride(settings, 'image', 'image', xcli.value);
    assert.equal(route.provider, 'xcli');
    assert.equal(route.sourceId, 'cli');
    const args = applyGenerationToolConstraints('image_generate', {
        prompt: '猫', model: 'gardenflow-image', provider: 'openai-compatible',
    }, { imageGenerate: { model: route.model, sourceId: route.sourceId } });
    const { generateImagesToMediaLibrary } = await loadImageService(settings);
    const image = await generateImagesToMediaLibrary(ImageGenerateParamsSchema.parse(args));
    assert.equal(image.provider, 'xcli');
    assert.equal(JSON.parse(fs.readFileSync(fake.stdinPath, 'utf8')).agent, 'codex');

    const xcliDefault = { ...settings, ai_model_routes_json: JSON.stringify(xcliSettings(fake.executable).ai_model_routes_json) };
    const proxy = modelRoutes.resolveConfiguredImageRoute(xcliDefault, 'gardenflow-image', officialProxy.id);
    assert.equal(proxy?.endpoint, officialProxy.baseURL);
    assert.equal(proxy?.model, 'gardenflow-image');
    assert.equal(proxy?.provider, 'openai-compatible');
    assert.throws(() => modelRoutes.resolveConfiguredImageRoute(xcliDefault, 'codex', 'removed'), /图片供应商已移除/);
});

test('generates a cover without an API key using only the saved xcli path', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const { generateCoverAssets } = await loadXcliModule<typeof import('../electron/core/coverGenerationService.ts')>(
        '../electron/core/coverGenerationService.ts', xcliSettings(fake.executable), fake.directory,
    );
    const result = await generateCoverAssets({
        provider: 'xcli', providerTemplate: 'xcli', endpoint: '/bin/sh', titlePrompt: '封面测试',
    });
    assert.equal(result.assets.length, 1);
    const [asset] = result.assets;
    assert.equal(asset.provider, 'xcli');
    assert.equal(asset.size, '1x1');
    const coverRoot = path.join(fake.directory, 'cover');
    assert.deepEqual(fs.readFileSync(path.join(coverRoot, asset.relativePath!)), Buffer.from(png, 'base64'));
    const catalog = JSON.parse(fs.readFileSync(path.join(coverRoot, 'catalog.json'), 'utf8'));
    assert.equal(catalog.assets[0].id, asset.id);
    assert.match(JSON.parse(fs.readFileSync(fake.stdinPath, 'utf8')).goal, /封面测试/);
});

test('retains one valid image per xcli subprocess in media and cover generation', unixOnly, async (t) => {
    const fake = makeFakeXcli(t, 'multi');
    const settings = xcliSettings(fake.executable);
    const service = await loadImageService(settings);
    const { generateCoverAssets } = await loadXcliModule<typeof import('../electron/core/coverGenerationService.ts')>(
        '../electron/core/coverGenerationService.ts', settings, fake.directory,
    );
    const image = await service.generateImagesToMediaLibrary({ prompt: '猫', count: 2 });
    const cover = await generateCoverAssets({ titlePrompt: '封面', count: 2 });
    assert.equal(fs.readdirSync(fake.directory).filter((name) => /^image-/.test(name)).length, 4);
    assert.deepEqual(Array.from(image.assets, (asset) => asset.size), ['1x1', '1x1']);
    assert.deepEqual(Array.from(cover.assets, (asset) => asset.size), ['1x1', '1x1']);
});

test('rejects xcli while preparing a private project image before provider validation', unixOnly, async (t) => {
    const fake = makeFakeXcli(t);
    const harness = await productVideoHarness({ dreamStory: true });
    t.after(() => harness.close());
    const project = await readyDream(harness);
    harness.state.settings = { ...xcliSettings(fake.executable), image_provider: 'xcli', image_provider_template: 'xcli' };
    await assert.rejects(harness.api.previewDreamBatch({ ...dreamRequest(project), kind: 'image', sceneIds: ['scene_0'] }), {
        name: 'XcliPrivateProjectError',
    });
    assert.equal(harness.state.imageCalls, 0);
    assert.equal(fs.existsSync(fake.stdinPath), false);
});
