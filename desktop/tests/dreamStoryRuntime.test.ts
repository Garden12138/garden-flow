import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

async function runtimeFixture(toolName: 'dream_story_read' | 'dream_story_propose') {
    const state = { calls: 0, executions: 0, memoryWrites: 0, events: [] as any[] };
    const stubs: Record<string, string> = {
        sessionRuntimeStore: 'export const getSessionRuntimeStore = () => ({ appendTranscript() {}, addCheckpoint() {}, listCheckpoints() { return []; }, listToolResults() { return []; } });',
        toolResultStore: 'export const getToolResultStore = () => ({ add() { return {id:"result"}; }, list() { return []; }, applyBudget(input) { return input; } });',
        compactManager: 'export class CompactManager { async maybeCompact() { return null; } }',
        memoryMaintenanceService: 'export const getMemoryMaintenanceService = () => ({ notifyQueryLifecycleEvent() { globalThis.__state.memoryWrites++; } });',
        runtimeHooks: 'export const executeRuntimeHooks = async () => {};',
        taskGraphRuntime: 'export const getTaskGraphRuntime = () => ({});',
        db: 'export const getChatMessages = () => [];',
        xhsAutoCaptureCompletion: 'export const applyXhsAutoCaptureCompletionGate = () => ({}); export const validateXhsAutoCaptureCompletion = () => ({complete:true});',
    };
    const bundle = await build({ stdin: { contents: "export { QueryRuntime } from './electron/core/queryRuntime';", resolveDir: new URL('..', import.meta.url).pathname },
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
        plugins: [{ name: 'private-dream-runtime', setup(builder) {
            builder.onResolve({ filter: /(?:sessionRuntimeStore|toolResultStore|compactManager|memoryMaintenanceService|runtimeHooks|taskGraphRuntime|xhsAutoCaptureCompletion|\/db)$/ }, args => ({ path: args.path.split('/').pop()!, namespace: 'dream-fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'dream-fixture' }, args => ({ contents: stubs[args.path], loader: 'ts' }));
        } }],
    });
    const module = { exports: {} as any };
    vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, __state: state,
        require: createRequire(new URL('../package.json', import.meta.url)), console, Buffer, URL, Error, AbortController, setTimeout, clearTimeout,
        fetch: async () => { state.calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'call_' + state.calls, function: { name: toolName, arguments: '{}' } }] } }] })); },
    });
    const tool = { name: toolName, kind: 'read', getDescription: () => '当前梦境', shouldConfirmExecute: () => false };
    const registry = { getTool: () => tool, getToolSchemas: () => [], getAllTools: () => [tool] };
    const executor = { execute: async (request: any) => { state.executions++;
        assert.equal(request.params._dreamTurn.projectId, 'owned');
        return { callId: request.callId, name: request.name, durationMs: 0, result: toolName === 'dream_story_read'
            ? { success: true, llmContent: 'Current project.' }
            : { success: false, llmContent: 'Invalid director.', error: { type: 'INVALID_PARAMS', message: 'Invalid director.' } } };
    } };
    const runtime = new module.exports.QueryRuntime(registry, executor, { onEvent: (event: any) => state.events.push(event) }, {
        sessionId: 'private', apiKey: 'fixture', baseURL: 'https://fixture.invalid/v1', model: 'fixture', systemPrompt: '当前梦境', messages: [],
        toolPack: 'gardenflow', runtimeMode: 'gardenflow', workflowKind: 'dream-story-create', dreamStoryTurn: { projectId: 'owned' }, maxTurns: 100,
    });
    return { state, run: () => runtime.run('保留原文意象，创作八幕。') };
}
test('dream runtime caps repeated reads at three model requests even when the caller asks for 100 turns', async () => {
    const h = await runtimeFixture('dream_story_read'); await h.run();
    assert.equal(h.state.calls, 3); assert.equal(h.state.executions, 3); assert.equal(h.state.memoryWrites, 0);
});
test('dream runtime stops after the first visible structural repair without another paid request', async () => {
    const h = await runtimeFixture('dream_story_propose'); await h.run();
    assert.equal(h.state.calls, 2); assert.equal(h.state.executions, 2); assert.equal(h.state.memoryWrites, 0);
    assert.equal(h.state.events.filter(event => String(event.content || '').includes('正在进行一次结构修复')).length, 1);
});
