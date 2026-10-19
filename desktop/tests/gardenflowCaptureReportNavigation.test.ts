import { creationWorkspaceSessionId, creationNativeSessionRef } from '../shared/creationWorkspace.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { dreamStorySessionProjectId } from '../shared/dreamStorySession.ts';

const source = await fs.readFile(new URL('../src/pages/GardenFlow.tsx', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('    const loadContextSessions = useCallback('), source.indexOf('    const initSession = useCallback('));
const code = (await transform(loader.replace('const loadContextSessions =', 'globalThis.loadContextSessions ='), { loader: 'ts', target: 'es2022' })).code;
const report = { id: 'report', title: '采集报告', metadata: { contextType: 'gardenflow-capture', contextId: 'gardenflow-capture:default:taobao-product-auto-capture', spaceId: 'default' } };

function harness(sessions: any[], remembered?: string, readSessions = async () => sessions) {
    const state: any = { items: [], selected: null, intents: [] };
    const sandbox: any = {
        creationWorkspaceSessionId, creationNativeSessionRef, dreamStorySessionProjectId, dispatchAppIntent: (intent: any) => state.intents.push(intent),
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

const dream = { id: 'dream-chat', title: '海边的梦', metadata: { contextType: 'dream-story', contextId: 'dream-story:default:project-one', editorBindingKind: 'dream-story', dreamStoryProjectId: 'project-one', spaceId: 'default' } };

test('existing dream conversations appear in recent history without being selected or opened', async () => {
    const { load, state } = harness([dream]);
    await load('default', '默认空间');
    assert.deepEqual(Array.from(state.items, (item: any) => item.id), ['creative', 'dream-chat']);
    assert.equal(state.selected, null);
    assert.equal(state.intents.length, 0);
});

test('dream conversation deep link reopens its bound project without the generic composer', async () => {
    const { load, state } = harness([dream]);
    await load('default', '默认空间', { preferredSessionId: dream.id });
    assert.equal(state.selected, null);
    assert.equal(state.intents[0].type, 'video-project.open');
    assert.equal(state.intents[0].projectId, 'project-one');
});

test('dream history excludes foreign spaces, invalid bindings and archived conversations', async () => {
    for (const session of [
        { ...dream, metadata: { ...dream.metadata, spaceId: 'other' } },
        { ...dream, metadata: { ...dream.metadata, contextId: 'dream-story:other:project-one' } },
        { ...dream, metadata: { ...dream.metadata, dreamStoryProjectId: '../escape' } },
        { ...dream, metadata: { ...dream.metadata, editorBindingKind: 'file' } },
        { ...dream, archived: true },
        { ...dream, metadata: { ...dream.metadata, archived: true } },
    ]) {
        const { load, state } = harness([session]);
        await load('default', '默认空间');
        assert.deepEqual(Array.from(state.items, (item: any) => item.id), ['creative']);
    }
});

test('clicking a dream history row opens the original project and clears unread state', async () => {
    const clickSource = source.slice(source.indexOf('    const switchHistorySession = useCallback('), source.indexOf('    const ensureActiveChatSessionForSend = useCallback('));
    const clickCode = (await transform(clickSource.replace('const switchHistorySession =', 'globalThis.openHistory ='), { loader: 'ts', target: 'es2022' })).code;
    const calls: any[] = [];
    const sandbox: any = { useCallback: (fn: any) => fn, creationWorkspaceSessionId, creationNativeSessionRef, dreamStorySessionProjectId, activeSpaceId: 'default',
        dispatchAppIntent: (intent: any) => calls.push(intent), clearSessionActivity() {},
        setHistorySessionUnread: (id: string, unread: boolean) => calls.push({ id, unread }),
        onOpenChatSurface: () => calls.push('generic-surface'), switchSession: () => calls.push('generic-session'),
    };
    vm.runInNewContext(clickCode, sandbox);
    sandbox.openHistory({ ...dream, surface: 'gardenflow' });
    assert.equal(calls[0].unread, false);
    assert.equal(calls[1].type, 'video-project.open');
    assert.equal(calls[1].projectId, 'project-one');
    assert.equal(calls.length, 2);
});

test('new creation history restores its same workspace and leaves generic chat unselected', async () => {
    const session = { id: 'creation-session', metadata: { spaceId: 'default', creationWorkspaceId: 'creation_fixture', editorBindingKind: 'creation-workspace' } };
    const { load, state } = harness([session]);
    await load('default', '默认空间', { preferredSessionId: session.id });
    assert.equal(state.selected, null); assert.equal(state.intents[0].type, 'creation.open'); assert.equal(state.intents[0].workspaceId, 'creation_fixture');
});
