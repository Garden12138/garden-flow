import assert from 'node:assert/strict';
import test from 'node:test';
import { retryLocalRemotionNavigation } from '../electron/core/video-editor-v2/localRemotionRetry.ts';

const navigationError = () => new Error('Visited "http://localhost:3000/index.html" but got no response.');

test('local Remotion navigation retries once and returns the recovered result', async () => {
    let calls = 0;
    let retries = 0;
    const result = await retryLocalRemotionNavigation(async () => {
        if (++calls === 1) throw navigationError();
        return { compositionId: 'GardenFlowVideoMotion' };
    }, () => retries++);
    assert.deepEqual(result, { compositionId: 'GardenFlowVideoMotion' });
    assert.equal(calls, 2);
    assert.equal(retries, 1);
});

test('render errors and nonlocal or unrelated navigation failures are surfaced without retry', async () => {
    for (const message of ['Missing image', 'Navigation timeout',
        'Visited "https://example.com/index.html" but got no response.',
        'Visited "http://localhost:5173/index.html" but got no response.',
        'Visited "http://localhost:3000/other.html" but got no response.']) {
        let calls = 0;
        const error = new Error(message);
        await assert.rejects(retryLocalRemotionNavigation(async () => { calls++; throw error; }), (caught) => caught === error);
        assert.equal(calls, 1);
    }
});

test('repeated local navigation failures stop after two attempts', async () => {
    let calls = 0;
    const finalError = navigationError();
    await assert.rejects(retryLocalRemotionNavigation(async () => {
        calls++;
        throw calls === 1 ? navigationError() : finalError;
    }), (caught) => caught === finalError);
    assert.equal(calls, 2);
});
