// pnpm --dir desktop exec node --test tests/experimentExplanationUi.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from 'esbuild';

async function fixture(t: any, contentIntelligence: any) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' }); let changed: (() => void) | undefined;
    const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
    (dom.window as any).ipcRenderer = { spaces: { onChanged: (listener: () => void) => { changed = listener; }, offChanged: () => {} }, contentIntelligence };
    const bundled = await build({ stdin: { contents: "export { ExperimentExplanationPanel } from './src/components/experiments/ExperimentExplanationPanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!);
    t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === label)!;
    return { dom, root, component: module.exports.ExperimentExplanationPanel, button, changeSpace: () => changed!() };
}
const detail = { experiment: { id: 'plan', revision: 2, status: 'collecting' }, comparison: { interpretation: 'insufficient' }, observationRevisionsChanged: false };
const run = { id: 'run', status: 'queued', revision: 1, calls: 0, createdAt: 1, inputCharacters: 100,
    input: { experimentRevision: 2, observationRevisionsChanged: false, hypothesis: '旧空间待验证假设' }, model: { name: 'synthetic', host: '127.0.0.1', fingerprint: 'a'.repeat(64) } };

test('explanation UI waits for preview and fee consent, locks double start and rejects a late old-space result', async t => {
    let calls = 0; let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const h = await fixture(t, { experimentExplanations: async () => ({ success: true, data: [] }),
        previewExperimentExplanation: async () => ({ success: true, data: run }), startExperimentExplanation: async (input: any) => { assert.equal(input.consent, true); calls++; return pending; } });
    await act(async () => h.root.render(React.createElement(h.component, { detail, onSuggestion: () => assert.fail('no suggestion before completion') })));
    assert.equal(calls, 0); await act(async () => h.button('预览实验解释范围').click());
    assert.equal(h.button('确认一次文本解释').disabled, true); assert.ok(h.dom.window.document.body.textContent?.includes('127.0.0.1'));
    await act(async () => (h.dom.window.document.querySelector('[aria-label=确认实验解释费用]') as HTMLInputElement).click());
    await act(async () => { h.button('确认一次文本解释').click(); h.button('确认一次文本解释').click(); }); assert.equal(calls, 1);
    await act(async () => h.changeSpace()); assert.equal(h.dom.window.document.body.textContent?.includes('旧空间待验证假设'), false);
    await act(async () => finish({ success: true, data: { ...run, status: 'succeeded', proposal: { considerations: ['旧空间私密输出'], suggestions: [] } } }));
    assert.equal(h.dom.window.document.body.textContent?.includes('旧空间私密输出'), false); assert.equal(calls, 1);
});
test('model output remains an unverified proposal and only fills a manual draft; changed experiment disables adoption', async t => {
    let drafts = 0; const proposal = { considerations: ['待复核的观点'], suggestions: [{ kind: 'title', name: '标题', before: '待核对', after: '问题', rationale: '新假设', preserve: ['正文'] }] };
    const h = await fixture(t, { experimentExplanations: async () => ({ success: true, data: [] }), previewExperimentExplanation: async () => ({ success: true, data: { ...run, status: 'succeeded', proposal } }) });
    const props = { detail, onSuggestion: (value: unknown) => { drafts++; assert.deepEqual(JSON.parse(JSON.stringify(value)), proposal.suggestions[0]); } };
    await act(async () => h.root.render(React.createElement(h.component, props)));
    await act(async () => h.button('预览实验解释范围').click());
    assert.ok(h.dom.window.document.body.textContent?.includes('模型观点与新假设（未验证）')); assert.equal(drafts, 0);
    await act(async () => h.button('填入下一轮草稿，核对后再建任务').click()); assert.equal(drafts, 1);
    await act(async () => h.root.render(React.createElement(h.component, { ...props, detail: { ...detail, observationRevisionsChanged: true } })));
    assert.equal(h.button('填入下一轮草稿，核对后再建任务').disabled, true); assert.equal(drafts, 1);
});
