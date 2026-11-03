import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

test('local H3 polls the configured port and saves the signed MP4 without sending the API key to the download URL', async () => {
    const endpoint = 'http://video.lan:18889';
    const signedUrl = `${endpoint}/v2/files/task-1?expires=1234&signature=fixture`;
    const settings = {
        active_video_provider_id: 'local-h3',
        video_api_key: 'different-provider-key',
        video_providers_json: [{
            id: 'local-h3', preset: 'minimax-h3-local', endpoint, model: 'MiniMax-H3', apiKey: 'h3-key',
        }],
    };
    const { outputFiles } = await build({
        entryPoints: [new URL('../electron/core/videoGenerationService.ts', import.meta.url).pathname],
        bundle: true, platform: 'node', format: 'cjs', write: false,
        plugins: [{
            name: 'local-h3-test-boundaries',
            setup(builder) {
                builder.onResolve({ filter: /(?:^|\/)(?:db|mediaLibraryStore)(?:\.ts)?$|imageHosting\/service\.ts$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
                builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
                    loader: 'js',
                    contents: path.endsWith('/db')
                        ? 'export const getSettings = () => fixtureSettings;'
                        : path.includes('imageHosting')
                            ? 'export const normalizeMediaValueForRemote = async () => { throw new Error("unexpected image hosting"); };'
                            : 'export const createGeneratedMediaAsset = async (asset) => asset;',
                }));
            },
        }],
    });
    const module = { exports: {} as typeof import('../electron/core/videoGenerationService.ts') };
    const requests: string[] = [];
    const frame = 'data:image/png;base64,iVBORw0KGgo=';
    let failed = false;
    let polls = 0;
    vm.runInNewContext(outputFiles[0].text, {
        module, exports: module.exports, require: createRequire(import.meta.url), process, console,
        Buffer, URL, AbortSignal, setTimeout: queueMicrotask, fixtureSettings: settings,
        fetch: async (url: string, init: RequestInit) => {
            requests.push(url);
            const headers = new Headers(init.headers);
            if (url === signedUrl) {
                assert.deepEqual([...headers.entries()], []);
                return new Response('fixture-mp4', { headers: { 'Content-Type': 'video/mp4' } });
            }
            assert.equal(headers.get('Authorization'), 'Bearer h3-key');
            if (init.method === 'POST') {
                assert.deepEqual(JSON.parse(String(init.body)), {
                    model: 'MiniMax-H3', resolution: '768P', duration: 5, ratio: 'adaptive',
                    content: [
                        { type: 'text', text: 'Move the camera' },
                        { type: 'image_url', role: 'first_frame', image_url: { url: frame } },
                    ],
                });
                return Response.json({ task_id: 'task-1' });
            }
            assert.equal(url, `${endpoint}/v2/query/video_generation/task-1`);
            if (failed) return Response.json({ task: { status: 'failed', error: { message: 'GPU unavailable' } } });
            if (polls++ === 0) return Response.json({ task: { status: 'running' } });
            return Response.json({ task: { status: 'succeeded', resolution: '608x352', content: { url: signedUrl } } });
        },
    });
    const request = {
        prompt: 'Move the camera', privacyScope: 'project', generationMode: 'reference-guided', referenceImages: [frame],
    } as const;
    const result = await module.exports.generateVideosToMediaLibrary({ ...request, referenceImages: [frame] });
    assert.equal(result.provider, 'minimax-h3-local');
    assert.equal(result.resolution, '608x352');
    assert.equal(result.durationSeconds, 5);
    assert.equal(result.assets[0].size, '608x352');
    assert.equal(result.assets[0].mimeType, 'video/mp4');
    assert.deepEqual(requests, [
        `${endpoint}/v2/video_generation`, `${endpoint}/v2/query/video_generation/task-1`,
        `${endpoint}/v2/query/video_generation/task-1`, signedUrl,
    ]);
    await assert.rejects(module.exports.generateVideosToMediaLibrary({ ...request, referenceImages: [frame, frame] }), /需要 1 张参考图/);
    assert.equal(requests.length, 4);
    failed = true;
    await assert.rejects(module.exports.generateVideosToMediaLibrary({ ...request, referenceImages: [frame] }), /GPU unavailable/);
    assert.equal(requests.length, 6);
    settings.video_providers_json[0].apiKey = '';
    await assert.rejects(module.exports.generateVideosToMediaLibrary({ ...request, referenceImages: [frame] }), /API Key 未配置/);
    assert.equal(requests.length, 6);
});
