import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from 'esbuild';

test('metrics UI requires preview plus confirmation; double click imports once and late old-space data is discarded', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window }); Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document }); Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    let space = 'old'; let changed: (() => void) | undefined; let imports = 0; let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    (dom.window as any).ipcRenderer = { spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} }, contentIntelligence: {
        metricWorks: async () => ({ success: true, data: [] }),
        publications: async () => ({ success: true, data: space === 'old' ? [{ id: 'private-link', platform: 'tiktok', accountAlias: '旧空间别名', externalWorkId: '123', sourceNote: '旧空间私密说明', workspaceId: 'work', workspaceRevision: 'rev', origin: 'manual' }] : [] }),
        metrics: async () => ({ success: true, data: [] }),
        previewMetrics: async () => ({ success: true, data: { digest: 'a'.repeat(64), headers: [], rows: [{ row: 2, status: 'new', input: { publicationLinkId: 'private-link', metric: { key: 'views', definition: '合成窗口计数', unit: 'count' }, window: { startAt: 0, endAt: 86400000, timeZone: 'UTC', alignment: 'calendar' }, confounders: [], value: 10, sourceNote: '合成观测' } }] } }),
        importMetrics: async (input: any) => { assert.equal(input.confirmed, true); assert.equal(input.previewDigest, 'a'.repeat(64)); imports++; await pending; return { success: true, data: { changed: [{}], duplicates: 0 } }; },
    } };
    const bundled = await build({ stdin: { contents: "export { ContentExperimentsPanel } from './src/components/experiments/ContentExperimentsPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === label)!;
    await act(async () => root.render(React.createElement(module.exports.ContentExperimentsPanel)));
    assert.ok(dom.window.document.body.textContent?.includes('旧空间私密说明')); assert.equal(imports, 0);
    await act(async () => button('填入空白模板标题').click()); await act(async () => button('预览观测导入').click());
    assert.equal(button('确认导入观测').disabled, true); assert.equal(imports, 0);
    await act(async () => (dom.window.document.querySelector('[aria-label=确认导入观测]') as HTMLInputElement).click());
    await act(async () => { button('确认导入观测').click(); button('确认导入观测').click(); }); assert.equal(imports, 1);
    await act(async () => { space = 'new'; changed!(); });
    assert.equal(dom.window.document.body.textContent?.includes('旧空间私密说明'), false);
    assert.equal((dom.window.document.querySelector('[aria-label=指标CSV内容]') as HTMLTextAreaElement).value, '');
    await act(async () => finish(undefined));
    assert.equal(dom.window.document.body.textContent?.includes('已写入 1 条'), false); assert.equal(imports, 1);
    assert.equal(dom.window.document.querySelector('[aria-label=观测导入预览]'), null);
});
