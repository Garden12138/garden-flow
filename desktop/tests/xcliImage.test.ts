import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeXcliImageAgent, normalizeXcliSource } from '../shared/xcliSource.ts';

test('normalizes xcli image agents and defaults legacy aliases to auto', () => {
    assert.equal(normalizeXcliImageAgent(' Codex '), 'codex');
    assert.equal(normalizeXcliImageAgent('xcli/image-default'), 'auto');
    assert.equal(normalizeXcliImageAgent(''), 'auto');
    assert.equal(normalizeXcliImageAgent(undefined), 'auto');
});

test('migrates saved xcli gateway settings to an image-only CLI source', () => {
    const source = normalizeXcliSource({
        id: 'old-source',
        presetId: 'xcli',
        baseURL: 'http://127.0.0.1:18741/v1',
        apiKey: 'fixture-token',
        model: 'xcli/text-default',
    });
    const agents = ['auto', 'codex', 'antigravity', 'cursor'];
    assert.deepEqual(source, {
        id: 'old-source',
        presetId: 'xcli',
        baseURL: 'xcli',
        apiKey: '',
        model: 'auto',
        models: agents,
        modelsMeta: agents.map((id) => ({ id, capabilities: ['image'], inputCapabilities: [] })),
    });
    assert.equal(normalizeXcliSource({ presetId: 'xcli', baseURL: '~/bin/xcli' }).baseURL, '~/bin/xcli');

    const other = { presetId: 'openai', baseURL: 'https://example.test/v1' };
    assert.equal(normalizeXcliSource(other), other);
});
