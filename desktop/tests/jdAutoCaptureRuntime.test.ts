import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    JD_AUTO_CAPTURE_TASK_ID,
    resolveJdAutoCaptureLaunch,
} from '../electron/core/jdAutoCaptureSettings.ts';
import {
    parseJdCaptureSaveResult,
    isJdCaptureBlocker,
    runJdStructuredCaptureRound,
    type JdStructuredCaptureIo,
} from '../electron/core/jdStructuredCapture.ts';

test('JD builtin task exposes bounded product and review settings', () => {
    const source = fs.readFileSync(path.resolve('electron/core/builtinAutomationTasks.ts'), 'utf8');
    assert.equal(JD_AUTO_CAPTURE_TASK_ID, 'jd-product-auto-capture');
    assert.match(source, /id: JD_AUTO_CAPTURE_TASK_ID/);
    assert.match(source, /name: '京东商品自动采集'/);
    assert.match(source, /requiredSkills: \['jd-auto-capture'\]/);
    for (const key of ['productUrls', 'maxProductsPerRun', 'reviewFilterLabels', 'reviewsPerFilter', 'pacing']) {
        assert.match(source, new RegExp(`key: '${key}'`));
    }
});

test('resolves and rotates canonical JD product URLs while preserving review defaults', () => {
    const settings = {
        productUrls: [
            'https://item.jd.com/10001.html?tracking=1',
            'https://item.jd.com/10002.html',
            'https://item.jd.com/10003.html',
        ],
        maxProductsPerRun: 2,
        reviewFilterLabels: [],
        reviewsPerFilter: 99,
        pacing: 'unexpected',
    };
    const first = resolveJdAutoCaptureLaunch(settings, 0);
    assert.deepEqual(first.productUrls, [
        'https://item.jd.com/10001.html',
        'https://item.jd.com/10002.html',
    ]);
    assert.deepEqual(first.reviewFilterLabels, []);
    assert.equal(first.reviewsPerFilter, 50);
    assert.equal(first.pacing, 'conservative');

    const nextDay = resolveJdAutoCaptureLaunch(settings, 24 * 60 * 60 * 1_000);
    assert.deepEqual(nextDay.productUrls, [
        'https://item.jd.com/10003.html',
        'https://item.jd.com/10001.html',
    ]);
});

test('rejects lookalike and non-product links and deduplicates custom labels', () => {
    const launch = resolveJdAutoCaptureLaunch({
        productUrls: [
            'https://item.jd.com/280930.html',
            'https://item.jd.com/280930.html?utm=1',
            'https://item.jd.com.evil.test/280930.html',
            'https://search.jd.com/Search?keyword=cat',
        ],
        reviewFilterLabels: ['图/视频', '图/视频', '回头客'],
        reviewsPerFilter: 0,
    }, 0);
    assert.deepEqual(launch.allProductUrls, ['https://item.jd.com/280930.html']);
    assert.equal(launch.invalidProductUrls.length, 2);
    assert.deepEqual(launch.reviewFilterLabels, ['图/视频', '回头客']);
    assert.equal(launch.reviewsPerFilter, 1);
});

test('parses only saves backed by product and snapshot ids', () => {
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
        },
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.duplicate, true);
    assert.equal(parsed.capturedReviews, 15);
    assert.deepEqual(parsed.reviewWarnings, ['中评仅取得 2 条']);
    assert.equal(parseJdCaptureSaveResult({ success: true, productId: 'only-product' }).ok, false);
    assert.equal(isJdCaptureBlocker(Object.assign(new Error('blocked'), { code: 'BROWSER_SECURITY_CHALLENGE' })), true);
});

test('structured JD capture creates, saves, and closes each task tab', async () => {
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
                };
            }
            if (name === 'tab.close') return { success: true };
            throw new Error(`unexpected tool ${name}`);
        },
    };

    const round = await runJdStructuredCaptureRound({
        productUrls: ['https://item.jd.com/1.html', 'https://item.jd.com/2.html'],
        reviewFilterLabels: ['图/视频', '回头客'],
        reviewsPerFilter: 7,
        pacing: 'normal',
    }, io);

    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 2);
    assert.equal(round.recaptured, 1);
    assert.equal(round.capturedReviews, 6);
    assert.deepEqual(calls.map((call) => call.name), [
        'tab.create', 'capture.save', 'tab.close',
        'tab.create', 'capture.save', 'tab.close',
    ]);
    assert.deepEqual(calls.find((call) => call.name === 'capture.save')?.args.reviewOptions, {
        selectedFilterLabels: ['图/视频', '回头客'],
        limitPerFilter: 7,
    });
});

test('structured JD capture keeps successful snapshots when a later product fails', async () => {
    let nextTabId = 70;
    let saveIndex = 0;
    const closed: number[] = [];
    const round = await runJdStructuredCaptureRound({
        productUrls: ['https://item.jd.com/1.html', 'https://item.jd.com/2.html'],
        reviewFilterLabels: [],
        reviewsPerFilter: 5,
        pacing: 'conservative',
    }, {
        checkPluginInstance: () => ({ ok: true, detail: 'connected' }),
        sleep: async () => undefined,
        invokeBrowserControl: async (_method, params) => {
            const name = String(params.name || '');
            const args = params.arguments as Record<string, unknown>;
            if (name === 'tab.create') return { success: true, tab: { id: nextTabId++ } };
            if (name === 'capture.save') {
                saveIndex += 1;
                if (saveIndex === 2) throw new Error('商品页加载失败');
                return { success: true, productId: 'p1', snapshotId: 's1', capturedReviews: 15 };
            }
            if (name === 'tab.close') {
                closed.push(Number(args.tabId));
                return { success: true };
            }
            throw new Error(`unexpected tool ${name}`);
        },
    });
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 1);
    assert.equal(round.failed, 1);
    assert.match(round.reason || '', /部分商品/);
    assert.deepEqual(closed, [70, 71]);
});

test('structured JD capture stops before opening tabs when plugin is unavailable', async () => {
    let invoked = false;
    const round = await runJdStructuredCaptureRound({
        productUrls: ['https://item.jd.com/1.html'],
        reviewFilterLabels: [],
        reviewsPerFilter: 5,
        pacing: 'conservative',
    }, {
        checkPluginInstance: () => ({ ok: false, detail: '插件未连接' }),
        invokeBrowserControl: async () => {
            invoked = true;
            return {};
        },
    });
    assert.equal(round.status, 'blocked');
    assert.equal(invoked, false);
});
