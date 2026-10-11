import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createBrandWorkspaceStore, type CapturedProductInput } from '../electron/core/brandWorkspaceStore.ts';
import { capturedMediaKey, localizeCapturedProductMedia } from '../electron/core/productCaptureMedia.ts';
import { validateCapturedProduct } from '../electron/core/productCaptureValidation.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const source = { platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '商品' };
const input = (count = 24): CapturedProductInput => ({ ...source, images: Array.from({ length: count }, (_, i) => ({ sourceUrl: `https://img.alicdn.com/${i}.png`, dataUrl })) });
const response = () => new Response(png, { headers: { 'content-type': 'image/png' } });
const temporary = async (t: TestContext) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-capture-media-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, store: createBrandWorkspaceStore(() => root) };
};

test('recapture reuses all validated local images, appends a snapshot and makes no network requests', async (t) => {
    const { root, store } = await temporary(t);
    const first = await store.ingestProduct(input());
    const before = await fs.readFile(path.join(root, 'catalog.json'), 'utf8');
    const fresh = validateCapturedProduct(input());
    const cache = await store.getCapturedProductImageCache(fresh);
    assert.equal(cache.size, 24); assert.equal(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'), before);
    const localized = await localizeCapturedProductMedia(fresh, { cache, headers: {}, fetchImpl: (async () => { assert.fail('cached images must not be downloaded'); }) as typeof fetch });
    assert.equal(localized.images.length, 24); assert.equal(localized.failedImages, 0);
    const next = await store.ingestProduct({ ...fresh, ...localized });
    assert.equal(next.product.product.id, first.product.product.id);
    assert.deepEqual(next.sourceSnapshot.imageAssetIds, first.sourceSnapshot.imageAssetIds);
    assert.equal(next.product.sourceSnapshots.length, 2);
});

test('cached images are isolated by platform, product identity, URL and review owner', async (t) => {
    const { store } = await temporary(t);
    const original: CapturedProductInput = { ...input(1), reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [
        { id: 'r1', text: '正文', matchedFilterIds: [], imageSourceUrls: ['https://img.alicdn.com/review.png'], images: [{ sourceUrl: 'https://img.alicdn.com/review.png', dataUrl }] },
    ] } };
    await store.ingestProduct(original);
    assert.equal((await store.getCapturedProductImageCache(original)).size, 2);
    assert.equal((await store.getCapturedProductImageCache({ ...original, platform: 'tmall', sourceUrl: 'https://detail.tmall.com/item.htm?id=1' })).size, 0);
    assert.equal((await store.getCapturedProductImageCache({ ...original, externalId: '2', sourceUrl: 'https://item.taobao.com/item.htm?id=2' })).size, 0);
    const otherReview = { ...original, images: [{ sourceUrl: 'https://img.alicdn.com/review.png' }], reviewCapture: { ...original.reviewCapture!, reviews: [{ ...original.reviewCapture!.reviews[0], id: 'r2' }] } };
    assert.equal((await store.getCapturedProductImageCache(otherReview)).size, 0);
    assert.equal((await store.getCapturedProductImageCache({ ...original, images: [{ sourceUrl: 'https://img.alicdn.com/0.png?changed=1' }], reviewCapture: undefined })).size, 0);
    await assert.rejects(store.getCapturedProductImageCache({ ...original, images: [{ sourceUrl: 'https://evil.example/a.png' }] }), /所属平台/);
});

test('missing, corrupt and symlinked cached files are rejected; a new download repairs current capture', async (t) => {
    const { root, store } = await temporary(t);
    const first = await store.ingestProduct(input(3));
    const paths = first.product.assets.map((a) => a.absolutePath);
    await fs.rm(paths[0]); await fs.writeFile(paths[1], '<html>not an image</html>');
    const outside = path.join(root, 'outside.png'); await fs.writeFile(outside, png); await fs.rm(paths[2]); await fs.symlink(outside, paths[2]);
    assert.equal((await store.getCapturedProductImageCache(input(3))).size, 0);
    const localized = await localizeCapturedProductMedia(validateCapturedProduct(input(3)), { headers: {}, fetchImpl: (async () => response()) as typeof fetch });
    const second = await store.ingestProduct({ ...input(3), ...localized });
    assert.equal(second.sourceSnapshot.imageAssetIds.length, 3);
    assert.ok(second.sourceSnapshot.imageAssetIds.every((id) => !first.sourceSnapshot.imageAssetIds.includes(id)));
    assert.equal((await store.getProductCreativeReference(first.product.product.id)).assets.length, 3);
    assert.equal((await store.getCapturedProductImageCache(input(3))).size, 3);
});

test('product and review downloads share four workers and preserve source order and buyer pairing', async () => {
    let active = 0; let maximum = 0;
    const fetchImpl = (async () => { active++; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--; return response(); }) as typeof fetch;
    const product: CapturedProductInput = { ...input(10), reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [
        { id: 'r1', text: '正文', merchantReply: '回复', matchedFilterIds: [], imageSourceUrls: ['https://img.alicdn.com/review.png'] },
    ] } };
    const result = await localizeCapturedProductMedia(product, { headers: {}, fetchImpl });
    assert.equal(maximum, 4); assert.deepEqual(result.images.map(i => i.sourceUrl), product.images!.map(i => i.sourceUrl));
    assert.equal(result.reviewCapture!.reviews[0].merchantReply, '回复'); assert.equal(result.reviewCapture!.reviews[0].sourceImages![0].status, 'localized');
    assert.equal(result.reviewCapture!.reviews[0].images![0].sourceUrl, 'https://img.alicdn.com/review.png');
});

test('replacing a corrupt review image does not attach both the broken and repaired files', async (t) => {
    const { root, store } = await temporary(t);
    const product: CapturedProductInput = { ...input(0), reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [
        { id: 'r1', text: '正文', matchedFilterIds: [], imageSourceUrls: ['https://img.alicdn.com/review.png'], images: [{ sourceUrl: 'https://img.alicdn.com/review.png', dataUrl }] },
    ] } };
    const first = await store.ingestProduct(product);
    const oldId = first.sourceSnapshot.reviewCapture!.reviews[0].imageAssetIds[0];
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'));
    await fs.writeFile(path.join(root, catalog.assets.find((asset: { id: string }) => asset.id === oldId).relativePath), 'corrupt');
    assert.equal((await store.getCapturedProductImageCache(product)).size, 0);
    const fresh = await localizeCapturedProductMedia(product, { headers: {}, fetchImpl: (async () => response()) as typeof fetch });
    const second = await store.ingestProduct({ ...product, ...fresh });
    const ids = second.sourceSnapshot.reviewCapture!.reviews[0].imageAssetIds;
    assert.equal(ids.length, 1); assert.notEqual(ids[0], oldId);
    assert.deepEqual(second.product.sourceSnapshots.find(s => s.id === first.sourceSnapshot.id)!.reviewCapture!.reviews[0].imageAssetIds, [oldId]);
});

test('only transient failures retry once; invalid content, redirects and access denials never retry', async () => {
    for (const kind of ['network', '503', '403', '429', 'invalid', 'redirect']) {
        let calls = 0;
        const result = await localizeCapturedProductMedia(input(1), { headers: {}, wait: async () => {}, fetchImpl: (async () => {
            calls++;
            if (kind === 'network' && calls === 1) throw new TypeError('fetch failed');
            if (kind === '503' && calls === 1) return new Response(null, { status: 503 });
            if (kind === '403' || kind === '429') return new Response(null, { status: Number(kind) });
            if (kind === 'invalid') return new Response('<html/>', { headers: { 'content-type': 'image/png' } });
            if (kind === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
            return response();
        }) as typeof fetch });
        const transient = kind === 'network' || kind === '503';
        assert.equal(calls, transient ? 2 : 1, kind); assert.equal(result.failedImages, transient ? 0 : 1, kind);
        assert.equal(result.failureReasons.length, transient ? 0 : 1, kind);
    }
});

test('rate limiting stops subsequent remote downloads while retaining verified cached files', async () => {
    let calls = 0;
    const cache = new Map(Array.from({ length: 19 }, (_, i) => [capturedMediaKey(`https://img.alicdn.com/${i + 5}.png`), { dataUrl }]));
    const result = await localizeCapturedProductMedia(input(), { cache, headers: {}, fetchImpl: (async () => { calls++; return new Response(null, { status: 429 }); }) as typeof fetch });
    assert.ok(calls <= 4); assert.equal(result.images.length, 19); assert.equal(result.failedImages, 5); assert.match(result.failureReasons[0], /429/);
});

test('review image failure makes the capture partial and keeps its source for recovery', async () => {
    const product: CapturedProductInput = { ...input(0), reviewCapture: { modalDetected: true, status: 'complete', availableFilters: [], selectedFilters: [], results: [], warnings: [], reviews: [
        { id: 'r1', text: '正文', matchedFilterIds: [], imageSourceUrls: ['https://img.alicdn.com/review.png'] },
    ] } };
    const result = await localizeCapturedProductMedia(product, { headers: {}, fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch });
    assert.equal(result.reviewCapture!.status, 'partial'); assert.equal(result.reviewCapture!.reviews[0].sourceImages![0].status, 'failed');
    assert.match(result.reviewCapture!.warnings[0], /下载失败/);
});

test('a shared deadline cancels pending media and prevents queued requests, retaining cache hits', async () => {
    const controller = new AbortController(); let calls = 0;
    const cache = new Map([[capturedMediaKey('https://img.alicdn.com/23.png'), { dataUrl }]]);
    const result = await localizeCapturedProductMedia(input(), { headers: {}, cache, signal: controller.signal, fetchImpl: (async (_url, options) => {
        calls++; const signal = options!.signal!;
        return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            queueMicrotask(() => controller.abort());
        });
    }) as typeof fetch });
    assert.ok(calls <= 4); assert.equal(result.images.length, 1); assert.equal(result.failedImages, 23);
    assert.match(result.failureReasons[0], /已停止或达到 60 秒/);
});

test('exact page review totals survive validation and catalog round trips without changing requested quotas', async (t) => {
    const { store } = await temporary(t);
    const product = validateCapturedProduct({ ...source, reviewCapture: { status: 'complete', availableFilters: [{ id: 'append', label: '追评' }], selectedFilters: [{ id: 'append', label: '追评', limit: 5 }], results: [{ filterId: 'append', label: '追评', requested: 5, captured: 2, availableCount: 2, status: 'complete' }], reviews: [] } });
    const saved = await store.ingestProduct(product);
    assert.equal(saved.sourceSnapshot.reviewCapture!.results[0].availableCount, 2);
    const loaded = (await store.list()).flatMap(b => b.products)[0].sourceSnapshots[0].reviewCapture!.results[0];
    assert.equal(loaded.availableCount, 2); assert.equal(loaded.requested, 5);
});
