import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    JD_AUTO_CAPTURE_TASK_ID,
    resolveJdAutoCaptureLaunch,
} from '../electron/core/jdAutoCaptureSettings.ts';
import {
    extractJdProductId,
    isJdCaptureBlocker,
    parseJdCaptureSaveResult,
    parseJdResearchResult,
    runJdStructuredCaptureRound,
    uniqueJdSearchCards,
    type JdStructuredCaptureIo,
} from '../electron/core/jdStructuredCapture.ts';

function searchResult(items: Array<Record<string, unknown>>, tabId = 12): Record<string, unknown> {
    return { success: true, kind: 'browser_research', tab: { id: tabId }, items };
}

function productCard(id: string, title = `商品 ${id}`): Record<string, unknown> {
    return { id, title, sourceUrl: `https://item.jd.com/${id}.html?tracking=search` };
}

test('JD builtin task exposes keyword, product-count, and review-label settings', () => {
    const source = fs.readFileSync(path.resolve('electron/core/builtinAutomationTasks.ts'), 'utf8');
    assert.equal(JD_AUTO_CAPTURE_TASK_ID, 'jd-product-auto-capture');
    assert.match(source, /id: JD_AUTO_CAPTURE_TASK_ID/);
    assert.match(source, /name: '京东商品自动采集'/);
    assert.match(source, /requiredSkills: \['jd-auto-capture'\]/);
    for (const key of ['keywords', 'maxProductsPerRun', 'reviewFilterLabels', 'pacing']) {
        assert.match(source, new RegExp(`key: '${key}'`));
    }
    assert.doesNotMatch(source, /key: 'reviewsPerFilter'/);
    assert.doesNotMatch(source, /key: 'productUrls'/);
});

test('resolves and rotates JD search keywords while preserving review labels', () => {
    const settings = {
        keywords: ['冻干猫粮', '露营帐篷', '儿童书桌', '冻干猫粮'],
        maxProductsPerRun: 99,
        reviewFilterLabels: ['图/视频', '图/视频', '回头客'],
        pacing: 'unexpected',
    };
    const first = resolveJdAutoCaptureLaunch(settings, 0);
    assert.deepEqual(first.allKeywords, ['冻干猫粮', '露营帐篷', '儿童书桌']);
    assert.equal(first.keyword, '冻干猫粮');
    assert.equal(first.maxProductsPerRun, 20);
    assert.deepEqual(first.reviewFilterLabels, ['图/视频', '回头客']);
    assert.equal(first.pacing, 'conservative');

    const nextDay = resolveJdAutoCaptureLaunch(settings, 24 * 60 * 60 * 1_000);
    assert.equal(nextDay.keyword, '露营帐篷');
});

test('normalizes and deduplicates JD product cards returned by keyword search', () => {
    const cards = uniqueJdSearchCards([
        productCard('280930'),
        { sourceUrl: 'https://item.jd.com/280930.html?utm=duplicate', title: '重复商品' },
        { sourceUrl: 'https://item.jd.com.evil.test/280930.html', title: '伪造域名' },
        { sourceUrl: 'https://search.jd.com/Search?keyword=cat', title: '搜索页' },
        productCard('10001'),
    ]);
    assert.deepEqual(cards.map((card) => card.id), ['280930', '10001']);
    assert.deepEqual(cards.map((card) => card.sourceUrl), [
        'https://item.jd.com/280930.html',
        'https://item.jd.com/10001.html',
    ]);
    assert.equal(extractJdProductId('https://item.jd.com/280930.html?x=1'), '280930');
});

test('parses research results and saves only when product and snapshot ids exist', () => {
    const research = parseJdResearchResult({ response: { result: searchResult([productCard('1')], 9) } });
    assert.equal(research.ok, true);
    assert.equal(research.tabId, 9);
    assert.equal(research.items.length, 1);

    const parsed = parseJdCaptureSaveResult({
        result: {
            success: true,
            duplicate: true,
            title: '测试商品',
            productId: 'product-1',
            snapshotId: 'snapshot-2',
            capturedReviews: 15,
            importedImages: 8,
            importedReviewImages: 4,
            reviewWarnings: ['中评仅取得 2 条'],
            tabClosed: true,
        },
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.duplicate, true);
    assert.equal(parsed.capturedReviews, 15);
    assert.equal(parsed.tabClosed, true);
    assert.deepEqual(parsed.reviewWarnings, ['中评仅取得 2 条']);
    assert.equal(parseJdCaptureSaveResult({ success: true, productId: 'only-product' }).ok, false);
    assert.equal(isJdCaptureBlocker(Object.assign(new Error('blocked'), { code: 'BROWSER_SECURITY_CHALLENGE' })), true);
});

test('structured JD capture searches once, then opens, saves, and closes result products', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let nextTabId = 30;
    let saveIndex = 0;
    const io: JdStructuredCaptureIo = {
        checkPluginInstance: () => ({ ok: true, detail: 'connected' }),
        sleep: async () => undefined,
        invokeBrowserControl: async (_method, params) => {
            const name = String(params.name || '');
            const args = params.arguments as Record<string, unknown>;
            calls.push({ name, args });
            if (name === 'research.run') return searchResult([productCard('1'), productCard('2')]);
            if (name === 'tab.create') return { success: true, tab: { id: nextTabId++ } };
            if (name === 'capture.save') {
                saveIndex += 1;
                return {
                    success: true,
                    duplicate: saveIndex === 2,
                    title: `商品 ${saveIndex}`,
                    productId: `product-${saveIndex}`,
                    snapshotId: `snapshot-${saveIndex}`,
                    capturedReviews: 3,
                    importedImages: 8,
                    importedReviewImages: 1,
                    tabClosed: true,
                };
            }
            if (name === 'tab.close') return { success: true };
            throw new Error(`unexpected tool ${name}`);
        },
    };

    const round = await runJdStructuredCaptureRound({
        keyword: '冻干猫粮',
        maxProducts: 2,
        reviewFilterLabels: ['图/视频', '回头客'],
        pacing: 'normal',
    }, io);

    assert.equal(round.status, 'captured');
    assert.equal(round.keyword, '冻干猫粮');
    assert.equal(round.saved, 2);
    assert.equal(round.recaptured, 1);
    assert.equal(round.capturedReviews, 6);
    assert.deepEqual(calls.map((call) => call.name), [
        'research.run',
        'tab.create', 'capture.save',
        'tab.create', 'capture.save',
        'tab.close',
    ]);
    assert.deepEqual(calls[0].args, {
        site: 'jd',
        operation: 'search',
        query: '冻干猫粮',
        depth: 'preview',
        limit: 8,
        maxScrolls: 8,
        snapshot: false,
        active: true,
        reuseExistingTab: false,
        timeoutMs: 30000,
    });
    assert.equal(calls.find((call) => call.name === 'tab.create')?.args.active, true);
    assert.deepEqual(calls.at(-1), {
        name: 'tab.close',
        args: { tabId: 12, reason: 'jd_auto_capture_search_complete' },
    });
    assert.deepEqual(calls.find((call) => call.name === 'capture.save')?.args, {
        tabId: 30,
        closeAfterSave: true,
        reviewOptions: {
            selectedFilterLabels: ['图/视频', '回头客'],
            captureAll: true,
        },
    });
});

test('structured JD capture keeps successful snapshots and continues after one result fails', async () => {
    let nextTabId = 70;
    let saveIndex = 0;
    const closed: number[] = [];
    const round = await runJdStructuredCaptureRound({
        keyword: '猫粮',
        maxProducts: 2,
        reviewFilterLabels: [],
        pacing: 'conservative',
    }, {
        checkPluginInstance: () => ({ ok: true, detail: 'connected' }),
        sleep: async () => undefined,
        invokeBrowserControl: async (_method, params) => {
            const name = String(params.name || '');
            const args = params.arguments as Record<string, unknown>;
            if (name === 'research.run') return searchResult([productCard('1'), productCard('2'), productCard('3')]);
            if (name === 'tab.create') return { success: true, tab: { id: nextTabId++ } };
            if (name === 'capture.save') {
                saveIndex += 1;
                if (saveIndex === 2) throw new Error('商品页加载失败');
                return { success: true, productId: `p${saveIndex}`, snapshotId: `s${saveIndex}`, capturedReviews: 15, tabClosed: true };
            }
            if (name === 'tab.close') {
                closed.push(Number(args.tabId));
                return { success: true };
            }
            throw new Error(`unexpected tool ${name}`);
        },
    });
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 2);
    assert.equal(round.failed, 1);
    assert.match(round.reason || '', /部分商品/);
    assert.deepEqual(closed, [71, 12]);
});

test('structured JD capture stops before search when keyword or plugin is unavailable', async () => {
    let invoked = false;
    const input = {
        keyword: '',
        maxProducts: 5,
        reviewFilterLabels: [],
        pacing: 'conservative' as const,
    };
    const missingKeyword = await runJdStructuredCaptureRound(input, {
        checkPluginInstance: () => ({ ok: true, detail: 'connected' }),
        invokeBrowserControl: async () => {
            invoked = true;
            return {};
        },
    });
    assert.equal(missingKeyword.status, 'failed');
    assert.equal(invoked, false);

    const missingPlugin = await runJdStructuredCaptureRound({ ...input, keyword: '猫粮' }, {
        checkPluginInstance: () => ({ ok: false, detail: '插件未连接' }),
        invokeBrowserControl: async () => {
            invoked = true;
            return {};
        },
    });
    assert.equal(missingPlugin.status, 'blocked');
    assert.equal(invoked, false);
});

test('structured JD capture reports a search login wall as blocked', async () => {
    const closed: number[] = [];
    const round = await runJdStructuredCaptureRound({
        keyword: '猫粮',
        maxProducts: 5,
        reviewFilterLabels: [],
        pacing: 'normal',
    }, {
        checkPluginInstance: () => ({ ok: true, detail: 'connected' }),
        invokeBrowserControl: async (_method, params) => {
            const name = String(params.name || '');
            const args = params.arguments as Record<string, unknown>;
            if (name === 'research.run') {
                return {
                    success: false,
                    reason: 'security_verification_required',
                    tab: { id: 91 },
                    handoff: { required: true },
                };
            }
            if (name === 'tab.close') {
                closed.push(Number(args.tabId));
                return { success: true };
            }
            throw new Error(`unexpected tool ${name}`);
        },
    });
    assert.equal(round.status, 'blocked');
    assert.match(round.reason || '', /安全验证/);
    assert.deepEqual(closed, [91]);
});
