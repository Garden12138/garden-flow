import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FLOW_STAGE_VIEW_MAP,
    WORKBENCH_NAVIGATION,
    normalizeRestoredWorkbenchView,
    resolveFlowOpen,
    viewForFlowStage,
} from '../src/features/workbench/navigation.ts';
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH } from '../src/features/app-shell/useLayoutSidebar.ts';

test('workflow stages map to the intended desktop pages', () => {
    assert.deepEqual(FLOW_STAGE_VIEW_MAP, {
        home: 'home',
        collect: 'knowledge',
        ideate: 'wander',
        compose: 'gardenflow',
        produce: 'generation-studio',
        library: 'subjects',
        schedule: 'automation',
    });
    assert.deepEqual(
        WORKBENCH_NAVIGATION.map((item) => item.view),
        ['home', 'knowledge', 'wander', 'gardenflow', 'generation-studio', 'subjects', 'media-library', 'automation'],
    );
});

test('new users open the workbench while existing legal pages still restore', () => {
    assert.equal(normalizeRestoredWorkbenchView(null), 'home');
    assert.equal(normalizeRestoredWorkbenchView('removed-page'), 'home');
    assert.equal(normalizeRestoredWorkbenchView('gardenflow'), 'gardenflow');
    assert.equal(normalizeRestoredWorkbenchView('media-library'), 'media-library');
});

test('chat handoff resolves once to compose and preserves every reference', () => {
    const message = {
        content: '请把这些素材整理为创作简报',
        deliveryMode: 'draft' as const,
        knowledgeReferences: [{ id: 'note-1', title: '田野记录', tags: ['观察'] }],
        assetReferences: [{ id: 'asset-1', name: '品牌人物', tags: ['主角'] }],
    };
    const resolved = resolveFlowOpen('ideate', { kind: 'chat-draft', message });
    assert.equal(resolved.view, 'gardenflow');
    assert.equal(resolved.chatMessage, message);
    assert.deepEqual(resolved.chatMessage?.knowledgeReferences, message.knowledgeReferences);
    assert.deepEqual(resolved.chatMessage?.assetReferences, message.assetReferences);
    assert.equal(resolved.generationIntent, undefined);
});

test('generation handoff keeps the typed intent and ignores message-like keywords', () => {
    const intent = {
        mode: 'cover' as const,
        source: 'manuscripts' as const,
        sourceTitle: '秋季刊',
        assetReferences: [{ assetId: 'image-1', name: '参考封面' }],
    };
    const generated = resolveFlowOpen('compose', { kind: 'generation', intent });
    assert.equal(generated.view, 'generation-studio');
    assert.equal(generated.generationIntent, intent);

    const keywordMessage = resolveFlowOpen('compose', {
        kind: 'chat-draft',
        message: { content: '生图、视频、自动化都只是正文内容', deliveryMode: 'draft' },
    });
    assert.equal(keywordMessage.view, 'gardenflow');
    assert.equal(viewForFlowStage('produce'), 'generation-studio');
});

test('legacy sidebar width preferences remain valid and are safely clamped', () => {
    assert.equal(SIDEBAR_DEFAULT_WIDTH, 300);
    assert.equal(clampSidebarWidth(240), 240);
    assert.equal(clampSidebarWidth(320), 320);
    assert.equal(clampSidebarWidth(100), 240);
    assert.equal(clampSidebarWidth(800), 460);
});
