// pnpm --dir desktop exec node --test tests/dreamContinuityReviewUi.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { dreamDirector } from './helpers/dreamStoryFixture.ts';

test('optional dream continuity review starts closed, performs no IPC or mutations, reflects current saved revisions and clears on space change', async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' }); const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
    let changed!: () => void; let ipcCalls = 0;
    (dom.window as any).ipcRenderer = { spaces: { onChanged: (value: () => void) => { changed = value; }, offChanged: () => {} }, dreamStory: new Proxy({}, { get: () => () => { ipcCalls++; throw new Error('review must not call generation or editing'); } }) };
    const bundled = await build({ stdin: { contents: "export { DreamContinuityReview } from './src/components/dream-story/DreamContinuityReview';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window });
    const root = createRoot(dom.window.document.getElementById('root')!); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    const project: any = { id: 'project-a', assets: [], dreamStory: { schemaVersion: 1, spaceId: 'a', revision: 'old', director: dreamDirector('fragment'), media: {} } }; project.dreamStory.director.scenes[0].visual = '空间 A 私密画面';
    const before = JSON.stringify(project); const render = (value: any) => root.render(React.createElement(module.exports.DreamContinuityReview, { project: value }));
    await act(async () => render(project)); assert.equal(dom.window.document.querySelector('[aria-label=梦境连续性复核]'), null); assert.equal(dom.window.document.body.textContent!.includes('空间 A 私密画面'), false);
    const button = () => dom.window.document.querySelector('button')!;
    await act(async () => button().click()); assert.ok(dom.window.document.body.textContent!.includes('旧版分镜未登记')); assert.equal(dom.window.document.querySelectorAll('[data-continuity-scene]').length, 8); assert.equal(JSON.stringify(project), before);
    const current = structuredClone(project); current.dreamStory.schemaVersion = 2; current.dreamStory.revision = 'new'; current.dreamStory.director.scenes[1].continuity = 'continue';
    await act(async () => render(current)); assert.ok(dom.window.document.body.textContent!.includes('前幕尚未登记确认')); assert.equal(ipcCalls, 0);
    await act(async () => button().click()); assert.equal(dom.window.document.querySelector('[aria-label=梦境连续性复核]'), null); await act(async () => button().click());
    await act(async () => changed()); assert.equal(dom.window.document.querySelector('[aria-label=梦境连续性复核]'), null); assert.equal(button().disabled, true); assert.equal(dom.window.document.body.textContent!.includes('空间 A 私密画面'), false);
    const foreign = structuredClone(current); foreign.id = 'project-b'; foreign.dreamStory.spaceId = 'b'; foreign.dreamStory.director.scenes[0].visual = '空间 B'; await act(async () => render(foreign)); assert.equal(button().disabled, false); await act(async () => button().click()); assert.ok(!dom.window.document.body.textContent!.includes('空间 A 私密画面')); assert.equal(ipcCalls, 0);
});
