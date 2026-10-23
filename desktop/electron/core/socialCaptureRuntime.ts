import { randomUUID } from 'node:crypto';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';
import { runSocialStructuredCaptureRound, type XhsStructuredCaptureIo } from './socialStructuredCapture.ts';
import { socialExternalId, socialPlatformFromUrl, type SocialCapturePlatform } from '../../shared/socialCapture.ts';

const leases = new Map<string, Promise<unknown>>();

export async function withCaptureInstance<T>(action: (io: XhsStructuredCaptureIo) => Promise<T>, log?: XhsStructuredCaptureIo['log'], bridge = getBrowserCaptureBridgeService()): Promise<T> {
    const instance = bridge?.getStatus().instances.find((item) => item.extensionKind === 'capture');
    if (!bridge || !instance) throw new Error('请打开已启用 GardenFlow 采集插件的浏览器');
    const extensionInstanceId = instance.extensionInstanceId;
    const hostInstanceId = instance.hostInstanceId;
    const sessionId = `social-capture-${randomUUID()}`;
    const previous = leases.get(extensionInstanceId) || Promise.resolve();
    const check = () => bridge.getStatus().instances.some((item) => item.extensionInstanceId === extensionInstanceId && item.hostInstanceId === hostInstanceId && item.extensionKind === 'capture');
    const current = previous.catch(() => undefined).then(async () => {
        if (!check()) throw new Error('采集插件实例已断开，请重新连接后重试');
        const io: XhsStructuredCaptureIo = {
            checkPluginInstance: () => ({ ok: check(), detail: check() ? '已连接采集插件' : '采集插件实例已断开' }),
            invokeBrowserControl: async (method, params, options) => {
                if (!check()) throw Object.assign(new Error('采集插件实例已断开'), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
                const args = params.arguments as Record<string, unknown> | undefined;
                const result = await bridge.invokeBrowserControl(method, args ? { ...params, arguments: { ...args, sessionId } } : params,
                    { ...options, extensionKind: 'capture', extensionInstanceId });
                if (!check()) throw Object.assign(new Error('采集插件实例已断开'), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
                return result;
            },
            log,
        };
        try { return await action(io); } finally {
            if (check()) await io.invokeBrowserControl('tools/call', { name: 'turn.ended', arguments: {} }, { timeoutMs: 10000 }).catch(() => undefined);
        }
    });
    leases.set(extensionInstanceId, current);
    try { return await current; } finally { if (leases.get(extensionInstanceId) === current) leases.delete(extensionInstanceId); }
}

export function unwrapCaptureResponse(value: unknown): Record<string, any> {
    let result = value && typeof value === 'object' ? value as Record<string, any> : {};
    for (let count = 0; count < 4; count += 1) {
        const nested = result.result || result.response;
        if (!nested || typeof nested !== 'object') break;
        result = nested;
    }
    return result;
}

async function checkSocialPlugin(io: XhsStructuredCaptureIo, platform: SocialCapturePlatform) {
    if (platform === 'xiaohongshu') return;
    const info = unwrapCaptureResponse(await io.invokeBrowserControl('getInfo', {}));
    if (info.socialCaptureVersion !== 1) throw new Error('请更新并重新加载 GardenFlow 采集插件以支持抖音和 TikTok 结构化采集');
}

export async function runSocialCaptureTask(input: {
    platform: SocialCapturePlatform; keyword: string; maxNotes: number; pacing: 'normal' | 'conservative';
    captureSpaceId: string; commentLimit?: number;
}, log?: XhsStructuredCaptureIo['log']) {
    return await withCaptureInstance(async (io) => {
        await checkSocialPlugin(io, input.platform);
        return await runSocialStructuredCaptureRound(input, io);
    }, log);
}

/** Open only a supported share/content URL; verify the final redirect before saving. */
export async function captureSocialUrlWithIo(input: { url: string; captureSpaceId: string; commentLimit: number }, io: XhsStructuredCaptureIo) {
    const platform = socialPlatformFromUrl(input.url);
    if (!platform) throw new Error('请输入小红书、抖音或 TikTok 的作品链接');
    const requestedId = socialExternalId(input.url, platform);
    const commentLimit = Math.max(0, Math.min(200, Math.trunc(Number(input.commentLimit)) || 0));
    const call = async (name: string, args: Record<string, unknown>, timeoutMs = 60000) => unwrapCaptureResponse(await io.invokeBrowserControl('tools/call', { name, arguments: args }, { timeoutMs }));
    // Resolve the first redirect in the background before autoplay can advance.
    // Then activate the locked detail so platform loading checks can finish.
    const opened = await call('tab.create', { url: input.url, active: false, waitUntilComplete: false });
    const tabId = Number(opened.tab?.id || opened.tabId);
    if (!opened.success || !Number.isInteger(tabId) || tabId <= 0) throw new Error(opened.error || '作品页面打开失败');
    let saved = false;
    try {
        let finalUrl = '';
        let externalId = '';
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const info = await call('tab.info', { tabId });
            finalUrl = String(info.tab?.url || info.url || '');
            if (finalUrl && finalUrl !== 'about:blank' && socialPlatformFromUrl(finalUrl) !== platform) throw new Error('分享链接跳转到了其他平台，请核对作品链接');
            externalId = socialExternalId(finalUrl, platform);
            if (externalId) break;
            await (io.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(500);
        }
        if (!externalId || requestedId && requestedId !== externalId) throw new Error('未能确认链接对应的作品，请在浏览器完成登录并核对页面');
        const activated = await call('tab.activate', { tabId });
        if (!activated.success) throw new Error(activated.error || '无法打开目标作品详情');
        // The redirect URL can be visible while Chrome is still replacing its
        // previous document. Keep the first identity pinned across that wait.
        const ready = await call('page.waitForLoadState', { tabId, state: 'load', timeoutMs: 30000 }, 35000);
        if (!ready.success) throw new Error(ready.error || '作品页面加载失败，请稍后重试');
        const settled = await call('tab.info', { tabId });
        const settledUrl = String(settled.tab?.url || settled.url || '');
        if (socialPlatformFromUrl(settledUrl) !== platform || socialExternalId(settledUrl, platform) !== externalId) {
            throw new Error('页面作品已变化，请重新打开目标作品');
        }
        const result = await call('capture.save', { tabId, captureSpaceId: input.captureSpaceId, commentLimit, expectedContent: { platform, externalId } }, 240000);
        if (!result.success || !result.noteId) throw new Error(result.error || '作品保存失败');
        saved = true;
        return result as { success: boolean; noteId: string; duplicate?: boolean; updated?: boolean; capture?: import('../../shared/socialCapture.ts').SocialCaptureState };
    } finally {
        // Keep unsuccessful pages open for login, verification and inspection.
        if (saved) await call('tab.close', { tabId }).catch(() => undefined);
        else {
            await call('tab.activate', { tabId }).catch(() => undefined);
            await call('tabs.finalize', { keep: [{ tabId, status: 'handoff' }] }).catch(() => undefined);
        }
    }
}

export async function saveSocialCaptureUrl(input: { url: string; captureSpaceId: string; commentLimit: number }) {
    const platform = socialPlatformFromUrl(input.url);
    if (!platform) throw new Error('请输入小红书、抖音或 TikTok 的作品链接');
    return await withCaptureInstance(async (io) => {
        await checkSocialPlugin(io, platform);
        return await captureSocialUrlWithIo(input, io);
    });
}
