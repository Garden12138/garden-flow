import type { BrowserKnowledgeEntryPayload } from './browserCapturePayloads.ts';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService.ts';

/**
 * 小红书结构化采集管线。
 *
 * 桌面编排、插件执行。research.run 只负责页内搜索和站内点击打开/关闭笔记；
 * 入库必须走与侧栏「保存笔记」相同的 capture.save（save-xhs → ingestXhsEntryV2），
 * 不由桌面拼条目、也不直开笔记 URL。
 */

export type XhsCaptureNoteOutcome = {
    sourceUrl: string;
    title: string;
    outcome: 'saved' | 'duplicate' | 'failed';
    entryId?: string;
    error?: string;
    updated?: boolean;
};

export type XhsStructuredCaptureRound = {
    status: 'captured' | 'blocked' | 'failed';
    keyword: string;
    attempted: number;
    saved: number;
    duplicates: number;
    failed: number;
    entryIds: string[];
    notes: XhsCaptureNoteOutcome[];
    reason?: string;
    summary: string;
};

export type XhsStructuredCaptureIo = {
    invokeBrowserControl: (
        method: string,
        params: Record<string, unknown>,
        options?: { timeoutMs?: number },
    ) => Promise<unknown>;
    checkPluginInstance: () => { ok: boolean; detail: string };
    sleep?: (ms: number) => Promise<void>;
    log?: (level: 'info' | 'warn' | 'error', message: string) => void;
};

const BLOCKED_RESEARCH_REASONS = new Set(['login_required', 'security_verification_required']);
const BLOCKED_ERROR_CODES = new Set(['BROWSER_LOGIN_REQUIRED', 'BROWSER_SECURITY_CHALLENGE']);
const SEARCH_TIMEOUT_MS = 120_000;
const OPEN_TIMEOUT_MS = 60_000;
const SAVE_TIMEOUT_MS = 90_000;
const CLOSE_TIMEOUT_MS = 30_000;
const PLUGIN_STEP_TIMEOUT_MS = 20_000;
const XHS_SEARCH_MAX_SCROLLS = 8;
const XHS_SEARCH_REFILL_MAX = 2;

type CaptureSaveOutcome = {
    ok: boolean;
    blocked: boolean;
    duplicate: boolean;
    updated: boolean;
    entryId: string;
    title: string;
    reason: string;
};

type ResearchOutcome = {
    ok: boolean;
    blocked: boolean;
    reason: string;
    items: Array<Record<string, unknown>>;
    content: Record<string, unknown> | null;
    failures: Array<{ sourceUrl: string; reason: string }>;
    tabId: number;
    sourceTabId: number;
    targetTabId: number;
    openState: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function parseResearchResult(value: unknown): ResearchOutcome {
    let record = asRecord(value);
    // 兼容外层包了一层 { result } / { response: { result } } 的返回。
    for (const key of ['response', 'result']) {
        const nested = record && asRecord(record[key]);
        if (nested && (nested.kind === 'browser_research' || nested.success != null)) {
            record = nested;
        }
    }
    if (!record) {
        return {
            ok: false,
            blocked: false,
            reason: 'empty_research_result',
            items: [],
            content: null,
            failures: [],
            tabId: 0,
            sourceTabId: 0,
            targetTabId: 0,
            openState: null,
        };
    }
    const reason = String(record.reason || '').trim();
    const handoff = asRecord(record.handoff);
    const blocked = BLOCKED_RESEARCH_REASONS.has(reason) || handoff?.required === true;
    const items = Array.isArray(record.items)
        ? record.items.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
        : [];
    const failures = (Array.isArray(record.failures) ? record.failures : [])
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
            sourceUrl: String(item.sourceUrl || '').trim(),
            reason: String(item.reason || item.message || '未知原因').trim(),
        }));
    const tab = asRecord(record.tab);
    const openState = asRecord(record.openState);
    const tabId = positiveId(tab?.id || record.tabId);
    return {
        ok: record.success === true,
        blocked,
        reason,
        items,
        content: asRecord(record.content),
        failures,
        tabId,
        sourceTabId: positiveId(record.sourceTabId || openState?.sourceTabId || tabId),
        targetTabId: positiveId(record.targetTabId || openState?.targetTabId || tabId),
        openState,
    };
}

function positiveId(value: unknown): number {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

export function parseCaptureSaveResult(value: unknown): CaptureSaveOutcome {
    let record = asRecord(value);
    for (const key of ['response', 'result']) {
        const nested = record && asRecord(record[key]);
        if (nested && (nested.success != null || nested.noteId != null || nested.entryId != null)) {
            record = nested;
        }
    }
    if (!record) {
        return { ok: false, blocked: false, duplicate: false, updated: false, entryId: '', title: '', reason: 'empty_save_result' };
    }
    const code = String(record.code || record.errorCode || '').trim();
    const reason = String(record.error || record.reason || record.message || '').trim();
    const blocked = BLOCKED_ERROR_CODES.has(code)
        || BLOCKED_RESEARCH_REASONS.has(reason)
        || /需要先在浏览器中登录|安全验证/.test(reason);
    const entryId = String(record.noteId || record.entryId || '').trim();
    const updated = Boolean(record.updated);
    return {
        ok: record.success === true,
        blocked,
        duplicate: Boolean(record.duplicate) || updated,
        updated,
        entryId,
        title: String(record.title || '').trim(),
        reason,
    };
}

/** 搜索时多拉卡片：配额按「新入库」计，重复不占条数，需要余量继续翻页。 */
export function resolveXhsSearchCardLimit(maxNotes: number): number {
    const capped = Math.max(1, Math.min(20, Math.round(maxNotes || 5)));
    return Math.min(40, Math.max(capped * 4, capped + 8));
}

export function isCaptureBlocker(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    const code = String(record?.code || '');
    const message = error instanceof Error ? error.message : String(error || '');
    return BLOCKED_ERROR_CODES.has(code) || /需要先在浏览器中登录|安全验证/.test(message);
}

export function extractXhsNoteId(url: string): string {
    const match = /\/(?:explore|discovery\/item)\/([0-9a-zA-Z]+)/.exec(String(url || ''));
    return match ? match[1] : '';
}

export function uniqueXhsSearchCards(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    const cards: Array<Record<string, unknown>> = [];
    for (const card of items) {
        const sourceUrl = String(card.sourceUrl || '').trim();
        if (!/^https?:\/\//i.test(sourceUrl)) continue;
        const noteId = extractXhsNoteId(sourceUrl) || sourceUrl;
        if (seen.has(noteId)) continue;
        seen.add(noteId);
        cards.push(card);
    }
    return cards;
}

function httpUrls(values: unknown[], limit: number): string[] {
    const urls: string[] = [];
    for (const value of values) {
        const url = String(value || '').trim();
        if (/^https?:\/\//i.test(url) && !urls.includes(url)) {
            urls.push(url);
            if (urls.length >= limit) break;
        }
    }
    return urls;
}

export function buildXhsKnowledgeEntry(input: {
    keyword: string;
    sourceUrl: string;
    card: Record<string, unknown>;
    content: Record<string, unknown> | null;
}): BrowserKnowledgeEntryPayload | null {
    const content = input.content || {};
    const title = String(content.title || input.card.title || '').trim();
    const body = String(content.body || content.text || '').trim();
    if (!title && !body) return null;
    const noteId = extractXhsNoteId(input.sourceUrl);
    const mediaList = Array.isArray(content.media) ? content.media.map((item) => asRecord(item)).filter(Boolean) : [];
    const imageUrls = httpUrls(
        mediaList.filter((item) => String(item?.type || '') !== 'video').map((item) => item?.sourceUrl),
        9,
    );
    const videoUrls = httpUrls(
        mediaList.filter((item) => String(item?.type || '') === 'video').map((item) => item?.sourceUrl),
        1,
    );
    const commentsSnapshot = (Array.isArray(content.comments) ? content.comments : [])
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
            author: String(item.author || item.name || '').trim().slice(0, 200),
            text: String(item.text || item.content || '').trim().slice(0, 2_000),
        }))
        .filter((item) => item.text)
        .slice(0, 20);
    return {
        kind: videoUrls.length > 0 ? 'xhs-video' : 'xhs-note',
        source: {
            sourceLink: input.sourceUrl,
            sourceUrl: input.sourceUrl,
            sourceDomain: 'www.xiaohongshu.com',
            externalId: noteId || undefined,
        },
        content: {
            title: title || '小红书内容',
            text: body,
            indexText: body,
            excerpt: body.slice(0, 180),
            description: body.slice(0, 500),
            author: String(content.author || input.card.author || '').trim().slice(0, 1_000),
            siteName: '小红书',
            tags: ['小红书', input.keyword].filter(Boolean),
            commentsSnapshot,
        },
        assets: {
            coverUrl: imageUrls[0],
            imageUrls,
            videoUrl: videoUrls[0],
        },
    };
}

function pacingDelayMs(pacing: 'conservative' | 'normal'): number {
    return pacing === 'conservative'
        ? 5_000 + Math.floor(Math.random() * 2_000)
        : 2_000 + Math.floor(Math.random() * 1_000);
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function callTool(
    io: XhsStructuredCaptureIo,
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
): Promise<unknown> {
    return io.invokeBrowserControl('tools/call', { name, arguments: args }, { timeoutMs });
}

function summarize(round: Omit<XhsStructuredCaptureRound, 'summary'>): string {
    const lines: string[] = [];
    lines.push(`小红书自动采集：关键词「${round.keyword}」，尝试 ${round.attempted} 条，新入库 ${round.saved} 条，重复 ${round.duplicates} 条，失败 ${round.failed} 条。`);
    for (const note of round.notes) {
        const label = note.outcome === 'saved'
            ? `已入库 id=${note.entryId || ''}`
            : note.outcome === 'duplicate'
                ? (note.updated ? '已存在（已更新，不计入新入库）' : '已存在（重复跳过）')
                : `失败：${note.error || '未知原因'}`;
        lines.push(`- ${note.title || note.sourceUrl}：${label}`);
    }
    if (round.reason) {
        lines.push(`停止原因：${round.reason}`);
    }
    return lines.join('\n');
}

export async function runXhsStructuredCaptureRound(
    input: { keyword: string; maxNotes: number; pacing: 'conservative' | 'normal' },
    io: XhsStructuredCaptureIo,
): Promise<XhsStructuredCaptureRound> {
    const log = io.log || (() => undefined);
    const sleep = io.sleep || defaultSleep;
    const keyword = String(input.keyword || '').trim();
    const maxNotes = Math.max(1, Math.min(20, Math.round(input.maxNotes || 5)));
    const notes: XhsCaptureNoteOutcome[] = [];
    const entryIds: string[] = [];
    let duplicates = 0;
    let failed = 0;

    const finalize = (status: XhsStructuredCaptureRound['status'], reason?: string): XhsStructuredCaptureRound => {
        const base = {
            status,
            keyword,
            attempted: notes.length,
            saved: entryIds.length,
            duplicates,
            failed,
            entryIds,
            notes,
            reason: reason || undefined,
        };
        return { ...base, summary: summarize(base) };
    };

    if (!keyword) {
        return finalize('failed', '本轮没有可用的采集关键词');
    }
    const instance = io.checkPluginInstance();
    if (!instance.ok) {
        return finalize('blocked', instance.detail || '未检测到已连接的 Bojin 浏览器插件');
    }

    const searchCardLimit = resolveXhsSearchCardLimit(maxNotes);
    log('info', `XHS capture searching via plugin: keyword=${keyword} maxNotes=${maxNotes} searchLimit=${searchCardLimit}`);
    let search: ResearchOutcome;
    try {
        search = parseResearchResult(await callTool(io, 'research.run', {
            site: 'xiaohongshu',
            operation: 'search',
            query: keyword,
            depth: 'preview',
            limit: searchCardLimit,
            maxScrolls: XHS_SEARCH_MAX_SCROLLS,
            snapshot: false,
            active: true,
            timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
        }, SEARCH_TIMEOUT_MS));
    } catch (error) {
        return finalize('failed', `搜索请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (search.blocked) {
        return finalize('blocked', `插件检测到登录墙/安全验证（${search.reason || 'login_required'}），已停止，请先在浏览器完成登录`);
    }
    if (!search.ok) {
        return finalize('failed', `页内搜索未成功：${search.reason || '未知原因'}`);
    }
    if (search.items.length === 0) {
        return finalize('failed', '搜索结果为空：页面无笔记卡片，可能关键词无结果或页面结构变化');
    }
    const sourceTabId = search.tabId;
    if (!sourceTabId) {
        return finalize('failed', '搜索完成但插件未返回可用的结果页 tabId');
    }

    const queue = uniqueXhsSearchCards(search.items);
    const queuedNoteIds = new Set(queue.map((card) => extractXhsNoteId(String(card.sourceUrl || '')) || String(card.sourceUrl || '')));
    log('info', `XHS capture found ${search.items.length} note cards (${queue.length} unique) on tab=${sourceTabId}`);

    let blockedReason = '';
    let exhausted = false;
    let refills = 0;
    let cursor = 0;

    const enqueueCards = (items: Array<Record<string, unknown>>): number => {
        let added = 0;
        for (const card of uniqueXhsSearchCards(items)) {
            const noteId = extractXhsNoteId(String(card.sourceUrl || '')) || String(card.sourceUrl || '');
            if (!noteId || queuedNoteIds.has(noteId)) continue;
            queuedNoteIds.add(noteId);
            queue.push(card);
            added += 1;
        }
        return added;
    };

    const captureCard = async (card: Record<string, unknown>): Promise<'blocked' | 'continue'> => {
        const sourceUrl = String(card.sourceUrl || '').trim();
        const cardTitle = String(card.title || '').trim();
        const interactionRef = asRecord(card.interactionRef);
        if (!interactionRef) {
            failed += 1;
            notes.push({ sourceUrl, title: cardTitle, outcome: 'failed', error: '搜索卡片缺少 interactionRef，无法站内点击打开' });
            return 'continue';
        }

        if (notes.length > 0) {
            await sleep(pacingDelayMs(input.pacing));
        }

        let opened: ResearchOutcome;
        try {
            opened = parseResearchResult(await callTool(io, 'research.run', {
                site: 'xiaohongshu',
                operation: 'search',
                query: keyword,
                tabId: sourceTabId,
                executionMode: 'open_item',
                item: card,
                timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
            }, OPEN_TIMEOUT_MS));
        } catch (error) {
            if (isCaptureBlocker(error)) {
                blockedReason = `打开笔记时遇到登录墙/安全验证，已停止`;
                return 'blocked';
            }
            failed += 1;
            notes.push({
                sourceUrl,
                title: cardTitle,
                outcome: 'failed',
                error: `打开笔记失败：${error instanceof Error ? error.message : String(error)}`,
            });
            return 'continue';
        }
        if (opened.blocked) {
            blockedReason = `打开笔记时遇到登录墙/安全验证（${opened.reason || 'login_required'}），已停止`;
            return 'blocked';
        }
        if (!opened.ok || !opened.openState) {
            failed += 1;
            notes.push({ sourceUrl, title: cardTitle, outcome: 'failed', error: opened.reason || '站内打开笔记失败' });
            return 'continue';
        }

        const saveTabId = opened.targetTabId || sourceTabId;
        let saved: CaptureSaveOutcome;
        try {
            log('info', `XHS capture saving note via plugin capture.save tab=${saveTabId}`);
            saved = parseCaptureSaveResult(await callTool(io, 'capture.save', {
                tabId: saveTabId,
            }, SAVE_TIMEOUT_MS));
        } catch (error) {
            if (isCaptureBlocker(error)) {
                blockedReason = `保存笔记时遇到登录墙/安全验证，已停止`;
                await closeOpenedItem(io, keyword, sourceTabId, opened.openState);
                return 'blocked';
            }
            failed += 1;
            notes.push({
                sourceUrl,
                title: cardTitle,
                outcome: 'failed',
                error: `保存笔记失败：${error instanceof Error ? error.message : String(error)}`,
            });
            await closeOpenedItem(io, keyword, sourceTabId, opened.openState);
            return 'continue';
        }

        if (saved.blocked) {
            blockedReason = `保存笔记时遇到登录墙/安全验证（${saved.reason || 'login_required'}），已停止`;
            await closeOpenedItem(io, keyword, sourceTabId, opened.openState);
            return 'blocked';
        }
        if (!saved.ok || (!saved.entryId && !saved.duplicate)) {
            failed += 1;
            notes.push({ sourceUrl, title: cardTitle, outcome: 'failed', error: saved.reason || '插件保存笔记未成功' });
            await closeOpenedItem(io, keyword, sourceTabId, opened.openState);
            return 'continue';
        }

        if (saved.duplicate) {
            duplicates += 1;
            notes.push({
                sourceUrl,
                title: saved.title || cardTitle,
                outcome: 'duplicate',
                entryId: saved.entryId,
                updated: saved.updated || undefined,
            });
        } else {
            if (saved.entryId) entryIds.push(saved.entryId);
            notes.push({ sourceUrl, title: saved.title || cardTitle, outcome: 'saved', entryId: saved.entryId });
            log('info', `XHS capture saved note via 保存笔记 entryId=${saved.entryId || ''}`);
        }
        await closeOpenedItem(io, keyword, sourceTabId, opened.openState);
        return 'continue';
    };

    while (entryIds.length < maxNotes && !blockedReason) {
        if (cursor >= queue.length) {
            if (refills >= XHS_SEARCH_REFILL_MAX) {
                exhausted = true;
                break;
            }
            refills += 1;
            log('info', `XHS capture scrolling for more cards refill=${refills} saved=${entryIds.length}/${maxNotes}`);
            let refill: ResearchOutcome;
            try {
                refill = parseResearchResult(await callTool(io, 'research.run', {
                    site: 'xiaohongshu',
                    operation: 'search',
                    query: keyword,
                    tabId: sourceTabId,
                    depth: 'preview',
                    limit: 40,
                    maxScrolls: XHS_SEARCH_MAX_SCROLLS,
                    snapshot: false,
                    active: true,
                    executionMode: 'extract',
                    timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
                }, SEARCH_TIMEOUT_MS));
            } catch (error) {
                if (isCaptureBlocker(error)) {
                    blockedReason = `继续翻页时遇到登录墙/安全验证，已停止`;
                    break;
                }
                exhausted = true;
                log('warn', `XHS capture refill failed: ${error instanceof Error ? error.message : String(error)}`);
                break;
            }
            if (refill.blocked) {
                blockedReason = `继续翻页时遇到登录墙/安全验证（${refill.reason || 'login_required'}），已停止`;
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
        if (await captureCard(card) === 'blocked') break;
    }

    const quotaMissReason = !blockedReason && exhausted && entryIds.length < maxNotes
        ? `搜索结果已用尽，本轮新入库 ${entryIds.length} 条（目标 ${maxNotes}）`
        : undefined;

    if (entryIds.length > 0) {
        return finalize('captured', blockedReason || quotaMissReason);
    }
    if (blockedReason) {
        return finalize('blocked', blockedReason);
    }
    if (duplicates > 0 && failed === 0) {
        return finalize('captured', quotaMissReason || '本轮笔记均已在知识库中（全部重复），未产生新条目');
    }
    return finalize('failed', '本轮没有笔记成功入库');
}

async function closeOpenedItem(
    io: XhsStructuredCaptureIo,
    keyword: string,
    sourceTabId: number,
    openState: Record<string, unknown> | null,
): Promise<void> {
    if (!openState) return;
    try {
        await callTool(io, 'research.run', {
            site: 'xiaohongshu',
            operation: 'search',
            query: keyword,
            tabId: sourceTabId,
            executionMode: 'close_item',
            openState,
            timeoutMs: PLUGIN_STEP_TIMEOUT_MS,
        }, CLOSE_TIMEOUT_MS);
    } catch {
        // 关闭失败不覆盖已成功的入库结果。
    }
}

/** 生产环境 IO：桥接真实的插件通道。入库由插件 capture.save 完成。 */
export function createXhsStructuredCaptureIo(
    log?: (level: 'info' | 'warn' | 'error', message: string) => void,
): XhsStructuredCaptureIo {
    return {
        invokeBrowserControl: async (method, params, options) => {
            const bridge = getBrowserCaptureBridgeService();
            if (!bridge) throw new Error('Desktop Bridge 尚未启动');
            return await bridge.invokeBrowserControl(method, params, options);
        },
        checkPluginInstance: () => {
            const bridge = getBrowserCaptureBridgeService();
            const instances = bridge?.getStatus().instances || [];
            if (instances.length === 0) {
                return { ok: false, detail: '未检测到已连接的 Bojin 浏览器插件，请确认采集浏览器已打开且插件已启用' };
            }
            return { ok: true, detail: `已连接 ${instances.length} 个插件实例` };
        },
        log,
    };
}
