import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';

/**
 * 京东商品结构化采集管线。
 *
 * 桌面运行时通过插件在京东页面搜索关键词、读取商品卡片并逐个打开；商品和评论
 * 识别、媒体下载及入库仍由 capture.save 走侧栏同一条链路完成。
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
    keyword: string;
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
    tabClosed: boolean;
};

type JdResearchOutcome = {
    ok: boolean;
    blocked: boolean;
    reason: string;
    items: Array<Record<string, unknown>>;
    tabId: number;
};

const BLOCKED_ERROR_CODES = new Set(['BROWSER_LOGIN_REQUIRED', 'BROWSER_SECURITY_CHALLENGE']);
const BLOCKED_RESEARCH_REASONS = new Set(['login_required', 'security_verification_required']);
const SEARCH_TIMEOUT_MS = 90_000;
const CREATE_TIMEOUT_MS = 45_000;
const SAVE_TIMEOUT_MS = 180_000;
const CLOSE_TIMEOUT_MS = 30_000;
const PLUGIN_STEP_TIMEOUT_MS = 30_000;
const JD_SEARCH_MAX_SCROLLS = 8;
const JD_SEARCH_REFILL_MAX = 2;

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

export function normalizeJdProductUrl(value: unknown): string {
    try {
        const url = new URL(String(value || '').trim());
        const hostname = url.hostname.toLowerCase();
        if (!/^https?:$/.test(url.protocol)) return '';
        if (!/(^|\.)jd\.(com|hk)$/.test(hostname)) return '';
        if (!/\/\d+\.html$/i.test(url.pathname)) return '';
        url.protocol = 'https:';
        url.hash = '';
        url.search = '';
        return url.toString();
    } catch {
        return '';
    }
}

export function extractJdProductId(value: unknown): string {
    const normalized = normalizeJdProductUrl(value);
    return /\/(\d+)\.html$/i.exec(normalized)?.[1] || '';
}

export function uniqueJdSearchCards(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    const cards: Array<Record<string, unknown>> = [];
    for (const item of items) {
        const sourceUrl = normalizeJdProductUrl(item.sourceUrl || item.url);
        const productId = extractJdProductId(sourceUrl);
        if (!sourceUrl || !productId || seen.has(productId)) continue;
        seen.add(productId);
        cards.push({ ...item, id: productId, sourceUrl });
    }
    return cards;
}

export function resolveJdSearchCardLimit(maxProducts: number): number {
    const capped = Math.max(1, Math.min(20, Math.round(maxProducts || 5)));
    return Math.min(40, Math.max(capped * 3, capped + 6));
}

export function isJdCaptureBlocker(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    const code = String(record?.code || '').trim();
    const message = error instanceof Error ? error.message : String(record?.message || error || '');
    return BLOCKED_ERROR_CODES.has(code) || /需要先在浏览器中登录|安全验证/.test(message);
}

export function parseJdResearchResult(value: unknown): JdResearchOutcome {
    const record = unwrapResult(value);
    if (!record) return { ok: false, blocked: false, reason: 'empty_research_result', items: [], tabId: 0 };
    const reason = String(record.reason || '').trim();
    const handoff = asRecord(record.handoff);
    const tab = asRecord(record.tab);
    return {
        ok: record.success === true,
        blocked: BLOCKED_RESEARCH_REASONS.has(reason) || handoff?.required === true,
        reason,
        items: (Array.isArray(record.items) ? record.items : [])
            .map((item) => asRecord(item))
            .filter((item): item is Record<string, unknown> => Boolean(item)),
        tabId: positiveInteger(tab?.id || record.tabId),
    };
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
            tabClosed: false,
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
        tabClosed: record.tabClosed === true,
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
        `京东商品自动采集：关键词「${round.keyword}」，尝试 ${round.attempted} 个商品，成功保存 ${round.saved} 个来源快照（其中复采 ${round.recaptured} 个），失败 ${round.failed} 个，共采集评论 ${round.capturedReviews} 条。`,
    ];
    for (const product of round.products) {
        if (product.outcome === 'failed') {
            lines.push(`- ${product.title || product.sourceUrl}：失败，${product.error || '未知原因'}`);
            continue;
        }
        const status = product.outcome === 'recaptured' ? '已复采' : '已保存';
        const warnings = [...(product.reviewWarnings || []), ...(product.missingFields || [])];
        lines.push(`- ${product.title || product.sourceUrl}：${status}，评论 ${product.capturedReviews || 0} 条${warnings.length > 0 ? `；提示：${warnings.join('、')}` : ''}`);
    }
    if (round.reason) lines.push(`说明：${round.reason}`);
    return lines.join('\n');
}

export async function runJdStructuredCaptureRound(
    input: {
        keyword: string;
        maxProducts: number;
        reviewFilterLabels: string[];
        pacing: 'conservative' | 'normal';
    },
    io: JdStructuredCaptureIo,
): Promise<JdStructuredCaptureRound> {
    const keyword = String(input.keyword || '').trim();
    const maxProducts = Math.max(1, Math.min(20, Math.round(Number(input.maxProducts) || 5)));
    const reviewFilterLabels = Array.from(new Set((input.reviewFilterLabels || []).map((label) => String(label || '').trim()).filter(Boolean))).slice(0, 50);
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
            keyword,
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

    if (!keyword) return finalize('failed', '本轮没有可用的采集关键词');
    const instance = io.checkPluginInstance();
    if (!instance.ok) return finalize('blocked', instance.detail || '未检测到已连接的 GardenFlow 浏览器插件');

    const searchLimit = resolveJdSearchCardLimit(maxProducts);
    log('info', `JD capture searching via plugin: keyword=${keyword} maxProducts=${maxProducts} searchLimit=${searchLimit}`);
    let search: JdResearchOutcome;
    try {
        search = parseJdResearchResult(await callTool(io, 'research.run', {
            site: 'jd',
            operation: 'search',
            query: keyword,
            depth: 'preview',
            limit: searchLimit,
            maxScrolls: JD_SEARCH_MAX_SCROLLS,
            snapshot: false,
            active: true,
            reuseExistingTab: false,
            timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
        }, SEARCH_TIMEOUT_MS));
    } catch (error) {
        return finalize('failed', `京东搜索请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
    let searchTabClosed = false;
    const closeSearchTab = async (): Promise<void> => {
        if (!search.tabId || searchTabClosed) return;
        searchTabClosed = true;
        await callTool(io, 'tab.close', {
            tabId: search.tabId,
            reason: 'jd_auto_capture_search_complete',
        }, CLOSE_TIMEOUT_MS).catch((error) => {
            log('warn', `JD capture could not close search tab ${search.tabId}: ${error instanceof Error ? error.message : String(error)}`);
        });
    };
    const finish = async (
        status: JdStructuredCaptureRound['status'],
        reason?: string,
    ): Promise<JdStructuredCaptureRound> => {
        await closeSearchTab();
        return finalize(status, reason);
    };
    if (search.blocked) return await finish('blocked', `京东搜索遇到登录或安全验证（${search.reason || 'login_required'}），请先在浏览器完成处理`);
    if (!search.ok) return await finish('failed', `京东关键词搜索未成功：${search.reason || '未知原因'}`);
    if (!search.tabId) return await finish('failed', '京东搜索完成但插件未返回可用的结果页 tabId');

    const queue = uniqueJdSearchCards(search.items);
    const queuedProductIds = new Set(queue.map((card) => String(card.id || '')));
    if (queue.length === 0) return await finish('failed', '京东搜索结果为空，或页面未识别到有效商品卡片');
    log('info', `JD capture found ${search.items.length} product cards (${queue.length} unique) on tab=${search.tabId}`);

    const enqueueCards = (items: Array<Record<string, unknown>>): number => {
        let added = 0;
        for (const card of uniqueJdSearchCards(items)) {
            const productId = String(card.id || '');
            if (!productId || queuedProductIds.has(productId)) continue;
            queuedProductIds.add(productId);
            queue.push(card);
            added += 1;
        }
        return added;
    };

    let cursor = 0;
    let refills = 0;
    let exhausted = false;
    while (saved < maxProducts && !blockedReason) {
        if (cursor >= queue.length) {
            if (refills >= JD_SEARCH_REFILL_MAX) {
                exhausted = true;
                break;
            }
            refills += 1;
            let refill: JdResearchOutcome;
            try {
                refill = parseJdResearchResult(await callTool(io, 'research.run', {
                    site: 'jd',
                    operation: 'search',
                    query: keyword,
                    tabId: search.tabId,
                    executionMode: 'extract',
                    depth: 'preview',
                    limit: 40,
                    maxScrolls: JD_SEARCH_MAX_SCROLLS,
                    snapshot: false,
                    timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
                }, SEARCH_TIMEOUT_MS));
            } catch (error) {
                log('warn', `JD capture refill failed: ${error instanceof Error ? error.message : String(error)}`);
                exhausted = true;
                break;
            }
            if (refill.blocked) {
                blockedReason = `继续读取京东搜索结果时遇到登录或安全验证（${refill.reason || 'login_required'}）`;
                break;
            }
            if (!refill.ok || enqueueCards(refill.items) === 0) {
                exhausted = true;
                break;
            }
            continue;
        }

        const card = queue[cursor];
        cursor += 1;
        const sourceUrl = String(card.sourceUrl || '').trim();
        const cardTitle = String(card.title || '').trim();
        if (products.length > 0) await sleep(captureDelayMs(input.pacing));
        let tabId = 0;
        let tabClosed = false;
        try {
            log('info', `JD capture opening search result ${cursor}/${queue.length}: ${sourceUrl}`);
            tabId = createdTabId(await callTool(io, 'tab.create', {
                url: sourceUrl,
                active: true,
                waitUntilComplete: true,
            }, CREATE_TIMEOUT_MS));
            if (!tabId) throw new Error('插件创建了商品页，但没有返回 tabId');

            await sleep(captureDelayMs(input.pacing));
            const result = parseJdCaptureSaveResult(await callTool(io, 'capture.save', {
                tabId,
                closeAfterSave: true,
                reviewOptions: {
                    selectedFilterLabels: reviewFilterLabels,
                    captureAll: true,
                },
            }, SAVE_TIMEOUT_MS));
            tabClosed = result.tabClosed;
            if (result.blocked) {
                blockedReason = `保存商品时遇到登录或安全验证：${result.reason || sourceUrl}`;
                products.push({ sourceUrl, title: cardTitle, outcome: 'failed', error: blockedReason });
            } else if (!result.ok) {
                throw new Error(result.reason || '插件没有返回有效的商品与来源快照 ID');
            } else {
                saved += 1;
                capturedReviews += result.capturedReviews;
                if (result.duplicate) recaptured += 1;
                products.push({
                    sourceUrl,
                    outcome: result.duplicate ? 'recaptured' : 'saved',
                    title: result.title || cardTitle,
                    productId: result.productId,
                    snapshotId: result.snapshotId,
                    capturedReviews: result.capturedReviews,
                    importedImages: result.importedImages,
                    importedReviewImages: result.importedReviewImages,
                    reviewWarnings: result.reviewWarnings,
                    missingFields: result.missingFields,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (isJdCaptureBlocker(error)) blockedReason = `采集商品时遇到登录或安全验证：${message}`;
            products.push({ sourceUrl, title: cardTitle, outcome: 'failed', error: message });
            log('warn', `JD capture failed for ${sourceUrl}: ${message}`);
        } finally {
            if (tabId && !tabClosed) {
                await callTool(io, 'tab.close', { tabId, reason: 'jd_auto_capture_complete' }, CLOSE_TIMEOUT_MS)
                    .catch((error) => {
                        log('warn', `JD capture could not close product tab ${tabId}: ${error instanceof Error ? error.message : String(error)}`);
                    });
            }
        }
    }

    const quotaMissReason = !blockedReason && exhausted && saved < maxProducts
        ? `京东搜索结果已用尽，本轮保存 ${saved} 个商品（目标 ${maxProducts} 个）`
        : undefined;
    if (saved > 0) {
        const partialReason = products.some((product) => product.outcome === 'failed')
            ? '部分商品未能保存，成功结果已保留'
            : undefined;
        return await finish('captured', blockedReason || quotaMissReason || partialReason);
    }
    if (blockedReason) return await finish('blocked', blockedReason);
    return await finish('failed', quotaMissReason || '本轮没有商品成功保存');
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
