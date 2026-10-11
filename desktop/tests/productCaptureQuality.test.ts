import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrandWorkspaceStore } from '../electron/core/brandWorkspaceStore.ts';
import { splitProductReviewMetadata } from '../shared/productReviewMetadata.ts';
import { validateCapturedProduct } from '../electron/core/productCaptureValidation.ts';

test('regular and supermarket Tmall pages recapture the same product while Taobao stays independent', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-supermarket-identity-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => root);
    const source = { platform: 'tmall', externalId: '1001', title: '同一商品' };
    const first = await store.ingestProduct(validateCapturedProduct({ ...source, sourceUrl: 'https://detail.tmall.com/item.htm?id=1001' }));
    const other = await store.ingestProduct(validateCapturedProduct({ ...source, platform: 'taobao', sourceUrl: 'https://item.taobao.com/item.htm?id=1001' }));
    await store.upsertProduct({ id: first.product.product.id, name: '用户商品名', description: '用户资料' });
    const reference = await store.getProductCreativeReference(other.product.product.id);
    const next = await store.ingestProduct(validateCapturedProduct({ ...source, sourceUrl: 'https://chaoshi.detail.tmall.com/item.htm?id=1001' }));
    assert.equal(next.duplicate, true); assert.equal(next.product.product.id, first.product.product.id);
    assert.equal(next.product.sourceSnapshots.length, 2); assert.equal(next.product.product.name, '用户商品名');
    assert.equal(next.product.product.description, '用户资料'); assert.equal(next.sourceSnapshot.platform, 'tmall');
    assert.equal(next.sourceSnapshot.sourceUrl, 'https://chaoshi.detail.tmall.com/item.htm?id=1001');
    assert.equal((await store.list()).flatMap((brand) => brand.products).length, 2);
    assert.deepEqual(await store.getProductCreativeReference(other.product.product.id), reference);
});

test('display metadata is split conservatively and an explicit SKU takes priority', () => {
    assert.deepEqual(splitProductReviewMetadata('2026年9月7日已购：【95新】8G+256G'), { dateText: '2026年9月7日', skuText: '【95新】8G+256G' });
    assert.deepEqual(splitProductReviewMetadata('2026-09-07 12:30 已购: 黑色', '白色'), { dateText: '2026-09-07 12:30', skuText: '白色' });
    assert.deepEqual(splitProductReviewMetadata('昨天 黑色'), { dateText: '昨天 黑色', skuText: undefined });
});

test('old review metadata reads correctly without writing a catalog or changing the product version', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-review-quality-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => root);
    const captured = await store.ingestProduct({ platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '主机' });
    const catalogPath = path.join(root, 'catalog.json');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    catalog.sourceSnapshots[0].reviewCapture = { status: 'complete', reviews: [{ id: 'r1', text: '初评 追评：继续使用正常', merchantReply: '已收到反馈', dateText: '2026年9月7日已购：8G+256G' }] };
    const original = JSON.stringify(catalog); await fs.writeFile(catalogPath, original);
    const bundle = (await store.list()).flatMap((brand) => brand.products)[0];
    const review = bundle.sourceSnapshots[0].reviewCapture!.reviews[0];
    assert.equal(review.dateText, '2026年9月7日'); assert.equal(review.skuText, '8G+256G');
    assert.equal(review.text, '初评 追评：继续使用正常'); assert.equal(review.merchantReply, '已收到反馈');
    assert.equal(bundle.product.updatedAt, captured.product.product.updatedAt);
    assert.equal(await fs.readFile(catalogPath, 'utf8'), original);
});

test('an explicitly empty recaptured description clears old captured text while preserving user edits and snapshots', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-description-quality-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => root);
    const source = { platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '主机' };
    const first = await store.ingestProduct({ ...source, description: '公益宝贝 每笔成交捐赠' });
    const next = await store.ingestProduct({ ...source, description: '' });
    assert.equal(next.product.product.id, first.product.product.id);
    assert.equal(next.product.product.description, undefined);
    assert.equal(next.product.sourceSnapshots.length, 2);
    assert.ok(next.product.sourceSnapshots.some((snapshot) => snapshot.description === '公益宝贝 每笔成交捐赠'));
    await store.upsertProduct({ id: first.product.product.id, name: '自定义主机', description: '用户确认的商品介绍' });
    const final = await store.ingestProduct({ ...source, description: '' });
    assert.equal(final.product.product.description, '用户确认的商品介绍');
    assert.equal(final.product.product.name, '自定义主机');
});

test('recapture retires known captured UI graphics from new creations, preserving old files, snapshot IDs and other products', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-old-capture-quality-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => root);
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==';
    const charity = 'https://gw.alicdn.com/imgextra/i2/O1CN010DB1Un24kXOjdGhG3_!!6000000007429-0-tps-84-82.jpg';
    const source = { platform: 'taobao', externalId: '1', sourceUrl: 'https://item.taobao.com/item.htm?id=1', title: '主机' };
    // Seed an old unvalidated capture to exercise compatibility with existing catalogs.
    const first = await store.ingestProduct({ ...source, images: [{ sourceUrl: charity, dataUrl }, { sourceUrl: 'https://img.alicdn.com/banner.jpg', dataUrl }] });
    const second = await store.ingestProduct({ ...source, platform: 'tmall', sourceUrl: 'https://detail.tmall.com/item.htm?id=1', images: [{ sourceUrl: 'https://img.alicdn.com/banner.jpg', dataUrl }] });
    const other = await store.getProductCreativeReference(second.product.product.id);
    await store.upsertProduct({ id: first.product.product.id, name: '主机', images: [...first.product.assets.map((asset) => ({ id: asset.id })), { dataUrl, origin: 'user' }] });
    const before = await store.getProductCreativeReference(first.product.product.id);
    const oldSnapshotIds = first.sourceSnapshot.imageAssetIds;
    const updated = await store.ingestProduct({ ...source, description: '', images: [{ sourceUrl: 'https://img.alicdn.com/banner.jpg', dataUrl }] });
    const reference = await store.getProductCreativeReference(first.product.product.id);
    assert.notEqual(reference.updatedAt, before.updatedAt);
    assert.equal(reference.assets.length, 2); assert.ok(reference.assets.some((asset) => asset.origin === 'user'));
    assert.ok(!reference.assets.some((asset) => asset.id === oldSnapshotIds[0]));
    await assert.rejects(store.resolveProductCreativeAssetPaths(reference.id, [oldSnapshotIds[0]]), /素材不存在/);
    assert.deepEqual(updated.product.sourceSnapshots.find((snapshot) => snapshot.id === first.sourceSnapshot.id)?.imageAssetIds, oldSnapshotIds);
    for (const asset of first.product.assets) await fs.access(asset.absolutePath);
    assert.deepEqual(await store.getProductCreativeReference(second.product.product.id), other);
});

test('recapture repairs proven captured SKU replacement characters while preserving IDs, manual edits, history and other products', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-sku-quality-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = createBrandWorkspaceStore(() => root);
    const source = { platform: 'tmall', externalId: '1', sourceUrl: 'https://detail.tmall.com/item.htm?id=1', title: '唱片机' };
    const broken = { externalId: '100', name: '动��磁 白色', variantText: '动��磁 白色' };
    const first = await store.ingestProduct({ ...source, selectedSku: broken, capturedAt: '2026-10-08T07:00:00.000Z' });
    const other = await store.ingestProduct({ ...source, platform: 'taobao', sourceUrl: 'https://item.taobao.com/item.htm?id=1', selectedSku: broken });
    const beforeOther = await store.getProductCreativeReference(other.product.product.id);
    const fixed = { ...broken, name: '动磁 白色', variantText: '动磁 白色' };
    const next = await store.ingestProduct({ ...source, selectedSku: fixed, capturedAt: '2026-10-08T08:00:00.000Z' });
    assert.equal(next.product.skus.length, 1);
    assert.equal(next.product.skus[0].id, first.product.skus[0].id);
    assert.equal(next.product.skus[0].name, '动磁 白色');
    assert.equal(next.product.sourceSnapshots.find((snapshot) => snapshot.id === first.sourceSnapshot.id)?.selectedSku?.name, broken.name);
    assert.deepEqual(await store.getProductCreativeReference(other.product.product.id), beforeOther);
    assert.equal((await store.getProductCreativeReference(next.product.product.id)).skus[0].name, fixed.name);
    // Even a manually retained malformed label belongs to the user.
    await store.upsertSku({ id: next.product.skus[0].id, productId: next.product.product.id, ...broken });
    const edited = await store.ingestProduct({ ...source, selectedSku: fixed });
    assert.equal(edited.product.skus[0].name, broken.name);
    assert.ok(edited.product.skus[0].userEditedAt);
});
