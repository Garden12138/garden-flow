import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { IntentRoute, RuntimeContext } from '../electron/core/ai/types.ts';

const prompts = {
    system: await fs.readFile(new URL('../electron/prompts/library/runtime/ai/route_intent_system.txt', import.meta.url), 'utf8'),
    user: await fs.readFile(new URL('../electron/prompts/library/runtime/ai/route_intent_user.txt', import.meta.url), 'utf8'),
};
const bundled = await build({
    stdin: { contents: `export { routeIntent } from './electron/core/ai/intentRouter';`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'real-prompts', setup(builder) {
        builder.onResolve({ filter: /prompts\/runtime$/ }, () => ({ path: 'prompts', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
            export const loadAndRenderPrompt = (p,v) => globalThis.__prompts[p.includes('system')?'system':'user']
                .replace(/\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}/g, (m,k) => String(v[k] ?? m));
        `, loader: 'js' }));
    } }],
});
const routeJson = { primary_intent: 'xhs_publishing', recommended_role: 'copywriter', confidence: 1,
    xhs_publish_action: { intent: 'confirm', confidence: 1, publicationRequested: true, acknowledgedNotPublished: false } };
const goodResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(routeJson) } }] }));
const context: RuntimeContext = { sessionId: 'session_1790235694798', runtimeMode: 'gardenflow', userInput: '重新发布当前版本',
    metadata: { xhsPublishContext: { jobId: 'isolated', revision: 4, publishStatus: 'not_submitted' } } };
const llm = { apiKey: 'SECRET_FIXTURE_KEY', baseURL: 'https://proxy.invalid/v1?credential=SECRET_QUERY', model: 'qwen3.8-max' };

function fixture(fetchImpl: (input: RequestInit, delay: (ms: number, signal?: AbortSignal | null) => Promise<void>) => Promise<Response>) {
    let now = 0;
    let counter = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const logs: unknown[] = [];
    let calls = 0;
    const setTimer = (callback: () => void, ms: number) => { const id = ++counter; timers.set(id, { at: now + ms, callback }); return id; };
    const clearTimer = (id: number) => { timers.delete(id); };
    const delay = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const id = setTimer(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { clearTimer(id); cleanup(); reject(new DOMException('aborted', 'AbortError')); };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
    const module = { exports: {} };
    class ClockDate extends Date { static now() { return now; } }
    vm.runInNewContext(bundled.outputFiles[0].text, {
        module, exports: module.exports, __prompts: prompts, URL, AbortController, Date: ClockDate,
        setTimeout: setTimer, clearTimeout: clearTimer, console: { warn: (...args: unknown[]) => logs.push(args) },
        fetch: async (_url: string, input: RequestInit) => { calls += 1; return fetchImpl(input, delay); },
    });
    const routeIntent = (module.exports as { routeIntent: (input: { context: RuntimeContext; llm: typeof llm & { timeoutMs?: number }; signal?: AbortSignal }) => Promise<IntentRoute> }).routeIntent;
    const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
    const advance = async (ms: number) => {
        await flush();
        const target = now + ms;
        for (;;) {
            const next = [...timers].filter(([,timer]) => timer.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
        }
        now = target; await flush();
    };
    return { routeIntent, advance, logs, timers, calls: () => calls };
}

test('slow route succeeds after the former 20s limit using the selected model', async () => {
    const f = fixture(async (input, delay) => {
        assert.equal(JSON.parse(String(input.body)).model, llm.model);
        await delay(25000, input.signal); return goodResponse();
    });
    const pending = f.routeIntent({ context, llm });
    await f.advance(25000);
    const route = await pending;
    assert.equal(route.routingFailure, undefined);
    assert.equal(route.xhsPublishAction?.publicationRequested, true);
    assert.equal(route.routingDiagnostic?.elapsedMs, 25000);
    assert.equal(route.routingDiagnostic?.timeoutMs, 90000);
    assert.equal(route.routingDiagnostic?.endpointHost, 'proxy.invalid');
    assert.equal(f.calls(), 1);
    assert.equal(f.timers.size, 0);
});

test('deadline cancels a stalled fetch without retry, leaking credentials or authorizing publication', async () => {
    const f = fixture(async (input, delay) => { await delay(100000, input.signal); return goodResponse(); });
    const pending = f.routeIntent({ context, llm });
    await f.advance(90000);
    const route = await pending;
    assert.equal(route.routingFailure, 'timeout');
    assert.equal(route.routingDiagnostic?.elapsedMs, 90000);
    assert.equal(route.xhsPublishAction, undefined);
    assert.equal(f.calls(), 1);
    assert.equal(f.timers.size, 0);
    assert.doesNotMatch(JSON.stringify([route.routingDiagnostic, f.logs]), /SECRET|credential|Bearer/);
});

test('stop cancels response-body reads and cleans listeners; already stopped makes zero requests', async () => {
    const controller = new AbortController();
    let listeners = 0;
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { listeners += 1; add(...args); };
    controller.signal.removeEventListener = (...args) => { listeners -= 1; remove(...args); };
    const f = fixture(async (input, delay) => ({ ok: true, status: 200, text: async () => {
        await delay(100000, input.signal); return 'SECRET_RESPONSE';
    } }) as Response);
    const pending = f.routeIntent({ context, llm, signal: controller.signal });
    await f.advance(1000); controller.abort();
    const route = await pending;
    assert.equal(route.routingFailure, 'cancelled');
    assert.equal(route.routingDiagnostic?.httpStatus, 200);
    assert.equal(f.timers.size, 0);
    assert.equal(listeners, 0);
    const preStopped = await f.routeIntent({ context, llm, signal: controller.signal });
    assert.equal(preStopped.routingFailure, 'cancelled');
    assert.equal(preStopped.routingDiagnostic?.attempts, 0);
    assert.equal(f.calls(), 1);
});

test('body read timeout stays a transport timeout, not malformed model output', async () => {
    const f = fixture(async (input, delay) => ({ ok: true, status: 200, text: async () => {
        await delay(100000, input.signal); return 'body';
    } }) as Response);
    const pending = f.routeIntent({ context, llm });
    await f.advance(90000);
    assert.equal((await pending).routingFailure, 'timeout');
    assert.equal(f.timers.size, 0);
});

test('explicit format compatibility retry gets a fresh deadline and same connection', async () => {
    const f = fixture(async (input, delay) => {
        const body = JSON.parse(String(input.body));
        assert.equal(body.model, llm.model);
        if (body.response_format) { await delay(80000, input.signal); return new Response('response_format unsupported', { status: 400 }); }
        await delay(25000, input.signal); return goodResponse();
    });
    const pending = f.routeIntent({ context, llm });
    await f.advance(105000);
    const route = await pending;
    assert.equal(route.routingFailure, undefined);
    assert.equal(route.routingDiagnostic?.attempts, 2);
    assert.equal(route.routingDiagnostic?.elapsedMs, 105000);
    assert.equal(f.calls(), 2);
    assert.equal(f.timers.size, 0);
});

test('HTTP, network and invalid-output failures are typed, redacted and never retry arbitrary failures', async () => {
    for (const [response, failure] of [
        [() => new Response('SECRET_RESPONSE response_format', { status: 500 }), 'http-error'],
        [() => new Response('SECRET_RESPONSE', { status: 401 }), 'http-error'],
        [() => { throw new Error('SECRET_NETWORK Authorization Bearer SECRET_FIXTURE_KEY'); }, 'network-error'],
        [() => new Response('not json SECRET_RESPONSE'), 'invalid-output'],
        [() => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })), 'invalid-output'],
    ] as const) {
        const f = fixture(async () => response());
        const route = await f.routeIntent({ context, llm: { ...llm, timeoutMs: NaN } });
        assert.equal(route.routingFailure, failure);
        assert.equal(route.routingDiagnostic?.timeoutMs, 90000);
        assert.equal(f.calls(), 1);
        assert.equal(f.timers.size, 0);
        assert.doesNotMatch(JSON.stringify([route.routingDiagnostic, f.logs]), /SECRET|Authorization|Bearer/);
    }
});

test('actual AgentRuntime preparation forwards stop to the router and saves transport diagnosis', async () => {
    const source = await fs.readFile(new URL('../electron/core/ai/agentRuntime.ts', import.meta.url), 'utf8');
    const method = source.slice(source.indexOf('  async prepareExecution('), source.indexOf('  completeExecution('));
    const entry = await build({ stdin: { loader: 'ts', contents: `export class RuntimeEntry {
        analyzeRuntimeContext() { return {route:null}; }
        ${method}
    }` }, write: false, platform: 'node', format: 'cjs' });
    const f = fixture(async (input, delay) => { await delay(25000, input.signal); return goodResponse(); });
    const controller = new AbortController();
    let persistedRoute: IntentRoute | undefined;
    let tracedRoute: IntentRoute | undefined;
    const task = { id: 'isolated-task', graph: [] };
    const runtime = {
        createInteractiveTask: (params: { route: IntentRoute }) => { persistedRoute = params.route; return task; },
        startNode: () => {}, completeNode: () => {}, getTask: () => task,
        addTrace: (_id: string, event: string, payload: { route: IntentRoute }) => {
            if (event === 'runtime.prepared') tracedRoute = payload.route;
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(entry.outputFiles[0].text, {
        module, exports: module.exports, console: { log: () => {} },
        extractHints: () => ({ subagentRoles: [], skipSubagentOrchestration: true }),
        routeIntent: f.routeIntent, getRoleSpec: () => ({ roleId: 'copywriter' }),
        resolveThinkingBudget: () => 'low', shouldRunSubagentOrchestration: () => false,
        computeShouldUseCoordinator: () => false, getTaskGraphRuntime: () => runtime,
        assembleRuntimeSystemPrompt: () => 'Fixture',
    });
    const RuntimeEntry = (module.exports as { RuntimeEntry: new () => { prepareExecution: (params: unknown) => Promise<{ route: IntentRoute }> } }).RuntimeEntry;
    const pending = new RuntimeEntry().prepareExecution({ runtimeContext: context, baseSystemPrompt: 'Fixture', llm, signal: controller.signal });
    await f.advance(1000); controller.abort();
    const outcome = await pending;
    assert.equal(outcome.route.routingFailure, 'cancelled');
    assert.equal(persistedRoute, outcome.route);
    assert.equal(tracedRoute?.routingDiagnostic?.elapsedMs, 1000);
    assert.equal(tracedRoute?.routingDiagnostic?.model, llm.model);
    assert.equal(f.calls(), 1);
    assert.equal(f.timers.size, 0);
});
