import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { canPersistChatComposerDraft, isChatComposerTextEditable } from '../src/utils/chatComposerState.ts';
import {
    clearChatSessionCache,
    readChatSessionCache,
    mergeChatRuntimeEvents,
    resolveChatSendSessionId,
    useChatSessionActivities,
    writeChatSessionCache,
} from '../src/runtime/chatSessionStore.ts';
import {
    mergeChatMessageSnapshots,
    reconcileOptimisticChatMessageIds,
} from '../src/utils/chatMessageSnapshot.ts';
import { uploadedAttachmentsFromPersistedMessage } from '../src/utils/chatMessageAttachments.ts';

test('a new-chat draft never reuses a stale session id', () => {
    assert.equal(resolveChatSendSessionId({
        forceNewSession: true,
        fixedSessionId: null,
        currentSessionIdRef: 'session_old_ref',
        currentSessionId: 'session_old_state',
    }), null);

    assert.equal(resolveChatSendSessionId({
        forceNewSession: false,
        fixedSessionId: 'session_fixed',
        currentSessionIdRef: 'session_old_ref',
        currentSessionId: 'session_old_state',
    }), 'session_fixed');
});

test('clears a submitted draft cache and keeps the editor writable while busy', () => {
    writeChatSessionCache('session-submit', {
        draft: '你可以先生成这两只边牧的图片',
    });
    writeChatSessionCache('session-submit', {
        draft: '',
        pendingAttachments: [],
    });
    assert.equal(readChatSessionCache('session-submit')?.draft, '');
    assert.equal(isChatComposerTextEditable({ readOnly: false, disabled: false, isBusy: true }), true);
    assert.equal(isChatComposerTextEditable({ readOnly: true, disabled: false, isBusy: false }), false);
    clearChatSessionCache('session-submit');
});

test('does not write the previous draft into a session before its composer cache is hydrated', () => {
    assert.equal(canPersistChatComposerDraft({
        sessionId: 'session-new',
        hydratedSessionId: 'session-old',
    }), false);
    assert.equal(canPersistChatComposerDraft({
        sessionId: 'session-new',
        hydratedSessionId: null,
    }), false);
    assert.equal(canPersistChatComposerDraft({
        sessionId: 'session-new',
        hydratedSessionId: 'session-new',
    }), true);
});

test('restores every uploaded image from canonical message metadata', () => {
    const primary = { type: 'uploaded-file', attachmentId: 'image-1', name: '图1.png' };
    const secondary = { type: 'uploaded-file', attachmentId: 'image-2', name: '图2.png' };
    const restored = uploadedAttachmentsFromPersistedMessage({
        attachment: JSON.stringify(primary),
        metadata: JSON.stringify({ uploadedAttachments: [primary, secondary] }),
    });
    assert.deepEqual(restored.map((item) => item.attachmentId), ['image-1', 'image-2']);
});

test('reconciles a late send receipt into the session cache with stable message ids', () => {
    const reconciled = reconcileOptimisticChatMessageIds([
        { id: '1786606431941', role: 'user', content: '使用这两张参考图生成视频' },
        { id: '1786606431942', role: 'ai', content: '', isStreaming: true },
    ], {
        optimisticUserMessageId: '1786606431941',
        optimisticAssistantMessageId: '1786606431942',
        userMessageId: 'chat_user_stable',
        assistantMessageId: 'chat_assistant_stable',
        runId: 'chat_run_stable',
    });
    assert.deepEqual(reconciled.map((message) => message.id), [
        'chat_user_stable',
        'chat_assistant_stable',
    ]);
    assert.equal(reconciled[1].runId, 'chat_run_stable');
});

test('does not append stale optimistic messages after database reconciliation', () => {
    const persisted = [
        {
            id: 'chat_user_stable',
            role: 'user',
            content: '使用这两张参考图生成视频\n[用户上传附件]...',
            displayContent: '使用这两张参考图生成视频',
            createdAt: 1786606541450,
            attachments: [
                { type: 'uploaded-file', attachmentId: 'image-1' },
                { type: 'uploaded-file', attachmentId: 'image-2' },
            ],
        },
        {
            id: 'chat_assistant_stable',
            role: 'ai',
            content: '收到参考图。',
            createdAt: 1786606541451,
            isStreaming: false,
        },
    ];
    const staleCached = [
        {
            id: '1786606541449',
            role: 'user',
            content: '使用这两张参考图生成视频',
            displayContent: '使用这两张参考图生成视频',
            createdAt: 1786606541449,
            attachments: [{ type: 'uploaded-file', attachmentId: 'image-1' }],
        },
        {
            id: '1786606541450',
            role: 'ai',
            content: '',
            createdAt: 1786606541450,
            isStreaming: true,
        },
    ];
    const merged = mergeChatMessageSnapshots(persisted, staleCached);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((message) => message.id), [
        'chat_user_stable',
        'chat_assistant_stable',
    ]);
    assert.equal(merged[0].attachments?.length, 2);
    assert.equal(merged[1].content, '收到参考图。');
});

test('keeps richer cached assistant content and execution details during database reconciliation', () => {
    const persisted = [{
        id: 'assistant-1',
        role: 'ai',
        content: '先生成西卡（黑白边牧）和',
        runId: 'run-1',
        runSequence: 15,
        isStreaming: false,
        timeline: [],
        tools: [],
    }];
    const cached = [{
        ...persisted[0],
        timeline: [{ id: 'tool-1', status: 'failed', toolData: { callId: 'call-1' } }],
        tools: [{ id: 'legacy-tool-1' }],
    }];
    const merged = mergeChatMessageSnapshots(persisted, cached);
    assert.equal(merged[0].content, persisted[0].content);
    assert.equal(merged[0].timeline.length, 1);
    assert.equal(merged[0].tools.length, 1);
});

test('deduplicates cached and replayed runtime events by run sequence', () => {
    const live = { eventId: 'live-1', eventType: 'runtime:tool-start', runId: 'run-1', sequence: 1 };
    const replay = { id: 'persisted-1', eventType: 'runtime:tool-start', payload: { runId: 'run-1', sequence: 1 } };
    const next = { id: 'persisted-2', eventType: 'runtime:tool-end', payload: { runId: 'run-1', sequence: 2 } };
    assert.equal(mergeChatRuntimeEvents([live], [replay, next]).length, 2);
});

test('restores cached messages, draft, attachments, and scroll position', () => {
    const dom = new JSDOM('<div id="messages"></div>');
    const container = dom.window.document.getElementById('messages') as HTMLDivElement;
    container.scrollTop = 480;

    writeChatSessionCache('session-cache', {
        messages: [{ id: 'message-1', content: 'cached' }],
        contextUsage: { estimatedTotalTokens: 12 },
        draft: 'unfinished draft',
        pendingAttachments: [{ type: 'uploaded-file', name: 'draft.png' }],
        scrollTop: container.scrollTop,
        wasNearBottom: false,
    });

    const restored = readChatSessionCache<
        { id: string; content: string },
        { estimatedTotalTokens: number }
    >('session-cache');
    assert.equal(restored?.messages[0].content, 'cached');
    assert.equal(restored?.draft, 'unfinished draft');
    assert.equal((restored?.pendingAttachments[0] as { name: string }).name, 'draft.png');
    assert.equal(restored?.scrollTop, 480);
    assert.equal(restored?.wasNearBottom, false);
    clearChatSessionCache('session-cache');
});

test('keeps message and attachment caches isolated during repeated session updates', () => {
    writeChatSessionCache('session-a', {
        messages: [{ id: 'a-message', content: 'A' }],
        pendingAttachments: [
            { type: 'uploaded-file', attachmentId: 'a-1' },
            { type: 'uploaded-file', attachmentId: 'a-2' },
        ],
    });
    writeChatSessionCache('session-b', {
        messages: [{ id: 'b-message', content: 'B' }],
        pendingAttachments: [{ type: 'uploaded-file', attachmentId: 'b-1' }],
    });
    writeChatSessionCache('session-a', {
        contextUsage: { estimatedTotalTokens: 42 },
    });

    assert.equal((readChatSessionCache('session-a')?.messages[0] as { content: string }).content, 'A');
    assert.equal(readChatSessionCache('session-a')?.pendingAttachments.length, 2);
    assert.equal((readChatSessionCache('session-b')?.messages[0] as { content: string }).content, 'B');
    assert.equal(readChatSessionCache('session-b')?.pendingAttachments.length, 1);
    clearChatSessionCache('session-a');
    clearChatSessionCache('session-b');
});

test('publishes per-session running and unread completion activity', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    let runtimeListener: ((event: unknown, envelope?: unknown) => void) | null = null;
    Object.defineProperty(dom.window, 'ipcRenderer', {
        configurable: true,
        value: {
            runtime: {
                onEvent: (listener: (event: unknown, envelope?: unknown) => void) => {
                    runtimeListener = listener;
                },
            },
        },
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

    let activities: ReturnType<typeof useChatSessionActivities> = [];
    const Observer = () => {
        activities = useChatSessionActivities();
        return React.createElement('div', null, activities.length);
    };
    const root = createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
    await act(async () => root.render(React.createElement(Observer)));
    assert.ok(runtimeListener);

    await act(async () => runtimeListener?.({}, {
        eventType: 'runtime:stream-start',
        sessionId: 'session-activity',
        runId: 'run-activity',
        assistantMessageId: 'assistant-activity',
        sequence: 1,
        status: 'running',
        phase: 'thinking',
        timestamp: 100,
        payload: { runId: 'run-activity', assistantMessageId: 'assistant-activity', startedAt: 100, sequence: 1 },
    }));
    assert.equal(activities.find((item) => item.sessionId === 'session-activity')?.status, 'running');

    await act(async () => runtimeListener?.({}, {
        eventType: 'runtime:done',
        sessionId: 'session-activity',
        runId: 'run-activity',
        assistantMessageId: 'assistant-activity',
        sequence: 2,
        status: 'completed',
        phase: 'completed',
        timestamp: 200,
        payload: {
            runId: 'run-activity',
            assistantMessageId: 'assistant-activity',
            startedAt: 100,
            sequence: 2,
            status: 'completed',
            content: 'done',
        },
    }));
    const completed = activities.find((item) => item.sessionId === 'session-activity');
    assert.equal(completed?.status, 'completed');
    assert.equal(completed?.unreadCount, 1);

    await act(async () => root.unmount());
    clearChatSessionCache('session-activity');
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});
