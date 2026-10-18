import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

async function videoBoundary(preset: string, endpoint: string, fail: boolean, seconds = 8) {
    const calls = { posts: 0, assets: [] as any[], logs: [] as unknown[] };
    const model = 'fixture-video';
    const compiled = await build({ entryPoints: [new URL('../electron/core/videoGenerationService.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false,
        plugins: [{ name: 'private-video-boundary', setup(builder) {
            builder.onResolve({ filter: /(?:^|\/)(?:db|mediaLibraryStore)(?:\.ts)?$|imageHosting\/service\.ts$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: /(?:^|\/)db(?:\.ts)?$/.test(path)
                ? 'export const getSettings = () => globalThis.settings;'
                : path.includes('imageHosting') ? 'export const normalizeMediaValueForRemote = async value => value;'
                    : 'export const createGeneratedMediaAsset = async input => { globalThis.calls.assets.push(input); return {id:"private-video",kind:"video"}; };' }));
        } }],
    });
    const module = { exports: {} as any };
    vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), process, Buffer, URL, AbortController, setTimeout, clearTimeout,
        console: { log: (...args: unknown[]) => calls.logs.push(args), warn: (...args: unknown[]) => calls.logs.push(args), error: (...args: unknown[]) => calls.logs.push(args) },
        settings: { video_model: model, video_providers_json: JSON.stringify([{ id: 'fixture', name: 'fixture', preset, endpoint, apiKey: 'private-credential', model }]) }, calls,
        fetch: async (_url: string, options: any) => {
            if (options?.method === 'POST') { calls.posts++; if (fail) return new Response(JSON.stringify({ message: 'temporarily unavailable', code: 'InternalError' }), { status: 500 });
                return new Response(JSON.stringify({ task_id: 'private-task', status: 'SUCCEEDED', video_url: 'https://fixture.invalid/result.mp4' }), { status: 200 }); }
            return new Response(Buffer.from('synthetic-video-bytes'), { headers: { 'content-type': 'video/mp4' } });
        },
    });
    const request = { projectId: 'private-project', privacyScope: 'project', prompt: 'PRIVATE_DREAM_ACTION', referenceImages: ['https://fixture.invalid/private-reference.png'], generationMode: 'reference-guided', durationSeconds: seconds, aspectRatio: '9:16' };
    if (fail) await assert.rejects(module.exports.generateVideosToMediaLibrary(request)); else await module.exports.generateVideosToMediaLibrary(request);
    return calls;
}

test('private video HTTP creation does not retry or fall back and never logs dream/hosted media', async () => {
    for (const [preset, endpoint] of [['custom', 'https://fixture.invalid/v1'], ['new-api-aliyun', 'https://fixture.invalid/v1']]) {
        const calls = await videoBoundary(preset, endpoint, true); assert.equal(calls.posts, 1); assert.equal(calls.assets.length, 0); assert.equal(calls.logs.length, 0);
    }
});
test('successful private video registration retains project privacy through the production provider route', async () => {
    const calls = await videoBoundary('custom', 'https://fixture.invalid/v1', false, 4);
    assert.equal(calls.posts, 1); assert.equal(calls.assets.length, 1); assert.equal(calls.assets[0].privacyScope, 'project'); assert.equal(calls.assets[0].projectId, 'private-project'); assert.equal(calls.logs.length, 0);
});
