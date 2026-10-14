import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await fs.readFile(new URL('../src/pages/GardenFlow.tsx', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('    const loadContextSessions = useCallback('), source.indexOf('    const initSession = useCallback('));
const code = (await transform(loader.replace('const loadContextSessions =', 'globalThis.loadContextSessions ='), { loader: 'ts', target: 'es2022' })).code;
const report = { id: 'report', title: '采集报告', metadata: { contextType: 'gardenflow-capture', contextId: 'gardenflow-capture:default:taobao-product-auto-capture', spaceId: 'default' } };

function harness(sessions: any[], remembered?: string, readSessions = async () => sessions) {
    const state: any = { items: [], selected: null };
    const sandbox: any = {
        console, useCallback: (callback: any) => callback,
        window: { ipcRenderer: { chat: { listContextSessionsGuarded: async () => [{ id: 'creative', metadata: {} }], getSessions: readSessions } } },
        sessionRequestIdRef: { current: 0 }, hasSessionSnapshotRef: { current: true },
        activeSessionIdRef: { current: null }, sessionListRef: { current: [] }, manualDraftActiveRef: { current: false },
        setIsSessionLoading() {}, setHistoryLoading() {}, setActiveSpaceId() {}, setActiveSpaceName() {},
        setSessionList: (items: any[]) => { state.items = items; }, setActiveSessionId: (id: string) => { state.selected = id; },
        buildGardenFlowContextId: (space: string) => `gardenflow-singleton:${space}`, GARDENFLOW_CONTEXT_TYPE: 'gardenflow',
        uiMeasure: (_scope: string, _label: string, callback: any) => callback(),
        sortContextSessionItems: (items: any[]) => items, createContextSessionListItem: (session: any) => session,
        readGardenFlowLastSessionId: () => remembered, loadExternalAgentSessions() {}, debugUi() {},
    };
    vm.runInNewContext(code, sandbox);
    return { state, sandbox, load: sandbox.loadContextSessions };
}

test('capture report link opens its persisted session while retaining the ordinary creative session', async () => {
    const { load, state } = harness([report]);
    await load('default', '默认空间', { preferredSessionId: report.id, silent: true });
    assert.equal(state.selected, report.id);
    assert.deepEqual(Array.from(state.items, (item: any) => item.id), ['creative', 'report']);
});

test('remembered capture report restores after reopening the same space', async () => {
    const { load, state } = harness([report], report.id);
    await load('default', '默认空间');
    assert.equal(state.selected, report.id);
});

test('cross-space, unrelated, archived and missing reports cannot be opened through the link', async () => {
    for (const candidate of [
        { ...report, metadata: { ...report.metadata, spaceId: 'other' } },
        { ...report, metadata: { ...report.metadata, contextId: 'gardenflow-capture:other:taobao-product-auto-capture' } },
        { ...report, metadata: { ...report.metadata, contextType: 'knowledge' } },
        { ...report, archived: true },
        { ...report, metadata: { ...report.metadata, status: 'archived' } },
    ]) {
        const { load, state } = harness([candidate]);
        await load('default', '默认空间', { preferredSessionId: report.id });
        assert.equal(state.selected, null);
        assert.deepEqual(Array.from(state.items, (item: any) => item.id), ['creative']);
    }
    const { load, state } = harness([]);
    await load('default', '默认空间', { preferredSessionId: report.id });
    assert.equal(state.selected, null);
});

test('late report lookup cannot replace a newer navigation', async () => {
    let resolve!: (sessions: any[]) => void;
    const pending = new Promise<any[]>((done) => { resolve = done; });
    const { load, state, sandbox } = harness([], undefined, () => pending);
    const loading = load('default', '默认空间', { preferredSessionId: report.id });
    await new Promise((done) => setImmediate(done));
    sandbox.sessionRequestIdRef.current++;
    state.selected = 'newer-session';
    resolve([report]);
    await loading;
    assert.equal(state.selected, 'newer-session');
});
