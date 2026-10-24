// pnpm --dir desktop exec node --test tests/contentCampaignsUi.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from 'esbuild';

async function fixture(t: any, api: any, entry = "export { ContentCampaignsPanel as Component } from './src/components/campaigns/ContentCampaignsPanel';") {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' }); let changed: (() => void) | undefined;
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
    (dom.window as any).ipcRenderer = { contentIntelligence: api, spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} } };
    const bundled = await build({ stdin: { contents: entry, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
    return { dom, root, Component: module.exports.Component, button, changeSpace: () => changed!() };
}
const campaign: any = { id: 'group', title: '旧空间私密内容组', goal: '复核范围', audience: '本次样本', revision: 1, planVersion: 1, status: 'active', limitations: [], platforms: ['xiaohongshu'], opportunities: [{ id: 'opp', revision: 2 }],
    items: ['awareness', 'education', 'objection'].map((role, index) => ({ id: 'item-' + index, revision: 1, role, title: '合成条目' + index, why: '待核实职责', origin: 'agent', opportunity: { id: 'opp', revision: 2 }, evidenceRefs: ['evidence'], dependencies: [], target: { platform: 'xiaohongshu', capability: 'note-image' }, assetNeeds: [], state: 'planned' })) };
const ok = (data: unknown) => ({ success: true, data });

test('campaign UI confirms the list and each item separately, locks double creation and ignores old-space completion', async t => {
    let value = structuredClone(campaign); let oldSpace = true; let creates = 0; let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const h = await fixture(t, { campaigns: async () => ok(oldSpace ? [value] : []), list: async () => ok({ items: [] }), sources: async () => ok([]),
        campaign: async () => ok({ campaign: value, works: [] }), confirmCampaign: async (input: any) => { assert.equal(input.confirmed, true); value = { ...value, revision: 2, confirmedPlanVersion: 1 }; return ok(value); },
        createCampaignWork: async (input: any) => { assert.equal(input.confirmed, true); assert.equal(input.itemId, 'item-0'); creates++; return pending; } });
    await act(async () => h.root.render(React.createElement(h.Component)));
    await act(async () => { const select = h.dom.window.document.querySelector('[aria-label=选择内容组]') as HTMLSelectElement; select.value = 'group'; select.dispatchEvent(new h.dom.window.Event('change', { bubbles: true })); });
    assert.equal(h.button('确认当前内容列表').disabled, true); assert.equal(h.button('确认创建这一条').disabled, true); assert.equal(creates, 0);
    await act(async () => (h.dom.window.document.querySelector('[aria-label=确认成组内容列表]') as HTMLInputElement).click());
    await act(async () => h.button('确认当前内容列表').click()); assert.equal(h.button('确认创建这一条').disabled, true);
    await act(async () => (h.dom.window.document.querySelector('[aria-label="确认单项创作 item-0"]') as HTMLInputElement).click());
    await act(async () => { h.button('确认创建这一条').click(); h.button('确认创建这一条').click(); }); assert.equal(creates, 1);
    await act(async () => { oldSpace = false; h.changeSpace(); }); assert.equal(h.dom.window.document.body.textContent?.includes('旧空间私密内容组'), false);
    await act(async () => finish(ok(value))); assert.equal(h.dom.window.document.body.textContent?.includes('旧空间私密内容组'), false); assert.equal(creates, 1);
});
test('campaign planning opens a draft in the existing conversation without sending a model or creating work', async t => {
    let intent: any;
    const h = await fixture(t, { campaigns: async () => ok([campaign]), list: async () => ok({ items: [] }), sources: async () => ok([]), campaign: async () => ok({ campaign, works: [] }) });
    h.dom.window.addEventListener('gardenflow:navigate', event => { intent = (event as CustomEvent).detail; });
    await act(async () => h.root.render(React.createElement(h.Component)));
    await act(async () => { const select = h.dom.window.document.querySelector('[aria-label=选择内容组]') as HTMLSelectElement; select.value = 'group'; select.dispatchEvent(new h.dom.window.Event('change', { bubbles: true })); });
    await act(async () => h.button('去对话规划（先填草稿）').click());
    assert.equal(intent.handoff.message.deliveryMode, 'draft'); assert.equal(intent.handoff.message.sessionRouting, 'new');
    assert.ok(intent.handoff.message.content.includes('campaign_read')); assert.ok(intent.handoff.message.content.includes('group')); assert.equal(intent.type, 'flow.open');
});
test('editor group context is read-only and does not restore a late previous-space goal', async t => {
    let reads = 0; let finish!: (value: unknown) => void; const pending = new Promise(resolve => { finish = resolve; });
    const h = await fixture(t, { campaignsForWork: async () => { reads++; return pending; } }, "export { CampaignContextPanel as Component } from './src/features/creation/CampaignContextPanel';");
    await act(async () => h.root.render(React.createElement(h.Component, { workspaceId: 'work' }))); assert.equal(reads, 0);
    await act(async () => h.button('成组内容任务 ▾').click()); assert.equal(reads, 1); await act(async () => h.changeSpace());
    await act(async () => finish(ok([campaign]))); assert.equal(h.dom.window.document.body.textContent?.includes('旧空间私密内容组'), false);
    assert.equal(h.dom.window.document.querySelectorAll('button').length, 1);
});
