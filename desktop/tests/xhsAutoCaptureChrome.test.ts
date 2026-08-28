import assert from 'node:assert/strict';
import test from 'node:test';
import {
    beginXhsCaptureChromeSession,
    buildXhsSearchUrl,
    endXhsCaptureChromeSession,
    getXhsCaptureChromeSession,
    isComputerUseOpenProfileTool,
    isComputerUseOpenUrlTool,
    isNativeBrowserSaveShortcut,
    pickBrowserPidFromProcessTree,
    parseProcessTable,
    rememberXhsCaptureScreenshot,
    isOmniboxFocusShortcut,
    maybeRewriteComputerUseNavigation,
    readMcpUrlArg,
} from '../electron/core/xhsAutoCaptureChrome.ts';
import {
    chromeBandMaxClickY,
    isClickInBrowserChrome,
    readScreenshotFrame,
} from '../electron/core/xhsAutoCaptureLocate.ts';

test('builds the xiaohongshu search url with encoded keyword', () => {
    assert.equal(
        buildXhsSearchUrl('猫粮'),
        'https://www.xiaohongshu.com/search_result?keyword=%E7%8C%AB%E7%B2%AE',
    );
});

test('recognizes computer-use open-url and open-profile tool names', () => {
    assert.equal(isComputerUseOpenUrlTool('computer_browser_open_url'), true);
    assert.equal(isComputerUseOpenUrlTool('computer-browser-open-url'), true);
    assert.equal(isComputerUseOpenUrlTool('computer_screenshot'), false);
    assert.equal(isComputerUseOpenProfileTool('computer_browser_open_profile'), true);
    assert.equal(isComputerUseOpenProfileTool('browser-open-profile'), true);
    assert.equal(isComputerUseOpenProfileTool('computer_click'), false);
});

test('reads url from mcp args', () => {
    assert.equal(readMcpUrlArg({ url: 'https://www.xiaohongshu.com/search_result?keyword=x' }), 'https://www.xiaohongshu.com/search_result?keyword=x');
    assert.equal(readMcpUrlArg({}), '');
});

test('does not rewrite computer-use navigation outside a capture session', async () => {
    endXhsCaptureChromeSession();
    const result = await maybeRewriteComputerUseNavigation('computer_browser_open_url', {
        url: 'https://www.xiaohongshu.com/search_result?keyword=x',
    });
    assert.equal(result.handled, false);
});

test('capture session records the search url used for rewrite', () => {
    endXhsCaptureChromeSession();
    const session = beginXhsCaptureChromeSession({ keyword: '猫粮', profile: 'ComputerUse' });
    assert.equal(session.searchUrl, buildXhsSearchUrl('猫粮'));
    assert.equal(getXhsCaptureChromeSession()?.profile, 'ComputerUse');
    endXhsCaptureChromeSession();
    assert.equal(getXhsCaptureChromeSession(), null);
});

test('recognizes Chrome native save shortcuts and ignores clicks', () => {
    assert.equal(isNativeBrowserSaveShortcut('computer_key', { key: 's', modifiers: ['command'] }), true);
    assert.equal(isNativeBrowserSaveShortcut('computer_hotkey', { combination: 'cmd+s' }), true);
    assert.equal(isNativeBrowserSaveShortcut('computer_click', { x: 100, y: 80 }), false);
    assert.equal(isNativeBrowserSaveShortcut('computer_key', { key: 'enter' }), false);
});

test('blocks Cmd+S during an active capture session', async () => {
    endXhsCaptureChromeSession();
    beginXhsCaptureChromeSession({ keyword: '猫粮', profile: 'ComputerUse' });
    const result = await maybeRewriteComputerUseNavigation('computer_key', {
        key: 's',
        modifiers: ['command'],
    });
    assert.equal(result.handled, true);
    if (result.handled) {
        assert.equal(result.result.ok, false);
        assert.equal(result.result.blockedNativeSave, true);
    }
    endXhsCaptureChromeSession();
});


test('binds the capture browser to the plugin native-host parent process, not a Chrome process name', () => {
    const processes = parseProcessTable([
        '  100   1 Google Chrome',
        '  110 100 Google Chrome Helper',
        '  200   1 Google Chrome',
        '  999 110 node',
    ].join('\n'));
    assert.equal(pickBrowserPidFromProcessTree(processes, 999, 'chrome'), 100);
    assert.equal(pickBrowserPidFromProcessTree(processes, 200, 'chrome'), 200);
    assert.equal(pickBrowserPidFromProcessTree(processes, 42, 'chrome'), null);
});

test('grid red-axis numbers already include window origin so y=80 is chrome chrome', () => {
    const frame = readScreenshotFrame({
        ok: true,
        data: {
            path: '/tmp/computer-use-grid.png',
            width: 1632,
            height: 1050,
            scale: 2,
            origin_x: 96,
            origin_y: 30,
            window_id: 15584,
            grid: true,
        },
    });
    assert.ok(frame);
    assert.equal(chromeBandMaxClickY(frame), (30 + 88) * 2);
    assert.equal(isClickInBrowserChrome(80, frame), true);
    assert.equal(isClickInBrowserChrome(400, frame), false);
});

test('blocks click before a window screenshot and blocks omnibox-band clicks after it', async () => {
    endXhsCaptureChromeSession();
    beginXhsCaptureChromeSession({ keyword: '猫粮', profile: 'ComputerUse' });
    const before = await maybeRewriteComputerUseNavigation('computer_click', { x: 650, y: 400 });
    assert.equal(before.handled, true);
    if (before.handled) {
        assert.equal(before.result.blockedBeforeLocate, true);
    }

    rememberXhsCaptureScreenshot({
        data: {
            path: '/tmp/computer-use-grid.png',
            width: 1632,
            height: 1050,
            scale: 1,
            origin_x: 0,
            origin_y: 0,
            grid: true,
            window_id: 15584,
        },
    });
    const chromeClick = await maybeRewriteComputerUseNavigation('computer_click', { x: 650, y: 80 });
    assert.equal(chromeClick.handled, true);
    if (chromeClick.handled) {
        assert.equal(chromeClick.result.blockedChromeClick, true);
    }

    const pageClick = await maybeRewriteComputerUseNavigation('computer_click', { x: 650, y: 220 });
    assert.equal(pageClick.handled, false);

    assert.equal(isOmniboxFocusShortcut('computer_hotkey', { combination: 'cmd+l' }), true);
    const omnibox = await maybeRewriteComputerUseNavigation('computer_hotkey', { combination: 'cmd+l' });
    assert.equal(omnibox.handled, true);
    if (omnibox.handled) {
        assert.equal(omnibox.result.blockedOmniboxShortcut, true);
    }
    endXhsCaptureChromeSession();
});

