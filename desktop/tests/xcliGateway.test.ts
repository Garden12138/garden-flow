import assert from 'node:assert/strict';
import test from 'node:test';
import { xcliModels } from '../electron/core/xcliGateway.ts';

const endpoint = 'http://127.0.0.1:18741/v1';
const token = 'synthetic-gardenflow-token';

test('the gateway client rejects malformed model catalogs', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ object: 'list', data: [{}] });
    try {
        await assert.rejects(() => xcliModels(endpoint, token), /catalog is invalid/);
    } finally { globalThis.fetch = original; }
});
