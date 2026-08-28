import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAiModelRoutesValue } from '../src/features/settings/modelRouteValue.ts';

test('model routes accept object values returned by settings storage', () => {
    const routes = parseAiModelRoutesValue({
        chat: {
            mode: 'custom',
            sourceId: 'dashscope-source',
            model: 'qwen3.7-plus',
        },
    });

    assert.deepEqual(routes.chat, {
        mode: 'custom',
        sourceId: 'dashscope-source',
        model: 'qwen3.7-plus',
    });
});

test('model routes continue to accept serialized JSON values', () => {
    const routes = parseAiModelRoutesValue(JSON.stringify({
        chat: {
            sourceId: 'dashscope-source',
            model: 'qwen3.7-plus',
        },
    }));

    assert.equal((routes.chat as Record<string, unknown>).model, 'qwen3.7-plus');
});
