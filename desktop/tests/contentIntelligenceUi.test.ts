// Run: pnpm --dir desktop exec node --test tests/contentIntelligenceUi.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

test('space switch clears private opportunities immediately and ignores late source responses and unmounted results', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    let changed: (() => void) | undefined; let release: (value: any) => void = () => {};
    const opportunity = { id: 'one', spaceId: 'a', status: 'proposed', revision: 1, basis: 'hypothesis', title: '空间 A 私有机会', problem: '空间 A 问题', audience: '本地样本', angle: '核对', evidence: [], createdAt: 1, updatedAt: 1 };
    (dom.window as any).ipcRenderer = {
        spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} },
        contentIntelligence: { list: async () => ({ success: true, data: { items: [opportunity] } }), sources: () => new Promise(resolve => { release = resolve; }) },
    };
    const bundled = await build({ stdin: { contents: "export { ContentOpportunitiesPanel } from './src/components/wander/ContentOpportunitiesPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any };
    vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.ContentOpportunitiesPanel)));
    assert.ok(dom.window.document.body.textContent?.includes(opportunity.title));
    const button = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '手动新建机会')!;
    await act(async () => button.click());
    await act(async () => changed!()); assert.equal(dom.window.document.body.textContent?.includes(opportunity.title), false);
    await act(async () => release({ success: true, data: [{ title: '迟到的空间 A 来源' }] }));
    assert.equal(dom.window.document.body.textContent?.includes('迟到的空间 A 来源'), false);
    assert.equal(dom.window.document.querySelector('form'), null);
    await act(async () => button.click());
    await act(async () => root.unmount());
    await act(async () => release({ success: true, data: [] }));
});

test('research sends nothing before checkbox plus button confirmation and clears a late start response on space switch', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const source = { source: { kind: 'product', namespace: 'tmall', id: 'one' }, version: 'a'.repeat(64), title: '空间 A 合成测试资料', coverage: { captured: 1, partial: false, issues: [] }, segments: [] };
    const run = { id: 'run_one', status: 'queued', revision: 1, createdAt: 1, calls: 0, opportunityIds: [], sourceCount: 1, referenceCount: 1, commentCount: 1, inputCharacters: 10, coverage: source.coverage,
        sourceOverviews: [{ source: source.source, version: source.version, title: source.title, coverage: source.coverage, referenceCount: 1, commentCount: 1, inputCharacters: 10 }],
        model: { name: 'synthetic-test-model', host: 'localhost', fingerprint: 'b'.repeat(64) } };
    let changed: (() => void) | undefined; let starts = 0; let finishStart: (value: any) => void = () => {};
    (dom.window as any).ipcRenderer = { spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} }, contentIntelligence: {
        sources: async () => ({ success: true, data: [source] }), researchRuns: async () => ({ success: true, data: [] }), previewResearch: async () => ({ success: true, data: run }),
        startResearch: () => { starts++; return new Promise(resolve => { finishStart = resolve; }); },
    } };
    const bundled = await build({ stdin: { contents: "export { ConsumerResearchPanel } from './src/components/wander/ConsumerResearchPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.ConsumerResearchPanel, { onResults: () => {} })));
    const find = (label: string) => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === label)!;
    await act(async () => (dom.window.document.querySelector('[data-research-source]') as HTMLInputElement).click());
    await act(async () => find('预览本轮范围与模型').click()); assert.equal(starts, 0);
    const start = find('确认并运行分析'); assert.equal(start.disabled, true); await act(async () => start.click()); assert.equal(starts, 0);
    await act(async () => (dom.window.document.querySelector('[aria-label=确认研究模型费用]') as HTMLInputElement).click()); assert.equal(starts, 0); assert.equal(start.disabled, false);
    await act(async () => { start.click(); start.click(); }); assert.equal(starts, 1);
    await act(async () => changed!()); assert.equal(dom.window.document.body.textContent?.includes(source.title), false);
    await act(async () => finishStart({ success: true, data: { ...run, status: 'running', revision: 2, calls: 1 } }));
    assert.equal(dom.window.document.body.textContent?.includes(run.model.name), false); assert.equal(dom.window.document.querySelector('[aria-label=研究范围预览]'), null);
});

test('opening a historical preview restores its actual selected scope and shows the frozen source version and original text', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const coverage = { captured: 1, partial: true, issues: ['仅本地合成样本'] };
    const source = { source: { kind: 'product', namespace: 'tmall', id: 'a' }, version: 'b'.repeat(64), title: '当前 A 已更名', coverage, segments: [] };
    const other = { ...source, source: { ...source.source, id: 'b' }, title: '当前 B' };
    const overview = { source: source.source, version: 'a'.repeat(64), title: '冻结的旧 A', capturedAt: 1, coverage, referenceCount: 1, commentCount: 1, inputCharacters: 7 };
    const run = { id: 'historical', status: 'queued', revision: 1, createdAt: 1, calls: 0, opportunityIds: [], sourceCount: 1, referenceCount: 1, commentCount: 1, inputCharacters: 7, coverage,
        scope: { sources: [{ source: source.source, version: overview.version }], goal: '旧范围', maxComments: 10, completeOnly: false },
        model: { name: 'synthetic-old-model', host: 'localhost', fingerprint: 'c'.repeat(64) } };
    let changed: (() => void) | undefined; let inputReads = 0;
    (dom.window as any).ipcRenderer = { spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} }, contentIntelligence: {
        sources: async () => ({ success: true, data: [source, other] }), researchRuns: async () => ({ success: true, data: [run] }),
        researchRun: async (id: string) => { assert.equal(id, run.id); return { success: true, data: { ...run, sourceOverviews: [overview] } }; },
        researchInput: async (id: string) => { assert.equal(id, run.id); inputReads++; return { success: true, data: [{ id: 'ref_a', source: source.source, version: overview.version, kind: 'comment', key: 'comment_one', text: '旧 A 冻结原文' }] }; },
        startResearch: async () => { assert.fail('viewing an old preview must not call a model'); },
    } };
    const bundled = await build({ stdin: { contents: "export { ConsumerResearchPanel } from './src/components/wander/ConsumerResearchPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.ConsumerResearchPanel, { onResults: () => {} })));
    const checkboxes = [...dom.window.document.querySelectorAll<HTMLInputElement>('[data-research-source]')];
    await act(async () => checkboxes[1].click()); assert.equal(checkboxes[1].checked, true);
    const view = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '查看范围')!;
    await act(async () => view.click()); assert.equal(checkboxes[0].checked, true); assert.equal(checkboxes[1].checked, false);
    const frozen = dom.window.document.querySelector('[aria-label=本轮已冻结的发送范围]')!;
    assert.ok(frozen.textContent?.includes('冻结的旧 A')); assert.ok(frozen.textContent?.includes('aaaaaaaaaaaa')); assert.equal(frozen.textContent?.includes('当前 A 已更名'), false);
    assert.equal((dom.window.document.querySelector('[aria-label=确认研究模型费用]') as HTMLInputElement).checked, false);
    assert.equal(inputReads, 0);
    const raw = [...dom.window.document.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent?.startsWith('查看本轮将发送'))!;
    await act(async () => { raw.open = true; raw.dispatchEvent(new dom.window.Event('toggle')); });
    assert.equal(inputReads, 1); assert.ok(dom.window.document.querySelector('[aria-label=研究发送原文]')?.textContent?.includes('旧 A 冻结原文'));
    await act(async () => changed!()); assert.equal(dom.window.document.body.textContent?.includes('旧 A 冻结原文'), false);
});
