import assert from 'node:assert/strict';
import test from 'node:test';
import {
    readSkipSubagentOrchestration,
    shouldRunSubagentOrchestration,
    shouldUseCoordinator,
} from '../electron/core/ai/orchestrationPolicy.ts';
import type { IntentRoute } from '../electron/core/ai/types.ts';
import { planBackgroundSession } from '../electron/core/backgroundSessionPlan.ts';
import {
    applyXhsAutoCaptureCompletionGate,
    evaluateXhsAutoCaptureRun,
    XHS_AUTO_CAPTURE_TASK_ID,
    validateXhsAutoCaptureCompletion,
} from '../electron/core/xhsAutoCaptureCompletion.ts';

const automationRoute: Pick<IntentRoute, 'intent' | 'requiresMultiAgent'> = {
    intent: 'automation',
    requiresMultiAgent: false,
};

const captureMetadata = {
    automationKind: 'builtin',
    builtinTaskId: XHS_AUTO_CAPTURE_TASK_ID,
};

test('extracts skipSubagentOrchestration from metadata', () => {
    assert.equal(readSkipSubagentOrchestration({ skipSubagentOrchestration: true }), true);
    assert.equal(readSkipSubagentOrchestration({ skipSubagentOrchestration: false }), false);
    assert.equal(readSkipSubagentOrchestration({}), false);
    assert.equal(readSkipSubagentOrchestration(null), false);
    assert.equal(readSkipSubagentOrchestration({ automationKind: 'builtin' }), true);
    assert.equal(readSkipSubagentOrchestration({ builtinTaskId: XHS_AUTO_CAPTURE_TASK_ID }), true);
});

test('skipSubagentOrchestration disables background-maintenance orchestration and coordinator', () => {
    assert.equal(shouldRunSubagentOrchestration({
        runtimeMode: 'background-maintenance',
        route: automationRoute,
        skipSubagentOrchestration: true,
    }), false);
    assert.equal(shouldUseCoordinator({
        runtimeMode: 'background-maintenance',
        route: automationRoute,
        skipSubagentOrchestration: true,
    }), false);
});

test('builtin task identity skips orchestration even without the skip flag', () => {
    assert.equal(shouldRunSubagentOrchestration({
        runtimeMode: 'background-maintenance',
        route: automationRoute,
        skipSubagentOrchestration: readSkipSubagentOrchestration({
            builtinTaskId: XHS_AUTO_CAPTURE_TASK_ID,
        }),
    }), false);
});

test('background-maintenance still orchestrates without skip', () => {
    assert.equal(shouldRunSubagentOrchestration({
        runtimeMode: 'background-maintenance',
        route: automationRoute,
    }), true);
    assert.equal(shouldUseCoordinator({
        runtimeMode: 'background-maintenance',
        route: automationRoute,
    }), true);
});

test('xhs auto-capture with only list_windows is not complete', () => {
    const result = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool list_windows', success: true },
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_open_profile --args "{}"', success: true },
        ],
        assistantResponse: '先截图确认现场状态，页面已打开。',
    });
    assert.equal(result?.complete, false);
    assert.equal(result?.captured, false);
    assert.equal(result?.hasSaveClick, false);
    assert.equal(result?.maxRecoveryAttempts, 8);
    assert.match(result?.feedback || '', /保存网页/);
    assert.match(result?.feedback || '', /没搜到/);
});

test('xhs auto-capture click plus unchanged knowledge list is not complete', () => {
    const ids = JSON.stringify({ redbook: ['64ba67ac0000000010030166', '69b00286000000001600a431'] }, null, 2);
    const result = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: ids },
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_click --args "{}"', success: true },
            { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: ids },
        ],
    });
    assert.equal(result?.complete, false);
    assert.equal(result?.captured, false);
    assert.equal(result?.hasSaveClick, true);
    assert.equal(result?.hasKnowledgeCheck, true);
});

test('xhs auto-capture completes only after computer_click and new knowledge ids', () => {
    const before = JSON.stringify({ redbook: ['64ba67ac0000000010030166'] }, null, 2);
    const after = JSON.stringify({ redbook: ['64ba67ac0000000010030166', '6a8299db0000000025003871'] }, null, 2);
    const result = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool list_windows', success: true },
            { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: before },
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_click --args "{}"', success: true },
            { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: after },
        ],
    });
    assert.equal(result?.complete, true);
    assert.equal(result?.captured, true);
    assert.equal(result?.hasSaveClick, true);
    assert.equal(result?.hasKnowledgeCheck, true);
});

test('failed click or missing knowledge list is not complete', () => {
    const failedClick = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_click --args "{}"', success: false },
            { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true },
        ],
    });
    assert.equal(failedClick?.complete, false);

    const clickOnly = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'computer-use click 120 80', success: true },
        ],
    });
    assert.equal(clickOnly?.complete, false);
    assert.equal(clickOnly?.hasSaveClick, true);
    assert.equal(clickOnly?.hasKnowledgeCheck, false);
});

test('explicit captcha stop is complete but not captured', () => {
    const result = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_screenshot', success: true },
        ],
        assistantResponse: '出现验证码滑块，立即停止并报告现场。',
    });
    assert.equal(result?.complete, true);
    assert.equal(result?.captured, false);
    assert.equal(result?.blocked, true);

    const evaluation = evaluateXhsAutoCaptureRun({
        metadata: captureMetadata,
        toolResults: result ? [{ toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_screenshot', success: true }] : [],
        assistantResponse: '出现验证码滑块，立即停止并报告现场。',
    });
    assert.equal(evaluation.applies, true);
    assert.equal(evaluation.captured, false);
    assert.equal(evaluation.blocked, true);
});

test('claiming a login wall on the explore feed is not a valid stop', () => {
    const result = validateXhsAutoCaptureCompletion({
        metadata: captureMetadata,
        toolResults: [
            { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_click --args "{}"', success: true },
            { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: JSON.stringify({ redbook: ['aaa111aaa111aaa111aaa111'] }) },
        ],
        assistantResponse: '搜索猫粮后页面弹出了登录墙，无法继续。需要用户手动登录。',
    });
    assert.equal(result?.complete, false);
    assert.equal(result?.blocked, false);
    assert.match(result?.feedback || '', /没搜到/);
});

test('query-runtime capture gate overrides a false-complete adapter result', () => {
    const merged = applyXhsAutoCaptureCompletionGate(
        { complete: true },
        validateXhsAutoCaptureCompletion({
            metadata: captureMetadata,
            toolResults: [
                { toolName: 'app_cli', command: 'mcp call --id computer-use --tool list_windows', success: true },
            ],
            assistantResponse: '页面已打开，先截图确认现场。',
        }),
    );
    assert.equal(merged.complete, false);
    assert.equal(merged.maxRecoveryAttempts, 8);

    const captured = applyXhsAutoCaptureCompletionGate(
        { complete: true },
        validateXhsAutoCaptureCompletion({
            metadata: captureMetadata,
            toolResults: [
                { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: JSON.stringify({ redbook: ['aaa111aaa111aaa111aaa111'] }) },
                { toolName: 'app_cli', command: 'mcp call --id computer-use --tool computer_click --args "{}"', success: true },
                { toolName: 'app_cli', command: 'knowledge list --source redbook --limit 5', success: true, resultText: JSON.stringify({ redbook: ['aaa111aaa111aaa111aaa111', 'bbb222bbb222bbb222bbb222'] }) },
            ],
        }),
    );
    assert.equal(captured.complete, true);
});

test('non-capture metadata is ignored by the capture gate', () => {
    assert.equal(validateXhsAutoCaptureCompletion({
        metadata: { builtinTaskId: 'other-task' },
        toolResults: [],
    }), null);
    const passthrough = applyXhsAutoCaptureCompletionGate(
        { complete: true },
        validateXhsAutoCaptureCompletion({
            metadata: { builtinTaskId: 'other-task' },
            toolResults: [],
        }),
    );
    assert.equal(passthrough.complete, true);
});

test('fresh builtin runs discard the previous bound session instead of reusing it', () => {
    assert.deepEqual(planBackgroundSession({ fresh: true, existingCount: 1 }), {
        action: 'create',
        discardExisting: true,
    });
    assert.deepEqual(planBackgroundSession({ fresh: true, existingCount: 0 }), {
        action: 'create',
        discardExisting: false,
    });
    assert.deepEqual(planBackgroundSession({ existingCount: 1 }), {
        action: 'reuse',
        discardExisting: false,
    });
    assert.deepEqual(planBackgroundSession({ existingCount: 0 }), {
        action: 'create',
        discardExisting: false,
    });
});
