import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';

/**
 * 京东、淘宝和天猫商品结构化采集管线。
 *
 * 桌面运行时通过插件在平台页面搜索关键词、读取商品卡片并逐个打开；商品和评论
 * 识别、媒体下载及入库仍由 capture.save 走侧栏同一条链路完成。
 */

export type ProductCapturePlatform = 'jd' | 'taobao' | 'tmall';
const PLATFORM_LABELS = { jd: '京东', taobao: '淘宝', tmall: '天猫' } as const;

export type ProductCaptureOutcome = {
    sourceUrl: string;
    platform?: ProductCapturePlatform;
    externalId?: string;
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
    errorCode?: string;
};

export type ProductStructuredCaptureRound = {
    status: 'captured' | 'partial' | 'blocked' | 'failed';
    keyword: string;
    attempted: number;
    saved: number;
    recaptured: number;
    failed: number;
    capturedReviews: number;
    products: ProductCaptureOutcome[];
    cleanupWarnings?: string[];
    reason?: string;
    summary: string;
};

export type ProductStructuredCaptureIo = {
    invokeBrowserControl: (
        method: string,
        params: Record<string, unknown>,
        options?: { timeoutMs?: number },
    ) => Promise<unknown>;
    checkPluginInstance: () => { ok: boolean; detail: string };
    sleep?: (ms: number) => Promise<void>;
    log?: (level: 'info' | 'warn' | 'error', message: string) => void;
};

type ProductCaptureSaveResult = {
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
    errorCode: string;
    tabClosed: boolean;
    platform: string;
    externalId: string;
    sourceUrl: string;
};

type ProductResearchOutcome = {
    ok: boolean;
    blocked: boolean;
    reason: string;
    items: Array<Record<string, unknown>>;
    tabId: number;
    detail: string;
    cleanupTabIds: number[];
};

const BLOCKED_ERROR_CODES = new Set(['BROWSER_LOGIN_REQUIRED', 'BROWSER_SECURITY_CHALLENGE', 'BROWSER_RATE_LIMITED']);
const BLOCKED_RESEARCH_REASONS = new Set(['login_required', 'security_verification_required', 'rate_limited']);
const SEARCH_TIMEOUT_MS = 90_000;
const CREATE_TIMEOUT_MS = 45_000;
const SAVE_TIMEOUT_MS = 180_000;
const CLOSE_TIMEOUT_MS = 30_000;
const PLUGIN_STEP_TIMEOUT_MS = 30_000;
const PRODUCT_SEARCH_REFILL_MAX = 2;

export type ProductCapturePacingProfile = {
    searchInteractionDelayMs: number;
    searchScrollDelayMs: number;
    searchMaxScrolls: number;
    detailDwellRangeMs: [number, number];
    betweenProductsRangeMs: [number, number];
    failedProductCooldownRangeMs: [number, number];
    reviewInteractionDelayMs: number;
    reviewScrollDelayMs: number;
    reviewMaxScrollRounds: number;
};

export function resolveProductCapturePacingProfile(pacing: 'conservative' | 'normal'): ProductCapturePacingProfile {
    if (pacing === 'conservative') {
        return {
            searchInteractionDelayMs: 5_000,
            searchScrollDelayMs: 2_500,
            searchMaxScrolls: 3,
            detailDwellRangeMs: [10_000, 16_000],
            betweenProductsRangeMs: [20_000, 35_000],
            failedProductCooldownRangeMs: [30_000, 45_000],
            reviewInteractionDelayMs: 1_500,
            reviewScrollDelayMs: 1_800,
            reviewMaxScrollRounds: 4,
        };
    }
    return {
        searchInteractionDelayMs: 1_500,
        searchScrollDelayMs: 1_200,
        searchMaxScrolls: 5,
        detailDwellRangeMs: [4_000, 7_000],
        betweenProductsRangeMs: [7_000, 12_000],
        failedProductCooldownRangeMs: [12_000, 20_000],
        reviewInteractionDelayMs: 700,
        reviewScrollDelayMs: 900,
        reviewMaxScrollRounds: 6,
    };
}

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

export function normalizeProductUrl(value: unknown, platform: ProductCapturePlatform = 'jd'): string {
    try {
        const url = new URL(String(value || '').trim());
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return '';
        if (platform === 'jd') {
            if (!/(^|\.)jd\.(com|hk)$/.test(url.hostname) || !/\/\d+\.html$/i.test(url.pathname)) return '';
            url.search = '';
        } else {
            if (!['item.taobao.com', 'detail.tmall.com', 'chaoshi.detail.tmall.com'].includes(url.hostname) || url.pathname !== '/item.htm') return '';
            const id = url.searchParams.get('id') || '';
            const skuId = url.searchParams.get('skuId') || '';
            if (!/^\d+$/.test(id)) return '';
            url.search = '';
            url.searchParams.set('id', id);
            if (/^\d+$/.test(skuId)) url.searchParams.set('skuId', skuId);
        }
        url.protocol = 'https:';
        url.hash = '';
        return url.toString();
    } catch { return ''; }
}

export function extractProductExternalId(value: unknown, platform: ProductCapturePlatform = 'jd'): string {
    const normalized = normalizeProductUrl(value, platform);
    if (!normalized) return '';
    return platform === 'jd' ? /\/(\d+)\.html$/i.exec(normalized)?.[1] || '' : new URL(normalized).searchParams.get('id') || '';
}

export function normalizeProductNavigationUrl(value: unknown, platform: ProductCapturePlatform = 'jd'): string {
    if (platform === 'jd') return normalizeProductUrl(value, platform);
    try {
        const url = new URL(String(value || '').trim());
        if (!normalizeProductUrl(url.href, platform)) return '';
        url.protocol = 'https:';
        return url.href;
    } catch { return ''; }
}

export function uniqueProductSearchCards(items: Array<Record<string, unknown>>, platform: ProductCapturePlatform = 'jd'): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    const cards: Array<Record<string, unknown>> = [];
    for (const item of items) {
        const sourceUrl = normalizeProductUrl(item.sourceUrl || item.url, platform);
        const id = extractProductExternalId(sourceUrl, platform);
        if (!sourceUrl || !id) continue;
        const actualPlatform = platform === 'jd' ? 'jd' : new URL(sourceUrl).hostname === 'item.taobao.com' ? 'taobao' : 'tmall';
        const navigationUrl = normalizeProductNavigationUrl(platform === 'jd' ? item.sourceUrl || item.url : item.navigationUrl || item.sourceUrl || item.url, platform);
        // Navigation evidence must identify the same source platform and item.
        // Never replace a rejected target with a guessed bare detail URL.
        if (!navigationUrl || extractProductExternalId(navigationUrl, platform) !== id
            || (platform !== 'jd' && new URL(navigationUrl).hostname !== new URL(sourceUrl).hostname)) continue;
        if (platform !== 'jd') {
            const sourceSkuId = new URL(sourceUrl).searchParams.get('skuId');
            if (sourceSkuId && new URL(navigationUrl).searchParams.get('skuId') !== sourceSkuId) continue;
        }
        const key = `${actualPlatform}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({ ...item, id, key, platform: actualPlatform, sourceUrl, navigationUrl });
    }
    return cards;
}

export function resolveProductSearchCardLimit(maxProducts: number): number {
    const capped = Math.max(1, Math.min(20, Math.round(maxProducts || 5)));
    return Math.min(40, Math.max(capped * 3, capped + 6));
}

export function isProductCaptureBlocker(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    const code = String(record?.code || '').trim();
    const message = error instanceof Error ? error.message : String(record?.message || error || '');
    return BLOCKED_ERROR_CODES.has(code) || /需要先在浏览器中登录|安全验证|访问过于频繁|访问频繁/.test(message);
}

export function parseProductResearchResult(value: unknown): ProductResearchOutcome {
    const record = unwrapResult(value);
    if (!record) return { ok: false, blocked: false, reason: 'empty_research_result', items: [], tabId: 0, detail: '', cleanupTabIds: [] };
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
        detail: String(record.message || record.error || '').trim().slice(0, 500),
        cleanupTabIds: (Array.isArray(record.cleanupTabIds) ? record.cleanupTabIds : []).map(positiveInteger).filter(Boolean),
    };
}

export function parseProductCaptureSaveResult(value: unknown): ProductCaptureSaveResult {
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
            tabClosed: false, platform: '', externalId: '', sourceUrl: '', errorCode: '',
        };
    }
    const browserError = asRecord(record.browserError);
    const code = String(record.reviewAccessErrorCode || record.code || record.errorCode || browserError?.code || '').trim();
    const reason = String(record.error || record.reason || record.message || browserError?.message || '').trim();
    return {
        ok: record.success === true && Boolean(String(record.productId || '').trim()) && Boolean(String(record.snapshotId || '').trim()),
        duplicate: record.duplicate === true,
        blocked: BLOCKED_ERROR_CODES.has(code) || /需要先在浏览器中登录|安全验证|访问过于频繁|访问频繁/.test(reason),
        title: String(record.title || '').trim(),
        productId: String(record.productId || '').trim(),
        snapshotId: String(record.snapshotId || '').trim(),
        capturedReviews: positiveInteger(record.capturedReviews),
        importedImages: positiveInteger(record.importedImages),
        importedReviewImages: positiveInteger(record.importedReviewImages),
        reviewWarnings: stringList(record.reviewWarnings, 100),
        missingFields: stringList(record.missingFields, 100),
        reason,
        errorCode: code,
        tabClosed: record.tabClosed === true,
        platform: String(record.platform || ''),
        externalId: String(record.externalId || ''),
        sourceUrl: String(record.sourceUrl || ''),
    };
}

function createdTabId(value: unknown): number {
    const record = unwrapResult(value);
    const tab = record && asRecord(record.tab);
    return positiveInteger(tab?.id || record?.tabId);
}

function callTool(
    io: ProductStructuredCaptureIo,
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
): Promise<unknown> {
    return io.invokeBrowserControl('tools/call', { name, arguments: args }, { timeoutMs });
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomizedDelay(range: [number, number]): number {
    const [minimum, maximum] = range;
    return Math.round(minimum + Math.random() * Math.max(0, maximum - minimum));
}

function summarize(round: Omit<ProductStructuredCaptureRound, 'summary'>, label: string): string {
    const incomplete = round.products.filter((product) => product.outcome !== 'failed'
        && ((product.missingFields?.length || 0) > 0 || (product.reviewWarnings?.length || 0) > 0)).length;
    const lines = [
        `${label}商品自动采集：关键词「${round.keyword}」，尝试 ${round.attempted} 个商品，新入库 ${round.saved} 个，重复复采 ${round.recaptured} 个，失败 ${round.failed} 个，共采集评论 ${round.capturedReviews} 条。${incomplete ? `其中 ${incomplete} 个商品的资料或评论待补充。` : ''}`,
    ];
    for (const product of round.products) {
        if (product.outcome === 'failed') {
            lines.push(`- ${product.title || product.sourceUrl}：失败，${product.error || '未知原因'}；来源：${product.sourceUrl}`);
            continue;
        }
        const status = product.outcome === 'recaptured' ? '已复采' : '已保存';
        const missing = product.missingFields || [];
        const warnings = product.reviewWarnings || [];
        lines.push(`- ${product.title || product.sourceUrl}：${status}${missing.length || warnings.length ? '（采集不完整）' : ''}，评论 ${product.capturedReviews || 0} 条${missing.length ? `；缺失资料：${missing.join('、')}` : ''}${warnings.length ? `；评论提示：${warnings.join('、')}` : ''}`);
    }
    if (round.reason) lines.push(`说明：${round.reason}`);
    return lines.join('\n');
}

export async function runProductStructuredCaptureRound(
    input: {
        platform?: ProductCapturePlatform;
        captureSpaceId?: string;
        keyword: string;
        maxProducts: number;
        reviewFilterLabels: string[];
        reviewsPerFilter: number;
        pacing: 'conservative' | 'normal';
    },
    io: ProductStructuredCaptureIo,
): Promise<ProductStructuredCaptureRound> {
    const platform = input.platform || 'jd';
    const label = PLATFORM_LABELS[platform];
    if (!label) throw new Error('不支持的商品采集平台');
    const keyword = String(input.keyword || '').trim();
    const maxProducts = Math.max(1, Math.min(20, Math.round(Number(input.maxProducts) || 5)));
    const reviewFilterLabels = Array.from(new Set((input.reviewFilterLabels || []).map((label) => String(label || '').trim()).filter(Boolean))).slice(0, 50);
    const reviewsPerFilter = Math.max(1, Math.min(50, Math.round(Number(input.reviewsPerFilter) || 5)));
    const products: ProductCaptureOutcome[] = [];
    const cleanupWarnings: string[] = [];
    const sleep = io.sleep || defaultSleep;
    const log = io.log || (() => undefined);
    const pacing = resolveProductCapturePacingProfile(input.pacing);
    let saved = 0;
    let recaptured = 0;
    let capturedReviews = 0;
    let blockedReason = '';
    let failureStopReason = '';
    let consecutiveFailures = 0;
    let failureCooldownApplied = false;

    const closeTaskTab = async (tabId: number, reason: string): Promise<void> => {
        try {
            const result = unwrapResult(await callTool(io, 'tab.close', { tabId, reason }, CLOSE_TIMEOUT_MS));
            if (result?.success === false || result?.closed === false) {
                throw new Error(String(result.message || result.reason || result.error || '插件未确认标签关闭'));
            }
        } catch (error) {
            const warning = `任务标签 ${tabId}：${error instanceof Error ? error.message : String(error)}`;
            cleanupWarnings.push(warning);
            log('warn', `${label} capture could not close ${warning}`);
        }
    };

    const finalize = (status: ProductStructuredCaptureRound['status'], reason?: string): ProductStructuredCaptureRound => {
        const cleanupReason = cleanupWarnings.length ? `标签清理失败：${cleanupWarnings.join('；')}` : '';
        const base = {
            status: cleanupWarnings.length && status === 'captured' ? 'partial' as const : status,
            keyword,
            attempted: products.length,
            saved,
            recaptured,
            failed: products.filter((product) => product.outcome === 'failed').length,
            capturedReviews,
            products,
            reason: [reason, cleanupReason].filter(Boolean).join('；') || undefined,
            ...(cleanupWarnings.length ? { cleanupWarnings: [...cleanupWarnings] } : {}),
        };
        return { ...base, summary: summarize(base, label) };
    };

    if (!keyword) return finalize('failed', '本轮没有可用的采集关键词');
    const instance = io.checkPluginInstance();
    if (!instance.ok) return finalize('blocked', instance.detail || '未检测到已连接的 GardenFlow 浏览器插件');

    const searchLimit = resolveProductSearchCardLimit(maxProducts);
    log('info', `${label} capture searching via plugin: keyword=${keyword} maxProducts=${maxProducts} searchLimit=${searchLimit}`);
    let search: ProductResearchOutcome;
    try {
        search = parseProductResearchResult(await callTool(io, 'research.run', {
            site: platform,
            operation: 'search',
            query: keyword,
            depth: 'preview',
            limit: searchLimit,
            maxScrolls: pacing.searchMaxScrolls,
            interactionDelayMs: pacing.searchInteractionDelayMs,
            scrollDelayMs: pacing.searchScrollDelayMs,
            snapshot: false,
            active: true,
            reuseExistingTab: false,
            timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
        }, SEARCH_TIMEOUT_MS));
    } catch (error) {
        return finalize('failed', `${label}搜索请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
    let searchTabClosed = false;
    const closeSearchTab = async (): Promise<void> => {
        if (searchTabClosed) return;
        searchTabClosed = true;
        for (const tabId of new Set([search.tabId, ...search.cleanupTabIds].filter(Boolean))) {
            await closeTaskTab(tabId, `${platform}_auto_capture_search_complete`);
        }
    };
    const finish = async (
        status: ProductStructuredCaptureRound['status'],
        reason?: string,
    ): Promise<ProductStructuredCaptureRound> => {
        await closeSearchTab();
        return finalize(status, reason);
    };
    if (search.blocked) return await finish('blocked', `${label}搜索遇到登录、安全验证或访问限制（${search.reason || 'login_required'}），请先在浏览器完成处理`);
    if (!search.ok) return await finish('failed', `${label}关键词搜索未成功：${search.reason || '未知原因'}${search.detail ? `：${search.detail}` : ''}`);
    if (!search.tabId) return await finish('failed', `${label}搜索完成但插件未返回可用的结果页 tabId`);

    const queue = uniqueProductSearchCards(search.items, platform);
    const queuedProductIds = new Set(queue.map((card) => String(card.key || card.id || '')));
    if (queue.length === 0) return await finish('failed', `${label}搜索结果为空，或页面未识别到有效商品卡片`);
    log('info', `${label} capture found ${search.items.length} product cards (${queue.length} unique) on tab=${search.tabId}`);

    const enqueueCards = (items: Array<Record<string, unknown>>): number => {
        let added = 0;
        for (const card of uniqueProductSearchCards(items, platform)) {
            const productId = String(card.key || card.id || '');
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
    let exhaustionDetail = '';
    while (saved < maxProducts && !blockedReason) {
        if (platform !== 'jd' && products.length >= Math.max(12, maxProducts * 4)) {
            exhaustionDetail = `已达到本轮 ${Math.max(12, maxProducts * 4)} 个商品的尝试上限`;
            exhausted = true;
            break;
        }
        if (cursor >= queue.length) {
            if (refills >= PRODUCT_SEARCH_REFILL_MAX) {
                exhausted = true;
                break;
            }
            refills += 1;
            let refill: ProductResearchOutcome;
            try {
                refill = parseProductResearchResult(await callTool(io, 'research.run', {
                    site: platform,
                    operation: 'search',
                    query: keyword,
                    tabId: search.tabId,
                    executionMode: 'extract',
                    depth: 'preview',
                    limit: 40,
                    maxScrolls: pacing.searchMaxScrolls,
                    interactionDelayMs: pacing.searchInteractionDelayMs,
                    scrollDelayMs: pacing.searchScrollDelayMs,
                    snapshot: false,
                    timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
                }, SEARCH_TIMEOUT_MS));
            } catch (error) {
                log('warn', `${label} capture refill failed: ${error instanceof Error ? error.message : String(error)}`);
                exhausted = true;
                break;
            }
            if (refill.blocked) {
                blockedReason = `继续读取${label}搜索结果时遇到登录、安全验证或访问限制（${refill.reason || 'login_required'}）`;
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
        if (products.length > 0 && !failureCooldownApplied) {
            const delayMs = randomizedDelay(pacing.betweenProductsRangeMs);
            log('info', `${label} capture pacing before next product: ${delayMs}ms (${input.pacing})`);
            await sleep(delayMs);
        }
        failureCooldownApplied = false;
        let tabId = 0;
        let tabClosed = false;
        let productSucceeded = false;
        let identityMismatch = false;
        try {
            log('info', `${label} capture opening search result ${cursor}/${queue.length}: ${sourceUrl}`);
            tabId = createdTabId(await callTool(io, 'tab.create', {
                url: String(card.navigationUrl || sourceUrl),
                active: true,
                waitUntilComplete: true,
            }, CREATE_TIMEOUT_MS));
            if (!tabId) throw new Error('插件创建了商品页，但没有返回 tabId');

            const detailDwellMs = randomizedDelay(pacing.detailDwellRangeMs);
            log('info', `${label} capture dwelling on product page: ${detailDwellMs}ms (${input.pacing})`);
            await sleep(detailDwellMs);
            const result = parseProductCaptureSaveResult(await callTool(io, 'capture.save', {
                tabId,
                closeAfterSave: true,
                ...(input.captureSpaceId ? { captureSpaceId: input.captureSpaceId } : {}),
                ...(platform === 'jd' ? {} : { expectedProduct: { externalId: card.id, platforms: ['taobao', 'tmall'] } }),
                reviewOptions: {
                    selectedFilterLabels: reviewFilterLabels,
                    limitPerFilter: reviewsPerFilter,
                    captureAll: false,
                    interactionDelayMs: pacing.reviewInteractionDelayMs,
                    scrollDelayMs: pacing.reviewScrollDelayMs,
                    maxScrollRounds: pacing.reviewMaxScrollRounds,
                },
            }, SAVE_TIMEOUT_MS));
            tabClosed = result.tabClosed;
            if (result.blocked && !result.ok) {
                blockedReason = `保存商品时遇到登录、安全验证或访问限制：${result.reason || sourceUrl}`;
                products.push({ sourceUrl, platform: card.platform as ProductCapturePlatform, externalId: String(card.id), title: cardTitle, outcome: 'failed', error: blockedReason, errorCode: result.errorCode });
            } else if (!result.ok) {
                throw Object.assign(new Error(result.reason || '插件没有返回有效的商品与来源快照 ID'), { code: result.errorCode });
            } else {
                productSucceeded = true;
                consecutiveFailures = 0;
                capturedReviews += result.capturedReviews;
                if (result.duplicate) recaptured += 1;
                else saved += 1;
                products.push({
                    sourceUrl: result.sourceUrl || sourceUrl,
                    platform: (result.platform || card.platform) as ProductCapturePlatform,
                    externalId: result.externalId || String(card.id),
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
                if (result.blocked) blockedReason = `商品资料已保存，评论遇到登录、安全验证或访问限制，已停止本轮：${result.reason || result.reviewWarnings.join('、') || sourceUrl}`;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const errorCode = String(asRecord(error)?.code || '');
            identityMismatch = platform !== 'jd' && errorCode === 'BROWSER_PRODUCT_IDENTITY_MISMATCH';
            if (isProductCaptureBlocker(error)) blockedReason = `采集商品时遇到登录、安全验证或访问限制：${message}`;
            products.push({ sourceUrl, platform: card.platform as ProductCapturePlatform, externalId: String(card.id), title: cardTitle, outcome: 'failed', error: message, errorCode });
            log('warn', `${label} capture failed for ${sourceUrl}: ${message}`);
        } finally {
            if (tabId && !tabClosed) {
                await closeTaskTab(tabId, `${platform}_auto_capture_complete`);
            }
        }
        if (!productSucceeded && !blockedReason) {
            // A rejected identity is a bad candidate, not evidence of an access
            // gate or a broken capture runtime. Skip it within the same budget.
            consecutiveFailures = identityMismatch ? 0 : consecutiveFailures + 1;
            if (consecutiveFailures >= 2) {
                failureStopReason = `连续两个商品采集失败，已提前停止本轮；新入库 ${saved} 个（目标 ${maxProducts} 个），复采 ${recaptured} 个。最近错误：${products.at(-1)?.error || '未知原因'}`;
                if (platform === 'jd') {
                    // Preserve the established JD round-status contract.
                    blockedReason = failureStopReason;
                    failureStopReason = '';
                }
                break;
            }
            const cooldownMs = randomizedDelay(pacing.failedProductCooldownRangeMs);
            log('warn', `${label} capture cooling down after failure: ${cooldownMs}ms`);
            await sleep(cooldownMs);
            failureCooldownApplied = true;
        }
    }

    const quotaMissReason = !blockedReason && exhausted && saved < maxProducts
        ? `${exhaustionDetail || `${label}搜索结果已用尽`}，本轮新入库 ${saved} 个商品（目标 ${maxProducts} 个）`
        : undefined;
    if (blockedReason && platform !== 'jd') return await finish('blocked', blockedReason);
    if (failureStopReason) return await finish(saved + recaptured > 0 ? 'partial' : 'failed', failureStopReason);
    if (saved > 0) {
        const partialReason = products.some((product) => product.outcome === 'failed')
            ? '部分商品未能保存，成功结果已保留'
            : undefined;
        return await finish(platform !== 'jd' && saved < maxProducts ? 'partial' : 'captured', blockedReason || quotaMissReason || partialReason);
    }
    if (blockedReason) return await finish('blocked', blockedReason);
    if (recaptured > 0) {
        return await finish(platform === 'jd' ? 'captured' : 'partial', quotaMissReason || '本轮商品均已在资产库中（全部重复），未产生新商品');
    }
    return await finish('failed', quotaMissReason || '本轮没有商品成功保存');
}

export function createProductStructuredCaptureIo(
    log?: (level: 'info' | 'warn' | 'error', message: string) => void,
): ProductStructuredCaptureIo {
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
