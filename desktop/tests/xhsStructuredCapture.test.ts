import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildXhsKnowledgeEntry,
    extractXhsNoteId,
    parseCaptureSaveResult,
    parseResearchResult,
    resolveXhsSearchCardLimit,
    runXhsStructuredCaptureRound,
    type XhsStructuredCaptureIo,
} from '../electron/core/xhsStructuredCapture.ts';

const NOTE_URL_A = 'https://www.xiaohongshu.com/explore/aaa111?xsec_token=t1';
const NOTE_URL_B = 'https://www.xiaohongshu.com/explore/bbb222?xsec_token=t2';

function card(sourceUrl: string, title: string) {
    return {
        sourceUrl,
        title,
        interactionRef: { kind: 'site_card', action: 'page_click', site: 'xiaohongshu', sourceUrl },
    };
}

function previewSearch(items: Array<Record<string, unknown>>, tabId = 11) {
    return { success: true, kind: 'browser_research', operation: 'search', items, tab: { id: tabId } };
}

function openedNote(targetTabId = 11) {
    return {
        success: true,
        kind: 'browser_research_step',
        step: 'open_item',
        sourceTabId: 11,
        targetTabId,
        tab: { id: targetTabId },
        openState: { openedIn: 'same_tab_overlay', sourceTabId: 11, targetTabId },
    };
}

function savedNote(entryId: string, extra: Record<string, unknown> = {}) {
    return { success: true, mode: 'xhs', noteId: entryId, title: '已保存', duplicate: false, ...extra };
}

function makeIo(handler: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>): XhsStructuredCaptureIo & {
    calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    return {
        calls,
        invokeBrowserControl: async (method, params) => {
            assert.equal(method, 'tools/call');
            const name = String(params.name || '');
            const args = (params.arguments || {}) as Record<string, unknown>;
            calls.push({ name, args });
            return await handler(name, args);
        },
        checkPluginInstance: () => ({ ok: true, detail: 'ok' }),
        sleep: async () => undefined,
        log: () => undefined,
    };
}

test('parseResearchResult unwraps nesting and flags structured login walls', () => {
    const plain = parseResearchResult({ success: true, items: [{ sourceUrl: NOTE_URL_A }], tab: { id: 9 } });
    assert.equal(plain.ok, true);
    assert.equal(plain.items.length, 1);
    assert.equal(plain.tabId, 9);

    const nested = parseResearchResult({ result: { success: true, kind: 'browser_research', items: [] } });
    assert.equal(nested.ok, true);

    const login = parseResearchResult({ success: false, reason: 'login_required', handoff: { required: true } });
    assert.equal(login.ok, false);
    assert.equal(login.blocked, true);
});

test('parseCaptureSaveResult reads plugin 保存笔记 response', () => {
    const saved = parseCaptureSaveResult({ success: true, mode: 'xhs', noteId: 'entry_1', duplicate: false, title: '笔记' });
    assert.equal(saved.ok, true);
    assert.equal(saved.entryId, 'entry_1');
    assert.equal(saved.duplicate, false);

    const dup = parseCaptureSaveResult({ result: { success: true, noteId: 'entry_dup', duplicate: true } });
    assert.equal(dup.ok, true);
    assert.equal(dup.duplicate, true);

    const updated = parseCaptureSaveResult({ success: true, noteId: 'entry_old', duplicate: false, updated: true, title: '旧笔记' });
    assert.equal(updated.ok, true);
    assert.equal(updated.duplicate, true);
    assert.equal(updated.updated, true);

    const login = parseCaptureSaveResult({ success: false, code: 'BROWSER_LOGIN_REQUIRED', error: '当前小红书页面需要先在浏览器中登录' });
    assert.equal(login.blocked, true);
});

test('extractXhsNoteId reads explore and discovery URLs', () => {
    assert.equal(extractXhsNoteId(NOTE_URL_A), 'aaa111');
    assert.equal(extractXhsNoteId('https://www.xiaohongshu.com/discovery/item/ccc333'), 'ccc333');
});

test('buildXhsKnowledgeEntry still maps detail content', () => {
    const entry = buildXhsKnowledgeEntry({
        keyword: '猫粮',
        sourceUrl: NOTE_URL_A,
        card: { title: '卡片标题' },
        content: { title: '详情标题', body: '正文内容', comments: [{ author: '评论者', content: '好用' }] },
    });
    assert.equal(entry?.kind, 'xhs-note');
    assert.equal(entry?.source?.externalId, 'aaa111');
});

test('round is blocked when no plugin instance is connected', async () => {
    const io = makeIo(() => previewSearch([]));
    io.checkPluginInstance = () => ({ ok: false, detail: '未检测到插件' });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 3, pacing: 'normal' }, io);
    assert.equal(round.status, 'blocked');
});

test('round is blocked when the plugin reports a login wall during search', async () => {
    const io = makeIo(() => ({ success: false, reason: 'login_required', handoff: { required: true } }));
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 3, pacing: 'normal' }, io);
    assert.equal(round.status, 'blocked');
    assert.match(round.reason || '', /登录墙|login_required/);
});

test('happy path opens, saves via capture.save, then closes', async () => {
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') return previewSearch([card(NOTE_URL_A, '笔记A'), card(NOTE_URL_B, '笔记B')]);
        if (name === 'capture.save') return savedNote(`entry_${io.calls.filter((item) => item.name === 'capture.save').length}`);
        throw new Error(`unexpected tool ${name}`);
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 2, pacing: 'normal' }, io);
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 2);
    assert.equal(round.failed, 0);
    const names = io.calls.map((item) => `${item.name}:${String(item.args.executionMode || '')}`);
    assert.deepEqual(names, [
        'research.run:',
        'research.run:open_item',
        'capture.save:',
        'research.run:close_item',
        'research.run:open_item',
        'capture.save:',
        'research.run:close_item',
    ]);
    assert.equal(io.calls[0].args.depth, 'preview');
    assert.equal(io.calls[0].args.limit, resolveXhsSearchCardLimit(2));
    assert.equal(io.calls[0].args.maxScrolls, 8);
    assert.equal(io.calls[2].args.tabId, 11);
});

test('save failure on one note does not fail the whole round', async () => {
    let saveCount = 0;
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') return previewSearch([card(NOTE_URL_A, '笔记A'), card(NOTE_URL_B, '笔记B')]);
        saveCount += 1;
        if (saveCount === 1) return { success: false, error: '详情提取失败' };
        return savedNote('entry_ok');
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 5, pacing: 'normal' }, io);
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 1);
    assert.equal(round.failed, 1);
});

test('login wall while saving stops the round honestly', async () => {
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') return previewSearch([card(NOTE_URL_A, '笔记A'), card(NOTE_URL_B, '笔记B')]);
        return { success: false, code: 'BROWSER_LOGIN_REQUIRED', error: '当前小红书页面需要先在浏览器中登录' };
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 5, pacing: 'normal' }, io);
    assert.equal(round.status, 'blocked');
    assert.equal(round.saved, 0);
    assert.match(round.reason || '', /登录墙|安全验证/);
});

test('all-duplicate round counts as captured without new entries', async () => {
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') return previewSearch([card(NOTE_URL_A, '笔记A')]);
        return savedNote('entry_dup', { duplicate: true });
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 5, pacing: 'normal' }, io);
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 0);
    assert.equal(round.duplicates, 1);
});

test('empty search results fail the round with a clear reason', async () => {
    const io = makeIo(() => previewSearch([]));
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 5, pacing: 'normal' }, io);
    assert.equal(round.status, 'failed');
    assert.match(round.reason || '', /搜索结果为空/);
});

test('duplicate note ids from search cards are only opened once', async () => {
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run' && args.executionMode === 'extract') return previewSearch([]);
        if (name === 'research.run') {
            return previewSearch([
                card(NOTE_URL_A, '笔记A'),
                card(`${NOTE_URL_A}&extra=1`, '笔记A重复卡片'),
            ]);
        }
        return savedNote('entry_1');
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 5, pacing: 'normal' }, io);
    assert.equal(io.calls.filter((item) => item.name === 'capture.save').length, 1);
    assert.equal(round.saved, 1);
});

test('knowledge duplicates do not fill the quota and later unique notes are still saved', async () => {
    const NOTE_URL_C = 'https://www.xiaohongshu.com/explore/ccc333?xsec_token=t3';
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run') {
            return previewSearch([
                card(NOTE_URL_A, '旧笔记A'),
                card(NOTE_URL_B, '旧笔记B'),
                card(NOTE_URL_C, '新笔记C'),
            ]);
        }
        const saveIndex = io.calls.filter((item) => item.name === 'capture.save').length;
        if (saveIndex <= 2) return savedNote(`entry_old_${saveIndex}`, { duplicate: true });
        return savedNote('entry_new');
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 1, pacing: 'normal' }, io);
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 1);
    assert.equal(round.duplicates, 2);
    assert.equal(round.entryIds[0], 'entry_new');
    assert.equal(io.calls.filter((item) => item.name === 'capture.save').length, 3);
});

test('updated existing notes count as duplicates, not new saves', async () => {
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') return openedNote();
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run' && args.executionMode === 'extract') return previewSearch([]);
        if (name === 'research.run') return previewSearch([card(NOTE_URL_A, '旧笔记')]);
        return savedNote('entry_old', { duplicate: false, updated: true });
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 1, pacing: 'normal' }, io);
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 0);
    assert.equal(round.duplicates, 1);
    assert.equal(round.notes[0].updated, true);
    assert.match(round.summary, /已更新，不计入新入库/);
});

test('refills by scrolling when the first search batch is all duplicates', async () => {
    const NOTE_URL_C = 'https://www.xiaohongshu.com/explore/ccc333?xsec_token=t3';
    let lastOpened = '';
    const io = makeIo((name, args) => {
        if (name === 'research.run' && args.executionMode === 'open_item') {
            lastOpened = String((args.item as Record<string, unknown>)?.sourceUrl || '');
            return openedNote();
        }
        if (name === 'research.run' && args.executionMode === 'close_item') return { success: true };
        if (name === 'research.run' && args.executionMode === 'extract') {
            return previewSearch([card(NOTE_URL_A, '旧笔记'), card(NOTE_URL_C, '新笔记')]);
        }
        if (name === 'research.run') return previewSearch([card(NOTE_URL_A, '旧笔记')]);
        if (lastOpened.includes('aaa111')) return savedNote('entry_old', { duplicate: true });
        return savedNote('entry_new');
    });
    const round = await runXhsStructuredCaptureRound({ keyword: '猫粮', maxNotes: 1, pacing: 'normal' }, io);
    assert.equal(round.status, 'captured');
    assert.equal(round.saved, 1);
    assert.equal(round.duplicates, 1);
    assert.equal(round.entryIds[0], 'entry_new');
    assert.equal(io.calls.some((item) => item.name === 'research.run' && item.args.executionMode === 'extract'), true);
    const extractCall = io.calls.find((item) => item.name === 'research.run' && item.args.executionMode === 'extract');
    assert.equal(extractCall?.args.maxScrolls, 8);
    assert.equal(extractCall?.args.limit, 40);
});
