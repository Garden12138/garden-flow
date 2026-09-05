import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildVideoModelRoutes,
    getVideoModelCapabilities,
    resolveVideoModelRoute,
} from '../shared/videoGenerationCapabilities.ts';
import { resolveVideoProvider } from '../shared/videoProvider.ts';
import {
    buildNewApiVideoCreateUrl,
    buildNewApiVideoQueryUrl,
    buildNewApiVideoRequest,
    shouldRetryNewApiVideoCreate,
} from '../shared/newApiVideo.ts';

const newApiEndpoint = 'https://video.example.com/v1';

test('direct upstream providers are resolved from explicit presets', () => {
    assert.equal(resolveVideoProvider('https://custom.example/v1', 'wan2.1', 'aliyun-bailian'), 'aliyun-bailian');
    assert.equal(resolveVideoProvider('https://custom.example/v1', 'video-01', 'minimax'), 'minimax');
    assert.equal(resolveVideoProvider(newApiEndpoint, 'user-model', 'new-api-aliyun'), 'new-api-aliyun');
    assert.equal(resolveVideoProvider(newApiEndpoint, 'user-model', 'new-api-minimax'), 'new-api-minimax');
    assert.equal(resolveVideoProvider(newApiEndpoint, 'user-model', 'custom'), 'openai-compatible');
});

test('new-api is never guessed from endpoint or model names', () => {
    assert.equal(resolveVideoProvider(newApiEndpoint, 'happyhorse-1.1-r2v'), 'openai-compatible');
    assert.equal(resolveVideoProvider(newApiEndpoint, 'MiniMax-H3'), 'openai-compatible');
});

test('explicit new-api presets expose their upstream capabilities', () => {
    const aliyun = getVideoModelCapabilities('my-aliyun-route', newApiEndpoint, 'new-api-aliyun');
    assert.equal(aliyun.providerKind, 'new-api-aliyun');
    assert.deepEqual(aliyun.supportedModes, ['text-to-video', 'reference-guided']);
    assert.equal(aliyun.maxReferenceImages, 5);

    const minimax = getVideoModelCapabilities('my-minimax-route', newApiEndpoint, 'new-api-minimax');
    assert.equal(minimax.providerKind, 'new-api-minimax');
    assert.deepEqual(minimax.supportedModes, ['text-to-video', 'reference-guided', 'first-last-frame']);
    assert.equal(minimax.maxReferenceImages, 9);
});

test('new-api task URLs use the singular /video/generations path', () => {
    assert.equal(buildNewApiVideoCreateUrl(newApiEndpoint), 'https://video.example.com/v1/video/generations');
    assert.equal(buildNewApiVideoQueryUrl(newApiEndpoint, 'task_abc'), 'https://video.example.com/v1/video/generations/task_abc');
    assert.equal(buildNewApiVideoQueryUrl(newApiEndpoint, '   '), '');
});

test('aliyun new-api request stores reference media in metadata', () => {
    const body = buildNewApiVideoRequest({
        model: 'user-aliyun-model',
        prompt: 'A person smiles in a cafe',
        upstream: 'aliyun-bailian',
        generationMode: 'reference-guided',
        referenceImages: ['https://assets.example/a.png', 'https://assets.example/b.png'],
        resolution: '1080p',
        durationSeconds: 10,
        maxReferenceImages: 5,
        aspectRatio: '9:16',
    });

    assert.equal(body.image, undefined);
    assert.deepEqual(body.metadata, {
        input: {
            media: [
                { type: 'reference_image', url: 'https://assets.example/a.png' },
                { type: 'reference_image', url: 'https://assets.example/b.png' },
            ],
        },
        parameters: { resolution: '1080P', ratio: '9:16', duration: 10 },
    });
});

test('minimax new-api request uses mode-specific metadata fields', () => {
    const body = buildNewApiVideoRequest({
        model: 'user-minimax-model',
        prompt: 'Transition between frames',
        upstream: 'minimax',
        generationMode: 'first-last-frame',
        referenceImages: ['https://assets.example/first.png', 'https://assets.example/last.png'],
        resolution: '720p',
        durationSeconds: 6,
        maxReferenceImages: 9,
    });
    assert.deepEqual(body.metadata, {
        resolution: '720P',
        first_frame_image: 'https://assets.example/first.png',
        last_frame_image: 'https://assets.example/last.png',
    });
});

test('new-api retry policy is bounded to known transient create errors', () => {
    assert.equal(shouldRetryNewApiVideoCreate(400, 'Model not exist.'), true);
    assert.equal(shouldRetryNewApiVideoCreate(400, 'fail_to_fetch_task'), true);
    assert.equal(shouldRetryNewApiVideoCreate(401, 'Model not exist.'), false);
    assert.equal(shouldRetryNewApiVideoCreate(400, 'reference image required'), false);
});

test('configured providers retain endpoint, key, preset, and active order', () => {
    const settings = {
        active_video_provider_id: 'new-api-minimax',
        video_providers_json: JSON.stringify([
            {
                id: 'direct-aliyun',
                name: 'Aliyun direct',
                preset: 'aliyun-bailian',
                endpoint: 'https://dashscope.aliyuncs.com',
                apiKey: 'aliyun-key',
                model: 'wan2.1-t2v',
                models: ['wan2.1-t2v'],
            },
            {
                id: 'new-api-minimax',
                name: 'New API MiniMax',
                preset: 'new-api-minimax',
                endpoint: newApiEndpoint,
                apiKey: 'new-api-key',
                model: 'my-video-model',
                models: ['my-video-model'],
            },
        ]),
    };

    const routes = buildVideoModelRoutes(settings);
    assert.equal(routes[0].provider.id, 'new-api-minimax');
    assert.equal(routes[0].provider.preset, 'new-api-minimax');
    assert.equal(routes[0].capabilities.providerKind, 'new-api-minimax');
    assert.equal(resolveVideoModelRoute(settings, 'wan2.1-t2v')?.provider.id, 'direct-aliyun');
});
