import assert from 'node:assert/strict';
import test from 'node:test';
import { getImageProviderAdapter } from '../electron/core/imageProviderAdapters.ts';
import { xcliEndpoint, xcliModels, requireXcliCapabilities } from '../electron/core/xcliGateway.ts';
import { fetchModelsForAiSource } from '../electron/core/aiSourceService.ts';
import { resolveSettingsLlm, resolveXcliImageRoute, resolveLlmInputCapabilities } from '../electron/core/aiModelRouteResolver.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const endpoint = 'http://127.0.0.1:18741/v1';
const token = 'synthetic-gardenflow-token';
const descriptor = (caps: string[], validated = true) => ({ id: 'xcli/image-default', xcli: { capabilities: caps, validated, inference_location: 'remote' } });
const catalog = (caps: string[], validated = true) => ({ object: 'list', data: [descriptor(caps, validated)] });
const input = { prompt: 'synthetic private canary', model: 'xcli/image-default', endpoint, apiKey: token, provider: 'xcli', providerTemplate: 'openai-images' as const, size: '1x1', count: 1 };

test('xcli never treats a loopback endpoint as unauthenticated or infers vision from an alias', () => {
    for (const bad of ['https://example.com/v1', 'http://localhost:18741/v1', endpoint + '?token=private', 'http://user@127.0.0.1:18741/v1', 'http://203.0.113.1:18741/v1']) assert.throws(() => xcliEndpoint(bad));
    const source = { id: 'gateway', presetId: 'xcli', baseURL: endpoint, model: 'xcli/text-default', apiKey: '' };
    const settings = { ai_sources_json: [source], ai_model_routes_json: { chat: { sourceId: source.id, model: source.model } } };
    assert.throws(() => resolveSettingsLlm(settings), /Token/);
    source.apiKey = token;
    assert.equal(resolveSettingsLlm(settings)?.modelName, source.model);
    assert.deepEqual(resolveLlmInputCapabilities(settings, { baseURL: endpoint, apiKey: token, modelName: source.model, sourceId: source.id }), []);
    assert.equal(resolveXcliImageRoute({ ...settings, ai_model_routes_json: { image: { sourceId: source.id, model: 'image-alias' } } })?.model, 'image-alias');
});

test('xcli reads capability and location metadata without sending any prompt', async () => {
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (url, init) => {
        requests++;
        assert.equal(String(url), endpoint + '/models');
        assert.equal(init?.body, undefined);
        assert.equal(init?.redirect, 'error');
        assert.equal((init?.headers as any).Authorization, 'Bearer ' + token);
        return Response.json(catalog(['image.generate']));
    };
    try {
        const listed = await fetchModelsForAiSource({ apiKey: token, baseURL: endpoint, presetId: 'xcli', purpose: 'image' });
        assert.deepEqual(listed.models[0].capabilities, ['image']);
        assert.equal(listed.models[0].xcli?.inference_location, 'remote');
        assert.deepEqual(listed.models[0].inputCapabilities, []);
        assert.throws(() => requireXcliCapabilities([descriptor(['tool_calls'], false) as any], input.model, ['tool_calls']));
        assert.equal(requests, 1);
    } finally { globalThis.fetch = original; }
});

test('xcli sends exactly one generation request and preserves parameters on upstream failure', async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    let fail = false;
    globalThis.fetch = async (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith('/models')) return Response.json(catalog(['image.generate']));
        assert.equal(String(url), endpoint + '/images/generations');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.size, '1x1'); assert.equal(body.n, 1); assert.equal(body.prompt, input.prompt);
        assert.equal(body.response_format, 'b64_json');
        return fail ? new Response('PRIVATE_CANARY unsupported parameter size', { status: 400 }) : Response.json({ data: [{ b64_json: png }] });
    };
    try {
        const adapter = getImageProviderAdapter('openai-images', 'xcli');
        assert.equal((await adapter.generate(input))[0].mimeType, 'image/png');
        fail = true; urls.length = 0;
        await assert.rejects(() => adapter.generate(input), error => String(error).includes('HTTP 400') && !String(error).includes('PRIVATE_CANARY'));
        assert.deepEqual(urls, [endpoint + '/models', endpoint + '/images/generations']);
    } finally { globalThis.fetch = original; }
});

test('xcli multi-reference edits require verified capabilities and never fall back to generation', async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    let verified = false;
    globalThis.fetch = async (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith('/models')) return Response.json(catalog(['image.edit', 'image.multi_reference'], verified));
        assert.equal(String(url), endpoint + '/images/edits');
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.getAll('image[]').length, 2);
        assert.equal(init.body.get('size'), '1x1');
        return new Response('private body canary', { status: 502 });
    };
    try {
        const adapter = getImageProviderAdapter('openai-images', 'xcli');
        const edit = { ...input, generationMode: 'reference-guided' as const, referenceImages: Array(2).fill('data:image/png;base64,' + png) };
        await assert.rejects(() => adapter.generate(edit), /verified capability/);
        assert.equal(urls.length, 1);
        verified = true; urls.length = 0;
        await assert.rejects(() => adapter.generate(edit), /HTTP 502/);
        assert.deepEqual(urls, [endpoint + '/models', endpoint + '/images/edits']);
        urls.length = 0;
        await assert.rejects(() => adapter.generate({ ...edit, referenceImages: [] }));
        await assert.rejects(() => adapter.generate({ ...edit, referenceImages: Array(5).fill(edit.referenceImages[0]) }));
        assert.equal(urls.length, 0);
    } finally { globalThis.fetch = original; }
});

test('xcli never downloads image URLs and malformed catalogs cannot authorize requests', async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    let badCatalog = false;
    globalThis.fetch = async (url) => {
        urls.push(String(url));
        if (String(url).endsWith('/models')) return Response.json(badCatalog ? { object: 'list', data: [{}] } : catalog(['image.generate']));
        return Response.json({ data: [{ url: 'http://169.254.169.254/private', b64_json: png }] });
    };
    try {
        await assert.rejects(() => getImageProviderAdapter('openai-images', 'xcli').generate(input), /invalid image/);
        assert.equal(urls.length, 2);
        badCatalog = true;
        await assert.rejects(() => xcliModels(endpoint, token), /catalog is invalid/);
    } finally { globalThis.fetch = original; }
});
