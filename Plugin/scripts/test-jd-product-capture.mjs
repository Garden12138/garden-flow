import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { extractJdProductPayload } from '../src/capture/jdProduct.js';

test('extracts the current JD SKU, images, price, and parameters for preview', () => {
  const { document } = parseHTML(`<!doctype html><html><head><title>测试保温杯 - 京东</title></head><body>
    <div class="sku-name">测试品牌 真空保温杯 500ml</div>
    <div class="p-author"><a>测试品牌</a></div>
    <div class="summary-price"><span class="p-price"><span class="price">129.00</span></span></div>
    <div id="choose-attrs"><div class="item selected" title="曜石黑"><a title="曜石黑">曜石黑</a></div></div>
    <div id="preview"><img src="//img10.360buyimg.com/n1/cover.jpg"></div>
    <div id="J-detail-content"><img data-lazy-img="https://img10.360buyimg.com/n1/detail.jpg"><p>杯盖可拆洗，适合通勤。</p></div>
    <ul class="p-parameter-list"><li title="品牌：测试品牌">品牌：测试品牌</li><li>容量：500ml</li></ul>
  </body></html>`);
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/100012345678.html'));

  assert.equal(payload.externalId, '100012345678');
  assert.equal(payload.title, '测试品牌 真空保温杯 500ml');
  assert.equal(payload.brandName, '测试品牌');
  assert.deepEqual(payload.selectedSku, {
    externalId: '100012345678',
    name: '曜石黑',
    variantText: '曜石黑',
  });
  assert.deepEqual(payload.price, { text: '¥129.00', currency: 'CNY' });
  assert.deepEqual(payload.parameters, [
    { key: '品牌', value: '测试品牌' },
    { key: '容量', value: '500ml' },
  ]);
  assert.equal(payload.images.length, 2);
  assert.equal(payload.images[0].sourceUrl, 'https://img10.360buyimg.com/n1/cover.jpg');
  assert.deepEqual(payload.missingFields, []);
});

test('marks visible JD fields that need manual completion', () => {
  const { document } = parseHTML('<html><head><title>简单商品 - 京东</title></head><body><h1>简单商品</h1></body></html>');
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/987654321.html'));

  assert.equal(payload.title, '简单商品');
  assert.deepEqual(payload.missingFields, ['当前规格', '价格', '商品图片', '商品参数']);
});

test('uses a JD SPU as the reusable product identity while retaining the selected SKU', () => {
  const { document } = parseHTML(`
    <html><head><title>多规格商品 - 京东</title></head><body>
      <script>window.pageConfig = { spuId: "600000001", skuId: "700000002" };</script>
      <h1>多规格商品</h1>
      <div id="choose-attrs"><div class="item selected" title="大号">大号</div></div>
    </body></html>
  `);
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/700000002.html'));

  assert.equal(payload.externalId, '600000001');
  assert.equal(payload.selectedSku?.externalId, '700000002');
  assert.equal(payload.selectedSku?.variantText, '大号');
});

test('new JD components exclude calculator, badges, other SKUs and navigation', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('./fixtures/jd-product-modern.html', import.meta.url), 'utf8');
  const { document } = parseHTML(html);
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.title, '伟嘉猫粮成猫全价猫粮亮毛蓝猫均衡营养10kg海洋鱼夹心粮【原料透明】');
  assert.equal(payload.externalId, '280930');
  assert.equal(payload.shopName, '宝路伟嘉京东自营旗舰店');
  assert.equal(payload.brandName, '伟嘉（whiskas）');
  assert.deepEqual(payload.price, { text: '¥153', currency: 'CNY', label: '到手价' });
  assert.equal(payload.selectedSku.variantText, '系列品：成猫猫粮；口味：成猫粮10kg|海洋鱼味');
  assert.equal(payload.parameters.length, 3);
  assert.deepEqual(payload.images.map((image) => image.role), ['primary', 'gallery', 'detail', 'detail']);
  assert.equal(payload.images[0].sourceUrl, 'https://img10.360buyimg.com/n1/s1440x1440_jfs/t1/cover.jpg.avif');
  assert.equal(payload.detailText, '酥脆夹心，均衡营养。');
  assert.deepEqual(payload.missingFields, []);
});

test('title metadata precedes unrelated headings and removes only JD SEO suffix', () => {
  const { document } = parseHTML('<html><head><title>伟嘉【原料透明】【行情 报价 价格 评测】-京东</title></head><body><h1>最小单价计算器</h1></body></html>');
  assert.equal(extractJdProductPayload(document, new URL('https://item.jd.com/280930.html')).title, '伟嘉【原料透明】');
});

test('matching Product structured data is a fallback without borrowing a recommendation price', () => {
  const { document } = parseHTML(`<html><head><script type="application/ld+json">${JSON.stringify({ '@graph': [
    { '@type': 'Product', sku: '999999', name: '推荐商品', offers: { price: 1 } },
    { '@type': 'Product', sku: '280930', name: '当前商品', brand: { name: '伟嘉' }, offers: { price: '165.00' }, image: ['https://img10.360buyimg.com/jfs/t1/current.jpg'], additionalProperty: [{ name: '重量', value: '10kg' }] },
  ] })}</script></head><body><h1>其他插件</h1></body></html>`);
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.title, '当前商品');
  assert.equal(payload.price.text, '¥165.00');
  assert.equal(payload.images.length, 1);
  assert.equal(payload.brandName, '伟嘉');
});

test('missing current price is not substituted with original price, coupon or instalment', () => {
  const { document } = parseHTML('<html><head><title>商品-京东</title></head><body><div class="product-price--gray">¥165</div><div class="calculator-title">¥1.00</div><div class="price">¥51.00 x 3期</div></body></html>');
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.price, undefined);
  assert.ok(payload.missingFields.includes('价格'));
});

test('all direct page-link saves of JD products bypass generic article capture', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const { isJdProductUrl } = await import('../src/capture/jdProduct.js');
  const source = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function saveCurrentPageLinkFromTab(');
  const end = source.indexOf('\nasync function ', start + 1);
  const calls = [];
  const context = {
    chrome: { tabs: { get: async () => ({ url: 'https://item.jd.com/280930.html' }) } },
    isJdProductUrl,
    saveJdProductFromTab: async (id) => { calls.push(id); return { mode: 'jd-product' }; },
    genericCaptureCoordinator: { extract: () => { throw new Error('Should not collect page chrome'); } },
  };
  runInNewContext(source.slice(start, end), context);
  assert.equal((await context.saveCurrentPageLinkFromTab(12)).mode, 'jd-product');
  assert.deepEqual(calls, [12]);
  assert.equal(isJdProductUrl('https://item.jd.com.evil.test/280930.html'), false);
  assert.equal(isJdProductUrl('https://jd.com/'), false);
});

test('captures scoped JD CSS detail images without collecting unrelated stylesheet icons', () => {
  const { document } = parseHTML(`<html><head><title>商品-京东</title></head><body><div id="detail-main">
    <style>.ssd-module-photo { background-image: url('//img10.360buyimg.com/jfs/t1/detail.jpg'); } .toolbar { background: url('//img10.360buyimg.com/jfs/t1/icon.png'); }</style>
    <div class="ssd-module-wrap"><div class="ssd-module ssd-module-photo"></div></div>
  </div></body></html>`);
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.images.length, 1);
  assert.equal(payload.images[0].role, 'detail');
  assert.equal(payload.images[0].sourceUrl, 'https://img10.360buyimg.com/jfs/t1/detail.jpg');
  assert.equal(payload.detailText, undefined);
  assert.equal(payload.captureVersion, 2);
});

test('a loading shell cannot be saved under the JD homepage title or a third-party heading', () => {
  const { document } = parseHTML('<html><head><title>京东(JD.COM)-正品低价、品质保障、配送及时、轻松购物！</title></head><body><h1>最小单价计算器</h1></body></html>');
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.title, '');
  assert.ok(payload.missingFields.includes('商品名称'));
});
