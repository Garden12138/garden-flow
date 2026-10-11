import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

// Exercise the public manual-run entry and actual execution branch without
// operating a browser or writing user configuration.
const source = await fs.readFile(new URL('../electron/core/gardenflowBackgroundRunner.ts', import.meta.url), 'utf8');
const manualRun = source.slice(source.indexOf('  async runBuiltinTaskNow('), source.indexOf('  listLongCycleTasks('));
const execution = source.slice(source.indexOf('  private async executeBuiltinTask('), source.indexOf('  private buildLongCyclePrompt('));
const code = (await transform(`globalThis.Runner = class { ${manualRun}\n${execution} };`, { loader: 'ts', target: 'es2022' })).code;

const taskIds = ['jd-product-auto-capture', 'taobao-product-auto-capture', 'tmall-product-auto-capture', 'xhs-auto-capture'];

function harness(options: {
    enabled?: boolean;
    ready?: boolean;
    capture?: () => Promise<unknown>;
} = {}) {
    const calls: any[] = [];
    const states = new Map(taskIds.map((id) => [id, { enabled: options.enabled ?? false, settings: {} } as any]));
    const definitions = taskIds.map((id) => ({
        id, name: id, trigger: { kind: 'schedule', schedule: { mode: 'daily', time: '11:00' } },
        checkReadiness: async () => ({ ready: options.ready ?? true, blockingReason: '采集插件未连接' }),
    }));
    const capture = async (input: any) => {
        calls.push({ type: 'capture', input });
        if (options.capture) return options.capture();
        return { status: 'captured', summary: '采集完成', saved: 1, duplicates: 0, recaptured: 0, failed: 0, capturedReviews: 5 };
    };
    const runtime = Object.fromEntries(['skipNode', 'completeNode', 'completeTask', 'failTask', 'addArtifact', 'addCheckpoint'].map((method) => [
        method, (...args: unknown[]) => calls.push({ type: method, args }),
    ]));
    const sandbox: any = {
        Error,
        getBuiltinAutomationDefinition: (id: string) => definitions.find((definition) => definition.id === id),
        getActiveSpaceId: () => 'default', nowIso: () => new Date().toISOString(), getTaskGraphRuntime: () => runtime,
        computeNextRunForBuiltinTask: () => { calls.push({ type: 'schedule' }); return '2026-10-10T03:00:00.000Z'; },
        JD_AUTO_CAPTURE_TASK_ID: taskIds[0], XHS_AUTO_CAPTURE_TASK_ID: taskIds[3],
        marketplaceCapturePlatform: (id: string) => ({ [taskIds[1]]: 'taobao', [taskIds[2]]: 'tmall' }[id] || null),
        resolveJdAutoCaptureLaunch: () => ({}), resolveMarketplaceAutoCaptureLaunch: () => ({}), resolveXhsAutoCaptureLaunch: () => ({}),
        runJdStructuredCaptureRound: capture, runProductStructuredCaptureRound: capture, runXhsStructuredCaptureRound: capture,
        createJdStructuredCaptureIo: () => ({}), createXhsStructuredCaptureIo: () => ({}),
    };
    vm.runInNewContext(code, sandbox);
    const runner = new sandbox.Runner();
    runner.config = { enabled: false };
    runner.currentAutomationTaskId = null;
    runner.lockState = 'owner';
    runner.ensureLoaded = async () => {};
    runner.ensureBuiltinTaskState = (definition: any) => states.get(definition.id);
    runner.projectBuiltinTask = (definition: any, state: any) => ({ id: definition.id, ...state, running: runner.currentAutomationTaskId === definition.id });
    runner.createRuntimeTask = () => { calls.push({ type: 'create' }); return 'runtime-1'; };
    runner.postCaptureReport = (...args: unknown[]) => { calls.push({ type: 'report', args }); return 'capture-report'; };
    runner.persistConfig = async () => { calls.push({ type: 'persist' }); };
    runner.emitStatus = () => { calls.push({ type: 'status', running: runner.currentAutomationTaskId }); };
    runner.emit = (type: string, payload: any) => calls.push({ type, ...payload });
    return { runner, calls, states, definitions };
}

test('manual builtin capture runs with the schedule disabled and retains a result without enabling future runs', async () => {
    const { runner, calls, states } = harness();
    for (const id of taskIds) {
        const task = await runner.runBuiltinTaskNow(id);
        assert.equal(task.enabled, false);
        assert.equal(task.running, false);
        assert.equal(task.lastResult, 'success');
        assert.ok(task.lastRunAt);
        assert.equal(task.nextRunAt, undefined);
        assert.equal(states.get(id)?.enabled, false);
        assert.ok(calls.some((call) => call.type === 'status' && call.running === id));
    }
    assert.equal(calls.filter((call) => call.type === 'capture').length, 4);
    assert.equal(calls.filter((call) => call.type === 'report').length, 4);
    assert.equal(calls.filter((call) => call.type === 'persist').length, 4);
    assert.equal(calls.filter((call) => call.type === 'schedule').length, 0);
});

test('disabled builtin scheduled runs remain skipped and enabled manual runs keep their schedule', async () => {
    const disabled = harness();
    for (const definition of disabled.definitions) await disabled.runner.executeBuiltinTask(definition, 'scheduled');
    assert.equal(disabled.calls.filter((call) => call.type === 'capture' || call.type === 'create').length, 0);
    assert.ok([...disabled.states.values()].every((state) => !state.lastRunAt && !state.nextRunAt));

    const enabled = harness({ enabled: true });
    const task = await enabled.runner.runBuiltinTaskNow(taskIds[1]);
    assert.equal(task.enabled, true);
    assert.equal(task.nextRunAt, '2026-10-10T03:00:00.000Z');
    await enabled.runner.executeBuiltinTask(enabled.definitions[2], 'scheduled');
    assert.equal(enabled.states.get(taskIds[2])?.lastResult, 'success');
    assert.equal(enabled.calls.filter((call) => call.type === 'capture').length, 2);
});

test('manual readiness and capture failures leave visible results without enabling the schedule', async () => {
    const notReady = harness({ ready: false });
    const skipped = await notReady.runner.runBuiltinTaskNow(taskIds[1]);
    assert.equal(skipped.lastResult, 'skipped');
    assert.equal(skipped.lastError, '采集插件未连接');
    assert.equal(skipped.enabled, false);
    assert.equal(skipped.nextRunAt, undefined);
    assert.equal(notReady.calls.filter((call) => call.type === 'capture').length, 0);

    const failed = harness({ capture: async () => { throw new Error('搜索页面读取失败'); } });
    const task = await failed.runner.runBuiltinTaskNow(taskIds[2]);
    assert.equal(task.lastResult, 'error');
    assert.equal(task.lastError, '搜索页面读取失败');
    assert.equal(task.enabled, false);
    assert.equal(task.nextRunAt, undefined);
    assert.equal(failed.runner.currentAutomationTaskId, null);
    assert.equal(failed.calls.filter((call) => call.type === 'failTask').length, 1);
});

test('product rounds with saved results surface partial completion rather than skipped or successful', async () => {
    for (const status of ['partial', 'blocked']) {
        const { runner, calls } = harness({ capture: async () => ({ status, saved: 3, recaptured: 4, failed: 4, capturedReviews: 35,
            reason: '目标 5 个，已保存结果保留', summary: '本轮采集报告' }) });
        const task = await runner.runBuiltinTaskNow(taskIds[2]);
        assert.equal(task.lastResult, 'partial'); assert.match(task.lastError, /目标 5 个/);
        assert.equal(task.enabled, false); assert.equal(task.nextRunAt, undefined);
        assert.equal(calls.filter((call) => call.type === 'report').length, 1);
        assert.ok(calls.some((call) => call.type === 'addCheckpoint' && call.args[3].saved === 3));
        assert.equal(calls.filter((call) => call.type === 'skipNode' || call.type === 'failTask').length, 0);
        assert.ok(calls.some((call) => call.type === 'completeTask' && call.args[1].endsWith(':partial')));
    }
    const gate = harness({ capture: async () => ({ status: 'blocked', saved: 0, recaptured: 0, failed: 0, summary: '登录受限', reason: '需要登录' }) });
    assert.equal((await gate.runner.runBuiltinTaskNow(taskIds[2])).lastResult, 'skipped');
});

test('manual runs retain serial exclusion while an earlier disabled task is running', async () => {
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const inProgress = new Promise((resolve) => { finish = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const { runner, calls } = harness({ capture: async () => { started(); return inProgress; } });
    const first = runner.runBuiltinTaskNow(taskIds[1]);
    await entered;
    try {
        await assert.rejects(runner.runBuiltinTaskNow(taskIds[2]), /已有自动化任务正在执行/);
        assert.equal(calls.filter((call) => call.type === 'capture').length, 1);
    } finally {
        finish({ status: 'captured', summary: '采集完成', saved: 1, failed: 0 });
        await first;
    }
    assert.equal(runner.currentAutomationTaskId, null);
});

test('disabling an enabled task during a run removes the next scheduled execution', async () => {
    let fixture: ReturnType<typeof harness>;
    fixture = harness({ enabled: true, capture: async () => {
        fixture.states.get(taskIds[1]).enabled = false;
        return { status: 'captured', summary: '采集完成', saved: 1, failed: 0 };
    } });
    const task = await fixture.runner.runBuiltinTaskNow(taskIds[1]);
    assert.equal(task.lastResult, 'success');
    assert.equal(task.enabled, false);
    assert.equal(task.nextRunAt, undefined);
});
