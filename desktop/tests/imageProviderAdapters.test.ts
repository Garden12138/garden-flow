import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { getImageProviderAdapter } from '../electron/core/imageProviderAdapters.ts';
import { buildCoverGeneratePayload, buildImageSubmitPayload } from '../src/features/media-generation/submitPayload.ts';

const ONE_PIXEL_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(globalThis as typeof globalThis & { require: NodeRequire }).require = createRequire(import.meta.url);

test('Qwen reference generation sends one MIME data URL request with the selected count and dimensions', async () => {
    const originalFetch = globalThis.fetch;
    const requests: any[] = [];
    const image = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;
    globalThis.fetch = async (input, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        requests.push({ url: String(input), body });
        if (body.input.messages[0].content[0].image !== image) return new Response('invalid image format', { status: 400 });
        return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image }] } }] } }), { status: 200 });
    };
    try {
        const outputs = await getImageProviderAdapter('dashscope-wan-native', 'dashscope').generate({
            prompt: '保持参考商品外观，不添加文字', model: 'qwen-image-2.0-pro-2026-06-22',
            endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'fixture-key',
            provider: 'dashscope', providerTemplate: 'dashscope-wan-native',
            generationMode: 'reference-guided', referenceImages: [image], count: 1, aspectRatio: '3:4', size: '1440x1920',
        });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
        assert.deepEqual(requests[0].body.parameters, { n: 1, size: '1440*1920' });
        assert.equal(outputs.length, 1);
        assert.equal(outputs[0].mimeType, 'image/png');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('explicit Qwen rewriting control is forwarded while an unspecified policy keeps existing behavior', async () => {
    const originalFetch = globalThis.fetch; const parameters: any[] = [];
    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)); parameters.push(body.parameters);
        return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: 'data:image/png;base64,' + ONE_PIXEL_PNG_BASE64 }] } }] } }));
    };
    try {
        for (const promptExtend of [false, true]) await getImageProviderAdapter('dashscope-wan-native', 'dashscope').generate({ prompt: 'One student in the original chair.', model: 'qwen-image-2.0-pro-2026-06-22', endpoint: 'https://dashscope.aliyuncs.com', apiKey: 'fixture', provider: 'dashscope', providerTemplate: 'dashscope-wan-native', promptExtend, count: 1 });
        assert.deepEqual(parameters.map(p => p.prompt_extend), [false, true]);
    } finally { globalThis.fetch = originalFetch; }
});

test('failed Qwen reference generation does not resubmit a different Base64 format', async () => {
    const originalFetch = globalThis.fetch;
    let submissions = 0;
    globalThis.fetch = async () => { submissions++; return new Response('provider unavailable', { status: 503 }); };
    try {
        await assert.rejects(() => getImageProviderAdapter('dashscope-wan-native', 'dashscope').generate({
            prompt: '保持参考商品外观', model: 'qwen-image-2.0-pro-2026-06-22',
            endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'fixture-key',
            provider: 'dashscope', providerTemplate: 'dashscope-wan-native', generationMode: 'reference-guided',
            referenceImages: [`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`], count: 1,
        }), /provider unavailable/);
        assert.equal(submissions, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('openai images retries /v1 when a root endpoint returns no image payload', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === 'https://gateway.example/images/generations') {
            return new Response(JSON.stringify({ message: 'welcome' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url === 'https://gateway.example/v1/images/generations') {
            return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/generated-image' }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url === 'https://cdn.example/generated-image') {
            return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'), {
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
            });
        }
        return new Response('not found', { status: 404 });
    };

    try {
        const adapter = getImageProviderAdapter('openai-images', 'openai-compatible');
        const outputs = await adapter.generate({
            prompt: 'test image',
            model: 'test-image-model',
            endpoint: 'https://gateway.example',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
            generationMode: 'text-to-image',
            aspectRatio: '1:1',
            quality: 'medium',
            count: 1,
        });

        assert.deepEqual(requestedUrls, [
            'https://gateway.example/images/generations',
            'https://gateway.example/v1/images/generations',
            'https://cdn.example/generated-image',
        ]);
        assert.equal(outputs.length, 1);
        assert.equal(outputs[0].mimeType, 'image/png');
        assert.ok(outputs[0].imageBuffer.length > 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('openai images does not duplicate /v1 for an already-versioned endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG_BASE64 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    try {
        const adapter = getImageProviderAdapter('openai-images', 'openai-compatible');
        const outputs = await adapter.generate({
            prompt: 'test image',
            model: 'test-image-model',
            endpoint: 'https://gateway.example/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
            generationMode: 'text-to-image',
            aspectRatio: '1:1',
            quality: 'medium',
            count: 1,
        });

        assert.deepEqual(requestedUrls, ['https://gateway.example/v1/images/generations']);
        assert.equal(outputs.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('openai images accepts a complete generations endpoint without duplicating the resource path', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG_BASE64 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    try {
        const adapter = getImageProviderAdapter('openai-images', 'openai-compatible');
        const outputs = await adapter.generate({
            prompt: 'test image',
            model: 'test-image-model',
            endpoint: 'https://gateway.example/v1/images/generations',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
            generationMode: 'text-to-image',
            count: 1,
        });

        assert.deepEqual(requestedUrls, ['https://gateway.example/v1/images/generations']);
        assert.equal(outputs.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('openai images uses url when gateway returns empty b64_json', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('/images/generations')) {
            return new Response(JSON.stringify({
                data: [{
                    url: 'https://cdn.example/new-api-image.png',
                    b64_json: '',
                    revised_prompt: '',
                }],
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url === 'https://cdn.example/new-api-image.png') {
            return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'), {
                status: 200,
                headers: { 'content-type': 'image/png' },
            });
        }
        return new Response('not found', { status: 404 });
    };

    try {
        const adapter = getImageProviderAdapter('openai-images', 'openai-compatible');
        const outputs = await adapter.generate({
            prompt: 'test image',
            model: 'gardenflow-imgae-3.0',
            endpoint: 'https://images.example.com/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
            generationMode: 'text-to-image',
            count: 1,
        });

        assert.equal(outputs.length, 1);
        assert.ok(requestedUrls.includes('https://cdn.example/new-api-image.png'));
        assert.ok(outputs[0].imageBuffer.length > 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('openai images retries with b64_json when a compatible gateway rejects url output', async () => {
    const originalFetch = globalThis.fetch;
    const responseFormats: string[] = [];
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        responseFormats.push(String(body.response_format || ''));
        if (body.response_format === 'url') {
            return new Response(JSON.stringify({
                error: {
                    message: "Invalid value: 'url'. Supported values are: 'b64_json'.",
                    param: 'response_format',
                    code: 'invalid_value',
                },
            }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG_BASE64 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    try {
        const adapter = getImageProviderAdapter('openai-images', 'openai-compatible');
        const outputs = await adapter.generate({
            prompt: 'test image',
            model: 'test-image-model',
            endpoint: 'https://gateway.example/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
            generationMode: 'text-to-image',
            count: 1,
        });

        assert.deepEqual(responseFormats, ['url', 'b64_json']);
        assert.equal(outputs.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('free creation image payload keeps the selected model route endpoint and protocol', () => {
    const payload = buildImageSubmitPayload({
        prompt: 'test image',
        title: '',
        projectId: '',
        generationMode: 'text-to-image',
        referenceItems: [],
        count: 1,
        model: 'gpt-image-2-1k',
        aspectRatio: '1:1',
        size: '1024x1024',
        quality: 'low',
        resolution: '1K',
    }, {
        clientRequestId: 'request-1',
        source: 'generation_studio',
        routeOverride: {
            baseURL: 'https://ai-api.kkidc.com/v1',
            endpoint: 'https://ai-api.kkidc.com/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
        },
        provider: 'dashscope',
        providerTemplate: 'dashscope-wan-native',
    });

    assert.equal(payload.endpoint, 'https://ai-api.kkidc.com/v1');
    assert.equal(payload.apiKey, 'test-key');
    assert.equal(payload.provider, 'openai-compatible');
    assert.equal(payload.providerTemplate, 'openai-images');
});

test('cover payload keeps the selected model route endpoint and protocol', () => {
    const payload = buildCoverGeneratePayload({
        prompt: 'test cover',
        title: '',
        referenceItems: [],
        count: 1,
        model: 'gpt-image-2-1k',
        quality: 'low',
        promptSwitches: {
            learnTypography: true,
            learnColorMood: true,
            beautifyFace: false,
            replaceBackground: false,
        },
    }, {
        titleId: 'title-1',
        routeOverride: {
            baseURL: 'https://ai-api.kkidc.com/v1',
            endpoint: 'https://ai-api.kkidc.com/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-images',
        },
        provider: 'dashscope',
        providerTemplate: 'dashscope-wan-native',
    });

    assert.equal(payload.endpoint, 'https://ai-api.kkidc.com/v1');
    assert.equal(payload.apiKey, 'test-key');
    assert.equal(payload.provider, 'openai-compatible');
    assert.equal(payload.providerTemplate, 'openai-images');
});

test('openai chat completions image adapter extracts a markdown image URL', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    let requestBody: Record<string, any> = {};
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url === 'https://gateway.example/v1/chat/completions') {
            requestBody = JSON.parse(String(init?.body || '{}'));
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: 'Generated image: ![result](https://cdn.example/chat-image)',
                    },
                }],
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url === 'https://cdn.example/chat-image') {
            return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'), {
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
            });
        }
        return new Response('not found', { status: 404 });
    };

    try {
        const adapter = getImageProviderAdapter('openai-chat-completions-image', 'openai-compatible');
        const outputs = await adapter.generate({
            prompt: 'test chat image',
            model: 'chat-image-model',
            endpoint: 'https://gateway.example/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-chat-completions-image',
            generationMode: 'text-to-image',
            aspectRatio: '3:4',
            quality: 'medium',
            count: 1,
        });

        assert.deepEqual(requestedUrls, [
            'https://gateway.example/v1/chat/completions',
            'https://cdn.example/chat-image',
        ]);
        assert.equal(requestBody.model, 'chat-image-model');
        assert.equal(requestBody.stream, false);
        assert.match(requestBody.messages[0].content, /aspect ratio 3:4/);
        assert.equal(outputs.length, 1);
        assert.equal(outputs[0].mimeType, 'image/png');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('openai chat completions image adapter surfaces provider quota errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: {
            message: 'insufficient quota',
            type: 'new_api_error',
            code: 'insufficient_user_quota',
        },
    }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
    });

    try {
        const adapter = getImageProviderAdapter('openai-chat-completions-image', 'openai-compatible');
        await assert.rejects(() => adapter.generate({
            prompt: 'test chat image',
            model: 'chat-image-model',
            endpoint: 'https://gateway.example/v1',
            apiKey: 'test-key',
            provider: 'openai-compatible',
            providerTemplate: 'openai-chat-completions-image',
            generationMode: 'text-to-image',
            count: 1,
        }), /Image generation failed \(403\): insufficient quota/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
