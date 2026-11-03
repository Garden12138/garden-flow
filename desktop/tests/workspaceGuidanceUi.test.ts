// Run: pnpm --dir desktop exec node --test tests/workspaceGuidanceUi.test.ts
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React, { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const entries = {
    campaign: 'components/campaigns/ContentCampaignsPanel',
    metrics: 'components/experiments/ContentExperimentsPanel',
    research: 'components/wander/ConsumerResearchPanel',
    maintenance: 'components/wander/SourceMaintenancePanel',
} as const;
const names = { campaign: 'ContentCampaignsPanel', metrics: 'ContentExperimentsPanel', research: 'ConsumerResearchPanel', maintenance: 'SourceMaintenancePanel' };
const ok = (data: unknown) => ({ success: true, data });
async function mount(t: TestContext, name: keyof typeof entries, api: object) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
    Object.defineProperty(dom.window, 'ipcRenderer', { value: { contentIntelligence: api, spaces: { onChanged() {}, offChanged() {} } } });
    const bundle = await build({ stdin: { contents: `export { ${names[name]} as Component } from './src/${entries[name]}';`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as { Component: ComponentType<{ onResults: () => void }> } };
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of originals) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.Component, { onResults() {} })));
    const document = dom.window.document;
    const button = (label: string) => { const node = [...document.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(node, label); return node; };
    const click = async (label: string) => { await act(async () => button(label).click()); };
    return { dom, document, click, button };
}

test('a new campaign opens a focused form while creation and model operations remain untouched', async t => {
    let writes = 0;
    const h = await mount(t, 'campaign', { campaigns: async () => ok([]), list: async () => ok({ items: [] }), sources: async () => ok([]), createCampaign: async () => { writes++; return ok({}); } });
    assert.ok(h.document.querySelector('[aria-label="让几件作品一起完成一个目标"]'));
    assert.equal(h.document.querySelector('[aria-label=选择内容组]'), null);
    await h.click('新建内容组');
    const title = h.document.querySelector('[aria-label=内容组title]')!;
    assert.equal(h.document.activeElement, title);
    assert.equal(title.closest('details')?.open, true);
    assert.equal(h.button('保存内容组').disabled, true);
    assert.equal(writes, 0);
});

test('performance starts with publication association and keeps CSV rules and comparison out of the first step', async t => {
    let writes = 0;
    const h = await mount(t, 'metrics', { metricWorks: async () => ok([]), publications: async () => ok([]), metrics: async () => ok([]), importMetrics: async () => { writes++; return ok({}); } });
    await h.click('关联已发布作品');
    const work = h.document.querySelector('[aria-label=观测工程]')!;
    assert.equal(h.document.activeElement, work);
    assert.equal(work.closest('details')?.open, true);
    const csv = h.document.querySelector('[aria-label=指标CSV内容]')!;
    assert.equal(csv.closest('details')?.open, false);
    const comparison = h.document.querySelector('[aria-label=对照观测]')!;
    assert.equal(comparison.closest('details')?.open, false);
    assert.equal(writes, 0);
});

test('research makes advanced sampling optional and empty source guidance routes to the materials library', async t => {
    let previews = 0;
    const h = await mount(t, 'research', { sources: async () => ok([]), researchRuns: async () => ok([]), previewResearch: async () => { previews++; return ok({}); } });
    const sampling = h.document.querySelector('[aria-label=研究评论上限]')!;
    assert.equal(sampling.closest('details')?.open, false);
    assert.equal(h.button('预览本轮范围与模型').disabled, true);
    let intent: unknown;
    h.dom.window.addEventListener('gardenflow:navigate', event => { intent = (event as CustomEvent).detail; });
    await h.click('去准备资料');
    assert.deepEqual(JSON.parse(JSON.stringify(intent)), { type: 'route.open', route: { section: 'library', page: 'materials' } });
    assert.equal(previews, 0);
});

test('source review explains its prerequisite instead of displaying empty version and history selectors', async t => {
    let checks = 0;
    const h = await mount(t, 'maintenance', { maintenanceSources: async () => ok({ items: [] }), maintenanceReports: async () => ok([]), checkMaintenance: async () => { checks++; return ok({}); } });
    assert.ok(h.document.querySelector('[aria-label="这里帮你找到需要更新的内容"]'));
    assert.equal(h.document.querySelector('[aria-label=选择旧来源版本]'), null);
    assert.equal(h.document.querySelector('[aria-label=选择复核记录]'), null);
    let intent: unknown;
    h.dom.window.addEventListener('gardenflow:navigate', event => { intent = (event as CustomEvent).detail; });
    await h.click('查看消费者机会');
    assert.deepEqual(JSON.parse(JSON.stringify(intent)), { type: 'route.open', route: { section: 'research', page: 'opportunities' } });
    assert.equal(checks, 0);
});

test('a delayed publication load does not collapse the association panel opened by the user', async t => {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const h = await mount(t, 'metrics', { metricWorks: async () => ok([]), publications: () => pending, metrics: async () => ok([]) });
    await h.click('关联已发布作品');
    const work = h.document.querySelector('[aria-label=观测工程]')!;
    assert.equal(work.closest('details')?.open, true);
    await act(async () => finish(ok([{ id: 'link', platform: 'xiaohongshu', accountAlias: 'demo', externalWorkId: 'posted', origin: 'manual', sourceNote: 'synthetic' }])));
    assert.equal(work.closest('details')?.open, true);
    assert.equal(h.document.activeElement, work);
});
