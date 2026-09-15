import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';

/**
 * 京东商品结构化采集管线。
 *
 * 桌面运行时只负责创建任务标签页并编排；商品和评论识别、媒体下载及入库仍由
 * GardenFlow 插件的 capture.save 走侧栏同一条链路完成。
 */

export type JdProductCaptureOutcome = {
    sourceUrl: string;
    outcome: 'saved' | 'recaptured' | 'failed';
    title?: string;
    productId?: string;
    snapshotId?: string;
    capturedReviews?: number;
    importedImages?: number;
    importedReviewImages?: number;
    reviewWarnings?: string[];
    missingFields?: string[];
    error?: string;
};

export type JdStructuredCaptureRound = {
    status: 'captured' | 'blocked' | 'failed';
    attempted: number;
    saved: number;
    recaptured: number;
    failed: number;
    capturedReviews: number;
    products: JdProductCaptureOutcome[];
    reason?: string;
    summary: string;
};

export type JdStructuredCaptureIo = {
    invokeBrowserControl: (
        method: string,
        params: Record<string, unknown>,
        options?: { timeoutMs?: number },
    ) => Promise<unknown>;
    checkPluginInstance: () => { ok: boolean; detail: string };
    sleep?: (ms: number) => Promise<void>;
    log?: (level: 'info' | 'warn' | 'error', message: string) => void;
};

type JdCaptureSaveResult = {
    ok: boolean;
    duplicate: boolean;
    blocked: boolean;
    title: string;
    productId: string;
    snapshotId: string;
    capturedReviews: number;
    importedImages: number;
    importedReviewImages: number;
    reviewWarnings: string[];
    missingFields: string[];
    reason: string;
};

const BLOCKED_ERROR_CODES = new Set(['BROWSER_LOGIN_REQUIRED', 'BROWSER_SECURITY_CHALLENGE']);
const CREATE_TIMEOUT_MS = 45_000;
const SAVE_TIMEOUT_MS = 180_000;
const CLOSE_TIMEOUT_MS = 30_000;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function unwrapResult(value: unknown): Record<string, unknown> | null {
    let record = asRecord(value);
    for (const key of ['response', 'result']) {
        const nested = record && asRecord(record[key]);
        if (nested) record = nested;
    }
    return record;
}

function positiveInteger(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function stringList(value: unknown, limit = 100): string[] {
    return (Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, limit);
}

export function isJdCaptureBlocker(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    const code = String(record?.code || '').trim();
    const message = error instanceof Error ? error.message : String(record?.message || error || '');
    return BLOCKED_ERROR_CODES.has(code) || /需要先在浏览器中登录|安全验证/.test(message);
}

export function parseJdCaptureSaveResult(value: unknown): JdCaptureSaveResult {
    const record = unwrapResult(value);
    if (!record) {
        return {
            ok: false,
            duplicate: false,
            blocked: false,
            title: '',
            productId: '',
            snapshotId: '',
            capturedReviews: 0,
            importedImages: 0,
            importedReviewImages: 0,
            reviewWarnings: [],
            missingFields: [],
            reason: 'empty_save_result',
        };
    }
    const code = String(record.code || record.errorCode || '').trim();
    const reason = String(record.error || record.reason || record.message || '').trim();
    return {
        ok: record.success === true && Boolean(String(record.productId || '').trim()) && Boolean(String(record.snapshotId || '').trim()),
        duplicate: record.duplicate === true,
        blocked: BLOCKED_ERROR_CODES.has(code) || /需要先在浏览器中登录|安全验证/.test(reason),
        title: String(record.title || '').trim(),
        productId: String(record.productId || '').trim(),
        snapshotId: String(record.snapshotId || '').trim(),
        capturedReviews: positiveInteger(record.capturedReviews),
        importedImages: positiveInteger(record.importedImages),
        importedReviewImages: positiveInteger(record.importedReviewImages),
        reviewWarnings: stringList(record.reviewWarnings, 100),
        missingFields: stringList(record.missingFields, 100),
        reason,
    };
}

function createdTabId(value: unknown): number {
    const record = unwrapResult(value);
    const tab = record && asRecord(record.tab);
    return positiveInteger(tab?.id || record?.tabId);
}

function callTool(
    io: JdStructuredCaptureIo,
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
): Promise<unknown> {
    return io.invokeBrowserControl('tools/call', { name, arguments: args }, { timeoutMs });
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureDelayMs(pacing: 'conservative' | 'normal'): number {
    return pacing === 'conservative' ? 4_000 : 1_500;
}

function summarize(round: Omit<JdStructuredCaptureRound, 'summary'>): string {
    const lines = [
        `京东商品自动采集：尝试 ${round.attempted} 个商品，成功保存 ${round.saved} 个来源快照（其中复采 ${round.recaptured} 个），失败 ${round.failed} 个，共采集评论 ${round.capturedReviews} 条。`,
    ];
    for (const product of round.products) {
        if (product.outcome === 'failed') {
            lines.push(`- ${product.sourceUrl}：失败，${product.error || '未知原因'}`);
            continue;
        }
        const status = product.outcome === 'recaptured' ? '已复采' : '已保存';
        const warnings = [
            ...(product.reviewWarnings || []),
            ...(product.missingFields || []),
        ];
        lines.push(`- ${product.title || product.sourceUrl}：${status}，评论 ${product.capturedReviews || 0} 条${warnings.length > 0 ? `；提示：${warnings.join('、')}` : ''}`);
    }
    if (round.reason) lines.push(`说明：${round.reason}`);
    return lines.join('\n');
}

export async function runJdStructuredCaptureRound(
    input: {
        productUrls: string[];
        reviewFilterLabels: string[];
        reviewsPerFilter: number;
        pacing: 'conservative' | 'normal';
    },
    io: JdStructuredCaptureIo,
): Promise<JdStructuredCaptureRound> {
    const productUrls = Array.from(new Set((input.productUrls || []).map((url) => String(url || '').trim()).filter(Boolean))).slice(0, 20);
    const reviewFilterLabels = Array.from(new Set((input.reviewFilterLabels || []).map((label) => String(label || '').trim()).filter(Boolean))).slice(0, 50);
    const reviewsPerFilter = Math.max(1, Math.min(50, Math.round(Number(input.reviewsPerFilter) || 5)));
    const products: JdProductCaptureOutcome[] = [];
    const sleep = io.sleep || defaultSleep;
    const log = io.log || (() => undefined);
    let saved = 0;
    let recaptured = 0;
    let capturedReviews = 0;
    let blockedReason = '';

    const finalize = (status: JdStructuredCaptureRound['status'], reason?: string): JdStructuredCaptureRound => {
        const base = {
            status,
            attempted: products.length,
            saved,
            recaptured,
            failed: products.filter((product) => product.outcome === 'failed').length,
            capturedReviews,
            products,
            reason: reason || undefined,
        };
        return { ...base, summary: summarize(base) };
    };

    if (productUrls.length === 0) return finalize('failed', '本轮没有可用的京东商品链接');
    const instance = io.checkPluginInstance();
    if (!instance.ok) return finalize('blocked', instance.detail || '未检测到已连接的 GardenFlow 浏览器插件');

    for (const [index, sourceUrl] of productUrls.entries()) {
        if (index > 0) await sleep(captureDelayMs(input.pacing));
        let tabId = 0;
        try {
            log('info', `JD capture opening product ${index + 1}/${productUrls.length}: ${sourceUrl}`);
            tabId = createdTabId(await callTool(io, 'tab.create', {
                url: sourceUrl,
                active: false,
                waitUntilComplete: true,
            }, CREATE_TIMEOUT_MS));
            if (!tabId) throw new Error('插件创建了商品页，但没有返回 tabId');

            await sleep(captureDelayMs(input.pacing));
            log('info', `JD capture saving product via plugin capture.save tab=${tabId}`);
            const result = parseJdCaptureSaveResult(await callTool(io, 'capture.save', {
                tabId,
                reviewOptions: {
                    selectedFilterLabels: reviewFilterLabels,
                    limitPerFilter: reviewsPerFilter,
                },
            }, SAVE_TIMEOUT_MS));
            if (result.blocked) {
                blockedReason = `保存商品时遇到登录或安全验证：${result.reason || sourceUrl}`;
                products.push({ sourceUrl, outcome: 'failed', error: blockedReason });
                break;
            }
            if (!result.ok) throw new Error(result.reason || '插件没有返回有效的商品与来源快照 ID');

            saved += 1;
            capturedReviews += result.capturedReviews;
            if (result.duplicate) recaptured += 1;
            products.push({
                sourceUrl,
                outcome: result.duplicate ? 'recaptured' : 'saved',
                title: result.title,
                productId: result.productId,
                snapshotId: result.snapshotId,
                capturedReviews: result.capturedReviews,
                importedImages: result.importedImages,
                importedReviewImages: result.importedReviewImages,
                reviewWarnings: result.reviewWarnings,
                missingFields: result.missingFields,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (isJdCaptureBlocker(error)) {
                blockedReason = `采集商品时遇到登录或安全验证：${message}`;
            }
            products.push({ sourceUrl, outcome: 'failed', error: message });
            log('warn', `JD capture failed for ${sourceUrl}: ${message}`);
        } finally {
            if (tabId) {
                await callTool(io, 'tab.close', { tabId, reason: 'jd_auto_capture_complete' }, CLOSE_TIMEOUT_MS)
                    .catch(() => undefined);
            }
        }
        if (blockedReason) break;
    }

    if (saved > 0) {
        const partialReason = products.some((product) => product.outcome === 'failed')
            ? '部分商品未能保存，成功结果已保留'
            : undefined;
        return finalize('captured', blockedReason || partialReason);
    }
    if (blockedReason) return finalize('blocked', blockedReason);
    return finalize('failed', '本轮没有商品成功保存');
}

export function createJdStructuredCaptureIo(
    log?: (level: 'info' | 'warn' | 'error', message: string) => void,
): JdStructuredCaptureIo {
    return {
        invokeBrowserControl: async (method, params, options) => {
            const bridge = getBrowserCaptureBridgeService();
            if (!bridge) throw new Error('Desktop Bridge 尚未启动');
            return await bridge.invokeBrowserControl(method, params, options);
        },
        checkPluginInstance: () => {
            const bridge = getBrowserCaptureBridgeService();
            const instances = (bridge?.getStatus().instances || []).filter((instance) => instance.extensionKind === 'capture');
            if (instances.length === 0) {
                return { ok: false, detail: '未检测到已连接的 GardenFlow 浏览器插件，请确认采集浏览器已打开且插件已启用' };
            }
            return { ok: true, detail: `已连接 ${instances.length} 个采集插件实例` };
        },
        log,
    };
}
