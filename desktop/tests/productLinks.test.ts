import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrandWorkspaceStore, onProductChanged } from '../electron/core/brandWorkspaceStore.ts';
import { parseProductLinkCandidates, suggestProductLinks, type ProductMatchDocument } from '../electron/core/productLinkSuggestions.ts';

const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==';
const doc = (id: string): ProductMatchDocument => ({ productId: id, productVersion: `version-${id}`, name: `测试 A1 ${id}`, facts: [{ key: '型号', value: 'A1' }], sources: [{ platform: 'taobao', parameters: [] }] });
const llm = { baseURL: 'https://model.invalid/v1', apiKey: 'fixture', modelName: 'fixture' };

test('AI output rejects invalid IDs/shape/reasons and binds trusted candidate versions', () => {
    const docs = [doc('1'), doc('2'), doc('3'), doc('4')];
    for (const value of ['invalid', '{}', '{"candidates":[{"productId":"bad","reason":"x"}]}', '{"candidates":[{"productId":"1","reason":""}]}']) assert.throws(() => parseProductLinkCandidates(value, docs));
    const result = parseProductLinkCandidates(JSON.stringify({ candidates: [...docs, docs[0]].map((item) => ({ productId: item.productId, reason: '明确 A1 型号', productVersion: 'forged' })) }), docs);
    assert.equal(result.length, 3); assert.equal(result[0].productVersion, 'version-1');
});

test('AI ranking batches larger catalogs and never sends a batch over forty', async () => {
    const sizes: number[] = [];
    const result = await suggestProductLinks({ product: doc('self'), candidates: Array.from({ length: 601 }, (_, i) => doc(String(i))), llm,
        fetchImpl: (async (_url, init) => {
            const body = JSON.parse(String(init?.body)); const request = JSON.parse(body.messages[1].content);
            sizes.push(request.candidates.length); assert.ok(!request.candidates.some((item: any) => item.productId === 'self'));
            return Response.json({ choices: [{ message: { content: JSON.stringify({ candidates: request.candidates.slice(0, 3).map((item: any) => ({ productId: item.productId, reason: '同品牌同型号 A1' })) }) } }] });
        }) as typeof fetch,
    });
    assert.equal(result.length, 3); assert.ok(sizes.length > 16); assert.ok(sizes.every((size) => size <= 40));
});

test('configured OpenAI, Anthropic and Gemini text connections return validated suggestions; failures surface', async () => {
    for (const protocol of ['openai', 'anthropic', 'gemini'] as const) {
        const raw = '{"candidates":[{"productId":"1","reason":"相同 A1 型号"}]}';
        const result = await suggestProductLinks({ product: doc('self'), candidates: [doc('1')], llm, protocol, fetchImpl: (async (url, init) => {
            const body = JSON.parse(String(init?.body)); assert.ok(init?.signal);
            if (protocol === 'anthropic') { assert.match(String(url), /messages$/); assert.ok(body.system); return Response.json({ content: [{ type: 'text', text: raw }] }); }
            if (protocol === 'gemini') { assert.match(String(url), /generateContent$/); assert.ok(body.systemInstruction); return Response.json({ candidates: [{ content: { parts: [{ text: raw }] } }] }); }
            assert.match(String(url), /chat\/completions$/); return Response.json({ choices: [{ message: { content: raw } }] });
        }) as typeof fetch });
        assert.equal(result[0].productId, '1');
    }
    await assert.rejects(suggestProductLinks({ product: doc('self'), candidates: [doc('1')], llm, fetchImpl: (async () => new Response('', { status: 429 })) as typeof fetch }), /HTTP 429/);
});

test('product link suggestions disable only documented DashScope hybrid thinking', async () => {
    for (const [baseURL, modelName, expected] of [
        ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max', false],
        ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max-0902', false],
        ['https://gateway.example/v1', 'qwen3.8-max', undefined],
        ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-unknown', undefined],
    ] as const) {
        const result = await suggestProductLinks({ product: doc('self'), candidates: [doc('1')], llm: { ...llm, baseURL, modelName },
            fetchImpl: (async (_url, init) => {
                const body = JSON.parse(String(init?.body));
                assert.equal(body.enable_thinking, expected);
                return Response.json({ choices: [{ message: { content: '{"candidates":[{"productId":"1","reason":"明确 A1 型号"}]}' } }] });
            }) as typeof fetch });
        assert.equal(result[0].productVersion, 'version-1');
    }
});

test('cross-platform captures stay independent, relations preserve content versions and recapture keeps user materials', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-product-links-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => root);
    const capture = (platform: string, title = `${platform} A1`) => store.ingestProduct({ platform, externalId: '123', sourceUrl: `https://${platform === 'taobao' ? 'item.taobao.com' : 'detail.tmall.com'}/item.htm?id=123`, title, selectedSku: { externalId: 'sku1', name: '黑色' }, parameters: [{ key: '型号', value: platform }], images: [{ sourceUrl: 'https://img.alicdn.com/a.png', dataUrl: picture }] });
    const a = await capture('taobao'); const b = await capture('tmall');
    assert.notEqual(a.product.product.id, b.product.product.id);
    const aId = a.product.product.id; const bId = b.product.product.id;
    await store.upsertProduct({ id: aId, name: '用户名称', facts: [{ key: '卖点', value: '手工确认', origin: 'user-confirmed', updatedAt: new Date().toISOString() }], images: [{ dataUrl: picture, origin: 'user' }] });
    const before = await store.getProductCreativeReference(aId); const bBefore = await store.getProductCreativeReference(bId);
    const events: string[] = []; t.after(onProductChanged((change) => { if (change.root === root) events.push(change.productId); }));
    const input = { productId: aId, relatedProductId: bId, productVersion: before.updatedAt, relatedProductVersion: bBefore.updatedAt, reason: '型号一致，用户确认' };
    const link = await store.linkProducts(input); assert.equal((await store.linkProducts({ ...input, productId: bId, relatedProductId: aId, productVersion: bBefore.updatedAt, relatedProductVersion: before.updatedAt })).id, link.id);
    assert.deepEqual(await store.getProductCreativeReference(aId), before); assert.deepEqual(events, []);
    await assert.rejects(store.linkProducts({ ...input, relatedProductVersion: 'stale' }), /刷新/);
    await assert.rejects(store.linkProducts({ ...input, relatedProductId: 'missing' }), /不存在/);
    await assert.rejects(store.linkProducts({ ...input, relatedProductId: aId }), /另一个/);
    const recaptured = await capture('tmall', '新天猫名称'); assert.equal(recaptured.duplicate, true); assert.equal(recaptured.product.sourceSnapshots.length, 2);
    assert.deepEqual(await store.getProductCreativeReference(aId), before); assert.deepEqual(events, [bId]);
    await store.unlinkProducts({ productId: aId, relatedProductId: bId }); await store.unlinkProducts({ productId: aId, relatedProductId: bId });
    assert.deepEqual(await store.getProductCreativeReference(aId), before);
    const newerB = await store.getProductCreativeReference(bId);
    await store.linkProducts({ ...input, relatedProductVersion: newerB.updatedAt });
    await capture('taobao', '页面新名字'); const newerA = await store.getProductCreativeReference(aId);
    assert.equal(newerA.name, '用户名称'); assert.ok(newerA.assets.some((asset) => asset.origin === 'user'));
    assert.ok(newerA.sources.every((snapshot) => snapshot.platform === 'taobao'));
    await store.deleteProduct(bId);
    const remaining = (await store.list()).flatMap((brand) => brand.products);
    assert.equal(remaining.length, 1); assert.equal(remaining[0].links.length, 0); assert.equal(remaining[0].product.id, aId);
    assert.deepEqual(await store.getProductCreativeReference(aId), newerA);
    const catalogPath = path.join(root, 'catalog.json'); const legacy = JSON.parse(await fs.readFile(catalogPath, 'utf8')); delete legacy.productLinks;
    await fs.writeFile(catalogPath, JSON.stringify(legacy)); assert.equal((await store.list()).flatMap((brand) => brand.products)[0].links.length, 0);
});
