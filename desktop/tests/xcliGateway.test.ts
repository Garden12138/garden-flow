import assert from 'node:assert/strict';
import test from 'node:test';
import { xcliEndpoint, xcliModels, requireXcliCapabilities } from '../electron/core/xcliGateway.ts';
import { fetchModelsForAiSource } from '../electron/core/aiSourceService.ts';
import { resolveSettingsLlm, resolveLlmInputCapabilities } from '../electron/core/aiModelRouteResolver.ts';

const endpoint = 'http://127.0.0.1:18741/v1';
const token = 'synthetic-gardenflow-token';
const descriptor = (caps: string[], validated = true) => ({ id: 'xcli/image-default', xcli: { capabilities: caps, validated, inference_location: 'remote' } });
const catalog = (caps: string[], validated = true) => ({ object: 'list', data: [descriptor(caps, validated)] });

test('xcli never treats a loopback endpoint as unauthenticated or infers vision from an alias', () => {
    for (const bad of ['https://example.com/v1', 'http://localhost:18741/v1', endpoint + '?token=private', 'http://user@127.0.0.1:18741/v1', 'http://203.0.113.1:18741/v1']) assert.throws(() => xcliEndpoint(bad));
    const source = { id: 'gateway', presetId: 'xcli', baseURL: endpoint, model: 'xcli/text-default', apiKey: '' };
    const settings = { ai_sources_json: [source], ai_model_routes_json: { chat: { sourceId: source.id, model: source.model } } };
    assert.throws(() => resolveSettingsLlm(settings), /Token/);
    source.apiKey = token;
    assert.equal(resolveSettingsLlm(settings)?.modelName, source.model);
    assert.deepEqual(resolveLlmInputCapabilities(settings, { baseURL: endpoint, apiKey: token, modelName: source.model, sourceId: source.id }), []);
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
        assert.throws(() => requireXcliCapabilities([descriptor(['tool_calls'], false) as any], listed.models[0].id, ['tool_calls']));
        assert.equal(requests, 1);
    } finally { globalThis.fetch = original; }
});

test('the gateway client rejects malformed model catalogs', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ object: 'list', data: [{}] });
    try {
        await assert.rejects(() => xcliModels(endpoint, token), /catalog is invalid/);
    } finally { globalThis.fetch = original; }
});
