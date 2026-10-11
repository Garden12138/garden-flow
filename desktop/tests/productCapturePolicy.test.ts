import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchProductMedia, readProductMedia, validateProductCaptureIdentity, validateProductMediaSource } from '../electron/core/productCapturePolicy.ts';
import { validateCapturedProduct } from '../electron/core/productCaptureValidation.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==', 'base64');

test('platform loading and charity graphics are rejected before download, including redirects and resize variants', async () => {
    const loading = 'https://img.alicdn.com/imgextra/i2/O1CN01Dqo1gd1wMhnobvRco_!!6000000006294-2-tps-145-145.png';
    const charity = 'https://gw.alicdn.com/imgextra/i2/O1CN010DB1Un24kXOjdGhG3_!!6000000007429-0-tps-84-82.jpg';
    for (const platform of ['taobao', 'tmall']) {
        for (const url of [loading, `${loading}_200x200q90.jpg_.webp?x=1`, charity]) assert.throws(() => validateProductMediaSource(platform, url), /占位图或公益/);
        assert.equal(validateProductMediaSource(platform, 'https://img.alicdn.com/real-145-145.jpg'), 'https://img.alicdn.com/real-145-145.jpg');
    }
    let calls = 0;
    await assert.rejects(fetchProductMedia('taobao', 'https://img.alicdn.com/a.png', {}, (async () => {
        calls += 1; return new Response(null, { status: 302, headers: { location: loading } });
    }) as typeof fetch), /占位图/);
    assert.equal(calls, 1);
    const result = validateCapturedProduct({ platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '主机',
        images: [{ sourceUrl: charity }, { sourceUrl: 'https://img.alicdn.com/banner.jpg' }],
        reviewCapture: { status: 'complete', reviews: [{ id: 'r1', text: '初评 追评：后续使用感受', merchantReply: '商家回复', dateText: '2026年9月7日已购：8G+256G', imageSourceUrls: [loading] }] },
    });
    assert.equal(result.images?.length, 1); assert.equal(result.reviewCapture?.status, 'partial');
    const review = result.reviewCapture!.reviews[0];
    assert.equal(review.imageSourceUrls?.length, 0); assert.equal(review.dateText, '2026年9月7日'); assert.equal(review.skuText, '8G+256G');
    assert.equal(review.text, '初评 追评：后续使用感受'); assert.equal(review.merchantReply, '商家回复');
    assert.match(result.reviewCapture!.warnings.join(' '), /占位/);
});

test('product platform identity validates item URL and identifier, preserving JD SPU identity', () => {
    assert.equal(validateProductCaptureIdentity('taobao', '1', 'https://item.taobao.com/item.htm?id=1'), 'taobao');
    assert.equal(validateProductCaptureIdentity('tmall', '1', 'https://detail.tmall.com/item.htm?id=1'), 'tmall');
    assert.equal(validateProductCaptureIdentity('jd', '2', 'https://item.jd.com/1.html'), 'jd');
    for (const [platform, id, url] of [
        ['taobao', '2', 'https://item.taobao.com/item.htm?id=1'], ['tmall', '1', 'https://item.taobao.com/item.htm?id=1'],
        ['taobao', '1', 'https://item.taobao.com.evil.com/item.htm?id=1'], ['taobao', '1', 'file:///item.htm?id=1'],
        ['taobao', '1', 'https://user:pass@item.taobao.com/item.htm?id=1'], ['taobao', 'x', 'https://item.taobao.com/item.htm?id=x'],
    ]) assert.throws(() => validateProductCaptureIdentity(platform, id, url));
});

test('Tmall supermarket payloads pass exact-host identity checks without broadening media or platform rules', () => {
    const sourceUrl = 'https://chaoshi.detail.tmall.com/item.htm?id=1001';
    assert.equal(validateProductCaptureIdentity('tmall', '1001', sourceUrl), 'tmall');
    const product = validateCapturedProduct({ platform: 'tmall', externalId: '1001', sourceUrl, title: '超市商品',
        images: [{ sourceUrl: 'https://img.alicdn.com/item.png' }, { sourceUrl: 'https://chaoshi.detail.tmall.com/item.png' }],
    });
    assert.equal(product.platform, 'tmall'); assert.equal(product.sourceUrl, sourceUrl); assert.equal(product.images!.length, 1);
    for (const url of [sourceUrl.replace('chaoshi.detail.tmall.com', 'chaoshi.detail.tmall.com.evil.test'),
        sourceUrl.replace('chaoshi.detail.tmall.com', 'other.detail.tmall.com'), sourceUrl.replace('https://', 'https://user@'),
        sourceUrl.replace('/item.htm', ':8443/item.htm'), sourceUrl.replace('/item.htm', '/shop.htm'), sourceUrl.replace('id=1001', 'id=1002')]) {
        assert.throws(() => validateProductCaptureIdentity('tmall', '1001', url));
    }
    assert.throws(() => validateProductCaptureIdentity('taobao', '1001', sourceUrl));
    assert.throws(() => validateProductMediaSource('tmall', 'https://chaoshi.detail.tmall.com/item.png'));
});

test('media domains are scoped by platform and redirect hops are checked before requests', async () => {
    assert.equal(validateProductMediaSource('tmall', 'https://gw.alicdn.com/a.png'), 'https://gw.alicdn.com/a.png');
    for (const url of ['https://alicdn.com.evil.com/a.png', 'https://127.0.0.1/a.png', 'https://img.alicdn.com:123/a.png', 'data:image/png;base64,abc', 'https://img10.360buyimg.com/a.png']) assert.throws(() => validateProductMediaSource('taobao', url));
    const calls: string[] = [];
    const fake = (async (url: string, options: RequestInit) => {
        calls.push(url); assert.equal(options.redirect, 'manual');
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
    }) as typeof fetch;
    await assert.rejects(fetchProductMedia('taobao', 'https://img.alicdn.com/a.png', {}, fake), /所属平台/);
    assert.equal(calls.length, 1);
    let attempts = 0;
    await assert.rejects(fetchProductMedia('tmall', 'https://img.alicdn.com/a.png', {}, (async () => {
        attempts++; return new Response(null, { status: 302, headers: { location: '/loop.png' } });
    }) as typeof fetch), /次数/);
    assert.equal(attempts, 5);
});

test('media readers enforce MIME, file signature and streamed size without trusting declared length', async () => {
    assert.deepEqual((await readProductMedia(new Response(png, { headers: { 'content-type': 'image/png' } }))).buffer, png);
    await assert.rejects(readProductMedia(new Response('<html/>', { headers: { 'content-type': 'text/html' } })), /类型/);
    await assert.rejects(readProductMedia(new Response('<html/>', { headers: { 'content-type': 'image/png' } })), /不一致/);
    await assert.rejects(readProductMedia(new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '13000000' } })), /12MB/);
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    await assert.rejects(readProductMedia(new Response(stream, { headers: { 'content-type': 'image/png', 'content-length': '1' } })), /12MB/);
    assert.equal(cancelled, true);
});

test('capture validation preserves buyer/reply pairing and missing tags while rejecting unsafe media', () => {
    const source = validateCapturedProduct({ platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '杯子',
        images: [{ sourceUrl: 'https://img.alicdn.com/cover.png' }, { sourceUrl: 'https://evil.com/cover.png' }],
        reviewCapture: { status: 'partial', availableFilters: [{ id: 'current', label: '当前评价列表' }], selectedFilters: [{ id: 'absent', label: '失效标签', limit: 5 }],
            results: [{ filterId: 'absent', label: '失效标签', requested: 5, captured: 0, status: 'missing' }],
            reviews: [{ id: 'r1', text: '买家完整正文', merchantReply: '商家完整回复', matchedFilterIds: ['current'], imageSourceUrls: ['https://img.alicdn.com/review.png', 'https://evil.com/review.png'] }], warnings: ['评论未完成'] },
    });
    assert.equal(source.images?.length, 1); assert.ok(source.missingFields?.some((field) => field.includes('忽略')));
    assert.equal(source.reviewCapture?.results[0].status, 'missing');
    assert.equal(source.reviewCapture?.reviews[0].merchantReply, '商家完整回复');
    assert.equal(source.reviewCapture?.reviews[0].sentiment, undefined);
    assert.equal(source.reviewCapture?.reviews[0].imageSourceUrls?.length, 1);
});

test('review label metadata remains bound to filter IDs across input validation', () => {
    const source = validateCapturedProduct({ platform: 'tmall', externalId: '1', sourceUrl: 'https://detail.tmall.com/item.htm?id=1', title: '商品',
        reviewOptions: { selectedFilterIds: ['photos', 'all'], selectedFilterLabels: ['全部', '图/视频'], filterLabels: { photos: ' 图/视频 ', all: '全部', invalid: 42 }, filterLimits: { photos: 2, all: 5 } },
    });
    assert.deepEqual(source.reviewOptions?.filterLabels, { photos: '图/视频', all: '全部' });
    assert.deepEqual(source.reviewOptions?.filterLimits, { photos: 2, all: 5 });
});
