import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await fs.readFile(new URL('../electron/appMain.ts', import.meta.url), 'utf8');
const handlerSource = source.slice(source.indexOf('const productVideoRetries ='), source.indexOf('// 取消执行', source.indexOf('const productVideoRetries =')));
const code = (await transform(handlerSource, { loader: 'ts', target: 'es2022' })).code;
function fixture() {
    let handler: any;
    const sent: any[] = [];
    const state = { active: false, spaceId: 'default', task: { status: 'failed', metadata: {
        workflowKind: 'product-video-compose',
        productVideoVisualDiagnostic: { outcome: 'token-mismatch' }, productVideoRequest: { message: '制作 15 秒竖版视频', spaceId: 'default' },
        explicitProductRefs: [{ productId: 'p1' }],
    } }, newerTasks: [] as any[] };
    vm.runInNewContext(code, {
        ipcMain: { handle: (channel: string, fn: any) => { if (channel === 'chat:retry-product-video') handler = fn; } }, randomUUID: () => 'fresh-id',
        getChatSession: (sessionId: string) => sessionId === 's1', getActiveChatRun: () => state.active,
        getWorkspacePaths: () => ({ activeSpaceId: state.spaceId }), getTaskGraphRuntime: () => ({ listTasks: () => [...state.newerTasks, state.task] }),
        brandWorkspaceStore: { getProductCreativeReference: async (id: string) => ({ id, name: '最新商品名称' }) },
        getProductVideoReplanInput: async (sessionId: string, callId: string) => {
            assert.equal(sessionId, 's1'); assert.equal(callId, 'stale-card'); return { message: '原始创作要求', productId: 'p1' };
        },
        executeChatMessage: async (_: unknown, payload: any, receipt: any) => { sent.push(payload); state.active = true; receipt({ accepted: true, sessionId: payload.sessionId }); },
    });
    return { state, sent, run: (payload: any) => handler({}, payload) };
}

test('replan coalesces double clicks and carries current model, fresh assets, original request and new proposal ID', async () => {
    const h = fixture();
    const modelConfig = { modelName: 'currently-selected', sourceId: 'current-provider' };
    const input = { sessionId: 's1', callId: 'stale-card', modelConfig };
    const one = h.run(input); const two = h.run(input);
    assert.equal(one, two);
    assert.equal((await one).accepted, true);
    assert.equal(h.sent.length, 1);
    const payload = h.sent[0];
    assert.equal(payload.modelConfig, modelConfig);
    assert.equal(payload.message, '原始创作要求');
    assert.equal(payload.assetReferences[0].name, '最新商品名称');
    assert.equal(payload.taskHints.productVideoProposalId, 'proposal-fresh-id');
    assert.equal(payload.taskHints.productVideoReplan, true);
    assert.equal((await h.run(input)).accepted, false);
    assert.equal(h.sent.length, 1);
});

test('visual retry requires a failed diagnostic in the owning space and never switches the selected model', async () => {
    const h = fixture();
    h.state.spaceId = 'other';
    assert.equal((await h.run({ sessionId: 's1' })).accepted, false);
    h.state.spaceId = 'default'; h.state.task.metadata.productVideoVisualDiagnostic.outcome = 'verified';
    assert.equal((await h.run({ sessionId: 's1' })).accepted, false);
    h.state.task.metadata.productVideoVisualDiagnostic.outcome = 'image-decode';
    const modelConfig = { modelName: 'user-choice', sourceId: 'provider-2' };
    assert.equal((await h.run({ sessionId: 's1', modelConfig })).accepted, true);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].modelConfig, modelConfig);
    assert.equal(h.sent[0].message, '制作 15 秒竖版视频');
    assert.equal(h.sent[0].assetReferences[0].id, 'p1');
    assert.equal(h.sent[0].taskHints.workflowKind, 'product-video-compose');
});

test('explicit visual retry recovers the product request after a plain follow-up task', async () => {
    const h = fixture();
    h.state.newerTasks.push({ status: 'failed', metadata: {}, goal: '重试商品图片理解' });
    assert.equal((await h.run({ sessionId: 's1' })).accepted, true);
    assert.equal(h.sent[0].message, '制作 15 秒竖版视频');
    assert.equal(h.sent[0].assetReferences[0].id, 'p1');
});

test('visual retry does not revive an older failure after a newer product workflow succeeded', async () => {
    const h = fixture();
    h.state.newerTasks.push({ status: 'completed', metadata: { workflowKind: 'product-video-compose' } });
    assert.equal((await h.run({ sessionId: 's1' })).accepted, false);
    assert.equal(h.sent.length, 0);
});

test('the explicit visual retry preserves an image-set workflow without starting video planning', async () => {
    const h = fixture();
    Object.assign(h.state.task.metadata, { workflowKind: 'product-image-set-compose', productImageSetRequest: { message: '商品五张套图', spaceId: 'default' } });
    assert.equal((await h.run({ sessionId: 's1' })).accepted, true);
    assert.equal(h.sent[0].taskHints.workflowKind, 'product-image-set-compose');
    assert.equal(h.sent[0].taskHints.productImageSetProposalId, 'proposal-fresh-id');
    assert.equal(h.sent[0].message, '商品五张套图');
});

test('cold history restores the visual retry action on its owning response, even after a generic error', async () => {
    const chatSource = await fs.readFile(new URL('../src/pages/Chat.tsx', import.meta.url), 'utf8');
    const start = chatSource.indexOf('function applyPersistedRuntimeEventsToMessages(');
    const compiled = (await transform(chatSource.slice(start, chatSource.indexOf('export function Chat(', start)), { loader: 'tsx', target: 'es2022' })).code;
    const context = vm.createContext({
        runtimeEventType: (event: any) => event.eventType,
        runtimeEventCreatedAt: (event: any) => event.createdAt,
        runtimeEventId: (event: any) => event.id,
        runtimeObject: (value: any) => value && typeof value === 'object' ? value : {},
        runtimeText: (value: any) => String(value || '').trim(),
        truncateErrorDetail: (value: any) => value,
    });
    vm.runInContext(compiled, context);
    const apply = vm.runInContext('applyPersistedRuntimeEventsToMessages', context);
    const messages = [{ id: 'visual-response', role: 'ai', timeline: [] }, { id: 'generic-response', role: 'ai', timeline: [] }];
    const checkpoint = (id: string, category: string, createdAt: number) => ({
        id, eventType: 'runtime:checkpoint', assistantMessageId: id, createdAt,
        payload: { checkpointType: 'chat.error', payload: { category, message: '理解失败' } },
    });
    const restored = apply(messages, [], [checkpoint('generic-response', 'unknown', 2), checkpoint('visual-response', 'product-video-visual', 1)]);
    assert.equal(restored[0].productVideoVisualRetry, true);
    assert.equal(restored[1].productVideoVisualRetry, false);
    assert.equal(messages[0].productVideoVisualRetry, undefined, 'do not mutate the cached message');
});
