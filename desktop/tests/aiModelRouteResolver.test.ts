import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSettingsLlm } from '../electron/core/aiModelRouteResolver.ts';

const openAiSource = {
  id: 'openai-main',
  name: 'OpenAI',
  presetId: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-openai-test',
  model: 'gpt-4.1-mini',
  models: ['gpt-4.1-mini'],
};

const localSource = {
  id: 'ollama-local',
  name: 'Ollama',
  presetId: 'ollama-local',
  baseURL: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  model: 'qwen3:8b',
  models: ['qwen3:8b'],
};

test('background work follows the configured chat route', () => {
  const resolved = resolveSettingsLlm({
    ai_sources_json: JSON.stringify([openAiSource]),
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'openai-main', model: 'gpt-4.1-mini' },
    }),
  }, { preferChat: true, contextType: 'gardenflow' });

  assert.deepEqual(resolved, {
    modelName: 'gpt-4.1-mini',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-openai-test',
    sourceId: 'openai-main',
    scope: 'chat',
    mode: 'custom',
  });
});

test('scope-specific routes retain their provider and model', () => {
  const resolved = resolveSettingsLlm({
    ai_sources_json: JSON.stringify([openAiSource]),
    ai_model_routes_json: JSON.stringify({
      gardenflow: { mode: 'custom', sourceId: 'openai-main', model: 'gpt-4.1' },
    }),
  }, { contextType: 'gardenflow' });

  assert.equal(resolved?.scope, 'gardenflow');
  assert.equal(resolved?.modelName, 'gpt-4.1');
  assert.equal(resolved?.sourceId, 'openai-main');
});

test('local providers work without a user-supplied API key', () => {
  const resolved = resolveSettingsLlm({
    ai_sources_json: JSON.stringify([localSource]),
    ai_model_routes_json: JSON.stringify({
      chat: { mode: 'custom', sourceId: 'ollama-local', model: 'qwen3:8b' },
    }),
  }, { preferChat: true });

  assert.equal(resolved?.baseURL, 'http://127.0.0.1:11434/v1');
  assert.equal(resolved?.apiKey, 'local');
});

test('disabled, missing, and incomplete routes resolve to null', () => {
  assert.equal(resolveSettingsLlm({
    ai_sources_json: '[]',
    ai_model_routes_json: JSON.stringify({ chat: { mode: 'disabled' } }),
  }, { preferChat: true }), null);

  assert.equal(resolveSettingsLlm({
    ai_sources_json: JSON.stringify([openAiSource]),
    ai_model_routes_json: JSON.stringify({ chat: { mode: 'custom', sourceId: 'missing', model: 'gpt-4.1-mini' } }),
  }, { preferChat: true }), null);

  assert.equal(resolveSettingsLlm({
    ai_sources_json: JSON.stringify([{ ...openAiSource, apiKey: '' }]),
    ai_model_routes_json: JSON.stringify({ chat: { mode: 'custom', sourceId: 'openai-main', model: 'gpt-4.1-mini' } }),
  }, { preferChat: true }), null);
});
