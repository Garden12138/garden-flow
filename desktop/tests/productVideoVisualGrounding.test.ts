import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertProductVideoRuntimeVisualInput,
    buildProductVideoVisualGroundingMessages,
    buildVerifiedProductAssetAnalysisText,
    parseProductVideoVisualGroundingResponse,
    requestProductVideoVisualGrounding,
    summarizeProductVideoRuntimeVisualInput,
    ProductVideoVisualError,
    type ProductVideoVisualAssetPayload,
} from '../electron/core/productVideoVisualGrounding.ts';
import {
    buildProductVideoImageFfmpegArgs,
    decodeProductVideoImage,
} from '../electron/core/productVideoImageDecode.ts';
import { createProductVideoVerificationPng } from '../electron/core/productVideoVerificationImage.ts';

const assets: ProductVideoVisualAssetPayload[] = [
    {
        assetId: 'asset-clean',
        role: 'primary',
        origin: 'catalog',
        dataUrl: 'data:image/jpeg;base64,Y2xlYW4=',
    },
    {
        assetId: 'asset-promo',
        role: 'gallery',
        origin: 'catalog',
        dataUrl: 'data:image/jpeg;base64,cHJvbW8=',
    },
];

test('visual diagnostics normalize only case and outer whitespace and never persist untrusted responses', async () => {
    const body = (token: string) => ({ verificationToken: token, assets: assets.map((asset) => ({ assetId: asset.assetId, description: '白底商品包装实拍' })) });
    let calls = 0;
    const run = (token: string) => requestProductVideoVisualGrounding({
        apiKey: 'secret-key', baseURL: 'https://private.invalid', modelName: 'fixture', productName: '商品',
        productId: 'p1', productUpdatedAt: 'v1', assets, verificationToken: 'GF-ABC123DEF456', verificationImageDataUrl: 'data:image/png;base64,cHJvb2Y=',
        fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body(token)) } }] })); },
    });
    assert.equal((await run('  gf-abc123def456\n')).diagnostic?.outcome, 'verified');
    for (const token of ['GF-ABC123DEF45', 'GF-ABC123DEF457', 'GF-ABC 123DEF456', 'secret-key data:image/png;base64,AAAA /private/file']) {
        await assert.rejects(run(token), (error: ProductVideoVisualError) => {
            assert.equal(error.code, 'token-mismatch');
            assert.equal(error.diagnostic?.responseParsed, true);
            assert.doesNotMatch(JSON.stringify(error.diagnostic), /secret-key|private.invalid|base64|\/private/);
            return true;
        });
    }
    assert.equal(calls, 5, 'semantic failure must not trigger another model request');
});

test('visual diagnostics distinguish response, asset coverage, HTTP and cancellation failures', async () => {
    const run = (content: unknown, status = 200, signal?: AbortSignal) => requestProductVideoVisualGrounding({
        apiKey: 'secret', baseURL: 'https://private.invalid', modelName: 'fixture', productName: '商品',
        productId: 'p1', productUpdatedAt: 'v1', assets, verificationToken: 'GF-ABC123DEF456', verificationImageDataUrl: 'data:image/png;base64,cHJvb2Y=', signal,
        fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
    });
    await assert.rejects(run('not JSON'), { code: 'invalid-response' });
    await assert.rejects(run(JSON.stringify({ verificationToken: 'GF-ABC123DEF456', assets: [] })), { code: 'incomplete-assets' });
    await assert.rejects(run('secret server response', 400), (error: ProductVideoVisualError) => error.code === 'request-failed' && !error.message.includes('secret'));
    await assert.rejects(run('bad', 200, AbortSignal.abort()), { code: 'cancelled' });
});

const parseEvidence = () => parseProductVideoVisualGroundingResponse({
    rawContent: JSON.stringify({
        verificationToken: 'GF-ABC123',
        assets: [
            {
                assetId: 'asset-clean',
                description: '白底商品包装、猫和食盆',
                visibleText: ['成猫全价猫粮'],
                hasPrice: false,
                hasPromotion: false,
                hasActivityDate: false,
                suitability: 'safe',
                reasons: [],
            },
            {
                assetId: 'asset-promo',
                description: '商品包装旁带促销价格和活动日期',
                visibleText: ['¥167', '9月18日-9月20日'],
                hasPrice: true,
                hasPromotion: true,
                hasActivityDate: true,
                suitability: 'safe',
                reasons: ['包含促销信息'],
            },
        ],
    }),
    expectedAssets: assets,
    expectedVerificationToken: 'GF-ABC123',
    modelName: 'qwen3.8-max',
    productId: 'product-001',
    productUpdatedAt: '2026-09-21T02:47:59.850Z',
    now: '2026-09-21T08:00:00.000Z',
});

test('visual grounding request keeps asset labels adjacent to every image and adds a proof image', () => {
    const messages = buildProductVideoVisualGroundingMessages({
        productName: '测试猫粮',
        assets,
        verificationImageDataUrl: 'data:image/png;base64,cHJvb2Y=',
    });
    const userContent = messages[1].content;
    assert.ok(Array.isArray(userContent));
    assert.equal(userContent.filter((part) => part.type === 'image_url').length, 3);
    const combinedText = userContent
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
    assert.match(combinedText, /assetId=asset-clean/);
    assert.match(combinedText, /assetId=asset-promo/);
    assert.doesNotMatch(combinedText, /GF-ABC123/);
});

test('visual grounding proves the image channel and forces promotional assets to exclude', () => {
    const evidence = parseEvidence();
    assert.equal(evidence.status, 'verified');
    assert.equal(evidence.modelName, 'qwen3.8-max');
    assert.equal(evidence.productId, 'product-001');
    assert.equal(evidence.imageCount, 2);
    assert.equal(evidence.assets[0].suitability, 'safe');
    assert.equal(evidence.assets[1].suitability, 'exclude');
});

test('visual grounding rejects missing images and an incorrect proof token', () => {
    assert.throws(() => parseProductVideoVisualGroundingResponse({
        rawContent: JSON.stringify({ verificationToken: 'GF-WRONG', assets: [] }),
        expectedAssets: assets,
        expectedVerificationToken: 'GF-ABC123',
        modelName: 'qwen3.8-max',
    }), /视觉通道校验失败/);

    assert.throws(() => parseProductVideoVisualGroundingResponse({
        rawContent: JSON.stringify({
            verificationToken: 'GF-ABC123',
            assets: [{
                assetId: 'asset-clean',
                description: '白底商品包装',
                hasPrice: false,
                hasPromotion: false,
                hasActivityDate: false,
            }],
        }),
        expectedAssets: assets,
        expectedVerificationToken: 'GF-ABC123',
        modelName: 'qwen3.8-max',
    }), /未完成全部商品素材分析/);
});

test('product-video runtime fails closed unless verified visual analysis and image parts coexist', () => {
    const evidence = parseEvidence();
    const content = [
        {
            type: 'text' as const,
            text: [
                '<product_asset_visuals>',
                '</product_asset_visuals>',
                buildVerifiedProductAssetAnalysisText(evidence),
                'assetId=asset-clean',
                'assetId=asset-promo',
            ].join('\n'),
        },
        { type: 'image_url' as const, image_url: { url: assets[0].dataUrl } },
        { type: 'image_url' as const, image_url: { url: assets[1].dataUrl } },
    ];
    const summary = assertProductVideoRuntimeVisualInput({ content, evidence });
    assert.equal(summary.groundingStatus, 'verified');
    assert.equal(summary.imagePartCount, 2);
    assert.deepEqual(summary.assetIds, ['asset-clean', 'asset-promo']);

    const rejected = summarizeProductVideoRuntimeVisualInput({ content: 'plain text', evidence });
    assert.equal(rejected.contentKind, 'text');
    assert.throws(() => assertProductVideoRuntimeVisualInput({ content: 'plain text', evidence }), /已阻止/);
    assert.throws(() => assertProductVideoRuntimeVisualInput({ content, evidence: null }), /已阻止/);
});

test('visual preflight sends a real multimodal payload and accepts only the pixel proof returned by the model', async () => {
    let requestBody: Record<string, unknown> | null = null;
    const evidence = await requestProductVideoVisualGrounding({
        apiKey: 'test-key',
        baseURL: 'https://example.test/v1',
        modelName: 'qwen3.8-max',
        productId: 'product-001',
        productUpdatedAt: '2026-09-21T02:47:59.850Z',
        productName: '测试猫粮',
        assets,
        verificationToken: 'GF-ABC123',
        verificationImageDataUrl: 'data:image/png;base64,cHJvb2Y=',
        fetchImpl: async (_url, init) => {
            requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            verificationToken: 'GF-ABC123',
                            assets: assets.map((asset) => ({
                                assetId: asset.assetId,
                                description: `${asset.assetId} 的真实画面`,
                                visibleText: [],
                                hasPrice: false,
                                hasPromotion: false,
                                hasActivityDate: false,
                                suitability: 'safe',
                                reasons: [],
                            })),
                        }),
                    },
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
    });
    assert.equal(evidence.status, 'verified');
    assert.equal(requestBody?.model, 'qwen3.8-max');
    const messages = requestBody?.messages as Array<{ role: string; content: unknown }>;
    assert.ok(Array.isArray(messages));
    const userContent = messages[1].content as Array<{ type: string }>;
    assert.equal(userContent.filter((part) => part.type === 'image_url').length, 3);
});

test('product image decoding falls back to ffmpeg when Electron cannot decode AVIF', async () => {
    let fallbackCalls = 0;
    const fallbackJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const decoded = await decodeProductVideoImage({
        decodeNative: () => null,
        decodeFallback: async () => {
            fallbackCalls += 1;
            return fallbackJpeg;
        },
    });

    assert.equal(fallbackCalls, 1);
    assert.equal(decoded?.decoder, 'ffmpeg');
    assert.deepEqual(decoded?.jpeg, fallbackJpeg);

    const args = buildProductVideoImageFfmpegArgs('/tmp/product.avif', 768);
    assert.deepEqual(args.slice(0, 4), ['-v', 'error', '-i', '/tmp/product.avif']);
    assert.ok(args.includes('mjpeg'));
    assert.match(String(args[args.indexOf('-vf') + 1]), /min\(768,iw\)/);
});

test('product image decoding keeps native decoding as the fast path', async () => {
    let fallbackCalls = 0;
    const nativeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const decoded = await decodeProductVideoImage({
        decodeNative: () => nativeJpeg,
        decodeFallback: async () => {
            fallbackCalls += 1;
            return Buffer.alloc(0);
        },
    });

    assert.equal(fallbackCalls, 0);
    assert.equal(decoded?.decoder, 'native-image');
    assert.deepEqual(decoded?.jpeg, nativeJpeg);
});

test('visual-channel proof image is a deterministic PNG independent of Electron nativeImage', () => {
    const png = createProductVideoVerificationPng('GF-ABC123DEF456');
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.equal(png.readUInt32BE(16), 720);
    assert.equal(png.readUInt32BE(20), 280);
    assert.ok(png.includes(Buffer.from('IDAT')));
    assert.ok(png.includes(Buffer.from('IEND')));
    assert.notDeepEqual(png, createProductVideoVerificationPng('GF-ABC123DEF457'));
    assert.throws(() => createProductVideoVerificationPng('GF-invalid'), /Invalid/);
});
