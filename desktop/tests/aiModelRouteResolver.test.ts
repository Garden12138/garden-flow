import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSettingsLlm } from '../electron/core/aiModelRouteResolver.ts';

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
  id: 'redbox_official_auto',
  name: 'Bojin官方',
  presetId: 'redbox-official',
  baseURL: 'http://192.168.10.117:3000/v1',
  apiKey: '',
  model: 'bojin-max',
  models: ['bojin-max'],
};

test('background capture follows the chat custom 百炼 route, not leftover official endpoint', () => {
  const resolved = resolveSettingsLlm({
    api_endpoint: 'http://192.168.10.117:3000/v1',
    api_key: 'sk-gateway-empty-quota',
    model_name: 'bojin-max',
    model_name_redclaw: 'bojin-max',
    ai_sources_json: JSON.stringify([officialSource, bailianSource]),
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'dashscope-home', model: 'qwen-plus' },
      redclaw: { mode: 'official', sourceId: 'redbox_official_auto', model: 'bojin-max' },
    }),
  }, {
    preferChat: true,
    contextType: 'redclaw',
  });

  assert.ok(resolved);
  assert.equal(resolved?.modelName, 'qwen-plus');
  assert.equal(resolved?.baseURL, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(resolved?.apiKey, 'sk-bailian-test');
  assert.equal(resolved?.scope, 'chat');
  assert.equal(resolved?.sourceId, 'dashscope-home');
});

test('interactive redclaw still uses the redclaw route when not preferring chat', () => {
  const resolved = resolveSettingsLlm({
    api_endpoint: 'http://192.168.10.117:3000/v1',
    api_key: 'sk-gateway-token',
    model_name: 'qwen-plus',
    ai_sources_json: JSON.stringify([officialSource, bailianSource]),
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'dashscope-home', model: 'qwen-plus' },
      redclaw: { mode: 'official', sourceId: 'redbox_official_auto', model: 'bojin-max' },
    }),
  }, {
    preferChat: false,
    contextType: 'redclaw',
  });

  assert.ok(resolved);
  assert.equal(resolved?.modelName, 'bojin-max');
  assert.equal(resolved?.baseURL, 'http://192.168.10.117:3000/v1');
  assert.equal(resolved?.apiKey, 'sk-gateway-token');
  assert.equal(resolved?.scope, 'redclaw');
});

test('returns null when the routed source is missing so callers can fall back', () => {
  const resolved = resolveSettingsLlm({
    api_endpoint: 'http://192.168.10.117:3000/v1',
    api_key: 'sk-gateway-token',
    model_name: 'bojin-max',
    ai_sources_json: '[]',
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'missing-source', model: 'qwen-plus' },
    }),
  }, { preferChat: true });

  assert.equal(resolved, null);
});
