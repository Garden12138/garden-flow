import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

// Exercise the actual report writer and complete builtin capture branch, with the
// browser collector replaced by a deterministic completed result.
const source = await fs.readFile(new URL('../electron/core/gardenflowBackgroundRunner.ts', import.meta.url), 'utf8');
const writer = source.slice(source.indexOf('  private postCaptureReport('), source.indexOf('  private mirrorLatestAssistantToMainSession('));
const runner = source.slice(source.indexOf('  private async executeBuiltinTask('), source.indexOf('  private buildLongCyclePrompt('));
const code = (await transform(`globalThis.CaptureRunner = class { ${writer}\n${runner} };`, { loader: 'ts', target: 'es2022' })).code;

test('JD and XHS completed capture reports remain in task/space sessions and retain automation results', async () => {
    const sessions: any[] = [{ id: 'creative-session', metadata: { contextId: 'gardenflow-singleton:default' } }];
    const messages: any[] = [{ session_id: 'creative-session', content: '待确认分镜', status: 'pending' }];
    const events: any[] = [];
    const artifacts: any[] = [];
    const states = new Map<string, any>();
    let space = 'default';
    let switchDuringCapture = false;
    const runtime = { addArtifact: (_: string, artifact: any) => artifacts.push(artifact), addCheckpoint() {}, completeNode() {}, completeTask() {}, failTask: (_: string, error: string) => assert.fail(error) };
    const capture = async () => { if (switchDuringCapture) space = 'other'; return { status: 'captured', summary: '采集完成：成功 2 项，重复 1 项，完整资料与图片已入库。', saved: 2, duplicates: 1, recaptured: 1, failed: 0, capturedReviews: 10 }; };
    const sandbox: any = {
        getActiveSpaceId: () => space, nowIso: () => new Date().toISOString(), getTaskGraphRuntime: () => runtime,
        computeNextRunForBuiltinTask: () => Date.now() + 3600000,
        JD_AUTO_CAPTURE_TASK_ID: 'jd-capture', XHS_AUTO_CAPTURE_TASK_ID: 'xhs-capture',
        resolveJdAutoCaptureLaunch: () => ({}), resolveXhsAutoCaptureLaunch: () => ({}),
        runJdStructuredCaptureRound: capture, runXhsStructuredCaptureRound: capture,
        createJdStructuredCaptureIo: () => ({}), createXhsStructuredCaptureIo: () => ({}),
        getChatSessionByContext: (contextId: string, contextType: string) => sessions.find((s) => s.metadata.contextId === contextId && s.metadata.contextType === contextType),
        createChatSession: (id: string, title: string, metadata: any) => { const session = { id, title, metadata }; sessions.push(session); return session; },
        addChatMessage: (message: any) => messages.push(message),
    };
    vm.runInNewContext(code, sandbox);
    const service = new sandbox.CaptureRunner();
    service.emit = (type: string, payload: any) => events.push({ type, ...payload });
    service.emitStatus = () => {};
    service.createRuntimeTask = () => 'runtime-1';
    service.ensureBuiltinTaskState = (definition: any) => {
        if (!states.has(definition.id)) states.set(definition.id, { enabled: true, settings: {} });
        return states.get(definition.id);
    };
    for (const targetSpace of ['default', 'other']) {
        for (const id of ['jd-capture', 'xhs-capture']) {
            space = targetSpace;
            await service.executeBuiltinTask({ id, name: id, checkReadiness: async () => ({ ready: true }) }, 'manual');
            assert.equal(states.get(id).lastResult, 'success');
        }
    }
    space = 'default'; switchDuringCapture = true;
    await service.executeBuiltinTask({ id: 'jd-capture', name: '京东', checkReadiness: async () => ({ ready: true }) }, 'manual');
    assert.equal(sessions.length, 5);
    assert.equal(messages.filter((m) => m.session_id === 'creative-session').length, 1);
    assert.equal(messages[0].status, 'pending');
    assert.equal(messages.at(-1).session_id, 'session_gardenflow_capture_default_jd-capture');
    assert.equal(artifacts.length, 5);
    for (const artifact of artifacts) {
        assert.equal(artifact.type, 'capture-report');
        assert.equal(artifact.metadata.isolated, true);
        assert.ok(sessions.some((session) => session.id === artifact.metadata.sessionId));
    }
    assert.ok(events.filter((event) => event.type === 'message').every((event) => event.isolated && event.sessionId !== 'creative-session'));
});
