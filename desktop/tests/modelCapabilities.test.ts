import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getModelInputCapabilities,
    inferModelCapabilities,
    modelNameDisallowsChatList,
} from '../shared/modelCapabilities.ts';
import { PRIVATE_GATEWAY_DEFAULT_MODELS } from '../shared/privateGateway.ts';

test('private gateway chat aliases stay chat-only with image/file input', () => {
    assert.deepEqual(inferModelCapabilities('bojin-max'), ['chat']);
    assert.deepEqual(inferModelCapabilities('bojin-plus'), ['chat']);
    assert.deepEqual(getModelInputCapabilities('bojin-max'), ['image', 'file']);
});

test('private gateway image aliases keep the gateway "imgae" spelling out of chat lists', () => {
    assert.deepEqual(inferModelCapabilities('bojin-imgae-2.0'), ['image']);
    assert.deepEqual(inferModelCapabilities('bojin-imgae-3.0'), ['image']);
    // 若网关后续把别名改为正确拼写，档案的第二个 matcher 兜住。
    assert.deepEqual(inferModelCapabilities('bojin-image-3.0'), ['image']);
});

test('private gateway omni alias is audio-only and allows video input', () => {
    assert.deepEqual(inferModelCapabilities('bojin-omni-plus'), ['audio']);
    assert.ok(getModelInputCapabilities('bojin-omni-plus').includes('video'));
    assert.equal(modelNameDisallowsChatList('bojin-omni-plus'), true);
});

test('private gateway speech / asr / embedding aliases map to their own capability', () => {
    assert.deepEqual(inferModelCapabilities('bojin-speech'), ['tts']);
    assert.deepEqual(inferModelCapabilities('bojin-asr-plus'), ['transcription']);
    assert.deepEqual(inferModelCapabilities('bojin-text-embedding'), ['embedding']);
});

test('qwen embedding models stay out of the chat family and appear as embedding', () => {
    assert.deepEqual(inferModelCapabilities('qwen3.7-text-embedding'), ['embedding']);
    assert.deepEqual(inferModelCapabilities('text-embedding-3-small'), ['embedding']);
    assert.deepEqual(inferModelCapabilities('qwen3.7-plus'), ['chat']);
    assert.deepEqual(inferModelCapabilities('qwen3.8-max'), ['chat']);
});

test('private gateway video aliases resolve to the video capability', () => {
    assert.deepEqual(inferModelCapabilities('bojin-video-1.1-r2v'), ['video']);
    assert.deepEqual(inferModelCapabilities('bojin-video-H3'), ['video']);
});

test('built-in gateway model metadata matches the inferred capabilities', () => {
    assert.equal(PRIVATE_GATEWAY_DEFAULT_MODELS.length, 10);
    for (const model of PRIVATE_GATEWAY_DEFAULT_MODELS) {
        assert.deepEqual(
            inferModelCapabilities(model.id),
            model.capabilities,
            `capability mismatch for ${model.id}`,
        );
    }
});
