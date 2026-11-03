// Run: pnpm --dir desktop exec node --test tests/consumerOpportunityGuidanceUi.test.ts
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React, { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import type { Opportunity, OpportunityDetail, SourceSnapshot } from '../shared/contentIntelligence.ts';
import type { OpportunitySelection } from '../src/components/wander/OpportunityDialogs.tsx';

const opportunity: Opportunity = { id: 'one', spaceId: 'default', status: 'proposed', revision: 1, basis: 'hypothesis', title: '小桌面也能轻松取物', problem: '收纳后找不到东西', audience: '居家办公者', angle: '比较拿取体验', evidence: [], createdAt: 1, updatedAt: 1 };
async function mount(t: TestContext, contentIntelligence: object, props: { standalone?: boolean; opportunityId?: string } = { standalone: true }) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    Object.defineProperty(dom.window, 'ipcRenderer', { value: { spaces: { onChanged() {}, offChanged() {} }, contentIntelligence } });
    const bundle = await build({ stdin: { contents: "export { ContentOpportunitiesPanel } from './src/components/wander/ContentOpportunitiesPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as { ContentOpportunitiesPanel: ComponentType<typeof props> } };
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.ContentOpportunitiesPanel, props)));
    const button = (text: string) => { const result = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === text); assert.ok(result, 'button: ' + text); return result; };
    const click = async (text: string) => { await act(async () => button(text).click()); };
    const intents: unknown[] = [];
    dom.window.addEventListener('gardenflow:navigate', event => intents.push((event as CustomEvent).detail));
    return { dom, document: dom.window.document, button, click, intents };
}

test('first use explains opportunities with an example and routes to research without loading sources or starting analysis', async t => {
    let sourceReads = 0;
    const { document, click, intents } = await mount(t, { list: async () => ({ success: true, data: { items: [] } }), sources: async () => { sourceReads++; return { success: true, data: [] }; } });
    assert.ok(document.querySelector('[aria-label=机会使用指南]')?.textContent?.includes('示例 · 非真实研究结果'));
    assert.equal(document.querySelectorAll('.opportunity-guide-steps li').length, 3);
    assert.equal(document.querySelector('form'), null);
    assert.equal(document.querySelector('[aria-label=机会创作平台]'), null);
    assert.equal(document.querySelectorAll('.workspace-primary-button').length, 1);
    assert.equal(sourceReads, 0);
    await click('开始发现机会');
    assert.deepEqual(JSON.parse(JSON.stringify(intents)), [{ type: 'route.open', route: { section: 'research', page: 'consumer' } }]);
    assert.equal(sourceReads, 0);
});

test('creation is explicit, cancel restores focus, and a failure after adoption retries the same work request without adopting twice', async t => {
    let current = opportunity;
    let transitions = 0;
    const calls: Array<{ opportunityId: string; expectedRevision: number; requestId: string; selection: OpportunitySelection }> = [];
    let finish: ((result: object) => void) | undefined;
    const { document, dom, click, button, intents } = await mount(t, {
        list: async () => ({ success: true, data: { items: [current] } }),
        detail: async () => ({ success: true, data: { opportunity: current, evidence: [] } }),
        transition: async (input: { to: Opportunity['status']; expectedRevision: number }) => { transitions++; assert.equal(input.to, 'accepted'); assert.equal(input.expectedRevision, 1); current = { ...current, status: 'accepted', revision: 2 }; return { success: true, data: current }; },
        createWork: (input: typeof calls[number]) => { calls.push(input); return new Promise(resolve => { finish = resolve; }); },
    }, { standalone: true, opportunityId: opportunity.id });
    assert.equal(document.querySelector('[aria-label=机会状态]'), null);
    assert.equal(document.querySelector('[aria-label=机会创作平台]'), null);
    button('基于此创作').focus();
    await click('基于此创作'); assert.ok(document.querySelector('[role=dialog]'));
    assert.equal(transitions, 0); assert.equal(calls.length, 0);
    await act(async () => document.querySelector('[role=dialog]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('[role=dialog]'), null); assert.equal(document.activeElement, button('基于此创作'));
    await click('基于此创作');
    await act(async () => { button('采纳并创建作品').click(); button('采纳并创建作品').click(); });
    assert.equal(transitions, 1); assert.equal(calls.length, 1); assert.equal(calls[0].expectedRevision, 2);
    await act(async () => finish!({ success: false, error: '暂时无法写入，请重试' }));
    assert.ok(document.querySelector('[role=dialog] [role=alert]')?.textContent?.includes('暂时无法写入'));
    assert.equal(document.querySelector('[role=dialog]') !== null, true);
    await click('创建作品'); assert.equal(calls.length, 2); assert.equal(transitions, 1);
    assert.equal(calls[1].requestId, calls[0].requestId);
    await act(async () => finish!({ success: true, data: { workspace: { id: 'creation_one' } } }));
    assert.deepEqual(JSON.parse(JSON.stringify(intents)), [{ type: 'creation.open', workspaceId: 'creation_one' }]);
});

test('stale evidence stays visible and directs the user to source review before creation', async t => {
    const detail: OpportunityDetail = { opportunity: { ...opportunity, basis: 'evidence', evidence: [{ id: 'ev_one', relation: 'contradicts' }] }, evidence: [{ id: 'ev_one', spaceId: 'default', source: { kind: 'product', namespace: 'taobao', id: 'product_one' }, sourceVersion: 'a'.repeat(64), locator: { key: 'review', start: 0, end: 4 }, excerpt: '不同意见', validity: 'stale', coverage: { captured: 1, partial: true, issues: ['样本有限'] }, createdAt: 1 }] };
    const { document, click, intents } = await mount(t, { list: async () => ({ success: true, data: { items: [detail.opportunity] } }), detail: async () => ({ success: true, data: detail }) }, { standalone: true, opportunityId: opportunity.id });
    assert.ok(document.querySelector('.opportunity-evidence')?.textContent?.includes('反例 · 来源已更新'));
    assert.ok(document.querySelector('.opportunity-evidence')?.textContent?.includes('部分样本'));
    assert.equal([...document.querySelectorAll('button')].some(item => item.textContent === '基于此创作'), false);
    await click('前往来源复核');
    assert.deepEqual(JSON.parse(JSON.stringify(intents)), [{ type: 'route.open', route: { section: 'research', page: 'maintenance' } }]);
});

test('manual evidence is optional, choosing a segment fills its exact quote, and keyboard focus skips collapsed controls', async t => {
    const source: SourceSnapshot = { source: { kind: 'document', namespace: 'local', id: 'doc_one' }, version: 'a'.repeat(64), title: '本地访谈资料', coverage: { captured: 0, partial: false, issues: [] }, segments: [{ key: 'text_1', kind: 'text', text: '收纳以后反而找不到东西。' }] };
    const { document, dom, click, button } = await mount(t, { list: async () => ({ success: true, data: { items: [] } }), sources: async () => ({ success: true, data: [source] }) });
    await click('已有想法，手动记录');
    const evidence = document.querySelector<HTMLDetailsElement>('.opportunity-disclosure')!;
    assert.equal(evidence.open, false);
    const close = document.querySelector<HTMLButtonElement>('[aria-label=关闭手动记录]')!;
    close.focus();
    await act(async () => close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
    assert.equal(document.activeElement, button('保存机会'));
    evidence.open = true;
    const select = async (label: string, value: string) => { const field = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; await act(async () => { field.value = value; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
    await select('证据来源', '0'); await select('原文片段', 'text_1');
    assert.equal(document.querySelector<HTMLTextAreaElement>('[aria-label=引用原文]')?.value, source.segments[0].text);
    await click('取消'); assert.equal(document.querySelector('form'), null);
});

test('empty filtered results offer a reset instead of claiming the workspace has no opportunities', async t => {
    const { document, dom, click } = await mount(t, { list: async (input: { status?: string }) => ({ success: true, data: { items: input.status ? [] : [opportunity] } }) });
    assert.equal(document.querySelector<HTMLDetailsElement>('.opportunity-help')?.open, false);
    const field = document.querySelector<HTMLSelectElement>('[aria-label=机会状态]')!;
    await act(async () => { field.value = 'archived'; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.ok(document.querySelector('.workspace-empty')?.textContent?.includes('没有符合筛选条件'));
    assert.equal(document.querySelector('[aria-label=机会使用指南]'), null);
    await click('清除筛选');
    assert.ok(document.querySelector('.opportunity-card')?.textContent?.includes(opportunity.title));
});
