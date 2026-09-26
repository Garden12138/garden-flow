import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSettingsLlm,
  resolveVisionCapablePlanningLlm,
} from '../electron/core/aiModelRouteResolver.ts';

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

test('product-video planning keeps the selected Qwen multimodal model', () => {
  const resolved = resolveVisionCapablePlanningLlm({
    ai_sources_json: JSON.stringify([openAiSource]),
    ai_model_routes_json: JSON.stringify({
      gardenflow: { mode: 'custom', sourceId: 'openai-main', model: 'gardenflow-max' },
    }),
  }, {
    modelName: 'qwen3.8-max',
    baseURL: 'https://text-only.example.com/v1',
    apiKey: 'text-only-key',
  });

  assert.deepEqual(resolved, {
    modelName: 'qwen3.8-max',
    baseURL: 'https://text-only.example.com/v1',
    apiKey: 'text-only-key',
  });
});

test('product-video planning keeps a selected visual model and fails closed without any visual route', () => {
  const visualSelection = {
    modelName: 'qwen3.5-plus',
    baseURL: 'https://visual.example.com/v1',
    apiKey: 'visual-key',
  };
  assert.deepEqual(resolveVisionCapablePlanningLlm({}, visualSelection), visualSelection);
  assert.equal(resolveVisionCapablePlanningLlm({}, {
    modelName: 'minimax-m2.1',
    baseURL: 'https://text-only.example.com/v1',
    apiKey: 'text-only-key',
  }), null);
});

test('product-video planning never switches silently to the GardenFlow-scoped source', () => {
  const officialVisionSource = {
    ...openAiSource,
    id: 'gardenflow-official',
    name: 'GardenFlow 官方',
    model: 'gpt-4.1',
    models: ['gpt-4.1'],
    modelsMeta: [{
      id: 'gpt-4.1',
      capabilities: ['chat'],
      inputCapabilities: ['image'],
    }],
  };
  const resolved = resolveVisionCapablePlanningLlm({
    ai_sources_json: JSON.stringify([officialVisionSource]),
    ai_model_routes_json: JSON.stringify({
      gardenflow: { mode: 'custom', sourceId: officialVisionSource.id, model: 'gpt-4.1' },
    }),
  }, {
    modelName: 'minimax-m2.1',
    baseURL: 'https://text-only.example.com/v1',
    apiKey: 'text-only-key',
  });

  assert.equal(resolved, null);
});

test('product-video planning trusts explicit source input capabilities', () => {
  const source = {
    id: 'custom-vision',
    name: 'Custom vision gateway',
    baseURL: 'https://vision.example.com/v1',
    apiKey: 'vision-key',
    model: 'minimax-m2.1',
    models: ['minimax-m2.1'],
    modelsMeta: [{
      id: 'minimax-m2.1',
      capabilities: ['chat'],
      inputCapabilities: ['image'],
    }],
  };
  const selected = {
    modelName: 'minimax-m2.1',
    baseURL: source.baseURL,
    apiKey: source.apiKey,
    sourceId: source.id,
  };
  assert.deepEqual(resolveVisionCapablePlanningLlm({
    ai_sources_json: JSON.stringify([source]),
  }, selected), selected);
});
