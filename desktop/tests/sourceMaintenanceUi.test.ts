// pnpm --dir desktop exec node --test tests/sourceMaintenanceUi.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const ok = (data: unknown) => ({ success: true, data });
const source = { kind: 'product', namespace: 'tmall', id: 'synthetic' };
const previous = { source, version: 'a'.repeat(64), title: '旧空间私密商品', coverage: { captured: 1, partial: true, issues: ['合成测试'] }, segments: [{ key: 'selectedSku', kind: 'fact', text: '300g×12' }] };
const impact = { id: 'impact-work', targetId: 'work', kind: 'workspace', title: '合成待复核工程', versionDigest: 'c'.repeat(64), reviewState: 'needs_review', reason: 'inherited-work', evidenceIds: ['evidence'], opportunityIds: ['opp'], viaWorkspaceId: 'source-work', availability: 'available' };
const detail: any = { report: { id: 'report', version: 1, source, sourceTitle: previous.title, spaceId: 'default', previousVersion: previous.version, currentVersion: 'b'.repeat(64), currentAvailability: 'available', createdAt: 1,
    fields: [{ kind: 'segment', key: 'selectedSku', change: 'changed', previous: '300g×12', current: '<img src=x onerror=alert(1)>600g×6' }], impacts: [impact],
    coverage: { totalWorkspaceRecords: 3, scannedWorkspaces: 2, excludedWorkspaces: 1, completeWithinScope: false, unversionedSameProductWorkspaces: 1 } }, previous,
    current: { ...previous, version: 'b'.repeat(64), segments: [{ key: 'selectedSku', kind: 'fact', text: '600g×6' }] }, decisions: [], pending: 1 };
async function fixture(t: any, overrides: any = {}) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' }); const originals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key, value] of [['window', dom.window], ['document', dom.window.document], ['IS_REACT_ACT_ENVIRONMENT', true]] as const) Object.defineProperty(globalThis, key, { configurable: true, value });
    let changed!: () => void; let foreign = false;
    const api = { maintenanceSources: async () => ok({ items: foreign ? [] : [{ rowId: 1, source, version: previous.version, title: previous.title, evidenceCount: 1 }] }), maintenanceReports: async () => ok([]), maintenanceDetail: async () => ok(detail), ...overrides };
    (dom.window as any).ipcRenderer = { contentIntelligence: api, spaces: { onChanged: (value: () => void) => { changed = value; }, offChanged: () => {} } };
    const bundled = await build({ stdin: { contents: "export { SourceMaintenancePanel } from './src/components/wander/SourceMaintenancePanel';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
    const module = { exports: {} as any }; vm.runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(new URL('../package.json', import.meta.url)), window: dom.window, crypto, CustomEvent: dom.window.CustomEvent });
    const root = createRoot(dom.window.document.getElementById('root')!); t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
    await act(async () => root.render(React.createElement(module.exports.SourceMaintenancePanel)));
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
    const set = async (label: string, value: string) => { const node = dom.window.document.querySelector(`[aria-label="${label}"]`) as any; await act(async () => {
        if (node.tagName === 'SELECT') { node.value = value; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
        else node[Object.keys(node).find(key => key.startsWith('__reactProps$'))!].onChange({ target: { value } });
    }); };
    return { dom, button, set, api, foreign: async () => { foreign = true; await act(async () => changed()); } };
}
test('explicit checks lock double clicks, retain request identity on failure and use a fresh request after successful frozen checks', async t => {
    const calls: string[] = []; let finish!: (value: unknown) => void;
    const h = await fixture(t, { checkMaintenance: (input: any) => { calls.push(input.requestId); return new Promise(resolve => { finish = resolve; }); } });
    assert.equal(calls.length, 0); assert.equal(h.button('检查当前入库版本').disabled, true); await h.set('选择旧来源版本', '1');
    await act(async () => { h.button('检查当前入库版本').click(); h.button('检查当前入库版本').click(); }); assert.equal(calls.length, 1);
    await act(async () => finish({ success: false, error: '合成读取中断' })); await act(async () => h.button('检查当前入库版本').click()); assert.equal(calls[1], calls[0]);
    await act(async () => finish(ok({ changed: true, detail }))); const body = h.dom.window.document.body;
    assert.ok(body.textContent!.includes('扫描不完整')); assert.ok(body.textContent!.includes('同商品但无旧版本引用链 1 条')); assert.ok(body.textContent!.includes('600g×6')); assert.equal(body.querySelector('img'), null);
    await act(async () => h.button('检查当前入库版本').click()); assert.notEqual(calls[2], calls[0]);
    await h.foreign(); assert.ok(!body.textContent!.includes(previous.title)); await act(async () => finish(ok({ changed: true, detail }))); assert.ok(!body.textContent!.includes(previous.title)); assert.equal(body.querySelector('[aria-label="来源复核清单"]'), null);
});
test('each maintenance decision requires a note and separate confirmation, records audit only once, and opens the original work without creation', async t => {
    let decisions = 0; let value = structuredClone(detail); let finish!: (value: unknown) => void; let intent: any;
    const h = await fixture(t, { checkMaintenance: async () => ok({ changed: true, detail: value }), maintenanceDetail: async () => ok(value),
        decideMaintenance: (input: any) => { decisions++; assert.equal(input.confirmed, true); assert.equal(input.impactVersion, impact.versionDigest); assert.equal(input.expectedDecisionRevision, 0); return new Promise(resolve => { finish = resolve; }); },
        maintenanceHistory: async () => ok(value.decisions) });
    h.dom.window.addEventListener('gardenflow:navigate', event => { intent = (event as CustomEvent).detail; });
    await h.set('选择旧来源版本', '1'); await act(async () => h.button('检查当前入库版本').click()); await act(async () => (h.dom.window.document.querySelector('[data-maintenance-impact=work]') as HTMLButtonElement).click());
    assert.equal(h.button('确认记录本项决定').disabled, true); await act(async () => h.button('打开原工程手动复核').click()); assert.equal(intent.type, 'creation.open'); assert.equal(intent.workspaceId, 'work'); assert.equal(decisions, 0);
    await h.set('维护说明', '先核实新旧规格适用范围，实际编辑另行完成'); assert.equal(h.button('确认记录本项决定').disabled, true);
    await act(async () => (h.dom.window.document.querySelector('[aria-label=确认记录维护决定]') as HTMLInputElement).click()); await h.set('维护说明', '保留可追溯历史，先补充证据再编辑'); assert.equal(h.button('确认记录本项决定').disabled, true);
    await act(async () => (h.dom.window.document.querySelector('[aria-label=确认记录维护决定]') as HTMLInputElement).click());
    await act(async () => { h.button('确认记录本项决定').click(); h.button('确认记录本项决定').click(); }); assert.equal(decisions, 1);
    value = { ...value, pending: 0, decisions: [{ id: 'decision', impactId: impact.id, revision: 1, action: 'edit-manually', note: '已记录计划，未修改稿件', createdAt: 1 }] };
    await act(async () => finish(ok(value.decisions[0]))); assert.ok(h.dom.window.document.body.textContent!.includes('已记录人工决定')); assert.ok(h.dom.window.document.body.textContent!.includes('请在原工程中执行后续处理')); assert.equal(h.button('确认记录本项决定').disabled, true);
    await act(async () => h.button('查看最近 100 次处理记录').click()); assert.ok(h.dom.window.document.querySelector('[aria-label=维护审计记录]')!.textContent!.includes('未修改稿件')); assert.equal(decisions, 1);
});
