import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSettingsLlm } from '../electron/core/aiModelRouteResolver.ts';
import OpenAI from 'openai';
import compatibility from '../shared/brandCompatibility.cjs';
import { PRIVATE_GATEWAY_DEFAULT_MODEL_IDS } from '../shared/privateGateway.ts';

const bailianSource = {
  id: 'dashscope-home',
  name: '阿里云百炼',
  presetId: 'dashscope',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-bailian-test',
  model: 'qwen-plus',
  models: ['qwen-plus', 'qwen-max'],
};

const officialSource = {
  id: 'gardenflow_official_auto',
  name: 'GardenFlow官方',
  presetId: 'gardenflow-official',
  baseURL: 'http://192.168.10.117:3000/v1',
  apiKey: '',
  model: 'gardenflow-max',
  models: ['gardenflow-max'],
};

test('background capture follows the chat custom 百炼 route, not leftover official endpoint', () => {
  const resolved = resolveSettingsLlm({
    api_endpoint: 'http://192.168.10.117:3000/v1',
    api_key: 'sk-gateway-empty-quota',
    model_name: 'gardenflow-max',
    model_name_gardenflow: 'gardenflow-max',
    ai_sources_json: JSON.stringify([officialSource, bailianSource]),
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'dashscope-home', model: 'qwen-plus' },
      gardenflow: { mode: 'official', sourceId: 'gardenflow_official_auto', model: 'gardenflow-max' },
    }),
  }, {
    preferChat: true,
    contextType: 'gardenflow',
  });

  assert.ok(resolved);
  assert.equal(resolved?.modelName, 'qwen-plus');
  assert.equal(resolved?.baseURL, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(resolved?.apiKey, 'sk-bailian-test');
  assert.equal(resolved?.scope, 'chat');
  assert.equal(resolved?.sourceId, 'dashscope-home');
});

test('interactive gardenflow still uses the gardenflow route when not preferring chat', () => {
  const resolved = resolveSettingsLlm({
    api_endpoint: 'http://192.168.10.117:3000/v1',
    api_key: 'sk-gateway-token',
    model_name: 'qwen-plus',
    ai_sources_json: JSON.stringify([officialSource, bailianSource]),
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'dashscope-home', model: 'qwen-plus' },
      gardenflow: { mode: 'official', sourceId: 'gardenflow_official_auto', model: 'gardenflow-max' },
    }),
  }, {
    preferChat: false,
    contextType: 'gardenflow',
  });

  assert.ok(resolved);
  assert.equal(resolved?.modelName, 'gardenflow-max');
  assert.equal(resolved?.baseURL, 'http://192.168.10.117:3000/v1');
  assert.equal(resolved?.apiKey, 'sk-gateway-token');
  assert.equal(resolved?.scope, 'gardenflow');
});

test('returns null when the routed source is missing so callers can fall back', () => {
  const resolved = resolveSettingsLlm({
    api_endpoint: 'http://192.168.10.117:3000/v1',
    api_key: 'sk-gateway-token',
    model_name: 'gardenflow-max',
    ai_sources_json: '[]',
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'missing-source', model: 'qwen-plus' },
    }),
  }, { preferChat: true });

  assert.equal(resolved, null);
});

test('all eleven migrated model IDs reach the wire unchanged and gateway rejection is surfaced', async () => {
  const ids = Object.entries(compatibility.identity.legacy.values).filter(([old, current]) => old.startsWith('bojin-') && PRIVATE_GATEWAY_DEFAULT_MODEL_IDS.includes(current));
  assert.equal(ids.length, 11);
  const sent: string[] = [];
  const client = new OpenAI({
    apiKey: 'test-not-a-real-key',
    baseURL: 'http://gateway.invalid/v1',
    maxRetries: 0,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)).model);
      return new Response(JSON.stringify({ error: { message: 'GardenFlow model mapping is not configured', type: 'invalid_request_error', code: 'model_not_found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
    },
  });
  for (const [old, current] of ids) {
    const route = resolveSettingsLlm({
      ai_sources_json: JSON.stringify([{ ...officialSource, id: 'bojin_official_auto', apiKey: 'test-not-a-real-key', model: old }]),
      ai_model_routes_json: JSON.stringify({ redclaw: { mode: 'official', sourceId: 'bojin_official_auto', model: old } }),
    }, { contextType: 'redclaw' });
    assert.equal(route?.modelName, current);
    await assert.rejects(client.chat.completions.create({ model: route!.modelName, messages: [{ role: 'user', content: 'test' }] }), /GardenFlow model mapping is not configured/);
  }
  assert.deepEqual(sent, ids.map(([, current]) => current));
});
