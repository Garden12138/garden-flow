import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getModelInputCapabilities,
    inferModelCapabilities,
    modelNameDisallowsChatList,
} from '../shared/modelCapabilities.ts';

test('common chat models stay in the chat capability family', () => {
    assert.deepEqual(inferModelCapabilities('gpt-4.1-mini'), ['chat']);
    assert.deepEqual(inferModelCapabilities('claude-sonnet-4'), ['chat']);
    assert.deepEqual(getModelInputCapabilities('gpt-4.1-mini'), ['image', 'file']);
});

test('image and video families remain outside chat lists', () => {
    assert.deepEqual(inferModelCapabilities('gpt-image-1'), ['image']);
    assert.deepEqual(inferModelCapabilities('seedream-4.0'), ['image']);
    assert.deepEqual(inferModelCapabilities('seedance-1.5-pro'), ['video']);
});

test('embedding models resolve to embedding without product aliases', () => {
    assert.deepEqual(inferModelCapabilities('qwen3.7-text-embedding'), ['embedding']);
    assert.deepEqual(inferModelCapabilities('text-embedding-3-small'), ['embedding']);
    assert.deepEqual(inferModelCapabilities('qwen3.7-plus'), ['chat']);
});

test('omni models advertise rich inputs and remain outside chat selection', () => {
    assert.ok(getModelInputCapabilities('qwen-omni-turbo').includes('video'));
    assert.equal(modelNameDisallowsChatList('qwen-omni-turbo'), true);
});
