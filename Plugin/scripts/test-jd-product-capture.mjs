import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import {
  captureJdProductReviews,
  ensureJdReviewModal,
  extractJdProductPayload,
  extractJdReviewPreview,
} from '../src/capture/jdProduct.js';
import { removeTabWithRetry } from '../src/background/tabCloseRuntime.js';

test('retries transient Chrome tab-close failures and confirms the tab is gone', async () => {
  let attempts = 0;
  const waits = [];
  const result = await removeTabWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('Tabs cannot be edited right now');
  }, 42, { wait: async (ms) => waits.push(ms) });

  assert.deepEqual(result, { closed: true, attempts: 3, alreadyClosed: false });
  assert.deepEqual(waits, [200, 400]);
  assert.deepEqual(await removeTabWithRetry(async () => {
    throw new Error('No tab with id: 42');
  }, 42), { closed: true, attempts: 1, alreadyClosed: true });
});

function createReviewModal() {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" aria-modal="true" class="comment-dialog">
      <h2>商品评价</h2>
      <div class="comment-filter-list" role="tablist">
        <button role="tab" data-filter="all">全部 99%好评</button>
        <button role="tab" data-filter="image">图/视频 5万+</button>
        <button role="tab" data-filter="repeat">回头客 1900+</button>
        <button role="tab" data-filter="positive">好评 50万+</button>
        <button role="tab" data-filter="neutral">中评 2000+</button>
        <button role="tab" data-filter="negative">差评 2000+</button>
      </div>
      <div class="comment-scope">最新 | 当前商品</div>
      <div class="comment-list"></div>
    </div>
  </body></html>`);
  const list = document.querySelector('.comment-list');
  const render = (filter) => {
    for (const button of document.querySelectorAll('[data-filter]')) button.classList.toggle('active', button.dataset.filter === filter);
    list.innerHTML = Array.from({ length: 5 }, (_, index) => `
      <article class="comment-item" data-comment-id="${filter}-${index}">
        <span data-role="author">j***${index}</span>
        <span data-role="badge">已购 10 次</span>
        <span data-role="date">03-${20 + index}</span>
        <span data-role="sku">海洋鱼味</span>
        <span data-score="5">5 星</span>
        <p data-role="comment-text">${filter} 评论 ${index + 1}，猫咪很喜欢。</p>
        <div data-role="review-media"><img src="https://img10.360buyimg.com/jfs/t1/${filter}-${index}.jpg"></div>
        ${index === 0 ? '<span data-role="review-video"><video src="https://video-jdvideo.jcloudcs.com/review.mp4"></video></span>' : ''}
      </article>
    `).join('');
  };
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => render(button.dataset.filter));
  }
  render('all');
  return document;
}

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
  assert.equal(payload.captureVersion, 3);
});

test('a loading shell cannot be saved under the JD homepage title or a third-party heading', () => {
  const { document } = parseHTML('<html><head><title>京东(JD.COM)-正品低价、品质保障、配送及时、轻松购物！</title></head><body><h1>最小单价计算器</h1></body></html>');
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.title, '');
  assert.ok(payload.missingFields.includes('商品名称'));
});

test('recognizes visible review filters only after the JD review modal is open', () => {
  const closed = parseHTML('<html><body><button>全部评价</button></body></html>').document;
  assert.equal(extractJdReviewPreview(closed).modalDetected, false);

  const preview = extractJdReviewPreview(createReviewModal());
  assert.equal(preview.modalDetected, true);
  assert.deepEqual(preview.availableFilters.map((filter) => filter.label), ['全部', '图/视频', '回头客', '好评', '中评', '差评']);
  assert.deepEqual(preview.availableFilters.slice(-3).map((filter) => filter.sentiment), ['positive', 'neutral', 'negative']);
});

test('opens the JD review modal automatically from the all-reviews entry', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <button id="open-reviews">全部评价 ›</button>
    <div id="review-modal" role="dialog" aria-modal="true" class="comment-dialog" style="display: none">
      <h2>商品评价</h2>
      <button role="tab">好评 50万+</button>
      <button role="tab">中评 2000+</button>
      <button role="tab">差评 2000+</button>
      <div>最新 · 当前商品</div>
    </div>
  </body></html>`);
  const modal = document.querySelector('#review-modal');
  document.querySelector('#open-reviews').addEventListener('click', () => modal.removeAttribute('style'));

  const result = await ensureJdReviewModal(document);
  assert.deepEqual(result, { modalDetected: true, opened: true, entryFound: true });
  assert.equal(extractJdReviewPreview(document).modalDetected, true);
});

test('reports when a JD page has no automatic review entry', async () => {
  const { document } = parseHTML('<html><body><button>加入购物车</button></body></html>');
  assert.deepEqual(await ensureJdReviewModal(document), {
    modalDetected: false,
    opened: false,
    entryFound: false,
  });
});

test('recognizes the current JD popup structure without exposing nested count nodes as filters', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <main>
      <div><span>商品评价</span></div>
      <div class="tag-list">
        <div class="tag-item"><span>全部</span><span class="tag-count">99%好评</span></div>
        <div class="tag-item"><span>图/视频</span><span class="tag-count">5万+</span></div>
        <div class="tag-item"><span>好评</span><span class="tag-count">50万+</span></div>
        <div class="tag-item"><span>中评</span><span class="tag-count">2000+</span></div>
        <div class="tag-item"><span>差评</span><span class="tag-count">2000+</span></div>
      </div>
      <div>最新</div><div>当前商品</div>
      <section class="review-row">
        <img alt="avatar" src="https://img10.360buyimg.com/jfs/t1/avatar_sma.jpg">
        <div>j***m 该店铺购买≥10次</div>
        <img alt="star" src="https://img10.360buyimg.com/jfs/t1/star.png">
        <span>03-29</span><span>成猫粮1.3kg|海洋鱼味</span>
        <p>一直给家里的猫喂这款猫粮，适口性很好，包装也完整，会继续回购。</p>
        <img alt="pic" src="https://img10.360buyimg.com/jfs/t1/review.jpg.dpg">
      </section>
    </main>
  </body></html>`);
  const preview = extractJdReviewPreview(document);
  assert.deepEqual(preview.availableFilters.map((filter) => filter.label), ['全部', '图/视频', '好评', '中评', '差评']);

  const capture = await captureJdProductReviews({ selectedFilterLabels: ['好评'], limitPerFilter: 1 }, document, new URL('https://item.jd.com/280930.html'));
  assert.equal(capture.reviews.length, 1);
  assert.equal(capture.reviews[0].authorName, 'j***m');
  assert.equal(capture.reviews[0].dateText, '03-29');
  assert.equal(capture.reviews[0].skuText, '成猫粮1.3kg|海洋鱼味');
  assert.deepEqual(capture.reviews[0].imageSourceUrls, ['https://img10.360buyimg.com/jfs/t1/review.jpg.dpg']);
});

test('defaults to five positive, neutral, and negative reviews and keeps review media metadata', async () => {
  const capture = await captureJdProductReviews({}, createReviewModal(), new URL('https://item.jd.com/280930.html'));
  assert.equal(capture.status, 'complete');
  assert.deepEqual(capture.selectedFilters.map((filter) => [filter.label, filter.limit]), [
    ['好评', 5],
    ['中评', 5],
    ['差评', 5],
  ]);
  assert.equal(capture.reviews.length, 15);
  assert.equal(capture.reviews[0].imageSourceUrls.length, 1);
  assert.equal(capture.reviews[0].video.present, true);
});

test('waits for an asynchronous filter refresh and scrolls the modal for more reviews', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="positive">好评 20+</button>
      <button role="tab">中评 2</button>
      <button role="tab">差评 1</button>
      <div class="comment-scope">最新 | 当前商品</div>
      <div class="comment-list"></div>
    </div>
  </body></html>`);
  const button = document.querySelector('[data-filter="positive"]');
  const list = document.querySelector('.comment-list');
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 2_000 },
  });
  const row = (index) => `<article class="comment-item" data-comment-id="async-${index}">
    <span data-role="author">u***${index}</span>
    <span data-role="date">2026-09-${10 + index}</span>
    <span data-role="sku">海洋鱼味 10kg</span>
    <span data-score="4"></span>
    <p data-role="comment-text">异步加载的好评内容第 ${index} 条，猫咪吃得很好，会继续购买。</p>
  </article>`;
  list.innerHTML = row(0);
  button.addEventListener('click', () => {
    button.setAttribute('aria-selected', 'true');
    list.innerHTML = '<p>加载中</p>';
    setTimeout(() => { list.innerHTML = row(1); }, 450);
  });
  list.addEventListener('scroll', () => {
    if (list.querySelectorAll('.comment-item').length === 1) list.insertAdjacentHTML('beforeend', row(2) + row(3));
  });

  const capture = await captureJdProductReviews({ selectedFilterLabels: ['好评'], limitPerFilter: 3 }, document, new URL('https://item.jd.com/280930.html'));
  assert.equal(capture.status, 'complete');
  assert.equal(capture.results[0].captured, 3);
  assert.deepEqual(capture.reviews.map((review) => review.rating), [4, 4, 4]);
});

test('keeps the complete buyer review and merchant reply in separate fields', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="negative" aria-selected="true">差评 2000+</button>
      <div class="comment-list">
        <article class="comment-item" data-comment-id="buyer-with-reply">
          <span data-role="author">j***y</span>
          <span data-role="date">2021-06-10</span>
          <span data-role="sku">鱼肉味4斤</span>
          <span data-score="1">1 星</span>
          <div class="comment-content">放在快递点，离收货地址三公里，让我怎么拿 商家：感谢您选择我们的产品。实在很抱歉出现这样的情况呢，我们也会根据您的反馈加强和快递公司的沟通。</div>
        </article>
      </div>
    </div>
  </body></html>`);

  const capture = await captureJdProductReviews({ selectedFilterLabels: ['差评'], limitPerFilter: 1 }, document, new URL('https://item.jd.com/280930.html'));

  assert.equal(capture.reviews.length, 1);
  assert.equal(capture.reviews[0].text, '放在快递点，离收货地址三公里，让我怎么拿');
  assert.equal(capture.reviews[0].merchantReply, '感谢您选择我们的产品。实在很抱歉出现这样的情况呢，我们也会根据您的反馈加强和快递公司的沟通。');
});

test('keeps the buyer text when a generic comment-content node belongs to the merchant reply', async () => {
  const buyerText = '我家猫不爱吃，只要到碗里它就埋。';
  const replyText = '实在抱歉给您和毛孩子带来了不好的体验，得知您家猫咪对这款猫粮十分抗拒，我们满心愧疚。';
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="negative" aria-selected="true">差评 2000+</button>
      <div class="comment-list">
        <article class="comment-item" data-comment-id="buyer-and-shop-reply">
          <span data-role="author">j***p</span>
          <span data-role="date">01-02</span>
          <span data-role="sku">肠道养护 成猫鸡肉味2kg</span>
          <p class="comment-con">${buyerText}</p>
          <div class="shop-reply">
            <span class="reply-label">商家：</span>
            <p class="comment-content">${replyText}</p>
          </div>
        </article>
      </div>
    </div>
  </body></html>`);

  const capture = await captureJdProductReviews({ selectedFilterLabels: ['差评'], limitPerFilter: 1 }, document, new URL('https://item.jd.com/280930.html'));

  assert.equal(capture.reviews.length, 1);
  assert.equal(capture.reviews[0].text, buyerText);
  assert.equal(capture.reviews[0].merchantReply, replyText);
});

test('splits a merchant reply even when JD concatenates it directly after buyer punctuation', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="negative" aria-selected="true">差评 1</button>
      <article class="comment-item" data-comment-id="concatenated-reply">
        <span data-role="author">j***p</span><span data-role="date">01-02</span>
        <p data-role="comment-text">用户原文没有空格。商家：这是完整商家回复。</p>
      </article>
    </div>
  </body></html>`);

  const capture = await captureJdProductReviews({ selectedFilterLabels: ['差评'], limitPerFilter: 1 }, document, new URL('https://item.jd.com/280930.html'));

  assert.equal(capture.reviews[0].text, '用户原文没有空格。');
  assert.equal(capture.reviews[0].merchantReply, '这是完整商家回复。');
});

test('captures every loadable review without count or body truncation in capture-all mode', async () => {
  const longBody = `开头-${'完整评论'.repeat(3_000)}-结尾`;
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="positive" aria-selected="true">好评 6</button>
      <div class="comment-list"></div>
    </div>
  </body></html>`);
  const list = document.querySelector('.comment-list');
  const row = (index) => `<article class="comment-item" data-comment-id="all-${index}">
    <span data-role="author">u***${index}</span>
    <span data-role="date">2026-09-${10 + index}</span>
    <p data-role="comment-text">${index === 0 ? longBody : `第 ${index + 1} 条完整评论`}</p>
  </article>`;
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 2_000 },
  });
  list.innerHTML = row(0) + row(1);
  list.addEventListener('scroll', () => {
    if (list.querySelectorAll('.comment-item').length === 2) {
      list.insertAdjacentHTML('beforeend', Array.from({ length: 4 }, (_, index) => row(index + 2)).join(''));
    }
  });

  const capture = await captureJdProductReviews({ selectedFilterLabels: ['好评'], limitPerFilter: 5, captureAll: true }, document, new URL('https://item.jd.com/280930.html'));

  assert.equal(capture.reviews.length, 6);
  assert.equal(capture.reviews[0].text, longBody);
  assert.equal(capture.reviews[0].text.endsWith('-结尾'), true);
  assert.equal(capture.results[0].captureAll, true);
  assert.equal(capture.results[0].captured, 6);
  assert.equal(capture.results[0].status, 'complete');
});

test('stops review scrolling as soon as JD quick verification appears', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="positive" aria-selected="true">好评 2000+</button>
      <div class="comment-list">
        <article class="comment-item" data-comment-id="risk-0">
          <span data-role="author">u***0</span>
          <span data-role="date">2026-09-10</span>
          <p data-role="comment-text">风控前加载到的正常评论内容。</p>
        </article>
      </div>
    </div>
  </body></html>`);
  const list = document.querySelector('.comment-list');
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 20_000 },
  });
  let scrolls = 0;
  list.addEventListener('scroll', () => {
    scrolls += 1;
    document.body.innerHTML = '<main><p>验证一下，购物无忧</p><button>快速验证</button></main>';
  });

  const capture = await captureJdProductReviews({
    selectedFilterLabels: ['好评'],
    limitPerFilter: 3,
  }, document, new URL('https://item.jd.com/280930.html'));

  assert.equal(capture.status, 'blocked');
  assert.equal(capture.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE');
  assert.equal(scrolls, 1);
});

test('capture-all mode stops at the scroll safety limit even while reviews keep growing', async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div role="dialog" class="comment-dialog">
      <h2>商品评价</h2>
      <button role="tab" data-filter="positive" aria-selected="true">好评 2000+</button>
      <div class="comment-list">
        <article class="comment-item" data-comment-id="safe-0">
          <span data-role="author">u***0</span>
          <span data-role="date">2026-09-10</span>
          <p data-role="comment-text">安全上限测试评论第 0 条。</p>
        </article>
      </div>
    </div>
  </body></html>`);
  const list = document.querySelector('.comment-list');
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 20_000 },
  });
  let scrolls = 0;
  list.addEventListener('scroll', () => {
    scrolls += 1;
    list.insertAdjacentHTML('beforeend', `<article class="comment-item" data-comment-id="safe-${scrolls}">
      <span data-role="author">u***${scrolls}</span>
      <span data-role="date">2026-09-${10 + scrolls}</span>
      <p data-role="comment-text">安全上限测试评论第 ${scrolls} 条。</p>
    </article>`);
  });

  const capture = await captureJdProductReviews({
    selectedFilterLabels: ['好评'],
    captureAll: true,
    maxScrollRounds: 2,
  }, document, new URL('https://item.jd.com/280930.html'));

  assert.equal(scrolls, 2);
  assert.equal(capture.status, 'partial');
  assert.match(capture.results[0].warning, /安全采集上限/);
});

test('recognizes the JD shopping-protection verification page before product extraction', () => {
  const { document } = parseHTML('<html><body><p>验证一下，购物无忧</p><button>快速验证</button></body></html>');
  const payload = extractJdProductPayload(document, new URL('https://item.jd.com/280930.html'));
  assert.equal(payload.accessErrorCode, 'BROWSER_SECURITY_CHALLENGE');
  assert.equal(payload.externalId, '');
});

test('captures only custom review filters and clamps the shared limit to one through fifty', async () => {
  const document = createReviewModal();
  const modal = document.querySelector('[role="dialog"]');
  modal.scrollTop = 123;
  const preview = extractJdReviewPreview(document);
  const imageFilter = preview.availableFilters.find((filter) => filter.label === '图/视频');
  const capture = await captureJdProductReviews({
    selectedFilterIds: [imageFilter.id],
    selectedFilterLabels: ['图/视频'],
    limitPerFilter: 0,
  }, document, new URL('https://item.jd.com/280930.html'));
  assert.deepEqual(capture.selectedFilters, [{ id: imageFilter.id, label: '图/视频', limit: 1 }]);
  assert.equal(capture.reviews.length, 1);
  assert.equal(document.querySelector('[data-filter="all"]').classList.contains('active'), true);
  assert.equal(modal.scrollTop, 123);

  const upper = await captureJdProductReviews({ selectedFilterLabels: ['回头客'], limitPerFilter: 99 }, createReviewModal(), new URL('https://item.jd.com/280930.html'));
  assert.equal(upper.selectedFilters[0].limit, 50);
  assert.equal(upper.results[0].status, 'partial');
});

test('deduplicates the same review across filters and retains every matching label', async () => {
  const document = createReviewModal();
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      Array.from(document.querySelectorAll('.comment-item')).forEach((row, index) => row.setAttribute('data-comment-id', `shared-${index}`));
    });
  }
  const capture = await captureJdProductReviews({}, document, new URL('https://item.jd.com/280930.html'));
  assert.equal(capture.reviews.length, 5);
  assert.equal(capture.reviews[0].matchedFilterIds.length, 3);
});

test('reports partial default review capture when a sentiment filter is unavailable', async () => {
  const document = createReviewModal();
  document.querySelector('[data-filter="neutral"]').remove();
  const capture = await captureJdProductReviews({}, document, new URL('https://item.jd.com/280930.html'));
  assert.equal(capture.status, 'partial');
  assert.deepEqual(capture.selectedFilters.map((filter) => filter.label), ['好评', '差评']);
  assert.ok(capture.warnings.some((warning) => warning.includes('中评')));
});

test('returns a non-blocking review result when the review modal is closed', async () => {
  const { document } = parseHTML('<html><body><button>全部评价</button></body></html>');
  const capture = await captureJdProductReviews({}, document, new URL('https://item.jd.com/280930.html'));
  assert.equal(capture.status, 'not-opened');
  assert.equal(capture.reviews.length, 0);
  assert.match(capture.warnings[0], /仅保存商品资料/);
});
