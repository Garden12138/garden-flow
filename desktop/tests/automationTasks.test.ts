import assert from 'node:assert/strict';
import test from 'node:test';
import {
    describeAutomationSchedule,
    isAutomationTaskUiHint,
    normalizeAutomationTaskSource,
} from '../shared/automationTask.ts';
import { analyzeAppCliCommand } from '../electron/core/runtimeCommandPolicy.ts';

test('describes every supported automation schedule mode', () => {
    assert.equal(describeAutomationSchedule({ mode: 'daily', time: '09:30' }), '每天 09:30');
    assert.equal(describeAutomationSchedule({ mode: 'interval', intervalMinutes: 45 }), '每 45 分钟');
    assert.equal(
        describeAutomationSchedule({ mode: 'weekly', time: '22:00', weekdays: [1, 3] }),
        '每周 周一、周三 22:00',
    );
    assert.equal(
        describeAutomationSchedule({ mode: 'long_cycle', intervalMinutes: 30, totalRounds: 8, completedRounds: 2 }),
        '每 30 分钟推进一轮 · 2/8 轮',
    );
    assert.equal(describeAutomationSchedule({ mode: 'unknown-mode' }), '待定');
});

test('normalizes automation task source and rejects unknown values', () => {
    assert.equal(normalizeAutomationTaskSource('chat'), 'chat');
    assert.equal(normalizeAutomationTaskSource('BUILTIN'), 'builtin');
    assert.equal(normalizeAutomationTaskSource('robot'), undefined);
    assert.equal(normalizeAutomationTaskSource(undefined), undefined);
});

test('recognizes structured automation task ui hints', () => {
    assert.equal(isAutomationTaskUiHint({ kind: 'automation-task', taskId: 'sched_1' }), true);
    assert.equal(isAutomationTaskUiHint({ kind: 'automation-task', taskId: '' }), false);
    assert.equal(isAutomationTaskUiHint({ kind: 'generated-images', taskId: 'x' }), false);
    assert.equal(isAutomationTaskUiHint(null), false);
});

test('requires explicit user acknowledgement for persistent task mutations in foreground chat', () => {
    for (const command of [
        'gardenflow schedule-add --name "每日巡检" --mode daily --time 09:00 --prompt "..."',
        'gardenflow schedule-remove --task-id sched_1',
        'gardenflow long-add --name x --objective y --step-prompt z',
        'gardenflow long-remove --task-id long_1',
        'work schedule-add --title x --prompt y',
        'work cycle-add --title x --objective y --step-prompt z',
    ]) {
        const analysis = analyzeAppCliCommand(command, { interactive: true });
        assert.equal(analysis.className, 'confirm', command);
        assert.equal(analysis.requiresUserAcknowledgement, true, command);
    }
});

test('allows computer-use mcp call during unattended builtin automation', () => {
    const analysis = analyzeAppCliCommand(
        'mcp call --id computer-use --tool computer_screenshot --args "{}"',
        { interactive: false, runtimeMode: 'background-maintenance' },
    );
    assert.equal(analysis.className, 'trusted-write');
});

test('still confirms mcp call in foreground chat', () => {
    const analysis = analyzeAppCliCommand(
        'mcp call --id computer-use --tool computer_screenshot --args "{}"',
        { interactive: true },
    );
    assert.equal(analysis.className, 'confirm');
});

test('denies unrelated mcp servers in background maintenance', () => {
    const analysis = analyzeAppCliCommand(
        'mcp call --id filesystem --tool read_file',
        { interactive: false, runtimeMode: 'background-maintenance' },
    );
    assert.equal(analysis.className, 'deny');
});

test('keeps unattended automation links unblocked', () => {
    const background = analyzeAppCliCommand('gardenflow schedule-add --name x --prompt y', {
        interactive: true,
        runtimeMode: 'background-maintenance',
    });
    assert.equal(background.className, 'trusted-write');
    assert.equal(background.requiresUserAcknowledgement, undefined);

    const headless = analyzeAppCliCommand('gardenflow schedule-add --name x --prompt y', { interactive: false });
    assert.equal(headless.className, 'trusted-write');
    assert.equal(headless.requiresUserAcknowledgement, undefined);
});

test('leaves non-persistent gardenflow writes on the trusted path', () => {
    const analysis = analyzeAppCliCommand('gardenflow schedule-update --task-id sched_1 --name x', { interactive: true });
    assert.equal(analysis.className, 'trusted-write');
    assert.equal(analysis.requiresUserAcknowledgement, undefined);
});
