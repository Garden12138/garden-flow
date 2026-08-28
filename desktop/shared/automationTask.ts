/**
 * 自动化任务的跨进程共享契约。
 *
 * 主进程工具层产出结构化 `uiHint`，renderer 依据 `kind` 渲染对应卡片，
 * 避免在消息文本里做关键词匹配来判断“这条回复创建了自动化任务”。
 */

export type AutomationTaskSource = 'manual' | 'chat' | 'builtin';

export type AutomationTaskKind = 'scheduled' | 'long_cycle';

export interface AutomationTaskUiHint {
    kind: 'automation-task';
    /** 触发该提示的工具动作，例如 schedule-add / long-update */
    action: string;
    taskKind: AutomationTaskKind;
    taskId: string;
    name: string;
    enabled: boolean;
    /** 人类可读的频率描述，例如“每天 09:00” */
    scheduleLabel: string;
    nextRunAt?: string;
    source: AutomationTaskSource;
    /** 内置任务不可删除 */
    removable: boolean;
    promptSummary?: string;
}

export const AUTOMATION_TASK_UI_HINT_KIND = 'automation-task';

export function isAutomationTaskUiHint(value: unknown): value is AutomationTaskUiHint {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return record.kind === AUTOMATION_TASK_UI_HINT_KIND
        && typeof record.taskId === 'string'
        && record.taskId.length > 0;
}

export function normalizeAutomationTaskSource(value: unknown): AutomationTaskSource | undefined {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'manual' || text === 'chat' || text === 'builtin') return text;
    return undefined;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function describeAutomationSchedule(input: {
    mode?: string;
    intervalMinutes?: number;
    time?: string;
    weekdays?: number[];
    runAt?: string;
    totalRounds?: number;
    completedRounds?: number;
}): string {
    const mode = String(input.mode || '').trim().toLowerCase();
    const time = String(input.time || '').slice(0, 5);

    if (mode === 'long_cycle' || mode === 'long-cycle') {
        const interval = Number(input.intervalMinutes || 0);
        const rounds = `${Number(input.completedRounds || 0)}/${Number(input.totalRounds || 0)} 轮`;
        return interval > 0 ? `每 ${interval} 分钟推进一轮 · ${rounds}` : `长周期任务 · ${rounds}`;
    }
    if (mode === 'interval') {
        const interval = Number(input.intervalMinutes || 0);
        return interval > 0 ? `每 ${interval} 分钟` : '按间隔执行';
    }
    if (mode === 'daily') {
        return `每天 ${time || '09:00'}`;
    }
    if (mode === 'weekly') {
        const days = Array.isArray(input.weekdays) && input.weekdays.length > 0
            ? input.weekdays.map((day) => WEEKDAY_LABELS[Math.max(0, Math.min(6, Math.floor(Number(day) || 0)))]).join('、')
            : '周一';
        return `每周 ${days} ${time || '09:00'}`;
    }
    if (mode === 'once') {
        const runAtMs = Date.parse(String(input.runAt || ''));
        if (Number.isFinite(runAtMs)) {
            return `仅一次 ${new Date(runAtMs).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            })}`;
        }
        return '仅一次';
    }
    return '待定';
}
