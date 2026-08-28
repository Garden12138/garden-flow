import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DesktopBridgeHostClient } from '../electron/browserNativeHostRuntime.ts';
import { BrowserCaptureBridgeService } from '../electron/core/browserCaptureBridgeService.ts';
import { BrowserCaptureOperationCache } from '../electron/core/browserCaptureOperationCache.ts';
import {
    buildXhsCommentsSnapshotView,
    normalizeXhsV2Entry,
    normalizeZhihuAnswerEntry,
    normalizeZhihuArticleEntry,
    validateRemoteMediaSource,
} from '../electron/core/browserCapturePayloads.ts';
import {
    BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
    BROWSER_CAPTURE_EXTENSION_ID,
    BROWSER_CAPTURE_EXTENSION_ORIGIN,
    BROWSER_CAPTURE_MAX_FRAME_BYTES,
    browserCaptureDescriptorPath,
    type BrowserCaptureBridgeDescriptor,
} from '../electron/core/browserCaptureProtocol.ts';
import {
    browserNativeHostNeedsInstall,
    resolvePackagedBrowserNativeHostExecutable,
    type BrowserNativeHostStatus,
} from '../electron/core/browserNativeHostInstaller.ts';
import { selectCompatibleBojinReleaseAsset } from '../electron/core/appUpdatePolicy.ts';

function nativeHostStatus(overrides: Partial<BrowserNativeHostStatus> = {}): BrowserNativeHostStatus {
    return {
        supported: true,
        installedTargets: [],
        staleTargets: [],
        missingTargets: [],
        failures: [],
        ...overrides,
    };
}

test('fresh browser Native Host state triggers automatic installation', () => {
    assert.equal(browserNativeHostNeedsInstall(nativeHostStatus({
        missingTargets: [{
            id: 'chrome',
            label: 'Google Chrome',
            manifestPath: 'chrome-manifest.json',
            installed: false,
            stale: false,
        }],
    })), true);
    assert.equal(browserNativeHostNeedsInstall(nativeHostStatus({
        installedTargets: [{
            id: 'chrome',
            label: 'Google Chrome',
            manifestPath: 'chrome-manifest.json',
            installed: true,
            stale: false,
        }],
    })), false);
});

test('packaged Windows Native Host uses the dedicated console executable', () => {
    assert.equal(
        resolvePackagedBrowserNativeHostExecutable({
            appExecutable: 'C:\\Program Files\\Bojin\\Bojin.exe',
            resourcesPath: 'C:\\Program Files\\Bojin\\resources',
        }, 'win32'),
        'C:\\Program Files\\Bojin\\resources\\native-host\\bojin-browser-native-host.exe',
    );
    assert.equal(
        resolvePackagedBrowserNativeHostExecutable({
            appExecutable: '/Applications/Bojin.app/Contents/MacOS/Bojin',
            resourcesPath: '/Applications/Bojin.app/Contents/Resources',
        }, 'darwin'),
        '/Applications/Bojin.app/Contents/MacOS/Bojin',
    );
});

test('Windows packaging prepares and bundles the dedicated Native Host', async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '../..');
    const packageConfig = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'desktop/package.json'), 'utf8'));
    const windowsPackagingScript = await fs.readFile(
        path.join(repositoryRoot, 'desktop/scripts/package-windows.ps1'),
        'utf8',
    );
    const windowsDiagnosticScript = await fs.readFile(
        path.join(repositoryRoot, 'desktop/scripts/diagnose-windows-native-host.ps1'),
        'utf8',
    );
    assert.match(packageConfig.scripts['build:win'], /prepare:windows-native-host/);
    assert.equal(
        packageConfig.build.win.extraResources[0]?.to,
        'native-host/bojin-browser-native-host.exe',
    );
    assert.match(windowsPackagingScript, /Invoke-Pnpm run prepare:windows-native-host/);
    assert.match(windowsDiagnosticScript, /native-host\.log/);
    assert.match(windowsDiagnosticScript, /NativeMessagingHosts\\com\.redbox\.browser_control/);
});

test('app updater accepts only Bojin installers for the current platform and architecture', () => {
    const assets = [
        { name: 'Beav-9.9.9-x64.exe', downloadUrl: 'https://example.com/beav.exe', size: 1, digest: '' },
        { name: 'RedBox-9.9.9-x64.exe', downloadUrl: 'https://example.com/redbox.exe', size: 1, digest: '' },
        { name: 'Bojin-2.5.1-arm64.exe', downloadUrl: 'https://example.com/bojin-arm64.exe', size: 1, digest: '' },
        { name: 'Bojin-2.5.1-x64.exe.blockmap', downloadUrl: 'https://example.com/bojin.blockmap', size: 1, digest: '' },
        { name: 'Bojin-2.5.1-x64.exe', downloadUrl: 'https://example.com/bojin.exe', size: 1, digest: '' },
    ];
    assert.equal(
        selectCompatibleBojinReleaseAsset(assets, 'win32', 'x64')?.name,
        'Bojin-2.5.1-x64.exe',
    );
    assert.equal(
        selectCompatibleBojinReleaseAsset(assets.slice(0, 2), 'win32', 'x64'),
        null,
    );
});

test('typed capture payloads preserve platform content and reject local media paths', () => {
    const xhs = normalizeXhsV2Entry({
        source: { sourceLink: 'https://www.xiaohongshu.com/explore/note-1', externalId: 'note-1' },
        note: {
            noteId: 'note-1',
            noteType: 'video',
            title: '标题',
            text: '正文',
            author: { nickname: '作者', profileUrl: 'https://www.xiaohongshu.com/user/profile/u1' },
            stats: { likes: 12, collects: 3, comments: 1 },
            assets: { coverUrl: 'https://example.com/cover.jpg', videoUrl: 'https://example.com/video.mp4' },
        },
        comments: {
            items: [{
                author: { nickname: '评论者' },
                content: { text: '评论正文' },
                metrics: { likes: 2, replies: 1 },
                time: { display: '今天' },
            }],
        },
    });
    assert.equal(xhs.entry.kind, 'xhs-video');
    assert.equal(xhs.entry.content?.author, '作者');
    assert.equal(xhs.entry.content?.commentsSnapshot?.[0]?.text, '评论正文');
    assert.equal(xhs.entry.content?.commentsSnapshot?.[0]?.author, '评论者');
    assert.equal(xhs.entry.content?.commentsSnapshot?.[0]?.replies, 1);
    assert.equal(xhs.entry.content?.commentsSnapshot?.[0]?.createdAt, '今天');
    assert.equal(xhs.capturedComments, 1);
    const commentsView = buildXhsCommentsSnapshotView(xhs.entry.content?.commentsSnapshot, {
        noteId: 'note-1',
        sourceLink: 'https://www.xiaohongshu.com/explore/note-1',
        total: 505,
    });
    assert.equal(commentsView.comments[0]?.author.nickname, '评论者');
    assert.equal(commentsView.comments[0]?.content.text, '评论正文');
    assert.equal(commentsView.visibleCount, 1);
    assert.equal(commentsView.total, 505);
    assert.equal(commentsView.hasMore, true);

    const answer = normalizeZhihuAnswerEntry({
        source: { externalId: 'answer-1' },
        question: { title: '问题', detail: '详情', topics: ['主题'] },
        answer: { id: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', text: '回答正文', html: '<p>回答正文</p>', author: { name: '答主' } },
    });
    assert.equal(answer.kind, 'zhihu-answer');
    assert.match(answer.content?.indexText || '', /问题/);

    const article = normalizeZhihuArticleEntry({
        source: { externalId: 'article-1' },
        article: { id: 'article-1', url: 'https://zhuanlan.zhihu.com/p/1', title: '文章', text: '文章正文', author: { name: '作者' } },
    });
    assert.equal(article.kind, 'zhihu-article');
    assert.throws(() => validateRemoteMediaSource('/Users/example/private.jpg'), /媒体仅支持 HTTP\(S\)/);
});

test('operation cache deduplicates completed and concurrent operation ids', async () => {
    const cache = new BrowserCaptureOperationCache(2);
    let calls = 0;
    const task = async () => {
        calls += 1;
        await Promise.resolve();
        return { entryId: 'entry-1' };
    };
    const [left, right] = await Promise.all([
        cache.run('knowledge.ingestEntry:op-1', task),
        cache.run('knowledge.ingestEntry:op-1', task),
    ]);
    assert.deepEqual(left, right);
    assert.equal(calls, 1);
    assert.deepEqual(await cache.run('knowledge.ingestEntry:op-1', task), left);
    assert.equal(calls, 1);
    const nextAttempt = await cache.run('knowledge.ingestEntry:op-2', task);
    assert.equal(calls, 2);
    assert.deepEqual(await cache.run('knowledge.ingestEntry:op-2', task), nextAttempt);
    assert.equal(calls, 2);
});

test('capture transport does not request or read browser credentials and Native Host does not log payloads', async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '../..');
    const manifest = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'Plugin/src/manifest.json'), 'utf8'));
    const background = await fs.readFile(path.join(repositoryRoot, 'Plugin/src/background.js'), 'utf8');
    const nativeHost = await fs.readFile(path.join(repositoryRoot, 'desktop/electron/browserNativeHostRuntime.ts'), 'utf8');
    assert.equal(manifest.permissions.includes('cookies'), false);
    assert.equal(background.includes('document.cookie'), false);
    assert.equal(nativeHost.includes('console.'), false);
});

test('renderer uses the top-level browser plugin bridge exposed by createSystemBridge', async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '../..');
    const rendererFiles = [
        'desktop/src/pages/Knowledge.tsx',
        'desktop/src/pages/Settings.tsx',
        'desktop/src/pages/settings/SettingsSections.tsx',
    ];
    for (const relativePath of rendererFiles) {
        const source = await fs.readFile(path.join(repositoryRoot, relativePath), 'utf8');
        assert.doesNotMatch(source, /ipcRenderer\.system\.browserPlugin/);
    }
    const systemBridge = await fs.readFile(
        path.join(repositoryRoot, 'desktop/src/bridge/domains/systemBridge.ts'),
        'utf8',
    );
    assert.match(systemBridge, /^\s{4}browserPlugin:\s*\{/m);
});

test('Desktop Bridge authenticates token and origin, enforces registration and allowlist', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bojin-capture-bridge-'));
    const previousStateRoot = process.env.REDBOX_BROWSER_CONTROL_STATE_DIR;
    process.env.REDBOX_BROWSER_CONTROL_STATE_DIR = temporaryRoot;
    const received: string[] = [];
    const service = new BrowserCaptureBridgeService({
        appVersion: '2.5.0',
        handleRequest: async (method) => {
            received.push(method);
            return { ok: true };
        },
    });
    try {
        await service.start();
        const descriptor = JSON.parse(await fs.readFile(browserCaptureDescriptorPath(), 'utf8')) as BrowserCaptureBridgeDescriptor;

        const wrongToken = await openBridgeClient(descriptor);
        const rejectedToken = await wrongToken.request('bridge.hello', {
            role: 'native_host',
            bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            authToken: 'wrong',
            origin: BROWSER_CAPTURE_EXTENSION_ORIGIN,
        });
        assert.equal(rejectedToken.error?.data?.code, 'BROWSER_AUTHENTICATION_FAILED');
        wrongToken.close();

        const wrongOrigin = await openBridgeClient(descriptor);
        const rejectedOrigin = await wrongOrigin.request('bridge.hello', {
            role: 'native_host',
            bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            authToken: descriptor.hostAuthToken,
            origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
        });
        assert.equal(rejectedOrigin.error?.data?.code, 'EXTENSION_ORIGIN_NOT_ALLOWED');
        wrongOrigin.close();

        const client = await openBridgeClient(descriptor);
        const hello = await client.request('bridge.hello', {
            role: 'native_host',
            bridgeProtocolVersion: BROWSER_CAPTURE_BRIDGE_PROTOCOL_VERSION,
            authToken: descriptor.hostAuthToken,
            origin: BROWSER_CAPTURE_EXTENSION_ORIGIN,
            hostInstanceId: 'test-host',
        });
        assert.equal(hello.result?.ok, true);
        const beforeRegistration = await client.request('knowledge.ingestEntry', { operationId: 'op-1', payload: {} });
        assert.equal(beforeRegistration.error?.data?.code, 'EXTENSION_REGISTRATION_REQUIRED');
        const registration = await client.request('extension.register', {
            extensionId: BROWSER_CAPTURE_EXTENSION_ID,
            extensionInstanceId: 'test-extension-instance',
            version: '2.6.19',
            browser: 'chrome',
        });
        assert.equal(registration.result?.registered, true);
        const forbidden = await client.request('knowledge.batchIngest', {});
        assert.equal(forbidden.error?.data?.code, 'METHOD_NOT_ALLOWED');
        const allowed = await client.request('knowledge.ingestEntry', { operationId: 'op-1', payload: {} });
        assert.equal(allowed.result?.ok, true);
        const secondAttempt = await client.request('knowledge.ingestEntry', { operationId: 'op-2', payload: {} });
        assert.equal(secondAttempt.result?.ok, true);
        const replay = await client.request('knowledge.ingestEntry', { operationId: 'op-2', payload: {} });
        assert.equal(replay.result?.ok, true);
        assert.deepEqual(received, [
            'knowledge.ingestEntry',
            'knowledge.ingestEntry',
            'knowledge.ingestEntry',
        ]);
        client.close();

        const oversized = net.createConnection(descriptor.endpoint.kind === 'unix' ? descriptor.endpoint.path : descriptor.endpoint.name);
        await new Promise<void>((resolve, reject) => {
            oversized.once('connect', resolve);
            oversized.once('error', reject);
        });
        const header = Buffer.alloc(4);
        header.writeUInt32LE(BROWSER_CAPTURE_MAX_FRAME_BYTES + 1, 0);
        oversized.write(header);
        await new Promise<void>((resolve) => oversized.once('close', () => resolve()));
    } finally {
        await service.stop();
        if (previousStateRoot === undefined) delete process.env.REDBOX_BROWSER_CONTROL_STATE_DIR;
        else process.env.REDBOX_BROWSER_CONTROL_STATE_DIR = previousStateRoot;
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test('Native Host re-registers the extension after Desktop Bridge restarts', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bojin-native-host-reconnect-'));
    const previousStateRoot = process.env.REDBOX_BROWSER_CONTROL_STATE_DIR;
    process.env.REDBOX_BROWSER_CONTROL_STATE_DIR = temporaryRoot;
    const received: string[] = [];
    const service = new BrowserCaptureBridgeService({
        appVersion: '2.5.0',
        handleRequest: async (method) => {
            received.push(method);
            return { ok: true };
        },
    });
    const client = new DesktopBridgeHostClient({ origin: BROWSER_CAPTURE_EXTENSION_ORIGIN });
    try {
        await service.start();
        await client.call('extension.register', {
            extensionId: BROWSER_CAPTURE_EXTENSION_ID,
            extensionInstanceId: 'reconnect-test-extension',
            version: '2.6.19',
            browser: 'chrome',
        });
        await client.call('knowledge.ingestEntry', { operationId: 'before-restart', payload: {} });

        await service.stop();
        await service.start();

        await client.call('knowledge.ingestEntry', { operationId: 'after-restart', payload: {} });
        assert.deepEqual(received, ['knowledge.ingestEntry', 'knowledge.ingestEntry']);
        assert.equal(service.getStatus().instances[0]?.extensionInstanceId, 'reconnect-test-extension');
    } finally {
        client.close();
        await service.stop();
        if (previousStateRoot === undefined) delete process.env.REDBOX_BROWSER_CONTROL_STATE_DIR;
        else process.env.REDBOX_BROWSER_CONTROL_STATE_DIR = previousStateRoot;
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

type RpcResponse = {
    result?: Record<string, any>;
    error?: { data?: { code?: string } };
};

async function openBridgeClient(descriptor: BrowserCaptureBridgeDescriptor): Promise<{
    request: (method: string, params: Record<string, unknown>) => Promise<RpcResponse>;
    close: () => void;
}> {
    const endpoint = descriptor.endpoint.kind === 'unix' ? descriptor.endpoint.path : descriptor.endpoint.name;
    const socket = net.createConnection(endpoint);
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
    });
    let sequence = 0;
    let buffer = Buffer.alloc(0);
    const pending = new Map<string, (response: RpcResponse) => void>();
    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const length = buffer.readUInt32LE(0);
            if (buffer.length < length + 4) return;
            const response = JSON.parse(buffer.subarray(4, length + 4).toString('utf8')) as RpcResponse & { id: string };
            buffer = buffer.subarray(length + 4);
            pending.get(String(response.id))?.(response);
            pending.delete(String(response.id));
        }
    });
    return {
        request: (method, params) => new Promise((resolve) => {
            sequence += 1;
            const id = `test-${sequence}`;
            const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
            const frame = Buffer.alloc(payload.length + 4);
            frame.writeUInt32LE(payload.length, 0);
            payload.copy(frame, 4);
            pending.set(id, resolve);
            socket.write(frame);
        }),
        close: () => socket.destroy(),
    };
}
