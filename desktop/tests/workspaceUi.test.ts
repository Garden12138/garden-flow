// Run: pnpm --dir desktop exec node --test tests/workspaceUi.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React, { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import type { CreationAdapter } from '../src/features/workbench/CreationWorkbench';

test('canvas inspector preserves mounted inputs, flushes before navigation and becomes a keyboard dismissible drawer', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1440 });
    const measurements: Array<() => void> = [];
    class Observer { constructor(callback: () => void) { measurements.push(callback); } observe() {} disconnect() {} }
    const bundle = await build({ stdin: { contents: "export { CreationWorkbench } from './src/features/workbench/CreationWorkbench'; export { flushCreationBeforeNavigate } from './src/features/workbench/creationNavigation';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as { CreationWorkbench: ComponentType<{ adapter: CreationAdapter }>; flushCreationBeforeNavigate: () => Promise<void> } };
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, document: dom.window.document, ResizeObserver: Observer, HTMLElement: dom.window.HTMLElement, setTimeout, clearTimeout });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    let saves = 0; let fail = false;
    const adapter: CreationAdapter = { id: 'work', title: '编辑中的作品', chat: React.createElement('textarea', { 'aria-label': 'AI 输入' }), editor: React.createElement('input', { 'aria-label': '手动内容', defaultValue: '未提交的手动输入' }), preview: React.createElement('div', null, '作品画布'), flush: async () => { saves++; if (fail) throw new Error('保存失败，保留输入'); } };
    await act(async () => root.render(React.createElement(module.exports.CreationWorkbench, { adapter })));
    const input = dom.window.document.querySelector<HTMLInputElement>('[aria-label="手动内容"]')!;
    input.value = '正在编辑，尚未提交';
    const button = (label: string) => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === label)!;
    await act(async () => button('AI 助手').click());
    assert.equal(dom.window.document.getElementById('creation-panel-editor')?.hidden, true);
    await act(async () => button('属性').click());
    assert.equal(dom.window.document.querySelector('[aria-label="手动内容"]'), input);
    assert.equal(input.value, '正在编辑，尚未提交');
    await module.exports.flushCreationBeforeNavigate(); assert.equal(saves, 1);
    fail = true; await assert.rejects(module.exports.flushCreationBeforeNavigate(), /保存失败/); assert.equal(input.value, '正在编辑，尚未提交');
    await act(async () => { Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 960 }); measurements.forEach(measure => measure()); });
    const floating = dom.window.document.querySelector<HTMLButtonElement>('.creation-floating-tools button')!;
    await act(async () => floating.click());
    const inspector = dom.window.document.querySelector<HTMLElement>('.creation-inspector')!;
    assert.equal(inspector.getAttribute('role'), 'dialog'); assert.ok(inspector.classList.contains('is-open'));
    await act(async () => inspector.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(inspector.classList.contains('is-open'), false);
    assert.equal(input.value, '正在编辑，尚未提交');
});
