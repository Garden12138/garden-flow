// Run: pnpm --dir desktop exec node --test tests/contentExperimentContextUi.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from 'esbuild';

test('editor experiment context never restores a late previous-space task and exposes only read-only task actions', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']; const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    let changed: (() => void) | undefined; let finish!: (value: unknown) => void; let reads = 0;
    const pending = new Promise(resolve => { finish = resolve; });
    (dom.window as any).ipcRenderer = { spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} }, contentIntelligence: {
        experimentTasks: async () => { reads++; return pending; },
    } };
    const bundled = await build({ stdin: { contents: "export { ExperimentTaskContextPanel } from './src/features/creation/ExperimentTaskContextPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.ExperimentTaskContextPanel, { workspaceId: 'work' })));
    assert.equal(reads, 0); await act(async () => (dom.window.document.querySelector('button') as HTMLButtonElement).click()); assert.equal(reads, 1);
    await act(async () => changed!());
    await act(async () => finish({ success: true, data: [{ id: 'private-task', change: { name: '旧空间私密任务' } }] }));
    assert.equal(dom.window.document.body.textContent?.includes('旧空间私密任务'), false);
    assert.equal(dom.window.document.querySelector('button')?.getAttribute('aria-expanded'), 'false');
    assert.equal(dom.window.document.querySelectorAll('button').length, 1);
});
