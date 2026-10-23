import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';
import { runSocialStructuredCaptureRound, type XhsStructuredCaptureIo } from './socialStructuredCapture.ts';
export { buildXhsKnowledgeEntry, extractXhsNoteId, parseCaptureSaveResult, parseResearchResult, resolveXhsSearchCardLimit, uniqueXhsSearchCards, isCaptureBlocker } from './socialStructuredCapture.ts';
export type { XhsCaptureNoteOutcome, XhsStructuredCaptureRound, XhsStructuredCaptureIo } from './socialStructuredCapture.ts';

/** Compatibility entry point for the existing builtin task and integrations. */
export async function runXhsStructuredCaptureRound(input: { keyword: string; maxNotes: number; pacing: 'conservative' | 'normal'; captureSpaceId?: string; commentLimit?: number }, io: XhsStructuredCaptureIo) {
    return await runSocialStructuredCaptureRound({ ...input, platform: 'xiaohongshu' }, io);
}

/** 生产环境 IO：桥接真实的插件通道。入库由插件 capture.save 完成。 */
export function createXhsStructuredCaptureIo(
    log?: (level: 'info' | 'warn' | 'error', message: string) => void,
): XhsStructuredCaptureIo {
    let extensionInstanceId: string | undefined;
    return {
        invokeBrowserControl: async (method, params, options) => {
            const bridge = getBrowserCaptureBridgeService();
            if (!bridge) throw new Error('Desktop Bridge 尚未启动');
            extensionInstanceId ||= bridge.getStatus().instances.find((instance) => instance.extensionKind === 'capture')?.extensionInstanceId;
            if (!extensionInstanceId) throw new Error('没有已连接的 GardenFlow 采集插件实例');
            return await bridge.invokeBrowserControl(method, params, { ...options, extensionKind: 'capture', extensionInstanceId });
        },
        checkPluginInstance: () => {
            const bridge = getBrowserCaptureBridgeService();
            const instances = (bridge?.getStatus().instances || []).filter((instance) => instance.extensionKind === 'capture');
            const instance = extensionInstanceId
                ? instances.find((item) => item.extensionInstanceId === extensionInstanceId)
                : instances[0];
            if (!instance) {
                return { ok: false, detail: '未检测到已连接的 GardenFlow 浏览器插件，请确认采集浏览器已打开且插件已启用' };
            }
            extensionInstanceId = instance.extensionInstanceId;
            return { ok: true, detail: `已连接 ${instances.length} 个采集插件实例` };
        },
        log,
    };
}
