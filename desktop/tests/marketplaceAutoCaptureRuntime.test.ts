import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { marketplaceCapturePlatform, resolveMarketplaceAutoCaptureLaunch, TAOBAO_AUTO_CAPTURE_TASK_ID, TMALL_AUTO_CAPTURE_TASK_ID } from '../electron/core/marketplaceAutoCaptureSettings.ts';
import { runProductStructuredCaptureRound, uniqueProductSearchCards, normalizeProductUrl, normalizeProductNavigationUrl, type ProductStructuredCaptureIo } from '../electron/core/productStructuredCapture.ts';

const input = { keyword: '成猫猫粮', maxProducts: 2, reviewFilterLabels: [], reviewsPerFilter: 5, pacing: 'normal' as const };
const card = (id: string, platform = 'taobao') => ({ title: `猫粮 ${id}`, sourceUrl: `https://${platform === 'taobao' ? 'item.taobao.com' : 'detail.tmall.com'}/item.htm?id=${id}&spm=tracking` });
function harness(options: { cards?: any[]; search?: any; saves?: any[]; refill?: any[]; throwSave?: Error } = {}) {
    const calls: Array<{ name: string; args: any }> = [];
    let tabId = 100;
    let saves = 0;
    const io: ProductStructuredCaptureIo = {
        checkPluginInstance: () => ({ ok: true, detail: 'connected' }), sleep: async () => {},
        invokeBrowserControl: async (_method, params) => {
            const name = String(params.name); const args: any = params.arguments; calls.push({ name, args });
            if (name === 'research.run') return options.search || { success: true, tab: { id: 10 }, cleanupTabIds: [10, 11], items: args.executionMode ? options.refill || [] : options.cards || [card('1'), card('2')] };
            if (name === 'tab.create') return { tab: { id: ++tabId } };
            if (name === 'capture.save') {
                if (options.throwSave) throw options.throwSave;
                return { success: true, productId: `p${saves}`, snapshotId: `s${saves}`, capturedReviews: 5, tabClosed: true, ...options.saves?.[saves++] };
            }
            return { success: true };
        },
    };
    return { io, calls };
}

test('marketplace task IDs route explicitly and keyword/review settings stay bounded', () => {
    assert.equal(marketplaceCapturePlatform(TAOBAO_AUTO_CAPTURE_TASK_ID), 'taobao');
    assert.equal(marketplaceCapturePlatform(TMALL_AUTO_CAPTURE_TASK_ID), 'tmall');
    assert.equal(marketplaceCapturePlatform('other'), null);
    const settings = { keywords: '猫粮，显示器\n猫粮', maxProductsPerRun: 99, reviewsPerFilter: -1 };
    const a = resolveMarketplaceAutoCaptureLaunch(settings, 0);
    assert.deepEqual(a.allKeywords, ['猫粮', '显示器']); assert.equal(a.keyword, '猫粮');
    assert.equal(resolveMarketplaceAutoCaptureLaunch(settings, 86400000).keyword, '显示器');
    assert.equal(a.maxProductsPerRun, 20); assert.equal(a.reviewsPerFilter, 1); assert.equal(a.pacing, 'conservative');
    assert.deepEqual(a.reviewFilterLabels, []);
});

test('marketplace cards use exact detail hosts, preserve selected SKU and retain independent platform identities', () => {
    const cards = uniqueProductSearchCards([card('1'), card('1'), card('1', 'tmall'), { url: 'https://item.taobao.com/item.htm?id=2&skuId=123&tracking=1' },
        { url: 'https://item.taobao.com.evil.test/item.htm?id=3' }, { url: 'https://user@item.taobao.com/item.htm?id=3' }, { url: 'https://item.taobao.com:8443/item.htm?id=3' }, { url: 'https://item.taobao.com/shop.htm?id=3' }, { url: 'https://item.jd.com/3.html' }], 'tmall');
    assert.deepEqual(cards.map((c) => c.key), ['taobao:1', 'tmall:1', 'taobao:2']);
    assert.equal(cards[2].sourceUrl, 'https://item.taobao.com/item.htm?id=2&skuId=123');
    assert.equal(normalizeProductUrl('javascript:alert(1)', 'taobao'), '');
});

test('complete marketplace navigation links survive plugin extraction and desktop opening without changing source identity', async () => {
    const { marketplaceProductLink } = await import(new URL('../../Plugin/src/content/marketplaceSearch.js', import.meta.url).href);
    for (const host of ['item.taobao.com', 'detail.tmall.com']) {
        const href = `https://${host}/item.htm?id=1001&mi_id=synthetic&pvid=fixture-pvid&scm=1007.fixture&skuId=9001&spm=a21bo.tmall%2Fa.fixture&utparam=%7B%22isLogin%22%3Atrue%2C%22item_price%22%3A%2269.38%22%2C%22userId%22%3A0%7D&xxc=home_recommend`;
        const fromPlugin = marketplaceProductLink(href);
        const h = harness({ cards: [{ ...fromPlugin, title: '犬粮' }] });
        const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'tmall' }, h.io);
        assert.equal(h.calls.find((call) => call.name === 'tab.create')!.args.url, href);
        assert.deepEqual(h.calls.find((call) => call.name === 'capture.save')!.args.expectedProduct, { externalId: '1001', platforms: ['taobao', 'tmall'] });
        assert.equal(round.products[0].platform, fromPlugin.platform);
        assert.equal(round.products[0].sourceUrl, `https://${host}/item.htm?id=1001&skuId=9001`);
        assert.ok(!round.summary.includes('utparam')); assert.ok(!round.summary.includes('69.38'));
    }
});

test('legacy raw card URLs preserve navigation parameters, while JD retains its established normalization', () => {
    const href = 'https://detail.tmall.com/item.htm?id=1001&skuId=9001&mi_id=fixture&spm=fixture';
    const [card] = uniqueProductSearchCards([{ url: href }], 'tmall');
    assert.equal(card.navigationUrl, href); assert.equal(card.sourceUrl, 'https://detail.tmall.com/item.htm?id=1001&skuId=9001');
    assert.equal(normalizeProductNavigationUrl(`${href}#fragment`, 'tmall'), `${href}#fragment`);
    assert.equal(normalizeProductNavigationUrl(href.replace('https:', 'http:'), 'tmall'), href);
    const [jd] = uniqueProductSearchCards([{ sourceUrl: 'https://item.jd.com/1001.html?utm=fixture', navigationUrl: href }], 'jd');
    assert.equal(jd.navigationUrl, 'https://item.jd.com/1001.html');
});

test('supermarket search cards retain full navigation and landings are reported as Tmall', async () => {
    const { marketplaceProductLink } = await import(new URL('../../Plugin/src/content/marketplaceSearch.js', import.meta.url).href);
    const href = 'https://chaoshi.detail.tmall.com/item.htm?id=1001&skuId=9001&mi_id=fixture&spm=fixture';
    const parsed = marketplaceProductLink(href);
    const [item] = uniqueProductSearchCards([parsed], 'tmall');
    assert.equal(item.platform, 'tmall'); assert.equal(item.key, 'tmall:1001'); assert.equal(item.navigationUrl, href);
    const h = harness({ cards: [parsed], saves: [{ platform: 'tmall', externalId: '1001', sourceUrl: 'https://chaoshi.detail.tmall.com/item.htm?id=1001' }] });
    const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'tmall' }, h.io);
    assert.equal(round.status, 'captured'); assert.equal(round.saved, 1);
    assert.equal(h.calls.find((c) => c.name === 'tab.create')!.args.url, href);
    assert.equal(round.products[0].platform, 'tmall'); assert.equal(round.products[0].sourceUrl, 'https://chaoshi.detail.tmall.com/item.htm?id=1001');
    for (const value of [href.replace('chaoshi.detail.tmall.com', 'chaoshi.detail.tmall.com.evil.test'), href.replace('chaoshi.detail.tmall.com', 'other.detail.tmall.com'), href.replace('https://', 'https://user@')]) {
        assert.deepEqual(uniqueProductSearchCards([{ sourceUrl: value }], 'tmall'), []);
    }
});

test('unsafe or mismatched navigation targets are rejected before opening or saving products', async () => {
    const sourceUrl = 'https://detail.tmall.com/item.htm?id=1001&skuId=9001';
    const invalid = ['https://detail.tmall.com.evil.test/item.htm?id=1001&skuId=9001', 'https://user@detail.tmall.com/item.htm?id=1001&skuId=9001',
        'https://detail.tmall.com:8443/item.htm?id=1001&skuId=9001', 'https://detail.tmall.com/search?id=1001&skuId=9001',
        'https://detail.tmall.com/item.htm?id=1002&skuId=9001', 'https://item.taobao.com/item.htm?id=1001&skuId=9001',
        'https://detail.tmall.com/item.htm?id=1001&skuId=9002', 'javascript:alert(1)'];
    for (const navigationUrl of invalid) {
        assert.deepEqual(uniqueProductSearchCards([{ sourceUrl, navigationUrl }], 'tmall'), []);
        const h = harness({ cards: [{ sourceUrl, navigationUrl }] });
        const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'tmall' }, h.io);
        assert.equal(round.status, 'failed'); assert.ok(!h.calls.some((call) => ['tab.create', 'capture.save'].includes(call.name)));
    }
});

for (const platform of ['taobao', 'tmall'] as const) {
    test(`${platform} structured search uses plugin capture and closes only owned tabs`, async () => {
        const h = harness({ saves: [{ duplicate: true }, {}, {}], refill: [card('3')] });
        const round = await runProductStructuredCaptureRound({ ...input, platform, captureSpaceId: 'task-space', reviewFilterLabels: ['有图'], reviewsPerFilter: 7 }, h.io);
        assert.equal(round.status, 'captured'); assert.equal(round.saved, 2); assert.equal(round.recaptured, 1);
        const search = h.calls[0].args;
        assert.equal(search.site, platform); assert.equal(search.reuseExistingTab, false); assert.equal(search.depth, 'preview');
        assert.ok(h.calls.some((c) => c.name === 'research.run' && c.args.executionMode === 'extract'));
        const save = h.calls.find((c) => c.name === 'capture.save')!.args;
        assert.equal(save.captureSpaceId, 'task-space');
        assert.deepEqual(save.expectedProduct, { externalId: '1', platforms: ['taobao', 'tmall'] });
        assert.deepEqual(save.reviewOptions.selectedFilterLabels, ['有图']); assert.equal(save.reviewOptions.limitPerFilter, 7); assert.equal(save.reviewOptions.captureAll, false);
        assert.deepEqual(h.calls.filter((c) => c.name === 'tab.close').map((c) => c.args.tabId), [10, 11]);
    });
}

test('review access restriction retains the saved product and stops before the next page', async () => {
    const h = harness({ saves: [{ platform: 'tmall', externalId: '1', sourceUrl: card('1', 'tmall').sourceUrl, reviewAccessErrorCode: 'BROWSER_SECURITY_CHALLENGE', reviewWarnings: ['评论验证未完成'] }] });
    const round = await runProductStructuredCaptureRound({ ...input, platform: 'taobao' }, h.io);
    assert.equal(round.status, 'blocked'); assert.equal(round.saved, 1); assert.equal(round.failed, 0);
    assert.equal(round.products[0].productId, 'p0'); assert.equal(round.products[0].platform, 'tmall');
    assert.match(round.summary, /评论验证未完成/); assert.match(round.reason!, /资料已保存/);
    assert.equal(h.calls.filter((c) => c.name === 'tab.create').length, 1);
});

test('search and save gates stop immediately and all task tabs are cleaned up', async () => {
    const h = harness({ search: { success: false, reason: 'rate_limited', tab: { id: 10 }, cleanupTabIds: [10, 11] } });
    assert.equal((await runProductStructuredCaptureRound({ ...input, platform: 'tmall' }, h.io)).status, 'blocked');
    assert.deepEqual(h.calls.map((c) => c.name), ['research.run', 'tab.close', 'tab.close']);
    const second = harness({ throwSave: Object.assign(new Error('login'), { code: 'BROWSER_LOGIN_REQUIRED' }) });
    assert.equal((await runProductStructuredCaptureRound({ ...input, platform: 'taobao' }, second.io)).status, 'blocked');
    assert.equal(second.calls.filter((c) => c.name === 'tab.create').length, 1);
    assert.deepEqual(second.calls.filter((c) => c.name === 'tab.close').map((c) => c.args.tabId), [101, 10, 11]);
});

test('partial reviews and missing fields remain visible without failing an otherwise saved product', async () => {
    const h = harness({ saves: [{ reviewWarnings: ['有图标签不存在'], missingFields: ['当前价格'], capturedReviews: 0 }] });
    const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'taobao' }, h.io);
    assert.equal(round.status, 'captured'); assert.match(round.summary, /有图标签不存在/); assert.match(round.summary, /当前价格/);
    assert.deepEqual(h.calls.find((c) => c.name === 'capture.save')!.args.reviewOptions.selectedFilterLabels, []);
});

test('batch reports distinguish incomplete saved products from complete captures and failed saves', async () => {
    const h = harness({ cards: [card('1'), card('2'), card('3'), card('4')], saves: [
        {}, { missingFields: ['当前价格', '商品参数', '商品详情'], reviewWarnings: ['未识别到评价区域'], capturedReviews: 0 },
        { reviewWarnings: ['评论图片未就绪'] }, { success: false, error: '缺少名称' },
    ] });
    const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 4, platform: 'tmall' }, h.io);
    assert.equal(round.saved, 3); assert.equal(round.failed, 1);
    assert.match(round.summary, /其中 2 个商品的资料或评论待补充/);
    assert.match(round.summary, /猫粮 1：已保存，评论 5 条/);
    assert.match(round.summary, /猫粮 2：已保存（采集不完整）.*缺失资料：当前价格、商品参数、商品详情.*评论提示：未识别到评价区域/);
    assert.match(round.summary, /猫粮 3：已保存（采集不完整）.*评论提示：评论图片未就绪/);
    assert.match(round.summary, /猫粮 4：失败，缺少名称/);
});

test('two runtime failures stop with their actual reason and duplicate-only rounds have bounded refill and attempt limits', async () => {
    const fail = harness({ saves: [{ success: false, error: 'missing title' }, { success: false, error: 'missing title' }] });
    const failedRound = await runProductStructuredCaptureRound({ ...input, platform: 'taobao' }, fail.io);
    assert.equal(failedRound.failed, 2); assert.equal(failedRound.status, 'failed');
    assert.match(failedRound.reason!, /missing title/); assert.ok(!failedRound.summary.includes('风控'));
    const cards = Array.from({ length: 40 }, (_, i) => card(String(i + 1)));
    const h = harness({ cards, saves: cards.map(() => ({ duplicate: true })) });
    const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'tmall' }, h.io);
    assert.equal(round.recaptured, 12); assert.equal(round.saved, 0); assert.match(round.reason!, /尝试上限/);
    assert.equal(h.calls.filter((c) => c.name === 'tab.create').length, 12);
    assert.equal(round.status, 'partial');
});

const mismatch = (expected: string, actual: string) => ({ success: false, tabClosed: false,
    browserError: { code: 'BROWSER_PRODUCT_IDENTITY_MISMATCH', message: `商品详情与搜索卡片不一致（搜索商品 ${expected}；实际页面商品 ${actual}）` },
});

test('two rejected card identities skip only those candidates and still reach the new-product quota', async () => {
    const h = harness({ cards: [card('1'), card('2'), card('3'), card('4')], saves: [mismatch('1', '91'), mismatch('2', '92'), {}, {}] });
    const round = await runProductStructuredCaptureRound({ ...input, platform: 'tmall' }, h.io);
    assert.equal(round.status, 'captured'); assert.equal(round.attempted, 4); assert.equal(round.saved, 2); assert.equal(round.failed, 2);
    assert.equal(round.products[0].errorCode, 'BROWSER_PRODUCT_IDENTITY_MISMATCH');
    assert.equal(round.products[0].externalId, '1'); assert.equal(round.products[0].productId, undefined);
    assert.match(round.summary, /搜索商品 1；实际页面商品 91/);
    assert.match(round.summary, /来源：https:\/\/item.taobao.com\/item.htm\?id=1/);
    assert.ok(!round.summary.includes('风控'));
    assert.deepEqual(h.calls.filter((c) => c.name === 'tab.close').map((c) => c.args.tabId), [101, 102, 10, 11]);
});

test('identity skips reset unrelated consecutive failures but remain bounded by the round attempt limit', async () => {
    const mixed = harness({ cards: [card('1'), card('2'), card('3'), card('4')], saves: [
        { success: false, error: 'name missing' }, mismatch('2', '92'), { success: false, error: 'name missing' }, {},
    ] });
    assert.equal((await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'taobao' }, mixed.io)).saved, 1);
    const cards = Array.from({ length: 40 }, (_, i) => card(String(i + 1)));
    const all = harness({ cards, saves: cards.map((c) => mismatch(c.sourceUrl, '999')) });
    const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 1, platform: 'tmall' }, all.io);
    assert.equal(round.status, 'failed'); assert.equal(round.attempted, 12); assert.equal(round.saved, 0);
    assert.match(round.reason!, /尝试上限/); assert.equal(all.calls.filter((c) => c.name === 'tab.create').length, 12);
});

test('partial rounds preserve saved data and report the unmet quota and ordinary failure cause', async () => {
    const h = harness({ cards: [card('1'), card('2'), card('3'), card('4')], saves: [{}, { success: false, error: 'page missing name' }, { success: false, error: 'page missing name' }] });
    const round = await runProductStructuredCaptureRound({ ...input, maxProducts: 5, platform: 'tmall' }, h.io);
    assert.equal(round.status, 'partial'); assert.equal(round.saved, 1); assert.equal(round.failed, 2);
    assert.equal(round.products[0].productId, 'p0'); assert.match(round.reason!, /目标 5.*page missing name/);
    assert.equal(h.calls.filter((c) => c.name === 'tab.create').length, 3);
});

test('structured access gates in the browser error envelope stop immediately without depending on message wording', async () => {
    const h = harness({ saves: [{ success: false, browserError: { code: 'BROWSER_RATE_LIMITED', message: 'request rejected' } }] });
    const round = await runProductStructuredCaptureRound({ ...input, platform: 'tmall' }, h.io);
    assert.equal(round.status, 'blocked'); assert.equal(round.failed, 1); assert.match(round.reason!, /request rejected/);
    assert.equal(h.calls.filter((c) => c.name === 'tab.create').length, 1);
});

test('marketplace builtin configuration and readiness use existing schedule/bridge contracts', async () => {
    const source = await fs.readFile(new URL('../electron/core/builtinAutomationTasks.ts', import.meta.url), 'utf8');
    const schema = source.slice(source.indexOf('const JD_AUTO_CAPTURE_SETTINGS:'), source.indexOf('function buildJdAutoCapturePrompt'));
    const readiness = source.slice(source.indexOf('async function checkJdAutoCaptureReadiness('), source.indexOf('export function resolveXhsAutoCaptureLaunch'));
    const code = (await transform(`${schema}\n${readiness}\nglobalThis.definition = marketplaceAutoCaptureDefinition;`, { loader: 'ts' })).code;
    let connected = false;
    const context: any = { TAOBAO_AUTO_CAPTURE_TASK_ID, TMALL_AUTO_CAPTURE_TASK_ID, resolveJdAutoCaptureLaunch: resolveMarketplaceAutoCaptureLaunch, resolveMarketplaceAutoCaptureLaunch, JD_AUTO_CAPTURE_TASK_ID: 'jd', nowIso: () => new Date(0).toISOString(), getBrowserCaptureBridgeService: () => ({ getStatus: () => ({ instances: connected ? [{ extensionKind: 'capture' }] : [] }) }) };
    vm.runInNewContext(code, context);
    for (const platform of ['taobao', 'tmall']) {
        const definition = context.definition(platform);
        assert.equal(definition.trigger.kind, 'schedule'); assert.match(definition.description, /默认关闭/);
        assert.match(definition.settingsSchema.find((f: any) => f.key === 'reviewFilterLabels').description, /当前评价列表/);
        assert.match(definition.buildPrompt({ keywords: ['猫粮'] }), /当前评价列表/);
        assert.equal((await definition.checkReadiness({})).ready, false);
        assert.equal((await definition.checkReadiness({ keywords: ['猫粮'] })).ready, false);
        connected = true;
        assert.equal((await definition.checkReadiness({ keywords: ['猫粮'] })).ready, true);
        connected = false;
    }
});

test('search timeout detail survives into the report while all owned search tabs close', async () => {
    const h = harness({ search: { success: false, reason: 'research_runtime_failed', message: 'content script timeout', tab: { id: 10 }, cleanupTabIds: [10, 11] } });
    const round = await runProductStructuredCaptureRound({ ...input, platform: 'taobao' }, h.io);
    assert.equal(round.status, 'failed'); assert.match(round.reason!, /content script timeout/);
    assert.deepEqual(h.calls.filter((c) => c.name === 'tab.close').map((c) => c.args.tabId), [10, 11]);
});
