import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { extractSiteResearch, submitSiteResearchSearch } from '../src/content/siteResearchExtractor.js';
import { marketplaceProductLink, marketplaceSurface } from '../src/content/marketplaceSearch.js';
import { normalizeResearchRequest, buildSiteSearchTargetUrl, pickReusableResearchTab, runSiteResearch } from '../src/background/siteResearchRuntime.js';
import { assertExpectedProductMatches, getProductCaptureAdapter } from '../src/capture/productAdapters.js';

async function page(platform, url) {
  const html = await fs.readFile(new URL(`./fixtures/marketplace-search/${platform}.synthetic.html`, import.meta.url), 'utf8');
  return mount(html, url || (platform === 'taobao' ? 'https://www.taobao.com/search?q=猫粮' : 'https://list.tmall.com/search_product.htm?q=显示器'));
}
function mount(html, url) {
  const { window, document } = parseHTML(html);
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.getComputedStyle = (node) => ({ display: node.hidden ? 'none' : node.style.display || 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' });
  Object.assign(globalThis, { window, document, location: new URL(url), getComputedStyle: window.getComputedStyle, Event: window.Event, KeyboardEvent: window.KeyboardEvent || window.Event, InputEvent: window.InputEvent || window.Event, MouseEvent: window.MouseEvent || window.Event, PointerEvent: window.PointerEvent || window.Event, Node: window.Node, Element: window.Element });
  return document;
}
function macroDeps(options = {}) {
  let submitted = false;
  let extracted = false;
  const reads = []; const claimed = []; const scrolls = [];
  const entry = { id: 10, url: options.entry || 'https://www.taobao.com/' };
  const current = { id: 10, url: 'https://www.taobao.com/search?q=猫粮' };
  const child = { id: 11, openerTabId: 10, url: 'https://list.tmall.com/search_product.htm?q=猫粮' };
  const userTab = { id: 90, url: 'https://www.taobao.com/search?q=用户' };
  const evidence = { success: true, pageState: { results: { status: 'ready' } }, items: [{ id: '1', platform: 'taobao', sourceUrl: 'https://item.taobao.com/item.htm?id=1' }, { id: '1', platform: 'tmall', sourceUrl: 'https://detail.tmall.com/item.htm?id=1' }] };
  return { reads, claimed, scrolls, deps: {
    createControlledTab: async () => ({ tab: entry }),
    getTab: async (id) => id === 11 ? child : options.child ? entry : current,
    listTabs: async () => [entry, userTab,
      ...(options.existingChild ? [{ ...child, id: 80 }] : []),
      ...(submitted && options.child ? [child, { id: 91, openerTabId: 90, url: child.url }] : []),
      ...(extracted && options.lateChild ? [child, { id: 91, openerTabId: 90, url: child.url },
        { id: 92, openerTabId: 10, url: 'https://example.invalid/search' },
        { id: 93, openerTabId: 10, url: 'https://item.taobao.com/item.htm?id=2' }] : [])],
    claimTab: async (id) => { claimed.push(id); }, waitForTabComplete: async () => {},
    submitSearch: async () => { submitted = true; return options.submission || { success: true }; },
    readSiteEvidence: async (id) => { extracted = true; reads.push(id); if (options.throwRead) throw new Error('content timeout'); return options.read ? options.read(reads.length) : evidence; },
    readSnapshot: async () => assert.fail('snapshot disabled'), delay: async () => {},
    scrollPage: async (id) => { scrolls.push(id); return { success: true }; },
  } };
}
const macroInput = { site: 'taobao', operation: 'search', query: '猫粮', depth: 'preview', snapshot: false, limit: 2, reuseExistingTab: false };

for (const platform of ['taobao', 'tmall']) {
  test(`${platform} capability enters through home UI and excludes detail pages when reusing tabs`, () => {
    const request = normalizeResearchRequest({ ...macroInput, site: platform });
    assert.equal(buildSiteSearchTargetUrl(request.site, '猫粮'), `https://www.${platform}.com/`);
    assert.equal(request.site.detailOpenMode, 'direct_url');
    assert.equal(pickReusableResearchTab([{ id: 1, url: 'https://item.taobao.com/item.htm?id=1' }, { id: 2, url: `https://www.${platform}.com/` }], request)?.id, 2);
    assert.throws(() => normalizeResearchRequest({ ...macroInput, site: platform, url: 'https://evil.test/search' }), /does not belong/);
  });
  test(`${platform} submits actual search control in the owned tab and restores form target`, async () => {
    const document = await page(platform, `https://www.${platform}.com/`);
    let target;
    document.querySelector('button').addEventListener('click', () => { target = document.querySelector('form').getAttribute('target'); });
    const result = await submitSiteResearchSearch({ site: platform, query: '新关键词' });
    assert.equal(result.success, true); assert.equal(result.method, 'click');
    assert.equal(document.querySelector('input').value, '新关键词');
    assert.equal(target, '_self'); assert.equal(document.querySelector('form').getAttribute('target'), '_blank');
    assert.equal(document.querySelector('button').hasAttribute('formtarget'), false);
  });
}

test('search extracts visible real links, dedupes within platform and preserves cross-platform cards and SKU', async () => {
  await page('taobao');
  const result = extractSiteResearch({ site: 'taobao', operation: 'search', query: '猫粮', limit: 10 });
  assert.equal(result.success, true); assert.equal(result.pageState.surface, 'search_results');
  assert.deepEqual(result.items.map((item) => `${item.platform}:${item.id}`), ['taobao:1001', 'tmall:1001', 'taobao:1002']);
  assert.equal(result.items[0].title, '伟嘉成猫猫粮 3.6kg'); assert.equal(result.items[0].sourceUrl, 'https://item.taobao.com/item.htm?id=1001&skuId=9001');
  assert.equal(result.items[0].navigationUrl, 'https://item.taobao.com/item.htm?id=1001&skuId=9001&spm=search');
  assert.equal(result.items[2].title, '冻干猫粮');
  assert.equal(result.items[0].price, undefined);
  await page('tmall');
  const tmall = extractSiteResearch({ site: 'tmall', operation: 'search', query: '显示器' });
  assert.deepEqual(tmall.items.map((item) => item.platform), ['taobao', 'tmall']);
  assert.equal(tmall.items[0].title, '27英寸显示器');
});

test('marketplace links preserve complete navigation context separately from source identity', () => {
  for (const host of ['item.taobao.com', 'detail.tmall.com']) {
    const href = `https://${host}/item.htm?id=1001&mi_id=synthetic&pvid=fixture-pvid&scm=1007.fixture&skuId=9001&spm=a21bo.tmall%2Fa.fixture&utparam=%7B%22isLogin%22%3Atrue%2C%22item_price%22%3A%2269.38%22%2C%22userId%22%3A0%7D&xxc=home_recommend`;
    const product = marketplaceProductLink(href);
    assert.equal(product.navigationUrl, href);
    assert.equal(product.sourceUrl, `https://${host}/item.htm?id=1001&skuId=9001`);
    assert.equal(product.platform, host === 'item.taobao.com' ? 'taobao' : 'tmall');
    assert.equal(product.price, undefined);
    assert.equal(marketplaceProductLink(`${href}#fragment`).navigationUrl, `${href}#fragment`);
  }
  assert.equal(marketplaceProductLink('//detail.tmall.com/item.htm?id=1001&skuId=9001&spm=fixture', 'https://www.tmall.com/').navigationUrl, 'https://detail.tmall.com/item.htm?id=1001&skuId=9001&spm=fixture');
});

test('search card dedupe keeps the richest native navigation link and independently retains platforms', () => {
  const href = 'https://detail.tmall.com/item.htm?id=1001&skuId=9001&mi_id=fixture&spm=fixture&xxc=search';
  for (const anchors of [
    `<a href="https://detail.tmall.com/item.htm?id=1001">犬粮商品名</a><a href="${href}"></a>`,
    `<a href="${href}">犬粮商品名</a><a href="https://detail.tmall.com/item.htm?id=1001"></a>`,
  ]) {
    mount(`<html><body>${anchors}<a href="https://item.taobao.com/item.htm?id=1001&mi_id=other">淘宝同编号商品</a></body></html>`, 'https://www.taobao.com/search?q=猫粮');
    const result = extractSiteResearch({ ...macroInput });
    assert.equal(result.items.length, 2); assert.equal(result.items[0].title, '犬粮商品名');
    assert.equal(result.items[0].navigationUrl, href); assert.equal(result.items[0].sourceUrl, 'https://detail.tmall.com/item.htm?id=1001&skuId=9001');
    assert.equal(result.items[1].platform, 'taobao');
  }
});

test('full navigation URLs keep exact host, path, credentials and product-id validation', () => {
  for (const href of ['https://detail.tmall.com.evil.test/item.htm?id=1001&mi_id=fixture', 'https://user@detail.tmall.com/item.htm?id=1001&mi_id=fixture',
    'https://detail.tmall.com:8443/item.htm?id=1001&mi_id=fixture', 'https://detail.tmall.com/search?id=1001&mi_id=fixture',
    'https://detail.tmall.com/item.htm?id=abc&mi_id=fixture', 'javascript:alert(1)']) assert.equal(marketplaceProductLink(href), null);
});

test('home recommendations, detail pages and stale searches are not accepted as keyword results', async () => {
  for (const url of ['https://www.taobao.com/', 'https://item.taobao.com/item.htm?id=1001', 'https://www.taobao.com/search?q=旧关键词']) {
    await page('taobao', url);
    const result = extractSiteResearch({ site: 'taobao', operation: 'search', query: '猫粮' });
    assert.equal(result.items.length, 0); assert.equal(result.pageState.results.status, 'loading');
  }
  assert.equal(marketplaceSurface('https://taobao.com.evil.test/search?q=猫粮'), 'page');
  assert.equal(marketplaceProductLink('https://item.taobao.com/item.htm?id=abc'), null);
});

for (const [html, url, reason] of [
  ['<p>请登录后继续</p>', 'https://login.taobao.com/member/login.jhtml', 'login_required'],
  ['<p>请拖动滑块完成验证</p>', 'https://www.taobao.com/search?q=猫粮', 'security_verification_required'],
  ['<p>操作频繁，请稍后再试</p>', 'https://list.tmall.com/search_product.htm?q=猫粮', 'rate_limited'],
]) {
  test(`search and submission stop at ${reason}`, async () => {
    mount(`<html><body>${html}</body></html>`, url);
    assert.equal(extractSiteResearch({ ...macroInput }).reason, reason);
    assert.equal((await submitSiteResearchSearch(macroInput)).reason, reason);
  });
}

test('macro follows only the search page new child tab and reports both owned tabs for cleanup', async () => {
  const h = macroDeps({ child: true });
  const result = await runSiteResearch(macroInput, h.deps);
  assert.equal(result.success, true); assert.equal(result.tab.id, 11);
  assert.deepEqual(result.cleanupTabIds, [10, 11]); assert.deepEqual(h.claimed, [10, 11]); assert.deepEqual(h.reads, [11]);
  assert.equal(result.items.length, 2);
});

for (const throwRead of [false, true]) {
  test(`late task search children are returned for cleanup after ${throwRead ? 'extraction failure' : 'successful extraction'}, while user and pre-existing tabs remain untouched`, async () => {
    const h = macroDeps({ lateChild: true, existingChild: true, throwRead });
    const result = await runSiteResearch(macroInput, h.deps);
    assert.equal(result.success, !throwRead);
    assert.deepEqual(result.cleanupTabIds, [10, 11]);
    assert.deepEqual(h.claimed, [10, 11]);
    assert.deepEqual(h.reads, [10]);
  });
}

test('search runtime errors return owned tabs and bounded scroll gates stop before snapshots', async () => {
  const timeout = macroDeps({ throwRead: true });
  const failed = await runSiteResearch(macroInput, timeout.deps);
  assert.equal(failed.reason, 'research_runtime_failed'); assert.deepEqual(failed.cleanupTabIds, [10]);
  const h = macroDeps({ read: (count) => count === 1 ? { success: true, items: [{ id: '1', platform: 'taobao' }], pageState: { results: { status: 'ready' } } } : { success: false, reason: 'rate_limited', items: [] } });
  const gated = await runSiteResearch({ ...macroInput, limit: 10 }, h.deps);
  assert.equal(gated.success, false); assert.equal(gated.reason, 'rate_limited'); assert.equal(h.scrolls.length, 1);
});

test('initial gates and stalled results do not trigger further page interactions', async () => {
  const blocked = macroDeps({ read: () => ({ success: false, reason: 'login_required' }) });
  const result = await runSiteResearch(macroInput, blocked.deps);
  assert.equal(result.reason, 'login_required'); assert.equal(blocked.scrolls.length, 0);
  const stalled = macroDeps();
  assert.equal((await runSiteResearch({ ...macroInput, limit: 10, maxScrolls: 8 }, stalled.deps)).success, true);
  assert.equal(stalled.scrolls.length, 2);
});

test('capture identity contract rejects mismatched product/page and permits same-ID Taobao/Tmall redirects', () => {
  const expected = { externalId: '1', platforms: ['taobao', 'tmall'] };
  assert.doesNotThrow(() => assertExpectedProductMatches('https://detail.tmall.com/item.htm?id=1', expected, { platform: 'tmall', externalId: '1' }));
  for (const url of ['https://item.taobao.com/item.htm?id=2', 'https://item.jd.com/1.html', 'https://www.taobao.com/', 'https://item.taobao.com.evil.test/item.htm?id=1']) assert.throws(() => assertExpectedProductMatches(url, expected), /不一致/);
  assert.throws(() => assertExpectedProductMatches('https://item.taobao.com/item.htm?id=1', { externalId: '1', platforms: ['other'] }), /参数无效/);
  assert.throws(() => assertExpectedProductMatches('https://item.taobao.com/item.htm?id=1', expected, { platform: 'taobao', externalId: '2' }), /不一致/);
});

test('Tmall supermarket links and same-item landing pages stay Tmall with exact-host validation', () => {
  const href = 'https://chaoshi.detail.tmall.com/item.htm?id=1001&skuId=9001&spm=fixture';
  const product = marketplaceProductLink(href);
  assert.equal(product.platform, 'tmall'); assert.equal(product.navigationUrl, href);
  assert.equal(product.sourceUrl, 'https://chaoshi.detail.tmall.com/item.htm?id=1001&skuId=9001');
  assert.equal(marketplaceSurface(href), 'detail');
  assert.equal(getProductCaptureAdapter(href).platform, 'tmall');
  const expected = { externalId: '1001', platforms: ['taobao', 'tmall'] };
  assert.doesNotThrow(() => assertExpectedProductMatches(href, expected, { platform: 'tmall', externalId: '1001' }));
  assert.throws(() => assertExpectedProductMatches(href.replace('id=1001', 'id=1002'), expected), { code: 'BROWSER_PRODUCT_IDENTITY_MISMATCH' });
  for (const value of [href.replace('chaoshi.detail.tmall.com', 'chaoshi.detail.tmall.com.evil.test'),
    href.replace('chaoshi.detail.tmall.com', 'other.detail.tmall.com'), href.replace('https://', 'https://user@'),
    href.replace('/item.htm', ':8443/item.htm'), href.replace('/item.htm', '/shop.htm')]) {
    assert.equal(marketplaceProductLink(value), null); assert.equal(getProductCaptureAdapter(value), null);
    assert.throws(() => assertExpectedProductMatches(value, expected), { code: 'BROWSER_PRODUCT_IDENTITY_MISMATCH' });
  }
});

test('identity rejections retain a typed code and safe item diagnostics through the browser error envelope', async () => {
  const expected = { externalId: '1001', platforms: ['taobao', 'tmall'] };
  let rejected;
  try {
    assertExpectedProductMatches('https://detail.tmall.com/item.htm?id=1002&utparam=private-attribution', expected);
  } catch (error) { rejected = error; }
  assert.equal(rejected.code, 'BROWSER_PRODUCT_IDENTITY_MISMATCH');
  assert.match(rejected.message, /搜索商品 1001.*实际页面 detail.tmall.com\/item.htm，商品 1002/);
  assert.ok(!rejected.message.includes('private-attribution'));
  const source = await fs.readFile(new URL('../src/browserControlBackground.js', import.meta.url), 'utf8');
  const start = source.indexOf('function buildBrowserActionError(');
  const end = source.indexOf('\nasync function publishPolicyDecisionAudit(', start);
  const context = { describeErrorMessage: (error) => error.message, isCdpCommandTimeoutError: () => false };
  vm.runInNewContext(source.slice(start, end), context);
  const envelope = context.buildBrowserActionError(rejected, { type: 'capture.save', tabId: 7 });
  assert.equal(envelope.code, rejected.code); assert.equal(envelope.retryable, false);
  assert.equal(envelope.message, rejected.message);
});

test('a wrong landing item is rejected before extraction, review interaction or persistence', async () => {
  const source = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('async function previewJdProductFromTab('), source.indexOf('\nasync function saveCurrentPageLinkFromTab'));
  const context = {
    chrome: { tabs: { get: async () => ({ url: 'https://detail.tmall.com/item.htm?id=1002' }) } },
    getProductCaptureAdapter, assertExpectedProductMatches,
    runExtraction: async () => assert.fail('Wrong items must not be extracted'),
    requestNativeHost: async () => assert.fail('Wrong items must not be persisted'),
  };
  vm.runInNewContext(functions, context);
  await assert.rejects(context.saveJdProductFromTab(7, {}, { externalId: '1001', platforms: ['taobao', 'tmall'] }), { code: 'BROWSER_PRODUCT_IDENTITY_MISMATCH' });
});

test('capture mismatch never reaches reviews or assets.ingestProduct; valid partial capture keeps saved identity', async () => {
  const source = await fs.readFile(new URL('../src/background.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('async function previewJdProductFromTab('), source.indexOf('\nasync function saveCurrentPageLinkFromTab'));
  let extractionCount = 0; let persisted = 0; let id = '2';
  const context = {
    chrome: { tabs: { get: async () => ({ url: 'https://item.taobao.com/item.htm?id=1' }) } }, getProductCaptureAdapter, assertExpectedProductMatches,
    normalizeText: (v) => String(v || '').trim(), createBridgeOperationId: () => 'operation',
    runExtraction: async (_id, _fn, { args }) => { extractionCount++; return args[0] === 'product' ? { sourceUrl: 'https://item.taobao.com/item.htm?id=1', platform: 'taobao', externalId: id, title: '商品' } : { accessErrorCode: 'BROWSER_LOGIN_REQUIRED', status: 'partial', reviews: [], warnings: ['登录受限'] }; },
    requestNativeHost: async (_method, params) => { assert.equal(params.spaceId, 'task-space'); persisted++; return { productId: 'p', snapshotId: 's' }; },
  };
  vm.runInNewContext(functions, context);
  const expected = { externalId: '1', platforms: ['taobao', 'tmall'] };
  await assert.rejects(context.saveJdProductFromTab(1, {}, expected, 'task-space'), /不一致/);
  assert.equal(extractionCount, 1); assert.equal(persisted, 0);
  id = '1';
  const result = await context.saveJdProductFromTab(1, {}, expected, 'task-space');
  assert.equal(persisted, 1); assert.equal(result.externalId, '1'); assert.equal(result.reviewAccessErrorCode, 'BROWSER_LOGIN_REQUIRED');
  assert.equal(extractionCount, 3);
});

test('explicit empty marketplace search results stop readiness waits, and gated extract steps never retry', async () => {
  mount('<html><body>没有找到相关宝贝</body></html>', 'https://www.taobao.com/search?q=猫粮');
  assert.equal(extractSiteResearch(macroInput).pageState.results.status, 'empty');
  const h = macroDeps({ read: () => ({ success: false, reason: 'rate_limited', items: [] }) });
  const result = await runSiteResearch({ ...macroInput, tabId: 10, executionMode: 'extract' }, h.deps);
  assert.equal(result.reason, 'rate_limited'); assert.equal(h.reads.length, 1); assert.equal(h.scrolls.length, 0);
});

test('shared search navigation is explicit while site ownership remains distinct', () => {
  const tb = normalizeResearchRequest({ ...macroInput, site: 'taobao' });
  const tm = normalizeResearchRequest({ ...macroInput, site: 'tmall', url: 'https://www.taobao.com/search?q=猫粮' });
  assert.deepEqual(tb.site.hosts, ['taobao.com']); assert.deepEqual(tm.site.hosts, ['tmall.com']);
  assert.deepEqual(tm.site.searchNavigationHostPatterns, ['taobao.com', 'tmall.com']);
});

test('redirects outside declared marketplace hosts stop before content reads', async () => {
  const h = macroDeps(); h.deps.getTab = async () => ({ id: 10, url: 'https://evil.test/search' });
  const result = await runSiteResearch(macroInput, h.deps);
  assert.equal(result.reason, 'search_left_platform'); assert.deepEqual(h.reads, []); assert.deepEqual(result.cleanupTabIds, [10]);
});

test('detail identity guard classifies marketplace login/verification redirects as immediate access stops', () => {
  const expected = { externalId: '1', platforms: ['taobao', 'tmall'] };
  for (const [url, code] of [
    ['https://login.taobao.com/member/login.jhtml', 'BROWSER_LOGIN_REQUIRED'],
    ['https://login.tmall.com/', 'BROWSER_LOGIN_REQUIRED'],
    ['https://punish.taobao.com/', 'BROWSER_SECURITY_CHALLENGE'],
    ['https://item.taobao.com/_____tmd_____/punish', 'BROWSER_SECURITY_CHALLENGE'],
  ]) assert.throws(() => assertExpectedProductMatches(url, expected), (error) => error.code === code);
});
