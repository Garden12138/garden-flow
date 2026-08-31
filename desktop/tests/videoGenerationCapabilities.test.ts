import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildVideoModelRoutes,
    getVideoModelCapabilities,
    resolveVideoModelRoute,
} from '../shared/videoGenerationCapabilities.ts';
import { resolveVideoProvider } from '../shared/videoProvider.ts';
import {
    PRIVATE_GATEWAY_BASE_URL,
    buildPrivateGatewayVideoCreateUrl,
    buildPrivateGatewayVideoQueryUrl,
    buildPrivateGatewayVideoRequest,
    shouldRetryPrivateGatewayVideoCreate,
} from '../shared/privateGateway.ts';

test('HappyHorse r2v only exposes reference-guided parameters', () => {
    const capabilities = getVideoModelCapabilities(
        'happyhorse-1.1-r2v',
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    );

    assert.deepEqual(capabilities.supportedModes, ['reference-guided']);
    assert.equal(capabilities.minReferenceImages, 1);
    assert.equal(capabilities.maxReferenceImages, 9);
    assert.equal(capabilities.supportsGeneratedAudio, false);
    assert.ok(capabilities.durationSeconds.includes(15));
});

test('MiniMax H3 separates reference audio input from generated audio output', () => {
    const capabilities = getVideoModelCapabilities('MiniMax-H3', 'https://api.minimaxi.com');

    assert.equal(capabilities.supportsReferenceAudio, true);
    assert.equal(capabilities.maxReferenceAudios, 3);
    assert.deepEqual(capabilities.referenceAudioFormats, ['mp3', 'wav']);
    assert.equal(capabilities.supportsGeneratedAudio, false);
    assert.equal(capabilities.minReferenceImages, 0);
});

test('video model routes retain the provider endpoint and prefer the active provider', () => {
    const settings = {
        active_video_provider_id: 'aliyun',
        video_providers_json: JSON.stringify([
            {
                id: 'gardenflow',
                name: 'GardenFlow',
                endpoint: 'https://api.ziz.hk/gardenflow/v1',
                apiKey: 'gardenflow-key',
                model: 'seedance-2.0',
                models: ['seedance-2.0'],
            },
            {
                id: 'aliyun',
                name: '阿里云百炼',
                endpoint: '',
                apiKey: 'aliyun-key',
                model: 'happyhorse-1.1-r2v',
                models: ['happyhorse-1.1-r2v'],
            },
        ]),
    };

    const routes = buildVideoModelRoutes(settings);
    assert.equal(routes[0].model, 'happyhorse-1.1-r2v');
    assert.equal(routes[0].provider.id, 'aliyun');
    assert.match(routes[0].provider.endpoint, /dashscope\.aliyuncs\.com/);

    const gardenflowRoute = resolveVideoModelRoute(settings, 'seedance-2.0');
    assert.equal(gardenflowRoute?.provider.id, 'gardenflow');
    assert.equal(gardenflowRoute?.provider.endpoint, 'https://api.ziz.hk/gardenflow/v1');
});

test('the private gateway endpoint routes to the new-api task protocol', () => {
    assert.equal(resolveVideoProvider(PRIVATE_GATEWAY_BASE_URL, 'gardenflow-video-1.1-r2v'), 'new-api');
    assert.equal(resolveVideoProvider(PRIVATE_GATEWAY_BASE_URL, 'gardenflow-video-H3'), 'new-api');
    // endpoint 判定优先于模型名判定，网关别名与上游原名撞车时不会误走直连协议。
    assert.equal(resolveVideoProvider(PRIVATE_GATEWAY_BASE_URL, 'happyhorse-1.1-r2v'), 'new-api');
    assert.equal(resolveVideoProvider(PRIVATE_GATEWAY_BASE_URL, 'MiniMax-H3'), 'new-api');
});

test('direct upstream routing is unchanged by the private gateway branch', () => {
    assert.equal(
        resolveVideoProvider(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
            'happyhorse-1.1-r2v',
        ),
        'aliyun-bailian',
    );
    assert.equal(resolveVideoProvider('https://api.minimaxi.com', 'MiniMax-H3'), 'minimax');
    assert.equal(resolveVideoProvider('https://api.ziz.hk/gardenflow/v1', 'seedance-2.0'), 'gardenflow');
});

test('gateway video models expose the modes their upstream supports through new-api', () => {
    const referenceOnly = getVideoModelCapabilities('gardenflow-video-1.1-r2v', PRIVATE_GATEWAY_BASE_URL);
    assert.equal(referenceOnly.providerKind, 'new-api');
    assert.deepEqual(referenceOnly.supportedModes, ['reference-guided']);
    assert.equal(referenceOnly.minReferenceImages, 1);
    assert.equal(referenceOnly.maxReferenceImages, 5);
    assert.equal(referenceOnly.supportsReferenceAudio, false);
    assert.ok(referenceOnly.durationSeconds.includes(3));
    assert.ok(referenceOnly.durationSeconds.includes(15));

    const miniMaxViaGateway = getVideoModelCapabilities('gardenflow-video-H3', PRIVATE_GATEWAY_BASE_URL);
    assert.deepEqual(miniMaxViaGateway.supportedModes, ['text-to-video', 'reference-guided', 'first-last-frame']);
    assert.equal(miniMaxViaGateway.maxReferenceImages, 9);
    // 参考音频经网关会被丢弃，直连 MiniMax 才有该能力。
    assert.equal(miniMaxViaGateway.supportsReferenceAudio, false);
    assert.equal(miniMaxViaGateway.durationSeconds[0], 4);
});

test('unregistered gateway video models fall back to text-to-video only', () => {
    const capabilities = getVideoModelCapabilities('gardenflow-video-unknown', PRIVATE_GATEWAY_BASE_URL);
    assert.equal(capabilities.providerKind, 'new-api');
    assert.deepEqual(capabilities.supportedModes, ['text-to-video']);
    assert.equal(capabilities.maxReferenceImages, 0);
});

test('new-api task urls use the singular /video/generations path', () => {
    assert.equal(
        buildPrivateGatewayVideoCreateUrl(PRIVATE_GATEWAY_BASE_URL),
        'http://192.168.10.117:3000/v1/video/generations',
    );
    assert.equal(
        buildPrivateGatewayVideoQueryUrl(PRIVATE_GATEWAY_BASE_URL, 'task_abc'),
        'http://192.168.10.117:3000/v1/video/generations/task_abc',
    );
    assert.equal(buildPrivateGatewayVideoQueryUrl(PRIVATE_GATEWAY_BASE_URL, '   '), '');
});

test('aliyun upstream reference images go into metadata.input.media and never the top level', () => {
    const body = buildPrivateGatewayVideoRequest({
        model: 'gardenflow-video-1.1-r2v',
        prompt: '参考图人物在咖啡厅微笑',
        upstream: 'aliyun-bailian',
        generationMode: 'reference-guided',
        referenceImages: ['https://host/a.png', 'https://host/b.png'],
        resolution: '1080p',
        durationSeconds: 10,
        maxReferenceImages: 5,
    });

    assert.equal(body.image, undefined);
    assert.equal(body.images, undefined);
    assert.equal(body.duration, 10);
    assert.deepEqual(body.metadata, {
        input: {
            media: [
                { type: 'reference_image', url: 'https://host/a.png' },
                { type: 'reference_image', url: 'https://host/b.png' },
            ],
        },
        parameters: { resolution: '1080P', ratio: '16:9', duration: 10 },
    });
});

test('aliyun Model not exist create errors are treated as transient retries', () => {
    assert.equal(
        shouldRetryPrivateGatewayVideoCreate(400, '{"code":"InvalidParameter","message":"Model not exist."}'),
        true,
    );
    assert.equal(shouldRetryPrivateGatewayVideoCreate(400, 'fail_to_fetch_task'), true);
    assert.equal(shouldRetryPrivateGatewayVideoCreate(401, 'Model not exist.'), false);
    assert.equal(shouldRetryPrivateGatewayVideoCreate(400, 'reference image required'), false);
});

test('minimax upstream uses flat metadata fields per generation mode', () => {
    const firstLast = buildPrivateGatewayVideoRequest({
        model: 'gardenflow-video-H3',
        prompt: '首尾帧过渡',
        upstream: 'minimax',
        generationMode: 'first-last-frame',
        referenceImages: ['https://host/first.png', 'https://host/last.png'],
        resolution: '720p',
        durationSeconds: 6,
        maxReferenceImages: 9,
    });
    assert.deepEqual(firstLast.metadata, {
        resolution: '720P',
        first_frame_image: 'https://host/first.png',
        last_frame_image: 'https://host/last.png',
    });

    const reference = buildPrivateGatewayVideoRequest({
        model: 'gardenflow-video-H3',
        prompt: '参考角色',
        upstream: 'minimax',
        generationMode: 'reference-guided',
        referenceImages: ['https://host/role.png'],
        resolution: '1080p',
        durationSeconds: 6,
        maxReferenceImages: 9,
    });
    assert.deepEqual(reference.metadata, {
        resolution: '1080P',
        subject_reference: [{ type: 'character', image: ['https://host/role.png'] }],
    });

    const textOnly = buildPrivateGatewayVideoRequest({
        model: 'gardenflow-video-H3',
        prompt: '文生视频',
        upstream: 'minimax',
        generationMode: 'text-to-video',
        referenceImages: [],
        resolution: '1080p',
        durationSeconds: 6,
        maxReferenceImages: 9,
    });
    assert.deepEqual(textOnly.metadata, { resolution: '1080P' });
});

test('private gateway video providers surface both gateway video models', () => {
    const routes = buildVideoModelRoutes({
        active_video_provider_id: 'video-provider-private-gateway',
        video_providers_json: JSON.stringify([
            {
                id: 'video-provider-private-gateway',
                name: 'GardenFlow私有网关',
                endpoint: PRIVATE_GATEWAY_BASE_URL,
                apiKey: 'sk-gateway',
                model: 'gardenflow-video-1.1-r2v',
                models: ['gardenflow-video-1.1-r2v', 'gardenflow-video-H3'],
            },
        ]),
    });

    assert.deepEqual(routes.map((route) => route.model), ['gardenflow-video-1.1-r2v', 'gardenflow-video-H3']);
    assert.ok(routes.every((route) => route.capabilities.providerKind === 'new-api'));
});
