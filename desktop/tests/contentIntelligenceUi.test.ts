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
