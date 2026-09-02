import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isTerminalXhsPublishStatus,
    normalizeXhsHashtags,
    reconcileInterruptedXhsPublishJob,
    xhsPublishRetryMode,
    type XhsPublishJob,
} from '../shared/xhsPublisher.ts';

function job(overrides: Partial<XhsPublishJob> = {}): XhsPublishJob {
    return {
        id: 'job-1',
        sessionId: 'session-1',
        projectPath: '/workspace/note-1',
        revision: 1,
        contentDigest: 'a'.repeat(64),
        noteType: 'image',
        title: '标题',
        body: '正文',
        hashtags: ['猫'],
        media: [{
            slotId: 'cover',
            role: 'cover',
            path: '/workspace/media/cover.png',
            mimeType: 'image/png',
            order: 0,
        }],
        extensionInstanceId: 'publisher-1',
        status: 'awaiting_confirmation',
        publishStatus: 'not_submitted',
        resetStatus: 'not_started',
        messageId: 'message-1',
        errorCode: '',
        errorMessage: '',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

test('normalizes Xiaohongshu hashtags without duplicates', () => {
    assert.deepEqual(normalizeXhsHashtags(['#布偶猫', ' 布偶猫 ', '猫 粮', '', null]), ['布偶猫', '猫 粮']);
});

test('restart before submit is safely retryable', () => {
    for (const status of ['queued', 'preflighting', 'uploading'] as const) {
        const recovered = reconcileInterruptedXhsPublishJob(job({ status }), 100);
        assert.equal(recovered?.status, 'blocked');
        assert.equal(recovered?.publishStatus, 'not_submitted');
        assert.equal(recovered && xhsPublishRetryMode(recovered), 'publish');
    }
});

test('restart during submit becomes unknown and cannot publish again', () => {
    const recovered = reconcileInterruptedXhsPublishJob(job({
        status: 'submitting',
        publishStatus: 'submitted',
    }), 100);
    assert.equal(recovered?.status, 'submit_result_unknown');
    assert.equal(recovered?.publishStatus, 'unknown');
    assert.equal(recovered && xhsPublishRetryMode(recovered), null);
    assert.equal(isTerminalXhsPublishStatus('submit_result_unknown'), true);
});

test('restart while returning only allows restoring the publish page', () => {
    const recovered = reconcileInterruptedXhsPublishJob(job({
        status: 'returning',
        publishStatus: 'published',
        resetStatus: 'returning',
    }), 100);
    assert.equal(recovered?.status, 'published_reset_failed');
    assert.equal(recovered?.publishStatus, 'published');
    assert.equal(recovered?.resetStatus, 'failed');
    assert.equal(recovered && xhsPublishRetryMode(recovered), 'restore');
});

