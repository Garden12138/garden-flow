import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { taobaoProductPageRuntime as runtime } from '../src/capture/taobaoProduct.js';
import { assertExpectedProductMatches, getProductCaptureAdapter, productPlatformFromUrl } from '../src/capture/productAdapters.js';

const tb = new URL('https://item.taobao.com/item.htm?id=10001&skuId=8801&spm=test');
const tm = new URL('https://detail.tmall.com/item.htm?id=10002');
const fixture = async (name) => parseHTML(await fs.readFile(new URL(`fixtures/product-pages/${name}.synthetic.html`, import.meta.url), 'utf8')).document;
const tbpcUrl = new URL('https://item.taobao.com/item.htm?id=910000000001&skuId=999999999999');
const tbpcFixture = async () => parseHTML(await fs.readFile(new URL('fixtures/product-pages/taobao-tbpc-2026-10-06.sanitized.html', import.meta.url), 'utf8')).document;
const savedOct9Fixture = async (platform) => parseHTML(await fs.readFile(new URL(`fixtures/product-pages/${platform}-tbpc-2026-10-09.sanitized.html`, import.meta.url), 'utf8')).document;
const fastTimers = (t, onTick = () => {}) => {
  const original = globalThis.setTimeout;
  let ticks = 0;
  globalThis.setTimeout = (callback, _ms, ...args) => original(() => { onTick(++ticks); callback(...args); }, 0);
  t.after(() => { globalThis.setTimeout = original; });
  return () => ticks;
};
const rows = (length, prefix = 'r') => Array.from({ length }, (_, index) => `<article data-review-id="${prefix}-${index}">
  <span data-role="review-author">买家${index}</span><span data-role="review-date">2026-10-01</span><span data-role="review-sku">黑色</span>
  <p data-role="review-text">${prefix} 正文${index}<span class="tm-rate-fulltxt">完整内容</span></p>
  <div data-role="merchant-reply">商家回复${index}</div><div data-role="review-images"><img src="//img.alicdn.com/review/${prefix}-${index}.jpg"><img src="https://evil.example/review.jpg"></div>
</article>`).join('');

const loadingTile = 'https://img.alicdn.com/imgextra/i2/O1CN01Dqo1gd1wMhnobvRco_!!6000000006294-2-tps-145-145.png';
const charityIcon = 'https://gw.alicdn.com/imgextra/i2/O1CN010DB1Un24kXOjdGhG3_!!6000000007429-0-tps-84-82.jpg';

// Real expanded-list DOM subsets, sanitized without adding interaction handlers.
for (const sample of [
  { platform: 'taobao', itemId: '910000000002', skuId: '610000000002', title: '脱敏迷你主机', variant: '已选规格1', price: '¥650', parameters: 31, rows: 16, appendIndex: 7, replies: [] },
  { platform: 'tmall', itemId: '910000000003', skuId: '610000000003', title: '脱敏便携显示器套装', variant: '已选规格1；已选规格2', price: '¥366.72', parameters: 11, rows: 20, appendIndex: 3, replies: [0, 2, 5, 6, 8, 19] },
]) {
  const url = new URL(`https://${sample.platform === 'taobao' ? 'item.taobao.com' : 'detail.tmall.com'}/item.htm?id=${sample.itemId}&skuId=999999999999`);
  test(`saved Oct 9 ${sample.platform} facts bind rendered selections rather than the URL SKU`, async () => {
    const inject = new Function(`return (${runtime.toString()})`)();
    const document = await savedOct9Fixture(sample.platform);
    const product = await inject('product', {}, document, url);
    assert.equal(product.platform, sample.platform); assert.equal(product.title, sample.title);
    assert.equal(product.externalId, sample.itemId); assert.equal(product.selectedSku.externalId, sample.skuId);
    assert.equal(product.selectedSku.variantText, sample.variant); assert.equal(product.price.text, sample.price);
    assert.equal(product.parameters.length, sample.parameters); assert.equal(product.images.length, 24);
    assert.deepEqual(product.missingFields, []);
    assert.ok(product.images.every((image) => image.sourceUrl.startsWith('https://img.alicdn.com/imgextra/fixture/')));
    document.querySelector('#skuOptionsArea [class*="--isSelected"], #skuOptionsArea [class*="isSelected--"]').className = 'valueItem--sanitized';
    const unselected = await inject('product', {}, document, url);
    assert.equal(unselected.selectedSku?.externalId, undefined);
    assert.ok(unselected.missingFields.includes('完整规格'));
  });

  test(`saved Oct 9 ${sample.platform} expanded rows preserve buyer sections and corresponding merchant replies`, async (t) => {
    fastTimers(t);
    const document = await savedOct9Fixture(sample.platform);
    const preview = await runtime('preview', {}, document, url);
    assert.equal(preview.readableReviewCount, sample.rows); assert.equal(preview.status, 'ready');
    assert.ok(preview.availableFilters.some((filter) => filter.label === '追评'));
    const defaults = await runtime('reviews', { maxScrollRounds: 1 }, document, url);
    assert.equal(defaults.reviews.length, 5);
    const full = await runtime('reviews', { limitPerFilter: 50, maxScrollRounds: 1 }, document, url);
    assert.equal(full.reviews.length, sample.rows);
    for (const [index, review] of full.reviews.entries()) {
      assert.equal(review.authorName, `脱敏买家${index + 1}`);
      assert.equal(review.dateText, '2026年10月1日'); assert.equal(review.skuText, `脱敏评论规格${index + 1}`);
      assert.equal(review.text, `脱敏买家正文${index + 1}第1段。${index === sample.appendIndex ? `\n追评：1天后追评：脱敏买家正文${index + 1}第2段。` : ''}`);
      assert.equal(review.merchantReply, sample.replies.includes(index) ? `商家回复：脱敏商家回复${index + 1}。` : undefined);
      // Chrome rewrites photos to saved_files; those paths are never remote sources.
      assert.deepEqual(review.imageSourceUrls, []);
    }
    assert.equal(full.status, 'partial');
    assert.ok(full.results.every((result) => result.requested === 50 && result.captured === sample.rows));
  });
}

// Oct 8 multicategory captures: local catalog proves failures, while these
// controlled DOM variations exercise fixes without claiming live-page coverage.
test('already active CSS-module review tags read existing rows without a redundant click', async (t) => {
  fastTimers(t);
  for (const attributes of ['class="imprItem--fixture isActive--rYriMk4s"', 'class="tag--fixture isSelected--hash"', 'class="selected"', 'aria-selected="true"', 'data-state="active"']) {
    const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="all" ${attributes}>全部</button>${rows(5)}</div></body></html>`);
    let clicks = 0; document.querySelector('button').addEventListener('click', () => { clicks += 1; });
    const result = await runtime('reviews', { selectedFilterIds: ['all'] }, document, tm);
    assert.equal(result.status, 'complete'); assert.equal(result.results[0].captured, 5); assert.equal(clicks, 0);
  }
});

test('selected styling or late image hydration cannot certify a switch to another review tag', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="photos" class="imprItem--fixture">图/视频</button>${rows(5)}</div></body></html>`);
  document.querySelector('button').addEventListener('click', (event) => event.currentTarget.classList.add('isActive--fixture'));
  fastTimers(t, (tick) => { if (tick === 1) document.querySelector('img').src = 'https://img.alicdn.com/late-image.jpg'; });
  const result = await runtime('reviews', { selectedFilterIds: ['photos'] }, document, tm);
  assert.equal(result.reviews.length, 0); assert.match(result.results[0].warning, /未更新/);
});

test('a replaced list with shared identical reviews is valid evidence of tag loading', async (t) => {
  fastTimers(t);
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="photos">图/视频</button><div data-role="review-scroll">${rows(5)}</div></div></body></html>`);
  document.querySelector('button').addEventListener('click', () => { document.querySelector('[data-role="review-scroll"]').innerHTML = rows(5); });
  const result = await runtime('reviews', { selectedFilterIds: ['photos'] }, document, tm);
  assert.equal(result.status, 'complete'); assert.equal(result.reviews.length, 5);
});

test('repeat capture waits for an already open loading review dialog instead of toggling the inline entry', async (t) => {
  const document = await tbpcFixture(); let clicks = 0;
  document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => { clicks += 1; });
  const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<div data-role="review-scroll" aria-busy="true"></div>'; document.body.append(dialog);
  const ticks = fastTimers(t, (tick) => {
    if (tick === 3) { dialog.firstElementChild.innerHTML = rows(5, 'repeat'); dialog.firstElementChild.removeAttribute('aria-busy'); }
  });
  const preview = await runtime('preview', {}, document, tbpcUrl);
  assert.equal(preview.status, 'ready'); assert.equal(ticks(), 3);
  const result = await runtime('reviews', {}, document, tbpcUrl);
  assert.equal(clicks, 0); assert.equal(result.status, 'complete'); assert.equal(result.reviews[0].id, 'repeat-0');
});

test('an idle all-review entry gets one bounded retry and a later capture reuses the opened dialog', async (t) => {
  const ticks = fastTimers(t); const document = await tbpcFixture(); let clicks = 0; let reveals = 0;
  const entry = document.querySelector('[class*="ShowButton--"]'); entry.scrollIntoView = () => { reveals += 1; };
  entry.addEventListener('click', () => {
    clicks += 1;
    if (clicks === 2) document.body.insertAdjacentHTML('beforeend', `<section role="dialog">${rows(5, 'retry')}</section>`);
  });
  const preview = await runtime('preview', {}, document, tbpcUrl);
  assert.equal(preview.status, 'ready'); assert.equal(clicks, 2); assert.equal(reveals, 2); assert.ok(ticks() <= 24);
  const saved = await runtime('reviews', {}, document, tbpcUrl);
  assert.equal(saved.status, 'complete'); assert.equal(saved.reviews[0].id, 'retry-0'); assert.equal(clicks, 2);
});

test('retrying all-review opening stops on gates or navigation, retaining readable inline comments', async (t) => {
  let tickAction; fastTimers(t, (tick) => tickAction?.(tick));
  for (const changedPage of [false, true]) {
    const document = await tbpcFixture(); const location = new URL(tbpcUrl); let clicks = 0;
    document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => { clicks += 1; });
    tickAction = () => { if (changedPage) location.searchParams.set('id', '999'); else document.body.insertAdjacentHTML('beforeend', '<p>安全验证</p>'); };
    const result = await runtime('reviews', {}, document, location);
    assert.equal(clicks, 1); assert.equal(result.reviews.length, 2); assert.equal(result.accessErrorCode, changedPage ? 'CONTENT_NOT_ACCESSIBLE' : 'BROWSER_SECURITY_CHALLENGE');
  }
});

test('a busy active tag waits for fresh rows and ignores rows shown underneath its loading state', async (t) => {
  const { document } = parseHTML(`<html><body><section role="dialog"><button data-review-filter="all" class="isActive--fixture">全部</button><div data-role="review-scroll" aria-busy="true">${rows(5, 'stale')}</div></section></body></html>`);
  const ticks = fastTimers(t, (tick) => { if (tick === 2) { const list = document.querySelector('[data-role="review-scroll"]'); list.innerHTML = rows(5, 'fresh'); list.removeAttribute('aria-busy'); } });
  const result = await runtime('reviews', { selectedFilterIds: ['all'] }, document, tm);
  assert.equal(ticks(), 2); assert.equal(result.status, 'complete'); assert.equal(result.reviews[0].id, 'fresh-0');
});

test('missing filter diagnostics use keyed labels and legacy hashed IDs, never array positions', async (t) => {
  fastTimers(t);
  const document = await fixture('taobao'); document.querySelector('[data-role="review-scroll"]').innerHTML = rows(1);
  const keyed = await runtime('reviews', { selectedFilterIds: ['photos', 'all'], selectedFilterLabels: ['全部', '图/视频'], filterLabels: { all: '全部', photos: '图/视频' } }, document, tb);
  assert.deepEqual(keyed.results.map((result) => [result.filterId, result.label]), [['photos', '图/视频'], ['all', '全部']]);
  const legacy = await runtime('reviews', { selectedFilterIds: ['tag-e139dfaf', 'tag-5e6558ad'], selectedFilterLabels: ['全部', '图/视频'] }, document, tb);
  assert.deepEqual(legacy.results.map((result) => result.label), ['图/视频', '全部']);
});

test('sidepanel save binds filter names and independent quotas to checkbox order by ID', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await fs.readFile(new URL('../src/sidepanel.js', import.meta.url), 'utf8'); const context = {};
  runInNewContext(source.slice(source.indexOf('function productReviewOptionsForSave('), source.indexOf('async function runCaptureAction(')), context);
  const result = context.productReviewOptionsForSave({ selectedFilterIds: ['photos', 'all'], filterLimits: { photos: 2, all: 5 }, limitPerFilter: 5, captureAll: false }, [{ id: 'all', label: '全部' }, { id: 'photos', label: '图/视频' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { selectedFilterIds: ['photos', 'all'], selectedFilterLabels: ['图/视频', '全部'], filterLabels: { photos: '图/视频', all: '全部' }, filterLimits: { photos: 2, all: 5 }, limitPerFilter: 5, captureAll: false });
});

test('malformed SKU title falls back to the same rendered selection, keeping valid emoji intact', async () => {
  const document = await tbpcFixture(); const label = document.querySelector('[class*="isSelected--"] [class*="valueItemText--"]');
  label.setAttribute('title', '升��级加厚'); label.textContent = '升级加厚✅️';
  const product = await runtime('product', {}, document, tbpcUrl);
  assert.equal(product.selectedSku.variantText, '升级加厚✅️；2XL 建议120斤-150斤'); assert.equal(product.selectedSku.externalId, '610000000001');
  assert.ok(!product.missingFields.some((field) => field.includes('文字异常')));
});

test('an unreadable selected SKU can recover only from its matching product and selected property IDs', async () => {
  const document = await tbpcFixture(); const label = document.querySelector('[class*="isSelected--"] [class*="valueItemText--"]');
  label.setAttribute('title', '坏��字'); label.textContent = '坏��字';
  const product = await runtime('product', {}, document, tbpcUrl);
  assert.equal(product.selectedSku.variantText, '黑色【优质面料】；2XL 建议120斤-150斤');
  const wrongProduct = await runtime('product', {}, document, new URL('https://item.taobao.com/item.htm?id=999'));
  assert.equal(wrongProduct.selectedSku.variantText, '2XL 建议120斤-150斤'); assert.equal(wrongProduct.selectedSku.externalId, undefined);
  assert.ok(wrongProduct.missingFields.includes('当前规格文字异常，请核对原页面'));
});

test('unrecoverable or ambiguous SKU text is marked missing instead of guessed or silently stripped', async () => {
  const document = await tbpcFixture(); const label = document.querySelector('[class*="isSelected--"] [class*="valueItemText--"]');
  label.setAttribute('title', '动��磁'); label.textContent = '动��磁';
  document.querySelector('script').textContent = document.querySelector('script').textContent.replace('"name":"黑色【优质面料】"', '"name":"坏��字"');
  const product = await runtime('product', {}, document, tbpcUrl);
  assert.ok(product.missingFields.includes('当前规格文字异常，请核对原页面')); assert.ok(!product.selectedSku.name.includes('�'));
  // Matching another unselected value or concatenating the surviving characters is forbidden.
  assert.equal(product.selectedSku.name, '2XL 建议120斤-150斤');
});

// Synthetic DOM cases reproduce the locally verified Oct 8 capture defects.
test('detail extraction excludes platform modules while retaining real small banners and empty descriptions', async () => {
  const document = await fixture('taobao');
  const detail = document.querySelector('#J_DivItemDesc');
  detail.innerHTML = `<div class="descV8-charity">公益宝贝 每笔成交捐赠<img src="${charityIcon}"><img src="https://img.alicdn.com/new-charity.png"></div>
    <div class="descV8-quality">商品资质 机构认证<img src="https://img.alicdn.com/quality.png"></div>
    <div class="descV8-recShop">店铺推荐<img src="https://img.alicdn.com/recommend.png"></div>
    <div class="descV8-singleImage"><img width="505" height="42" data-src="https://img.alicdn.com/seller-banner.jpg" src="${loadingTile}"></div>
    <p>原装正品 激活店保</p>`;
  const payload = await runtime('product', {}, document, tb);
  assert.equal(payload.description, '原装正品 激活店保');
  assert.deepEqual(payload.images.filter((image) => image.role === 'detail').map((image) => image.sourceUrl), ['https://img.alicdn.com/seller-banner.jpg']);
  detail.querySelector('p').remove();
  assert.equal((await runtime('product', {}, document, tb)).description, '');
});

test('review metadata splits displayed date and purchased SKU and preserves all buyer sections and replies', async () => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><article data-review-id="r1">
    <div class="meta--test">2026年9月7日已购：【95新】MGEN2-8G+256G固态</div>
    <div class="contentWrapper--test"><div class="content--test" title="买家完整初评">截断初评</div></div>
    <div class="append--test"><div class="content--test">追加使用感受</div><div class="reply--test"><div class="content--test">商家追评回复</div></div></div>
    <div data-role="merchant-reply">商家初评回复</div>
  </article></div></body></html>`);
  const payload = await runtime('reviews', { limitPerFilter: 1 }, document, tb);
  assert.equal(payload.reviews[0].dateText, '2026年9月7日');
  assert.equal(payload.reviews[0].skuText, '【95新】MGEN2-8G+256G固态');
  assert.equal(payload.reviews[0].text, '买家完整初评\n追评：追加使用感受');
  assert.equal(payload.reviews[0].merchantReply, '商家追评回复\n商家初评回复');
  document.querySelector('article').insertAdjacentHTML('beforeend', '<span data-role="review-sku">独立规格字段</span>');
  assert.equal((await runtime('reviews', { limitPerFilter: 1 }, document, tb)).reviews[0].skuText, '独立规格字段');
});

test('review images wait after text quota and refresh deduplicated rows when lazy sources arrive', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews">${rows(2)}</div></body></html>`);
  const image = document.querySelector('[data-role="review-images"] img'); image.src = loadingTile;
  const ticks = fastTimers(t, (tick) => { if (tick === 2) image.setAttribute('data-ks-lazyload', 'https://img.alicdn.com/real-buyer.jpg'); });
  const payload = await runtime('reviews', { limitPerFilter: 1 }, document, tb);
  assert.equal(ticks(), 2); assert.equal(payload.status, 'complete'); assert.equal(payload.reviews.length, 1);
  assert.deepEqual(payload.reviews[0].imageSourceUrls, ['https://img.alicdn.com/real-buyer.jpg']);
});

test('permanent loading tiles are omitted with a bounded partial result; real 145px photos remain valid', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews">${rows(1)}</div></body></html>`);
  document.querySelector('[data-role="review-images"]').innerHTML = `<img src="${loadingTile}_200x200q90.jpg_.webp"><img width="145" height="145" src="https://img.alicdn.com/real-145.jpg">`;
  const ticks = fastTimers(t);
  const payload = await runtime('reviews', { limitPerFilter: 1 }, document, tb);
  assert.equal(ticks(), 16); assert.equal(payload.status, 'partial'); assert.equal(payload.results[0].captured, 1);
  assert.match(payload.warnings.join(' '), /占位图/);
  assert.deepEqual(payload.reviews[0].imageSourceUrls, ['https://img.alicdn.com/real-145.jpg']);
});

test('verification during thumbnail waiting stops immediately and retains already read text', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews">${rows(1)}</div></body></html>`);
  document.querySelector('[data-role="review-images"] img').src = loadingTile;
  const ticks = fastTimers(t, (tick) => { if (tick === 1) document.body.insertAdjacentHTML('afterbegin', '<p>安全验证</p>'); });
  const payload = await runtime('reviews', { limitPerFilter: 1 }, document, tb);
  assert.equal(ticks(), 1); assert.equal(payload.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE');
  assert.equal(payload.reviews.length, 1); assert.equal(payload.reviews[0].imageSourceUrls.length, 0);
  assert.equal(payload.status, 'partial');
});

test('virtualized rows retain missing-image warnings after scrolling and share one image-wait budget per tag', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><div data-role="review-scroll">${rows(1)}</div></div></body></html>`);
  document.querySelector('[data-role="review-images"] img').src = loadingTile;
  const scroll = document.querySelector('[data-role="review-scroll"]');
  scroll.scrollBy = () => { scroll.innerHTML = rows(1, 'next'); };
  const ticks = fastTimers(t);
  const payload = await runtime('reviews', { limitPerFilter: 2 }, document, tb);
  assert.equal(ticks(), 17); assert.equal(payload.reviews.length, 2); assert.equal(payload.status, 'partial');
  assert.equal(payload.results[0].captured, 2); assert.match(payload.warnings.join(' '), /占位图/);
});

test('text quota does not skip offscreen lazy photos: each selected thumbnail is revealed and scroll positions restore', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><div data-role="review-scroll">${rows(6)}</div></div></body></html>`);
  const list = document.querySelector('[data-role="review-scroll"]'); list.scrollTop = 35; list.scrollLeft = 8;
  const revealed = []; let loading;
  for (const [index, row] of [...document.querySelectorAll('article')].entries()) {
    const image = row.querySelector('img'); image.src = loadingTile;
    image.scrollIntoView = (options) => {
      assert.equal(options.block, 'center'); assert.equal(options.inline, 'center');
      revealed.push(index); list.scrollTop = 500 * index; list.scrollLeft = 90;
      loading = () => image.setAttribute('src', `https://img.alicdn.com/buyer-${index}.jpg`);
    };
  }
  fastTimers(t, () => { loading?.(); loading = undefined; });
  const result = await runtime('reviews', {}, document, tb);
  assert.equal(result.status, 'complete'); assert.equal(result.reviews.length, 5);
  assert.deepEqual(revealed, [0, 1, 2, 3, 4]);
  assert.deepEqual(result.reviews.map((review) => review.imageSourceUrls), Array.from({length: 5}, (_, i) => [`https://img.alicdn.com/buyer-${i}.jpg`]));
  assert.equal(list.scrollTop, 35); assert.equal(list.scrollLeft, 8);
});

test('every thumbnail in a horizontal strip is loaded and a second reveal can recover a slow image', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews">${rows(1)}</div></body></html>`);
  const strip = document.querySelector('[data-role="review-images"]'); strip.scrollLeft = 17;
  strip.innerHTML = Array.from({length: 3}, () => `<img loading="lazy" src="${loadingTile}">`).join('');
  const attempts = [0, 0, 0]; let loading;
  [...strip.querySelectorAll('img')].forEach((image, index) => {
    image.scrollIntoView = () => {
      attempts[index]++; strip.scrollLeft = index * 200;
      if (index !== 0 || attempts[index] === 2) loading = () => image.setAttribute('src', `https://img.alicdn.com/strip-${index}.jpg`);
    };
  });
  const ticks = fastTimers(t, () => { loading?.(); loading = undefined; });
  const result = await runtime('reviews', {limitPerFilter: 1}, document, tb);
  assert.equal(result.status, 'complete'); assert.deepEqual(attempts, [2, 1, 1]); assert.equal(ticks(), 11);
  assert.deepEqual(new Set(result.reviews[0].imageSourceUrls), new Set([0,1,2].map(i => `https://img.alicdn.com/strip-${i}.jpg`)));
  assert.equal(strip.scrollLeft, 17);
});

test('lazy picture/srcset sources are read without guessing or accepting unsafe image hosts', async () => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews">${rows(1)}</div></body></html>`);
  document.querySelector('[data-role="review-images"]').innerHTML = `<picture><source srcset="https://evil.example/a.jpg 1x, https://img.alicdn.com/picture.jpg 2x"><img src="${loadingTile}"></picture><img src="${loadingTile}" data-srcset="https://img.alicdn.com/lazy.jpg 300w">`;
  const result = await runtime('reviews', {limitPerFilter: 1}, document, tb);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.reviews[0].imageSourceUrls, ['https://img.alicdn.com/picture.jpg', 'https://img.alicdn.com/lazy.jpg']);
});

test('shared media resolved on a later tag clears stale warnings without losing a missing earlier slot', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="photos">图片</button><div data-role="review-scroll">${rows(1)}</div></div></body></html>`);
  const image = document.querySelector('[data-role="review-images"] img'); image.src = loadingTile;
  document.querySelector('button').addEventListener('click', () => {
    // Switching renders the shared row again; image hydration alone is not evidence of a new tag.
    const list = document.querySelector('[data-role="review-scroll"]'); list.innerHTML = rows(1);
    list.querySelector('img').src = 'https://img.alicdn.com/later-tag.jpg';
  });
  fastTimers(t);
  const result = await runtime('reviews', {selectedFilterIds: ['current', 'photos'], limitPerFilter: 1}, document, tb);
  assert.equal(result.status, 'complete'); assert.deepEqual(result.warnings, []);
  assert.ok(result.results.every(item => item.status === 'complete'));
  assert.deepEqual(result.reviews[0].matchedFilterIds, ['current', 'photos']);
  assert.deepEqual(result.reviews[0].imageSourceUrls, ['https://img.alicdn.com/later-tag.jpg']);
});

test('recycled rows cannot pair another buyer photo with the row that was scrolled into view', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><div data-role="review-scroll">${rows(1)}</div></div></body></html>`);
  const list = document.querySelector('[data-role="review-scroll"]'); const image = list.querySelector('img'); image.src = loadingTile;
  image.scrollIntoView = () => { list.innerHTML = rows(1, 'other-buyer'); };
  fastTimers(t);
  const result = await runtime('reviews', {limitPerFilter: 1}, document, tb);
  assert.equal(result.reviews.length, 1); assert.equal(result.reviews[0].id, 'r-0');
  assert.deepEqual(result.reviews[0].imageSourceUrls, []); assert.equal(result.status, 'partial');
});

test('a gate or navigation caused by revealing a photo stops before any further wait or scroll', async (t) => {
  const ticks = fastTimers(t);
  for (const restriction of ['login', 'captcha', 'rate', 'navigation']) {
    const { document } = parseHTML(`<html><body><div data-role="product-reviews">${rows(2)}</div></body></html>`);
    const location = new URL(tb.href); let reveals = 0;
    for (const image of document.querySelectorAll('[data-role="review-images"] img')) {
      image.src = loadingTile;
      image.scrollIntoView = () => {
        reveals++;
        if (restriction === 'navigation') location.searchParams.set('id','99999');
        else document.body.insertAdjacentHTML('afterbegin', `<p>${{login:'请先登录',captcha:'安全验证',rate:'访问频繁'}[restriction]}</p>`);
      };
    }
    const before = ticks(); const result = await runtime('reviews', {limitPerFilter: 2}, document, location);
    assert.equal(reveals, 1); assert.equal(ticks(), before); assert.equal(result.status, 'partial');
    assert.ok(result.accessErrorCode); assert.equal(result.reviews.length, 2);
  }
});

test('many permanent placeholders have bounded per-tag and overall image waits', async (t) => {
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="a">标签A</button><button data-review-filter="b">标签B</button><div data-role="review-scroll">${rows(5)}</div></div></body></html>`);
  const list = document.querySelector('[data-role="review-scroll"]');
  const pendingRows = () => list.querySelectorAll('img').forEach(image => image.src = loadingTile); pendingRows();
  for (const button of document.querySelectorAll('button')) button.addEventListener('click', () => {list.innerHTML = rows(5, button.getAttribute('data-review-filter')); pendingRows();});
  const ticks = fastTimers(t);
  const result = await runtime('reviews', {selectedFilterIds: ['current','a','b']}, document, tb);
  assert.equal(result.reviews.length, 15); assert.equal(result.status, 'partial');
  assert.equal(ticks(), 122); // 120 media ticks plus two tag-change waits.
  assert.ok(result.reviews.every(review => review.imageSourceUrls.length === 0));
});

test('recognizes separate desktop platforms and preserves the JD adapter', () => {
  assert.equal(productPlatformFromUrl(tb.href), 'taobao'); assert.equal(productPlatformFromUrl(tm.href), 'tmall');
  assert.equal(getProductCaptureAdapter('https://item.jd.com/10001.html').platform, 'jd');
  for (const url of ['https://evil.example/item.htm?id=1', 'https://item.taobao.com.evil.com/item.htm?id=1', 'https://item.taobao.com/item.htm?id=x', 'ftp://detail.tmall.com/item.htm?id=1']) assert.equal(productPlatformFromUrl(url), '');
});

test('extracts only selected Taobao SKU and visible price, with scoped images', async () => {
  const payload = await runtime('product', {}, await fixture('taobao'), tb);
  assert.equal(payload.platform, 'taobao'); assert.equal(payload.externalId, '10001');
  assert.equal(payload.sourceUrl, 'https://item.taobao.com/item.htm?id=10001');
  assert.deepEqual(payload.selectedSku, { externalId: '8801', name: '曜石黑；500ml', variantText: '曜石黑；500ml' });
  assert.equal(payload.price.text, '¥99.00'); assert.equal(payload.brandName, '测试品牌');
  assert.deepEqual(payload.images.map((image) => image.role), ['primary', 'detail']);
});

test('Tmall identity-bound metadata and ranges do not invent a SKU price', async () => {
  const document = await fixture('tmall');
  const payload = await runtime('product', {}, document, tm);
  assert.equal(payload.title, '测试 M2 耳机'); assert.equal(payload.platform, 'tmall');
  assert.equal(payload.selectedSku.variantText, '白色'); assert.equal(payload.price.text, '¥199–299');
  document.querySelector('[class*="Price--"]').remove(); document.querySelector('[class*="SkuContent--"]').remove();
  const missing = await runtime('product', {}, document, tm);
  assert.equal(missing.price, undefined); assert.equal(missing.selectedSku, undefined);
  assert.ok(missing.missingFields.includes('当前规格')); assert.ok(missing.missingFields.includes('当前价格'));
});

test('the sanitized saved TBPC page yields selected SKU, current price, 26 parameters and 13 unique images', async () => {
  const inject = new Function(`return (${runtime.toString()})`)();
  const payload = await inject('product', {}, await tbpcFixture(), tbpcUrl);
  assert.equal(payload.title, '测试大码女装工装裤'); assert.equal(payload.shopName, '测试服装店'); assert.equal(payload.brandName, '测试品牌');
  assert.equal(payload.externalId, '910000000001'); assert.equal(payload.selectedSku.externalId, '610000000001');
  assert.equal(payload.selectedSku.variantText, '黑色【优质面料】；2XL 建议120斤-150斤');
  assert.deepEqual(payload.price, { text: '¥95', currency: 'CNY', label: '平台加补后' });
  assert.equal(payload.parameters.length, 26);
  assert.deepEqual(payload.parameters.find((entry) => entry.key === '裤型'), { key: '裤型', value: '直筒裤' });
  assert.deepEqual(payload.parameters.find((entry) => entry.key === '材质成分'), { key: '材质成分', value: '聚酯纤维100%' });
  assert.equal(payload.images.length, 13); assert.equal(payload.images.filter((image) => image.role === 'detail').length, 8);
  assert.ok(payload.images.every((image) => image.sourceUrl.startsWith('https://img.alicdn.com/')));
  assert.deepEqual(payload.missingFields, []);
});

test('TBPC gallery DOM works without page state and deduplicates original, thumbnail and main-image sizes', async () => {
  const document = await tbpcFixture(); document.querySelector('script').remove();
  for (const image of document.querySelectorAll('#picGalleryEle img')) image.setAttribute('src', image.getAttribute('src').replace('./saved_files/', 'https://img.alicdn.com/imgextra/fixture/'));
  const payload = await runtime('product', {}, document, tbpcUrl);
  assert.equal(payload.images.length, 13); assert.equal(payload.images.filter((image) => image.role !== 'detail').length, 5);
  assert.equal(payload.selectedSku.externalId, undefined); assert.match(payload.selectedSku.variantText, /2XL/);
});

test('TBPC SKU ids follow every DOM selection and never the URL or an unselected default', async () => {
  const document = await tbpcFixture();
  const size = document.querySelectorAll('#skuOptionsArea [class*="skuItem--"]')[1];
  const values = [...size.querySelectorAll('[data-vid]')];
  const selectedClass = [...values[0].classList].find((value) => value.startsWith('isSelected--'));
  values[0].classList.remove(selectedClass); values[1].classList.add(selectedClass);
  const changed = await runtime('product', {}, document, tbpcUrl);
  assert.equal(changed.selectedSku.externalId, '610000000002'); assert.match(changed.selectedSku.variantText, /3XL/);
  values[1].classList.remove(selectedClass);
  const partial = await runtime('product', {}, document, tbpcUrl);
  assert.equal(partial.selectedSku.externalId, undefined); assert.equal(partial.selectedSku.variantText, '黑色【优质面料】');
  assert.ok(partial.missingFields.includes('完整规格'));
  values[1].classList.add(selectedClass); values[1].setAttribute('data-disabled', 'true');
  assert.equal((await runtime('product', {}, document, tbpcUrl)).selectedSku.externalId, undefined);
});

test('TBPC price excludes coupon amounts, pre-discount prices, hidden sticky copies and structured offers', async () => {
  const document = await tbpcFixture(); const panel = document.querySelector('#tbpcDetail_SkuPanelBody');
  const original = panel.querySelector('[class*="highlightPrice--"]');
  const hidden = original.cloneNode(true); hidden.setAttribute('style', 'display:none'); hidden.querySelector('[class*="text--"]').textContent = '1'; panel.prepend(hidden);
  const coupon = document.createElement('div'); coupon.className = 'CouponItem--test'; coupon.textContent = '¥3 首单礼金'; panel.prepend(coupon);
  const metadata = document.createElement('script'); metadata.type = 'application/ld+json'; metadata.textContent = JSON.stringify({ '@type': 'Product', productID: '910000000001', offers: { price: '106' } }); document.body.append(metadata);
  assert.equal((await runtime('product', {}, document, tbpcUrl)).price.text, '¥95');
  original.remove();
  assert.equal((await runtime('product', {}, document, tbpcUrl)).price, undefined);
});

test('TBPC state is identity bound, is never executed, and cannot introduce untrusted image hosts', async () => {
  const document = await tbpcFixture(); const script = document.querySelector('script');
  const saved = script.textContent;
  script.textContent = saved.replace('"itemId":"910000000001"', '"itemId":"999999999999"');
  let payload = await runtime('product', {}, document, tbpcUrl);
  assert.equal(payload.selectedSku.externalId, undefined); assert.ok(payload.images.every((image) => image.role === 'detail'));
  script.textContent = saved.replaceAll('https://img.alicdn.com/imgextra/fixture/gallery-', 'https://evil.example/gallery-');
  payload = await runtime('product', {}, document, tbpcUrl);
  assert.ok(payload.images.every((image) => image.role === 'detail' && !image.sourceUrl.includes('evil.example')));
  script.textContent = saved.replace('var b = {', 'var b = (globalThis.fixtureExecuted = true, {');
  await runtime('product', {}, document, tbpcUrl);
  assert.equal(globalThis.fixtureExecuted, undefined);
});

test('live ICE state is supported and conflicting live identity cannot fall back to stale inline data', async () => {
  const document = await tbpcFixture(); const script = document.querySelector('script');
  const state = JSON.parse(script.textContent.match(/var b\s*=\s*(\{[\s\S]*\});for\s*\(var k in a\)/)[1]);
  const view = document.defaultView; const previous = view.__ICE_APP_CONTEXT__;
  try {
    view.__ICE_APP_CONTEXT__ = state; script.remove();
    const current = await runtime('product', {}, document, tbpcUrl);
    assert.equal(current.images.length, 13); assert.equal(current.selectedSku.externalId, '610000000001');
    document.body.append(script); state.loaderData.home.data.res.item.itemId = '999999999999';
    const conflicting = await runtime('product', {}, document, tbpcUrl);
    assert.equal(conflicting.selectedSku.externalId, undefined); assert.ok(conflicting.images.every((image) => image.role === 'detail'));
  } finally {
    if (previous === undefined) delete view.__ICE_APP_CONTEXT__; else view.__ICE_APP_CONTEXT__ = previous;
  }
});

test('TBPC visible reviews expose actual topic labels, full body text and honest two-of-five sampling', async (t) => {
  fastTimers(t); const document = await tbpcFixture();
  const content = document.querySelector('[class*="Comment--"] [class*="content--"]');
  const full = '完整买家正文。'.repeat(2000); content.textContent = '折叠展示…'; content.setAttribute('title', full);
  // Synthetic extension of the saved rows verifies pairing; the saved page had no replies/images.
  const row = content.closest('[class*="Comment--"]'); row.insertAdjacentHTML('beforeend', '<div data-role="merchant-reply">对应商家回复</div><div data-role="review-images"><img src="https://img.alicdn.com/review/fixture.jpg"></div>');
  const preview = await runtime('preview', {}, document, tbpcUrl);
  assert.equal(preview.readableReviewCount, 2);
  assert.deepEqual(preview.availableFilters.slice(1).map((entry) => [entry.label, entry.countText]), [['外观好看', '4'], ['质量好', '1'], ['推荐度高', '1'], ['裤子合适', '1']]);
  const captured = await runtime('reviews', {}, document, tbpcUrl);
  assert.equal(captured.status, 'partial'); assert.equal(captured.reviews.length, 2); assert.equal(captured.results[0].requested, 5);
  assert.equal(captured.reviews[0].text, full); assert.equal(captured.reviews[0].merchantReply, '对应商家回复'); assert.equal(captured.reviews[0].imageSourceUrls.length, 1);
  assert.ok(captured.reviews.every((entry) => entry.sentiment === undefined));
});

test('TBPC topic selection reads a newly opened review dialog rather than stale inline rows', async (t) => {
  fastTimers(t); const document = await tbpcFixture();
  const tag = document.querySelector('[class*="imprItem--"]');
  const preview = await runtime('preview', {}, document, tbpcUrl); const filter = preview.availableFilters.find((entry) => entry.label === '外观好看');
  tag.addEventListener('click', () => {
    const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
    const row = document.querySelector('[class*="Comment--"]').cloneNode(true);
    row.querySelector('[class*="content--"]').setAttribute('title', '主题标签下的新评论'); dialog.append(row); document.body.append(dialog);
  });
  const captured = await runtime('reviews', { selectedFilterIds: [filter.id], filterLimits: { [filter.id]: 1 } }, document, tbpcUrl);
  assert.equal(captured.status, 'complete'); assert.equal(captured.reviews.length, 1);
  assert.equal(captured.reviews[0].text, '主题标签下的新评论'); assert.deepEqual(captured.reviews[0].matchedFilterIds, [filter.id]);
});

test('the shared automatic save pipeline retains TBPC facts, image sources and partial comments', async (t) => {
  fastTimers(t); const harness = await automaticCaptureHarness(await tbpcFixture(), tbpcUrl);
  const result = await harness.run(); const saved = harness.ingested[0];
  assert.equal(result.success, true); assert.equal(result.capturedReviews, 2); assert.equal(result.reviewCaptureStatus, 'partial');
  assert.equal(saved.selectedSku.externalId, '610000000001'); assert.equal(saved.price.text, '¥95');
  assert.equal(saved.images.length, 13); assert.equal(saved.parameters.length, 26); assert.equal(saved.shopName, '测试服装店');
});

test('all-reviews opens despite two inline rows, waits for dialog text and is reused by automatic save', async (t) => {
  const document = await tbpcFixture(); let clicks = 0; let dialog;
  const ticks = fastTimers(t, (tick) => {
    if (tick === 2) {
      dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<div data-role="product-reviews"><div data-role="review-scroll">加载中</div></div>'; document.body.append(dialog);
    }
    if (tick === 4) dialog.querySelector('[data-role="review-scroll"]').innerHTML = rows(8, 'full-list');
  });
  document.querySelector('[class*="ShowButton--"]').addEventListener('click', (event) => { clicks += 1; event.currentTarget.hidden = true; });
  const injected = new Function(`return (${runtime.toString()})`)();
  const preview = await injected('preview', {}, document, tbpcUrl);
  assert.equal(clicks, 1); assert.equal(ticks(), 4); assert.equal(preview.status, 'ready'); assert.equal(preview.readableReviewCount, 8);
  const harness = await automaticCaptureHarness(document, tbpcUrl); const saved = await harness.run();
  assert.equal(clicks, 1); assert.equal(saved.capturedReviews, 5); assert.equal(saved.reviewCaptureStatus, 'complete');
  const captured = harness.ingested[0]; assert.equal(captured.images.length, 13);
  assert.deepEqual(captured.reviewCapture.reviews.map((review) => review.id), Array.from({ length: 5 }, (_, i) => `full-list-${i}`));
  assert.equal(captured.reviewCapture.reviews[0].merchantReply, '商家回复0'); assert.equal(captured.reviewCapture.reviews[0].imageSourceUrls.length, 1);
});

test('full-review dialog scrolls its overflow ancestor and refreshes a replaced list', async (t) => {
  fastTimers(t); const document = await tbpcFixture();
  const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = `<div class="overflow-fixture"><div>${rows(2, 'loaded')}</div></div>`;
  document.body.append(dialog); const scroller = dialog.firstElementChild;
  Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } });
  const view = document.defaultView; const originalComputedStyle = view.getComputedStyle;
  view.getComputedStyle = (node) => ({ overflowY: node === scroller ? 'auto' : 'visible' });
  t.after(() => { if (originalComputedStyle) view.getComputedStyle = originalComputedStyle; else delete view.getComputedStyle; });
  let scrolls = 0;
  scroller.addEventListener('scroll', () => {
    scrolls += 1; const replacement = dialog.cloneNode(false);
    replacement.innerHTML = `<div data-role="review-scroll">${rows(8, 'loaded')}</div>`; dialog.replaceWith(replacement);
  });
  const captured = await runtime('reviews', {}, document, tbpcUrl);
  assert.equal(scrolls, 1); assert.equal(captured.status, 'complete'); assert.equal(captured.reviews.length, 5);
  assert.deepEqual(captured.reviews.map((review) => review.id), Array.from({ length: 5 }, (_, i) => `loaded-${i}`));
});

test('opening all reviews exposes dialog tags and preserves per-tag quotas', async (t) => {
  fastTimers(t); const document = await tbpcFixture(); let clicks = 0;
  document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => {
    clicks += 1; const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<button data-review-filter="photo">有图</button><button data-review-filter="fit">尺码合适</button><div data-role="review-scroll">${rows(8, 'all')}</div>`;
    for (const tag of dialog.querySelectorAll('button')) tag.addEventListener('click', () => { dialog.querySelector('[data-role="review-scroll"]').innerHTML = rows(8, tag.getAttribute('data-review-filter')); });
    document.body.append(dialog);
  });
  const preview = await runtime('preview', {}, document, tbpcUrl);
  assert.deepEqual(preview.availableFilters.map((filter) => filter.label), ['当前评价列表', '有图', '尺码合适']);
  const captured = await runtime('reviews', { selectedFilterIds: ['photo', 'fit'], filterLimits: { photo: 3, fit: 1 } }, document, tbpcUrl);
  assert.equal(clicks, 1); assert.equal(captured.status, 'complete'); assert.deepEqual(captured.results.map((result) => result.captured), [3, 1]);
  assert.ok(captured.reviews.every((review) => review.sentiment === undefined));
});

test('an empty dialog during tag loading never falls back to the inline excerpt', async (t) => {
  const document = await tbpcFixture(); const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
  document.querySelector('[class*="ShowButton--"]').hidden = true;
  dialog.innerHTML = `<button data-review-filter="photo">有图</button><div data-role="review-scroll">${rows(5, 'all')}</div>`; document.body.append(dialog);
  const list = dialog.querySelector('[data-role="review-scroll"]'); let switched = false;
  const ticks = fastTimers(t, (tick) => { if (switched && tick === 2) list.innerHTML = rows(6, 'photo'); });
  dialog.querySelector('button').addEventListener('click', () => { switched = true; list.innerHTML = ''; });
  const captured = await runtime('reviews', { selectedFilterIds: ['photo'], filterLimits: { photo: 3 } }, document, tbpcUrl);
  assert.equal(ticks(), 2); assert.equal(captured.status, 'complete');
  assert.deepEqual(captured.reviews.map((review) => review.id), ['photo-0', 'photo-1', 'photo-2']);
});

test('an all-reviews loading timeout is bounded and never treats inline rows as the full list', async (t) => {
  const ticks = fastTimers(t); const document = await tbpcFixture(); let clicks = 0; let scrolls = 0;
  document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => {
    clicks += 1; const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<div data-role="product-reviews"><article data-review-id="skeleton"><p data-role="review-text"></p></article></div>'; document.body.append(dialog);
  });
  document.querySelector('[class*="comments--"]').addEventListener('scroll', () => { scrolls += 1; });
  const captured = await runtime('reviews', { limitPerFilter: 1 }, document, tbpcUrl);
  assert.equal(clicks, 1); assert.equal(ticks(), 24); assert.equal(scrolls, 0);
  assert.equal(captured.status, 'partial'); assert.equal(captured.results[0].status, 'partial'); assert.equal(captured.reviews.length, 1);
  assert.match(captured.warnings.join(' '), /查看全部评价.*未加载/);
});

test('all-reviews also supports a list expanded in place', async (t) => {
  fastTimers(t); const document = await tbpcFixture();
  document.querySelector('[class*="ShowButton--"]').addEventListener('click', (event) => {
    event.currentTarget.hidden = true; document.querySelector('[class*="comments--"]').innerHTML = rows(6, 'expanded');
  });
  const captured = await runtime('reviews', {}, document, tbpcUrl);
  assert.equal(captured.status, 'complete'); assert.equal(captured.reviews.length, 5); assert.equal(captured.reviews[0].id, 'expanded-0');
});

test('a gate while opening all reviews stops immediately and automatic save keeps the pre-click snapshot', async (t) => {
  let pendingGate; const ticks = fastTimers(t, () => pendingGate?.());
  for (const [message, code] of [['请先登录', 'BROWSER_LOGIN_REQUIRED'], ['安全验证', 'BROWSER_SECURITY_CHALLENGE'], ['访问频繁', 'BROWSER_RATE_LIMITED']]) {
    const document = await tbpcFixture(); let clicks = 0; let scrolls = 0;
    document.querySelector('[class*="comments--"]').addEventListener('scroll', () => { scrolls += 1; });
    document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => {
      clicks += 1; pendingGate = () => { document.querySelector('[class*="Comments--"]').remove(); document.body.appendChild(document.createTextNode(message)); pendingGate = null; };
    });
    const harness = await automaticCaptureHarness(document, tbpcUrl); const before = ticks();
    const saved = await harness.run({ reviewOptions: { filterLimits: { current: 1 } } });
    assert.equal(ticks() - before, 1); assert.equal(clicks, 1); assert.equal(scrolls, 0);
    assert.equal(saved.success, true); assert.equal(saved.reviewCaptureStatus, 'partial'); assert.equal(saved.reviewAccessErrorCode, code); assert.equal(saved.capturedReviews, 1);
    assert.equal(harness.ingested[0].images.length, 13); assert.equal(harness.ingested[0].reviewCapture.reviews[0].text, '脱敏后的第1条买家评论。');
  }
});

test('an opening gate never assigns inline reviews to a requested but unvisited tag', async (t) => {
  fastTimers(t); const document = await tbpcFixture();
  document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => document.body.appendChild(document.createTextNode('安全验证')));
  const captured = await runtime('reviews', { selectedFilterLabels: ['外观好看'] }, document, tbpcUrl);
  assert.equal(captured.status, 'partial'); assert.equal(captured.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE');
  assert.equal(captured.reviews.length, 0); assert.equal(captured.selectedFilters[0].label, '外观好看');
});

test('serialized MAIN function has no module dependencies', async () => {
  const inject = new Function(`return (${runtime.toString()})`)();
  assert.equal((await inject('product', {}, await fixture('taobao'), tb)).title, '测试品牌 A1 保温杯');
});

test('semantic product headings tolerate CSS renames and ignore hidden or navigation headings', async (t) => {
  fastTimers(t);
  const document = parseHTML('<html><head><title>商品详情</title></head><body><nav><h1>淘宝导航</h1></nav><aside><h1>为你推荐</h1></aside><h1 hidden>旧名称</h1><main><h1 class="new-title-hash">测试 A3 咖啡杯</h1></main></body></html>').document;
  const payload = await runtime('product', {}, document, tb);
  assert.equal(payload.title, '测试 A3 咖啡杯');
  document.querySelector('main').innerHTML = '<div role="heading" aria-level="1">测试 B4 电水壶</div>';
  assert.equal((await runtime('product', {}, document, tb)).title, '测试 B4 电水壶');
});

test('page metadata supplies a title without inferring SKU or price from supplied link tracking', async (t) => {
  fastTimers(t);
  const inject = new Function(`return (${runtime.toString()})`)();
  for (const [id, skuId, titleMarkup, expected] of [
    ['1081819184372', '6133449697312', '<meta property="og:title" content="合成 A5 商品 - 淘宝网"><title>商品详情</title>', '合成 A5 商品'],
    ['1086793596355', '6304020186842', '<title>合成 B6 商品-淘宝网</title>', '合成 B6 商品'],
  ]) {
    // User-supplied identities only; titles and markup remain synthetic, not live page evidence.
    const url = new URL(`https://item.taobao.com/item.htm?id=${id}&skuId=${skuId}`);
    url.searchParams.set('utparam', JSON.stringify({ item_price: '251.25' }));
    const document = parseHTML(`<html><head><link rel="canonical" href="https://item.taobao.com/item.htm?id=${id}">${titleMarkup}</head><body><div>合成商品页面</div></body></html>`).document;
    assert.equal(getProductCaptureAdapter(url.href).platform, 'taobao');
    const payload = await inject('product', {}, document, url);
    assert.equal(payload.externalId, id); assert.equal(payload.title, expected);
    assert.equal(payload.sourceUrl, `https://item.taobao.com/item.htm?id=${id}`);
    assert.equal(payload.selectedSku, undefined); assert.equal(payload.price, undefined);
    assert.ok(payload.missingFields.includes('当前规格')); assert.ok(payload.missingFields.includes('当前价格'));
  }
  const document = parseHTML('<html><head><meta property="og:url" content="https://detail.tmall.com/item.htm?id=10002"><title>合成 C7 商品 - 天猫tmall.com</title></head><body></body></html>').document;
  assert.equal((await runtime('product', {}, document, tm)).title, '合成 C7 商品');
});

test('hydration waits for rendered product facts instead of returning early metadata', async (t) => {
  const document = parseHTML('<html><head><title>初始商品名称 - 淘宝网</title></head><body><h1>商品详情</h1></body></html>').document;
  const ticks = fastTimers(t, (count) => {
    if (count === 2) document.body.innerHTML = '<h1>加载后的 D8 商品</h1><div data-role="product-price">¥29.90</div><div data-role="product-skus" data-sku-id="88"><span aria-checked="true">白色</span></div>';
  });
  const payload = await runtime('product', {}, document, tb);
  assert.equal(ticks(), 2); assert.equal(payload.title, '加载后的 D8 商品');
  assert.equal(payload.price.text, '¥29.90'); assert.equal(payload.selectedSku.externalId, '88');
});

test('a rendered title alone does not end the wait before price and product images arrive', async (t) => {
  const document = parseHTML('<html><body><h1>合成服装商品</h1></body></html>').document;
  const ticks = fastTimers(t, (count) => {
    if (count === 2) document.body.innerHTML += '<div data-role="product-price">¥89.00</div><div data-role="product-gallery"><img src="https://img.alicdn.com/item.jpg"></div>';
  });
  const payload = await runtime('product', {}, document, tb);
  assert.equal(ticks(), 2); assert.equal(payload.price.text, '¥89.00'); assert.equal(payload.images.length, 1);
});

test('an absent or empty review container does not advertise a readable current list', async (t) => {
  fastTimers(t);
  for (const content of ['', '<div id="J_Reviews"><div class="CommentItem--skeleton"></div></div>']) {
    const document = parseHTML(`<html><body>${content}</body></html>`).document;
    const preview = await runtime('preview', {}, document, tb);
    assert.equal(preview.readableReviewCount, 0);
    assert.equal(preview.availableFilters.some((filter) => filter.id === 'current'), false);
    assert.notEqual(preview.status, 'ready'); assert.ok(preview.warnings.length);
  }
  const document = await fixture('taobao');
  const preview = await runtime('preview', {}, document, tb);
  assert.ok(preview.availableFilters.some((filter) => filter.id === 'size'));
  assert.equal(preview.availableFilters.some((filter) => filter.id === 'current'), false);
  document.querySelector('[data-role="review-scroll"]').innerHTML = rows(2);
  const ready = await runtime('preview', {}, document, tb);
  assert.equal(ready.readableReviewCount, 2); assert.equal(ready.availableFilters[0].id, 'current');
  assert.equal(ready.status, 'ready');
});

test('an initially empty review list can still load during bounded saving', async (t) => {
  fastTimers(t);
  const document = await fixture('taobao');
  const list = document.querySelector('[data-role="review-scroll"]');
  list.addEventListener('scroll', () => { list.innerHTML = rows(5); });
  const result = await runtime('reviews', {}, document, tb);
  assert.equal(result.status, 'complete'); assert.equal(result.reviews.length, 5); assert.equal(result.readableReviewCount, 5);
});

test('the side panel warns about name-only captures and distinguishes missing reviews from successful preview', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await fs.readFile(new URL('../src/sidepanel.js', import.meta.url), 'utf8');
  const context = {
    jdProductPreview: null,
    normalizePlatform: (value) => value,
    inferPageType: (value) => value.pageType,
    getPlatformMeta: () => ({ name: '淘宝' }),
  };
  runInNewContext(source.slice(source.indexOf('function getCaptureActionConfig('), source.indexOf('async function refreshTaskQueue(')), context);
  const product = { platform: 'taobao', externalId: '918092052086', sourceUrl: tb.href, title: '截图中的服装商品', images: [], parameters: [], missingFields: ['当前规格', '当前价格', '商品参数', '商品图片', '商品详情'], reviewCapture: { modalDetected: true, readableReviewCount: 0, status: 'partial' } };
  const response = { mode: 'product-preview', product };
  const feedback = context.productPreviewFeedback(product);
  assert.equal(feedback.status, 'warning'); assert.match(feedback.message, /商品主体未识别/);
  assert.equal(context.summarizeActionResponse(response), feedback.message);
  context.jdProductPreview = product;
  const action = context.getCaptureActionConfig({ tab: { url: tb.href }, pageInfo: { platform: 'taobao', pageType: 'product' } }).actions[0];
  assert.equal(action.label, '仅保存已识别资料'); assert.equal(action.primary, false);
  const complete = { ...product, price: { text: '¥89.00' }, missingFields: [] };
  assert.equal(context.productPreviewFeedback(complete).status, 'warning');
  assert.match(context.productPreviewFeedback(complete).message, /评论列表/);
  complete.reviewCapture = { modalDetected: true, readableReviewCount: 2, status: 'ready' };
  assert.equal(context.productPreviewFeedback(complete).status, 'success');
  assert.equal(context.productPreviewFeedback({ ...complete, platform: 'jd', reviewCapture: { modalDetected: true, status: 'ready' } }).status, 'success');
});

test('generic shells and ambiguous headings time out without creating a product name', async (t) => {
  const ticks = fastTimers(t);
  for (const title of ['商品详情', '商品详情 - 淘宝网', '淘宝网 - 淘！我喜欢', '天猫tmall.com--上天猫，就够了', '淘宝登录']) {
    const document = parseHTML(`<html><head><title>${title}</title></head><body><h1>商品详情</h1><h1>候选甲</h1><h1>候选乙</h1></body></html>`).document;
    const before = ticks();
    const payload = await runtime('product', {}, document, tb);
    assert.equal(payload.externalId, '10001'); assert.equal(payload.title, '');
    assert.ok(payload.missingFields.includes('商品名称')); assert.equal(ticks() - before, 12);
  }
});

test('conflicting metadata cannot substitute another product for the current identity', async (t) => {
  fastTimers(t);
  for (const declaredUrl of ['https://item.taobao.com/item.htm?id=99999', 'https://evil.example/item.htm?id=10001']) {
    const document = parseHTML(`<html><head><link rel="canonical" href="${declaredUrl}"><meta property="og:title" content="另一商品"><title>另一商品 - 淘宝网</title></head><body></body></html>`).document;
    assert.equal((await runtime('product', {}, document, tb)).title, '');
  }
  for (const product of [
    { productID: '10001', url: 'https://item.taobao.com/item.htm?id=99999' },
    { productID: '99999', url: tb.href },
    { url: 'https://evil.example/item.htm?id=10001' },
  ]) {
    const document = parseHTML(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: '另一商品', ...product })}</script></head><body></body></html>`).document;
    assert.equal((await runtime('product', {}, document, tb)).title, '');
  }
});

test('hydration stops immediately for navigation or access restrictions', async (t) => {
  let onTick;
  const ticks = fastTimers(t, () => onTick());
  for (const [message, code] of [['请先登录', 'BROWSER_LOGIN_REQUIRED'], ['安全验证', 'BROWSER_SECURITY_CHALLENGE'], ['访问频繁', 'BROWSER_RATE_LIMITED'], ['', '']]) {
    const document = parseHTML('<html><head><title>可用但尚未渲染的商品名-淘宝网</title></head><body></body></html>').document;
    const url = new URL(tb);
    onTick = () => { if (message) document.body.textContent = message; else url.searchParams.set('id', '99999'); };
    const before = ticks();
    const result = await runtime('product', {}, document, url);
    assert.equal(ticks() - before, 1); assert.equal(result.title, undefined);
    if (code) assert.equal(result.accessErrorCode, code);
    else assert.equal(result.pageChanged, true);
  }
});

test('defaults to five current-list reviews with paired replies, images and no guessed sentiment', async (t) => {
  fastTimers(t); const document = await fixture('taobao'); document.querySelector('[data-role="review-scroll"]').innerHTML = rows(8);
  const result = await runtime('reviews', {}, document, tb);
  assert.equal(result.status, 'complete'); assert.equal(result.reviews.length, 5); assert.equal(result.selectedFilters[0].id, 'current');
  assert.equal(result.reviews[0].text, 'r 正文0完整内容'); assert.equal(result.reviews[0].merchantReply, '商家回复0');
  assert.equal(result.reviews[0].imageSourceUrls.length, 1); assert.equal(result.reviews[0].sentiment, undefined);
});

test('actual tags accept independent bounded quotas and shared reviews do not exceed a quota', async (t) => {
  fastTimers(t); const document = await fixture('taobao'); const list = document.querySelector('[data-role="review-scroll"]'); list.innerHTML = rows(8);
  const tag = document.querySelector('[data-review-filter="size"]'); tag.addEventListener('click', () => { list.innerHTML = rows(8).replaceAll('正文', '容量正文'); });
  const result = await runtime('reviews', { selectedFilterIds: ['current', 'size'], filterLimits: { current: 3, size: 1 } }, document, tb);
  assert.deepEqual(result.results.map((entry) => entry.captured), [3, 1]);
  assert.equal(result.reviews.filter((entry) => entry.matchedFilterIds.includes('size')).length, 1);
  assert.equal(result.availableFilters.find((entry) => entry.id === 'size').sentiment, undefined);
});

test('finite idle scrolling preserves partial results and missing tags', async (t) => {
  fastTimers(t); const document = await fixture('taobao'); const list = document.querySelector('[data-role="review-scroll"]'); list.innerHTML = rows(2);
  let scrolls = 0; list.addEventListener('scroll', () => { scrolls += 1; });
  const result = await runtime('reviews', { selectedFilterIds: ['current', 'absent'], limitPerFilter: 100 }, document, tb);
  assert.equal(result.reviews.length, 2); assert.equal(result.results[0].requested, 50); assert.equal(result.results[1].status, 'missing');
  assert.equal(result.status, 'partial'); assert.ok(scrolls <= 3); assert.ok(result.warnings.length);
});

test('login, captcha and rate limiting stop immediately; previously read rows survive', async (t) => {
  fastTimers(t);
  for (const [message, code] of [['请先登录', 'BROWSER_LOGIN_REQUIRED'], ['安全验证', 'BROWSER_SECURITY_CHALLENGE'], ['访问频繁', 'BROWSER_RATE_LIMITED']]) {
    const document = await fixture('taobao'); document.body.appendChild(document.createTextNode(message));
    assert.equal((await runtime('preview', {}, document, tb)).accessErrorCode, code);
  }
  const document = await fixture('taobao'); const list = document.querySelector('[data-role="review-scroll"]'); list.innerHTML = rows(2);
  const product = await runtime('product', {}, document, tb);
  list.addEventListener('scroll', () => { document.body.appendChild(document.createTextNode('安全验证')); });
  const result = await runtime('reviews', { limitPerFilter: 5 }, document, tb);
  assert.equal(result.reviews.length, 2); assert.equal(result.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE'); assert.ok(product.title);
});

test('tag selection alone cannot relabel a stale review list', async (t) => {
  fastTimers(t); const document = await fixture('taobao'); document.querySelector('[data-role="review-scroll"]').innerHTML = rows(2);
  document.querySelector('[data-review-filter="size"]').addEventListener('click', (event) => event.target.setAttribute('aria-selected', 'true'));
  const result = await runtime('reviews', { selectedFilterIds: ['size'] }, document, tb);
  assert.equal(result.reviews.length, 0); assert.equal(result.status, 'partial'); assert.match(result.results[0].warning, /未更新/);
});

test('background product save routes Taobao/Tmall to ingestProduct and retains partial reviews', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function previewJdProductFromTab(');
  const end = source.indexOf('\nasync function saveCurrentPageLinkFromTab', start);
  for (const [url, platform] of [[tb.href, 'taobao'], [tm.href, 'tmall']]) {
    let persisted;
    const context = {
      chrome: { tabs: { get: async () => ({ url }) } }, getProductCaptureAdapter, normalizeText: (value) => String(value || '').trim(),
      runExtraction: async (_id, _func, { args }) => args[0] === 'product' ? { platform, externalId: platform === 'taobao' ? '10001' : '10002', sourceUrl: url, title: '产品资料' }
        : args[0] === 'preview' ? { modalDetected: true, availableFilters: [] }
        : { status: 'partial', accessErrorCode: 'BROWSER_LOGIN_REQUIRED', reviews: [{ id: '1', text: '已读取正文' }], warnings: ['评论未完成'] },
      createBridgeOperationId: () => 'fixture-operation',
      requestNativeHost: async (method, { payload }) => { assert.equal(method, 'assets.ingestProduct'); persisted = payload; return { productId: 'saved', capturedReviews: 1 }; },
      captureAccessError: () => new Error('blocked'),
    };
    runInNewContext(source.slice(start, end), context);
    const result = await context.saveJdProductFromTab(1, { filterLimits: { current: 3 } });
    assert.equal(result.mode, 'product'); assert.equal(result.platform, platform);
    assert.equal(persisted.title, '产品资料'); assert.equal(persisted.reviewCapture.status, 'partial'); assert.equal(result.reviewWarnings[0], '评论未完成');
    assert.equal(result.reviewCaptureStatus, 'partial'); assert.equal(result.reviewAccessErrorCode, 'BROWSER_LOGIN_REQUIRED');
    assert.equal(persisted.reviewOptions.filterLimits.current, 3);
  }
});

async function automaticCaptureHarness(document, url) {
  const { runInNewContext } = await import('node:vm');
  const [source, control] = await Promise.all([
    fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/browserControlBackground.js', import.meta.url), 'utf8'),
  ]);
  const events = [];
  const closed = [];
  const ingested = [];
  const context = {
    URL, productPlatformFromUrl, getProductCaptureAdapter, assertExpectedProductMatches, location: url,
    chrome: { tabs: { get: async () => ({ id: 7, url: url.href }) } },
    normalizeText: (value) => String(value || '').trim(),
    pluginCaptureRuntime: {},
    activeBrowserSession: null,
    runExtraction: async (_id, _func, { args }) => await runtime(args[0], args[1] || {}, document, url),
    createBridgeOperationId: () => 'fixture-operation',
    requestNativeHost: async (method, { payload }) => {
      assert.equal(method, 'assets.ingestProduct');
      ingested.push(payload);
      return { productId: `saved-${payload.platform}`, snapshotId: 'snapshot', capturedReviews: payload.reviewCapture.reviews.length };
    },
    captureAccessError: (code) => Object.assign(new Error(code), { code }),
    requireActiveControlledTabLease: async (_session, tabId) => { assert.equal(tabId, 7); },
    publishCaptureActivity: (_tabId, status, message, details) => events.push({ status, message, ...details }),
    closeControlledTab: async (_session, { tabId }) => closed.push(tabId),
    describeErrorMessage: (error) => error.message,
  };
  const captureStart = source.indexOf('async function saveCurrentPageFromTab(');
  const captureEnd = source.indexOf('\nasync function saveCurrentPageLinkFromTab', captureStart);
  const bridgeStart = control.indexOf('export function configurePluginCapture(');
  const bridgeEnd = control.indexOf('\nfunction publishCaptureActivity(', bridgeStart);
  const actionStart = control.indexOf("      case 'capture.save':");
  const actionEnd = control.indexOf("      case 'research.run':", actionStart);
  const detectionStart = source.indexOf('function detectCaptureTarget()');
  const detectionEnd = source.indexOf("\n  if (hostname === 'youtube.com'", detectionStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart && bridgeStart >= 0 && bridgeEnd > bridgeStart && actionStart >= 0 && actionEnd > actionStart);
  assert.ok(detectionStart >= 0 && detectionEnd > detectionStart);
  runInNewContext(`${source.slice(detectionStart, detectionEnd)}\nreturn null;\n}`, context);
  context.inspectPage = async () => ({ pageInfo: context.detectCaptureTarget() });
  runInNewContext(`${source.slice(captureStart, captureEnd)}
    ${control.slice(bridgeStart, bridgeEnd).replace('export function', 'function')}
    configurePluginCapture({ saveCurrentPageFromTab });
    async function runCaptureSave(normalized) {
      const session = { activeTabId: 7 };
      const tab = await chrome.tabs.get(7);
      let result;
      switch (normalized.type) { ${control.slice(actionStart, actionEnd)} }
      return result;
    }`, context);
  return { run: (options = {}) => context.runCaptureSave({ type: 'capture.save', tabId: 7, ...options }), events, closed, ingested };
}

// Reuse the sanitized regular TBPC DOM only to verify host compatibility and
// orchestration. This is not a captured supermarket layout or live acceptance.
test('serialized extraction and actual capture routing save supermarket landings as Tmall, including reviews', async (t) => {
  fastTimers(t);
  const url = new URL('https://chaoshi.detail.tmall.com/item.htm?id=910000000003&skuId=999999999999&spm=fixture');
  const document = await savedOct9Fixture('tmall');
  const inject = new Function(`return (${runtime.toString()})`)();
  const payload = await inject('product', {}, document, url);
  assert.equal(payload.platform, 'tmall'); assert.equal(payload.externalId, '910000000003');
  assert.equal(payload.sourceUrl, 'https://chaoshi.detail.tmall.com/item.htm?id=910000000003');
  assert.equal(payload.selectedSku.externalId, '610000000003'); assert.equal(payload.price.text, '¥366.72');
  assert.deepEqual(payload.missingFields, []);
  const harness = await automaticCaptureHarness(document, url);
  const result = await harness.run({ closeAfterSave: true, expectedProduct: { externalId: '910000000003', platforms: ['taobao', 'tmall'] } });
  assert.equal(result.platform, 'tmall'); assert.equal(result.capturedReviews, 5); assert.equal(result.tabClosed, true);
  assert.equal(harness.ingested.length, 1); assert.equal(harness.ingested[0].sourceUrl, payload.sourceUrl);
  // Saved HTML contains local image paths: retain its existing partial-image
  // warning rather than treating those paths as downloadable remote images.
  assert.equal(harness.ingested[0].reviewCapture.status, 'partial');
  assert.equal(result.reviewCaptureStatus, 'partial');
  assert.equal(harness.ingested[0].reviewCapture.reviews[0].merchantReply, '商家回复：脱敏商家回复1。');
  assert.deepEqual(harness.closed, [7]); assert.ok(harness.events.every((event) => event.action === 'saveProduct'));
  await assert.rejects(harness.run({ expectedProduct: { externalId: '910000000004', platforms: ['taobao', 'tmall'] } }), { code: 'BROWSER_PRODUCT_IDENTITY_MISMATCH' });
  assert.equal(harness.ingested.length, 1);
});

test('preview reports missing execution, identity, name and page changes separately before any save', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function previewJdProductFromTab(');
  const end = source.indexOf('\nasync function saveCurrentPageLinkFromTab', start);
  for (const [product, expected] of [
    [undefined, /商品采集未返回结果/],
    [{ title: '商品' }, /未识别到商品标识/],
    [{ externalId: '1081819184372', title: '' }, /已识别淘宝商品 1081819184372，但未读取到商品名称/],
    [{ pageChanged: true }, /商品页面已变化/],
  ]) {
    let calls = 0;
    const context = {
      chrome: { tabs: { get: async () => ({ url: tb.href }) } }, getProductCaptureAdapter,
      runExtraction: async () => { calls += 1; return product; },
      requestNativeHost: async () => { assert.fail('An invalid preview must not be saved'); },
    };
    runInNewContext(source.slice(start, end), context);
    await assert.rejects(context.saveJdProductFromTab(1), expected);
    assert.equal(calls, 1);
  }
});

test('automatic capture.save reuses Taobao/Tmall extraction, default sampling, quotas and completion cleanup', async (t) => {
  fastTimers(t);
  for (const [name, url, limit, closeAfterSave] of [['taobao', tb, 5, true], ['tmall', tm, 3, false]]) {
    const document = await fixture(name);
    const root = document.querySelector('[data-role="review-scroll"]') || document.querySelector('[class*="Comments--"]');
    assert.ok(root);
    root.innerHTML = rows(8);
    const harness = await automaticCaptureHarness(document, url);
    const result = await harness.run({ closeAfterSave, ...(limit === 3 ? { reviewOptions: { filterLimits: { current: 3 } } } : {}) });
    assert.equal(result.platform, name); assert.equal(result.mode, 'product'); assert.equal(result.productId, `saved-${name}`);
    assert.equal(result.capturedReviews, limit); assert.equal(result.reviewCaptureStatus, 'complete'); assert.equal(result.reviewAccessErrorCode, '');
    assert.equal(harness.ingested.length, 1); assert.equal(harness.ingested[0].reviewCapture.reviews.length, limit);
    assert.equal(harness.ingested[0].reviewCapture.selectedFilters[0].limit, limit);
    assert.equal(harness.ingested[0].reviewCapture.reviews[0].merchantReply, '商家回复0');
    assert.equal(result.tabClosed, closeAfterSave);
    assert.deepEqual(harness.closed, closeAfterSave ? [7] : []);
    assert.ok(harness.events.every((event) => event.action === 'saveProduct'));
    assert.match(harness.events.at(-1).message, new RegExp(`已保存 ${limit} 条评论`));
  }
});

// Synthetic reproductions of the Oct 9 dog-food catalog gaps. These exercise
// real save orchestration without claiming a fresh live-site acceptance run.
test('automatic saving hydrates late price, parameters and details inside a scrolling product panel', async (t) => {
  const { document } = parseHTML(`<html><body><div id="product-scroll" style="overflow-y:auto">
    <h1>合成犬粮</h1><div data-role="product-gallery"><img src="https://img.alicdn.com/dog-main.jpg"></div>
    <div data-role="product-skus" data-sku-id="8801"><span aria-checked="true">鸡肉120g；0g 以口味说明为准</span></div>
    <div data-role="product-description">店铺活动</div>
  </div></body></html>`);
  const panel = document.querySelector('#product-scroll');
  panel.scrollHeight = 6000; panel.clientHeight = 600; panel.scrollTop = 37;
  let scrolls = 0; let opens = 0;
  panel.addEventListener('scroll', () => {
    if (++scrolls !== 1) return;
    panel.insertAdjacentHTML('beforeend', '<div class="paramsInfoArea"><div class="generalParamsInfoItem--fixture"><span class="generalParamsInfoItemTitle--fixture">品牌</span><span class="generalParamsInfoItemSubTitle--fixture">测试品牌</span></div></div><div data-role="product-reviews"><button>查看全部评价</button></div>');
    document.querySelector('[data-role="product-description"]').insertAdjacentHTML('beforeend', '<img data-src="https://img.alicdn.com/dog-detail.jpg">');
    panel.querySelector('button').addEventListener('click', () => {
      opens++; document.body.insertAdjacentHTML('beforeend', `<section role="dialog">${rows(5, 'dog')}</section>`);
    });
  });
  const ticks = fastTimers(t, (tick) => {
    if (tick === 2) panel.insertAdjacentHTML('beforeend', '<div data-role="product-price">¥2.90</div>');
  });
  const harness = await automaticCaptureHarness(document, tb);
  const result = await harness.run();
  const payload = harness.ingested[0];
  assert.equal(result.capturedReviews, 5); assert.equal(opens, 1);
  assert.ok(ticks() >= 2); assert.ok(scrolls >= 2 && scrolls <= 12);
  assert.equal(payload.price.text, '¥2.90'); assert.equal(payload.brandName, '测试品牌');
  assert.equal(payload.selectedSku.externalId, '8801');
  assert.equal(payload.selectedSku.variantText, '鸡肉120g；0g 以口味说明为准');
  assert.equal(payload.description, ''); assert.equal(payload.detailText, undefined);
  assert.deepEqual(Array.from(payload.images, (image) => image.role), ['primary', 'detail']);
  assert.deepEqual(Array.from(payload.missingFields), []); assert.equal(panel.scrollTop, 37);
});

test('product lazy-section waiting is bounded and keeps missing facts explicit without inventing prices', async (t) => {
  const { document } = parseHTML(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', productID: '10002', name: '合成犬粮', offers: { price: '99' } })}</script></head><body>
    <h1>合成犬粮</h1><div data-role="product-gallery"><img src="https://img.alicdn.com/dog-main.jpg"></div>
    <div data-role="product-description">店铺活动</div>
  </body></html>`);
  const ticks = fastTimers(t);
  const inject = new Function(`return (${runtime.toString()})`)();
  const payload = await inject('product', { hydrateSections: true }, document, tm);
  assert.equal(ticks(), 12); assert.equal(payload.price, undefined); assert.equal(payload.description, '');
  assert.ok(payload.missingFields.includes('当前价格')); assert.ok(payload.missingFields.includes('商品参数'));
  assert.ok(payload.missingFields.includes('商品详情')); assert.equal(payload.images.length, 1);
});

test('late review-region discovery opens the full list and restores the product scroll position', async (t) => {
  fastTimers(t);
  for (const initialRegion of ['', '<div data-role="product-reviews"></div>']) {
    const { document } = parseHTML('<html><body><div id="tbpcDetail_SkuPanelBody" style="overflow-y:auto"></div><div id="product-scroll" style="overflow-y:auto"><div id="picGalleryEle"></div></div></body></html>');
    const skuPanel = document.querySelector('#tbpcDetail_SkuPanelBody');
    skuPanel.scrollHeight = 2000; skuPanel.clientHeight = 600; skuPanel.scrollTop = 19;
    const panel = document.querySelector('#product-scroll');
    panel.insertAdjacentHTML('beforeend', initialRegion);
    panel.scrollHeight = 6000; panel.clientHeight = 600; panel.scrollTop = 29;
    let scrolls = 0; let opens = 0;
    panel.addEventListener('scroll', () => {
      if (++scrolls !== 2) return;
      if (!panel.querySelector('[data-role="product-reviews"]')) panel.insertAdjacentHTML('beforeend', '<div data-role="product-reviews"></div>');
      panel.querySelector('[data-role="product-reviews"]').insertAdjacentHTML('beforeend', '<button>查看全部评价</button>');
      panel.querySelector('button').addEventListener('click', () => {
        opens++; document.body.insertAdjacentHTML('beforeend', `<section role="dialog">${rows(5)}</section>`);
      });
    });
    const result = await runtime('reviews', {}, document, tm);
    assert.equal(scrolls, 2); assert.equal(opens, 1); assert.equal(result.status, 'complete');
    assert.equal(result.reviews.length, 5); assert.equal(panel.scrollTop, 29); assert.equal(skuPanel.scrollTop, 19);
  }
});

test('missing review-region discovery has a fixed budget and never reports zero reviews as complete', async (t) => {
  const ticks = fastTimers(t);
  const { document } = parseHTML('<html><body></body></html>');
  const result = await runtime('reviews', {}, document, tm);
  assert.equal(ticks(), 12); assert.equal(result.status, 'not-opened'); assert.equal(result.reviews.length, 0);
  assert.match(result.warnings.join(' '), /未识别.*不代表商品没有评论/);
});

test('product hydration and review discovery stop immediately for gates or navigation', async (t) => {
  let onTick;
  const ticks = fastTimers(t, () => onTick());
  for (const action of ['product', 'reviews']) {
    for (const [message, code] of [['请先登录', 'BROWSER_LOGIN_REQUIRED'], ['安全验证', 'BROWSER_SECURITY_CHALLENGE'], ['访问频繁', 'BROWSER_RATE_LIMITED'], ['', 'CONTENT_NOT_ACCESSIBLE']]) {
      const { document } = parseHTML('<html><body><div id="product-scroll" style="overflow-y:auto"><h1>合成犬粮</h1><div id="picGalleryEle" data-role="product-gallery"><img src="https://img.alicdn.com/dog-main.jpg"></div></div></body></html>');
      const panel = document.querySelector('#product-scroll');
      panel.scrollHeight = 6000; panel.clientHeight = 600;
      let position = 0; let writes = 0;
      Object.defineProperty(panel, 'scrollTop', { get: () => position, set: (value) => { position = value; writes++; } });
      const url = new URL(tb);
      onTick = () => { if (message) document.body.appendChild(document.createTextNode(message)); else url.searchParams.set('id', '99999'); };
      const before = ticks();
      const result = await runtime(action, { hydrateSections: true }, document, url);
      assert.equal(ticks() - before, 1);
      assert.equal(writes, 1, 'gates and page changes must also stop scroll restoration');
      if (action === 'reviews') assert.equal(result.accessErrorCode, code);
      else if (message) { assert.equal(result.title, '合成犬粮'); assert.equal(result.images.length, 1); }
      else assert.equal(result.pageChanged, true);
    }
  }
});

test('UI-only detail headings are excluded while actual seller prose keeps the same words', async () => {
  const document = await fixture('taobao');
  const detail = document.querySelector('#J_DivItemDesc');
  for (const label of ['店铺活动', '商品详情', '图文详情']) {
    detail.textContent = label;
    const product = await runtime('product', {}, document, tb);
    assert.equal(product.description, ''); assert.ok(product.missingFields.includes('商品详情'));
  }
  detail.textContent = '店铺活动期间购买本款犬粮赠送量杯';
  assert.equal((await runtime('product', {}, document, tb)).description, detail.textContent);
});

test('automatic product save exposes a structured review restriction while retaining already captured facts and reviews', async (t) => {
  fastTimers(t);
  const document = await fixture('taobao');
  const root = document.querySelector('[data-role="review-scroll"]');
  root.innerHTML = rows(2);
  root.addEventListener('scroll', () => document.body.appendChild(document.createTextNode('访问频繁')));
  const harness = await automaticCaptureHarness(document, tb);
  const result = await harness.run();
  assert.equal(result.success, true); assert.equal(result.capturedReviews, 2);
  assert.equal(result.reviewCaptureStatus, 'partial'); assert.equal(result.reviewAccessErrorCode, 'BROWSER_RATE_LIMITED');
  assert.ok(result.reviewWarnings.length); assert.equal(harness.ingested[0].title, '测试品牌 A1 保温杯');
  assert.equal(harness.ingested[0].reviewCapture.reviews.length, 2);
});

test('an unrelated dialog with tabs does not prevent the actual review list from opening', async (t) => {
  fastTimers(t); const document = await tbpcFixture();
  document.body.insertAdjacentHTML('beforeend', '<section role="dialog"><button role="tab">其他面板</button></section>');
  let clicks = 0; document.querySelector('[class*="ShowButton--"]').addEventListener('click', () => {
    clicks += 1; document.body.insertAdjacentHTML('beforeend', `<section role="dialog">${rows(5, 'reviews')}</section>`);
  });
  const result = await runtime('reviews', {}, document, tbpcUrl);
  assert.equal(result.status, 'complete'); assert.equal(clicks, 1); assert.equal(result.reviews[0].id, 'reviews-0');
});

test('automatic saving retains keyed missing-label diagnostics through the normalized background options', async (t) => {
  fastTimers(t); const document = await fixture('taobao');
  const harness = await automaticCaptureHarness(document, tb);
  await harness.run({ reviewOptions: { selectedFilterIds: ['gone-photo', 'gone-all'], selectedFilterLabels: ['全部', '图/视频'], filterLabels: { 'gone-photo': '图/视频', 'gone-all': '全部' } } });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.ingested[0].reviewCapture.results.map((entry) => [entry.filterId, entry.label]))), [['gone-photo', '图/视频'], ['gone-all', '全部']]);
});

test('an exact zero review badge records an empty range without clicking or borrowing other tags', async (t) => {
  fastTimers(t);
  const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="append">追评<span class="imprItemCount--fixture">0</span></button>${rows(5, 'all')}</div></body></html>`);
  let clicks = 0; document.querySelector('button').addEventListener('click', () => { clicks++; });
  const result = await runtime('reviews', { selectedFilterIds: ['append'] }, document, tb);
  assert.equal(clicks, 0); assert.equal(result.status, 'complete'); assert.equal(result.reviews.length, 0);
  assert.deepEqual(result.results[0], { filterId: 'append', label: '追评', requested: 5, captured: 0, availableCount: 0, status: 'complete' });
});

test('exact small review totals complete when read, retaining the requested quota and page count', async (t) => {
  fastTimers(t);
  for (const count of [1, 2]) {
    const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="append" aria-selected="true">追评<span class="imprItemCount--fixture">${count}</span></button>${rows(count)}</div></body></html>`);
    const result = await runtime('reviews', { selectedFilterIds: ['append'] }, document, tm);
    assert.equal(result.status, 'complete'); assert.equal(result.results[0].requested, 5); assert.equal(result.results[0].availableCount, count);
    assert.equal(result.results[0].captured, count); assert.deepEqual(result.warnings, []);
  }
});

test('approximate totals, unread rows and contradictory zero badges never certify completeness', async (t) => {
  fastTimers(t);
  for (const [badge, count] of [['2+', 2], ['1万', 2], ['', 2], ['3', 2], ['0', 2]]) {
    const { document } = parseHTML(`<html><body><div data-role="product-reviews"><button data-review-filter="append" aria-selected="true">追评<span class="imprItemCount--fixture">${badge}</span></button>${rows(count)}</div></body></html>`);
    const result = await runtime('reviews', { selectedFilterIds: ['append'] }, document, tm);
    assert.equal(result.status, 'partial', badge); assert.equal(result.reviews.length, count);
    assert.match(result.results[0].warning, /不足/);
  }
});

test('exact counts do not hide access restrictions, pending images or a still-loading zero range', async (t) => {
  fastTimers(t);
  for (const kind of ['gate', 'image', 'loading']) {
    const count = kind === 'loading' ? 0 : 1;
    const { document } = parseHTML(`<html><body><div data-role="product-reviews" ${kind === 'loading' ? 'aria-busy="true"' : ''}><button data-review-filter="append" aria-selected="true">追评<span class="imprItemCount--fixture">${count}</span></button>${rows(count)}</div></body></html>`);
    if (kind === 'gate') document.body.appendChild(document.createTextNode('安全验证'));
    if (kind === 'image') document.querySelector('img').setAttribute('src', loadingTile);
    const result = await runtime('reviews', { selectedFilterIds: ['append'] }, document, tm);
    assert.equal(result.status, 'partial', kind);
    if (kind === 'gate') assert.equal(result.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE');
    if (kind === 'image') assert.match(result.warnings.join(' '), /图片/);
    if (kind === 'loading') assert.match(result.results[0].warning, /未更新/);
  }
});

test('saved review status takes precedence when image localization leaves the persisted capture partial', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const context = {
    chrome: { tabs: { get: async () => ({ url: tb.href }) } }, getProductCaptureAdapter, normalizeText: (value) => String(value || '').trim(),
    runExtraction: async (_id, _func, { args }) => args[0] === 'product' ? { platform: 'taobao', externalId: '10001', sourceUrl: tb.href, title: '商品' }
      : args[0] === 'preview' ? { modalDetected: true, availableFilters: [] } : { status: 'complete', reviews: [], warnings: [] },
    createBridgeOperationId: () => 'operation',
    requestNativeHost: async () => ({ productId: 'saved', reviewCaptureStatus: 'partial', reviewWarnings: ['评论图片下载失败'] }),
  };
  runInNewContext(source.slice(source.indexOf('async function previewJdProductFromTab('), source.indexOf('\nasync function saveCurrentPageLinkFromTab')), context);
  const result = await context.saveJdProductFromTab(1);
  assert.equal(result.reviewCaptureStatus, 'partial'); assert.deepEqual(result.reviewWarnings, ['评论图片下载失败']);
});
