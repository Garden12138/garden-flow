import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleChatSend } from '../shared/chatSendScheduler.ts';

test('an occluded window sends through the timer and never duplicates a later animation frame', () => {
    let sendCount = 0; let frame!: () => void; let timer!: () => void;
    const cancelled: number[] = [];
    scheduleChatSend(() => { sendCount++; }, {
        requestAnimationFrame: callback => { frame = callback; return 1; },
        cancelAnimationFrame: id => { cancelled.push(id); },
        setTimeout: (callback, delay) => { assert.equal(delay, 150); timer = callback; return 2; },
        clearTimeout: id => { cancelled.push(id); },
    });
    timer(); frame(); timer();
    assert.equal(sendCount, 1); assert.deepEqual(cancelled, [1, 2]);
});
test('a visible window sends on its frame and both fallback and cancellation remain inert', () => {
    let sendCount = 0; let frame!: () => void; let timer!: () => void;
    const cancel = scheduleChatSend(() => { sendCount++; }, {
        requestAnimationFrame: callback => { frame = callback; return 1; }, cancelAnimationFrame: () => {},
        setTimeout: callback => { timer = callback; return 2; }, clearTimeout: () => {},
    });
    frame(); timer(); cancel(); assert.equal(sendCount, 1);
    const cancelBeforeSend = scheduleChatSend(() => { sendCount++; }, {
        requestAnimationFrame: callback => { frame = callback; return 1; }, cancelAnimationFrame: () => {},
        setTimeout: callback => { timer = callback; return 2; }, clearTimeout: () => {},
    });
    cancelBeforeSend(); timer(); frame(); assert.equal(sendCount, 1);
});
