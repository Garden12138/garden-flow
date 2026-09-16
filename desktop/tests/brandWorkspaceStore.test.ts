import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrandWorkspaceStore, UNASSIGNED_BRAND_ID } from '../electron/core/brandWorkspaceStore.ts';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==';

test('captured products keep source snapshots separate from user-confirmed edits', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-brand-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);

  const first = await store.ingestProduct({
    platform: 'jd',
    externalId: '10001',
    sourceUrl: 'https://item.jd.com/10001.html',
    capturedAt: '2026-09-01T10:00:00.000Z',
    title: '采集商品名称',
    selectedSku: { externalId: '10001', name: '黑色', variantText: '颜色：黑色' },
    price: { text: '¥99.00', currency: 'CNY' },
    parameters: [{ key: '容量', value: '500ml' }],
    images: [{ name: '主图', sourceUrl: 'https://img.example.com/cover.png', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.product.sourceSnapshots.length, 1);

  await store.upsertProduct({
    id: first.product.product.id,
    name: '用户确认名称',
    description: '用户补充的卖点',
    facts: [{ key: '适用人群', value: '通勤用户', origin: 'user-confirmed', updatedAt: '2026-09-01T11:00:00.000Z' }],
  });
  const second = await store.ingestProduct({
    platform: 'jd',
    externalId: '10001',
    sourceUrl: 'https://item.jd.com/10001.html',
    capturedAt: '2026-09-02T10:00:00.000Z',
    title: '平台更新后的名称',
    selectedSku: { externalId: '10001', name: '黑色' },
    price: { text: '¥89.00', currency: 'CNY' },
    parameters: [{ key: '容量', value: '520ml' }],
  });

  assert.equal(second.duplicate, true);
  assert.equal(second.product.product.name, '用户确认名称');
  assert.equal(second.product.product.description, '用户补充的卖点');
  assert.equal(second.product.sourceSnapshots.length, 2);
  assert.equal(second.product.sourceSnapshots[0].price?.text, '¥89.00');
  assert.deepEqual(second.product.product.facts.map((fact) => [fact.key, fact.value, fact.origin]), [
    ['适用人群', '通勤用户', 'user-confirmed'],
    ['容量', '520ml', 'captured'],
  ]);

  const list = await store.list();
  assert.equal(list[0].brand.id, UNASSIGNED_BRAND_ID);
  assert.equal(list[0].products[0].assets.length, 1);
  assert.match(list[0].products[0].assets[0].path, /^gardenflow-asset:\/\/asset\//);
});

test('manual product image removal updates the catalog', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-brand-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);
  const brand = await store.upsertBrand({ name: '测试品牌' });
  const created = await store.upsertProduct({
    brandId: brand.brand.id,
    name: '测试商品',
    audience: '通勤用户',
    usageScenarios: ['办公室'],
    brandStyle: '简洁',
    images: [{ name: '主图', dataUrl: ONE_PIXEL_PNG }],
  });
  assert.equal(created.assets.length, 1);

  const updated = await store.upsertProduct({
    id: created.product.id,
    brandId: brand.brand.id,
    name: created.product.name,
    audience: '',
    usageScenarios: [],
    brandStyle: '',
    images: [],
  });
  assert.equal(updated.assets.length, 0);
  assert.equal(updated.product.audience, undefined);
  assert.deepEqual(updated.product.usageScenarios, []);
  assert.equal(updated.product.brandStyle, undefined);
});

test('a damaged catalog is surfaced instead of being overwritten as an empty workspace', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-brand-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'catalog.json'), '{invalid-json', 'utf8');
  const store = createBrandWorkspaceStore(() => root);

  await assert.rejects(store.list());
  await assert.rejects(store.upsertBrand({ name: '不应覆盖' }));
  assert.equal(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'), '{invalid-json');
});

test('product snapshots retain shop, price context and source images even after a partial recapture', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-product-recapture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);
  const input = {
    platform: 'jd', captureVersion: 2, externalId: '280930', sourceUrl: 'https://item.jd.com/280930.html',
    title: '伟嘉猫粮', brandName: '伟嘉', shopName: '宝路伟嘉京东自营旗舰店', description: '酥脆夹心',
    selectedSku: { externalId: '280930', name: '成猫粮10kg|海洋鱼味', variantText: '口味：海洋鱼味' },
    price: { text: '¥153', currency: 'CNY', label: '到手价' },
    parameters: [{ key: '净含量', value: '10kg' }, { key: '品牌', value: '伟嘉' }],
    sourceImages: [{ sourceUrl: 'https://img10.360buyimg.com/jfs/t1/cover.jpg', role: 'primary' }],
    missingFields: ['商品图片下载失败（1 张）'],
  };
  const first = await store.ingestProduct(input);
  assert.equal(first.sourceSnapshot.captureVersion, 2);
  assert.equal(first.sourceSnapshot.shopName, input.shopName);
  assert.equal(first.sourceSnapshot.description, input.description);
  assert.deepEqual(first.sourceSnapshot.price, input.price);
  assert.deepEqual(first.sourceSnapshot.sourceImages, input.sourceImages);
  assert.deepEqual(first.sourceSnapshot.imageAssetIds, []);
  await store.upsertProduct({ id: first.product.product.id, name: input.title, facts: [
    ...first.product.product.facts,
    { key: '适用阶段', value: '成猫', origin: 'user-confirmed', updatedAt: new Date().toISOString() },
  ] });
  const second = await store.ingestProduct({ ...input, parameters: [{ key: '适用阶段', value: '幼猫' }] });
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.product.product.facts.map((fact) => [fact.key, fact.value]), [['净含量', '10kg'], ['品牌', '伟嘉'], ['适用阶段', '成猫']]);
  assert.deepEqual(second.sourceSnapshot.parameters, [{ key: '适用阶段', value: '幼猫' }]);
  const reloaded = await createBrandWorkspaceStore(() => root).get(first.product.product.id);
  assert.ok(reloaded);
});

test('selected product references expose verified facts and sources to AI creation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-product-ai-reference-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);
  const captured = await store.ingestProduct({
    platform: 'jd',
    externalId: '280930',
    sourceUrl: 'https://item.jd.com/280930.html',
    capturedAt: '2026-09-12T08:27:57.000Z',
    title: '伟嘉猫粮',
    brandName: '伟嘉',
    shopName: '宝路伟嘉京东自营旗舰店',
    selectedSku: { externalId: '280930', name: '成猫粮10kg|海洋鱼味' },
    price: { text: '¥153', currency: 'CNY', label: '到手价' },
    parameters: [{ key: '适用阶段', value: '成猫' }],
    images: [{ name: '主图', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
  });

  const reference = await store.getProductAiReference(captured.product.product.id);
  assert.equal(reference.type, 'product-asset');
  assert.equal(reference.brandName, '伟嘉');
  assert.deepEqual(reference.facts, [{ key: '适用阶段', value: '成猫', origin: 'captured' }]);
  assert.equal(reference.skus[0].name, '成猫粮10kg|海洋鱼味');
  assert.equal(reference.sources[0].price?.text, '¥153');
  assert.equal(reference.sources[0].shopName, '宝路伟嘉京东自营旗舰店');
  assert.equal(reference.imageCount, 1);
});

test('creative product references expose previews while absolute paths stay in the main-process resolver', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-product-creative-reference-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);
  const first = await store.ingestProduct({
    platform: 'jd',
    externalId: 'creative-1',
    sourceUrl: 'https://item.jd.com/creative-1.html',
    title: '可信商品 A',
    price: { text: '¥129', currency: 'CNY', label: '采集价' },
    parameters: [{ key: '容量', value: '500ml' }],
    images: [{ name: '主图', role: 'primary', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
  });
  const second = await store.ingestProduct({
    platform: 'jd',
    externalId: 'creative-2',
    sourceUrl: 'https://item.jd.com/creative-2.html',
    title: '可信商品 B',
    images: [{ name: '主图', role: 'primary', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
  });

  const reference = await store.getProductCreativeReference(first.product.product.id);
  assert.equal(reference.productVersion, reference.updatedAt);
  assert.equal(reference.sources[0].price?.text, '¥129');
  assert.equal(reference.assets[0].role, 'primary');
  assert.match(reference.assets[0].previewUrl, /^gardenflow-asset:\/\/asset\//);
  assert.equal('absolutePath' in reference.assets[0], false);

  const resolved = await store.resolveProductCreativeAssetPaths(first.product.product.id, [reference.assets[0].id]);
  assert.equal(resolved.length, 1);
  assert.ok(path.isAbsolute(resolved[0].absolutePath));

  const secondReference = await store.getProductCreativeReference(second.product.product.id);
  await assert.rejects(
    store.resolveProductCreativeAssetPaths(first.product.product.id, [secondReference.assets[0].id]),
    /不属于当前商品/,
  );
});

test('JD review captures stay in source snapshots, keep review images separate, and expose balanced AI context', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-product-reviews-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);
  const filters = [
    { id: 'positive', label: '好评', sentiment: 'positive' as const },
    { id: 'neutral', label: '中评', sentiment: 'neutral' as const },
    { id: 'negative', label: '差评', sentiment: 'negative' as const },
  ];
  const fullReviewText = `开头-${'完整评论'.repeat(3_000)}-结尾`;
  const fullMerchantReply = `${'完整回复'.repeat(3_000)}-结束`;
  const reviews = filters.flatMap((filter) => Array.from({ length: 6 }, (_, index) => ({
    id: `${filter.id}-${index}`,
    authorName: `j***${index}`,
    text: filter.id === 'positive' && index === 0 ? fullReviewText : `${filter.label}评论 ${index + 1} ${'内容'.repeat(300)}`,
    merchantReply: filter.id === 'positive' && index === 0 ? fullMerchantReply : undefined,
    rating: filter.id === 'positive' ? 5 : filter.id === 'neutral' ? 3 : 1,
    sentiment: filter.sentiment,
    matchedFilterIds: [filter.id],
    dateText: `2026-09-${String(index + 1).padStart(2, '0')}`,
    skuText: '海洋鱼味',
    badges: ['已购'],
    helpfulCount: index,
    imageSourceUrls: filter.id === 'positive' && index === 0 ? ['https://img10.360buyimg.com/jfs/t1/review.jpg'] : [],
    sourceImages: filter.id === 'positive' && index === 0 ? [{
      sourceUrl: 'https://img10.360buyimg.com/jfs/t1/review.jpg',
      status: 'localized' as const,
    }] : [],
    images: filter.id === 'positive' && index === 0 ? [{
      name: '评论图',
      sourceUrl: 'https://img10.360buyimg.com/jfs/t1/review.jpg',
      dataUrl: ONE_PIXEL_PNG,
      origin: 'capture' as const,
    }] : [],
  })));
  const captured = await store.ingestProduct({
    captureVersion: 3,
    platform: 'jd',
    externalId: 'review-product',
    sourceUrl: 'https://item.jd.com/review-product.html',
    capturedAt: '2026-09-12T08:27:57.000Z',
    title: '评论测试商品',
    images: [{ name: '商品主图', role: 'primary', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
    reviewCapture: {
      modalDetected: true,
      status: 'complete',
      availableFilters: filters,
      selectedFilters: filters.map((filter) => ({ id: filter.id, label: filter.label, limit: 5, captureAll: true })),
      results: filters.map((filter) => ({ filterId: filter.id, label: filter.label, requested: 6, captured: 6, status: 'complete' as const, captureAll: true })),
      reviews,
      warnings: [],
      sortText: '最新',
      scopeText: '当前商品',
    },
  });

  assert.equal(captured.sourceSnapshot.captureVersion, 3);
  assert.equal(captured.sourceSnapshot.reviewCapture?.reviews.length, 18);
  assert.equal(captured.sourceSnapshot.reviewCapture?.reviews[0].text, fullReviewText);
  assert.equal(captured.sourceSnapshot.reviewCapture?.reviews[0].merchantReply, fullMerchantReply);
  assert.equal(captured.sourceSnapshot.reviewCapture?.results[0].captureAll, true);
  assert.equal(captured.sourceSnapshot.reviewCapture?.reviews[0].imageAssetIds.length, 1);
  assert.equal(captured.sourceSnapshot.reviewCapture?.reviews[0].sourceImages?.[0].status, 'localized');
  assert.equal(captured.product.assets.length, 1);
  assert.equal(captured.product.reviewAssets.length, 1);
  assert.equal(captured.product.reviewAssets[0].ownerType, 'product-review');

  await store.ingestProduct({
    captureVersion: 3,
    platform: 'jd',
    externalId: 'review-product',
    sourceUrl: 'https://item.jd.com/review-product.html',
    capturedAt: '2026-09-13T08:27:57.000Z',
    title: '评论测试商品',
    reviewCapture: {
      modalDetected: false,
      status: 'not-opened',
      availableFilters: [],
      selectedFilters: [],
      results: [],
      reviews: [],
      warnings: ['未打开评论弹窗'],
    },
  });

  const reference = await store.getProductAiReference(captured.product.product.id);
  assert.equal(reference.reviews.length, 15);
  assert.deepEqual(reference.reviews.slice(0, 3).map((review) => review.filterLabels[0]), ['好评', '中评', '差评']);
  assert.ok(reference.reviews.every((review) => review.text.length <= 500));
  assert.equal(reference.reviews[0].capturedAt, '2026-09-12T08:27:57.000Z');

  const creativeReference = await store.getProductCreativeReference(captured.product.product.id);
  assert.equal(creativeReference.reviews.length, 15);
  assert.equal(creativeReference.assets.some((asset) => asset.role === 'review-image'), false);
});

test('hard-deleting a captured product removes records, snapshots, reviews, and local asset files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-product-hard-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createBrandWorkspaceStore(() => root);
  const captured = await store.ingestProduct({
    captureVersion: 3,
    platform: 'jd',
    externalId: 'delete-me',
    sourceUrl: 'https://item.jd.com/delete-me.html',
    title: '待硬删除商品',
    selectedSku: { externalId: 'delete-me', name: '默认规格' },
    images: [{ name: '商品主图', role: 'primary', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
    reviewCapture: {
      modalDetected: true,
      status: 'complete',
      availableFilters: [{ id: 'negative', label: '差评', sentiment: 'negative' }],
      selectedFilters: [{ id: 'negative', label: '差评', limit: 1 }],
      results: [{ filterId: 'negative', label: '差评', requested: 1, captured: 1, status: 'complete' }],
      reviews: [{
        id: 'delete-review',
        text: '用户评论',
        merchantReply: '商家回复',
        matchedFilterIds: ['negative'],
        images: [{ name: '买家秀', dataUrl: ONE_PIXEL_PNG, origin: 'capture' }],
      }],
      warnings: [],
    },
  });
  const sku = captured.product.skus[0];
  await store.upsertSku({
    id: sku.id,
    productId: captured.product.product.id,
    name: sku.name,
    images: [{ name: 'SKU 图', dataUrl: ONE_PIXEL_PNG }],
  });
  await store.upsertProductDetailPage({
    productId: captured.product.product.id,
    platform: 'jd',
    market: 'CN',
    locale: 'zh-CN',
    images: [{ name: '详情图', dataUrl: ONE_PIXEL_PNG }],
  });

  const before = await store.get(captured.product.product.id);
  assert.ok(before.product);
  const assetPaths = [
    ...before.product.assets,
    ...before.product.reviewAssets,
    ...Object.values(before.product.skuAssets).flat(),
    ...Object.values(before.product.detailPageAssets).flat(),
  ].map((asset) => asset.absolutePath);
  assert.ok(assetPaths.length >= 4);
  for (const assetPath of assetPaths) await fs.access(assetPath);

  const deleted = await store.deleteProduct(captured.product.product.id);

  assert.equal(deleted.productId, captured.product.product.id);
  assert.equal(deleted.deletedSnapshots, 1);
  assert.equal(deleted.deletedReviews, 1);
  assert.deepEqual(deleted.fileDeleteFailures, []);
  await assert.rejects(store.get(captured.product.product.id), /不存在/);
  assert.deepEqual(await store.list(), []);
  for (const assetPath of assetPaths) {
    await assert.rejects(fs.access(assetPath));
  }
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.products, []);
  assert.deepEqual(catalog.skus, []);
  assert.deepEqual(catalog.sourceSnapshots, []);
  assert.deepEqual(catalog.detailPages, []);
  assert.deepEqual(catalog.assets, []);
});
