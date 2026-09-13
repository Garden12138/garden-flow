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
