import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';
import { buildVideoModelRoutes, resolveVideoModelRoute } from '../shared/videoGenerationCapabilities.ts';
import { resolveProductVideoMotionCapability } from '../shared/productVideoCapability.ts';

const configured = {
    video_endpoint: 'https://video.invalid/v1',
    video_api_key: 'fixture-key',
    video_model: 'happyhorse-1.1-r2v',
    video_providers_json: JSON.stringify([{
        id: 'video-a', name: 'fixture', preset: 'aliyun-bailian',
        endpoint: 'https://video.invalid/v1', apiKey: 'fixture-key', model: 'happyhorse-1.1-r2v',
    }]),
};

test('explicit video shutdown suppresses all routes and product AI motion without losing configuration', () => {
    const disabled = { ...configured, video_generation_enabled: false };
    const before = JSON.stringify(disabled);
    assert.deepEqual(buildVideoModelRoutes(disabled), []);
    assert.equal(resolveVideoModelRoute(disabled, 'happyhorse-1.1-r2v'), null);
    assert.deepEqual(resolveProductVideoMotionCapability(disabled), { available: false, reason: 'disabled' });
    assert.equal(JSON.stringify(disabled), before);
    assert.equal(resolveProductVideoMotionCapability(configured).available, true);
    assert.equal(resolveProductVideoMotionCapability({ ...disabled, video_generation_enabled: true }).available, true);
});

test('production video generation rejects disabled settings before HTTP, media upload or asset writes', async () => {
    const calls = { network: 0, hosting: 0, assets: 0 };
    const result = await build({
        entryPoints: [new URL('../electron/core/videoGenerationService.ts', import.meta.url).pathname],
        bundle: true, platform: 'node', format: 'cjs', write: false,
        plugins: [{ name: 'disabled-video-boundaries', setup(builder) {
            builder.onResolve({ filter: /(?:^|\/)(?:db|mediaLibraryStore)(?:\.ts)?$|imageHosting\/service\.ts$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
                loader: 'js',
                contents: /(?:^|\/)db(?:\.ts)?$/.test(path)
                    ? 'export const getSettings = () => globalThis.fixtureSettings;'
                    : path.includes('imageHosting')
                        ? 'export const normalizeMediaValueForRemote = async () => { globalThis.fixtureCalls.hosting++; throw new Error("unexpected hosting"); };'
                        : 'export const createGeneratedMediaAsset = async () => { globalThis.fixtureCalls.assets++; throw new Error("unexpected asset write"); };',
            }));
        } }],
    });
    const module = { exports: {} as any };
    vm.runInNewContext(result.outputFiles[0].text, {
        module, exports: module.exports, require: createRequire(import.meta.url), process, console,
        Buffer, URL, AbortController, setTimeout, clearTimeout,
        fixtureSettings: { ...configured, video_generation_enabled: false }, fixtureCalls: calls,
        fetch: async () => { calls.network++; throw new Error('unexpected network'); },
    });
    await assert.rejects(module.exports.generateVideosToMediaLibrary({
        prompt: 'Show the product', model: configured.video_model,
        endpoint: configured.video_endpoint, apiKey: 'explicit-fixture-key',
        referenceImages: ['https://image.invalid/product.jpg'], generationMode: 'reference-guided',
    }), { code: 'VIDEO_GENERATION_DISABLED' });
    assert.deepEqual(calls, { network: 0, hosting: 0, assets: 0 });
});

test('settings extras retain explicit false through save, partial update and legacy reads', async () => {
    const source = await fs.readFile(new URL('../electron/db.ts', import.meta.url), 'utf8');
    const snippet = source.slice(source.indexOf('const SETTINGS_EXTRA_KEYS'), source.indexOf('export const saveSettings'));
    const compiled = await transform(`${snippet}\nmodule.exports = { parseSettingsExtras, serializeSettingsExtras };`, { loader: 'ts', format: 'cjs' });
    const module = { exports: {} as any };
    vm.runInNewContext(compiled.code, { module, exports: module.exports });
    const { parseSettingsExtras, serializeSettingsExtras } = module.exports;
    const saved = parseSettingsExtras(serializeSettingsExtras({ video_generation_enabled: false }, {}));
    assert.equal(saved.video_generation_enabled, false);
    const partial = parseSettingsExtras(serializeSettingsExtras({ debug_log_enabled: true }, saved));
    assert.equal(partial.video_generation_enabled, false);
    assert.equal(parseSettingsExtras(serializeSettingsExtras({ video_generation_enabled: true }, partial)).video_generation_enabled, true);
    assert.equal(parseSettingsExtras('{}').video_generation_enabled, undefined);
});
