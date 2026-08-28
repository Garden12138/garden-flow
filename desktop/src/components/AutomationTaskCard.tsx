import { useCallback, useState } from 'react';
import { CalendarClock, ExternalLink, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { clsx } from 'clsx';
import type { AutomationTaskUiHint } from '../../shared/automationTask';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
import { appAlert } from '../utils/appDialogs';

interface AutomationTaskCardProps {
    hint: AutomationTaskUiHint;
}

const SOURCE_LABEL: Record<AutomationTaskUiHint['source'], string> = {
    manual: '手动创建',
    chat: '对话创建',
    builtin: '内置任务',
};

function formatNextRun(value?: string): string {
    if (!value) return '待计算';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return '待计算';
    return new Date(ms).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function readActionError(result: unknown, fallback: string): string {
    if (!result || typeof result !== 'object') return '';
    const record = result as { success?: unknown; error?: unknown };
    if (record.success === false) {
        return String(record.error || fallback);
    }
    return '';
}

/**
 * 聊天内的自动化任务卡片。
 * 只依赖工具结果里的结构化 uiHint，操作直接走既有 IPC，不再经过 AI。
 */
export function AutomationTaskCard({ hint }: AutomationTaskCardProps) {
    const [enabled, setEnabled] = useState(hint.enabled);
    const [busy, setBusy] = useState<'' | 'toggle' | 'run'>('');

    const isLongCycle = hint.taskKind === 'long_cycle';

    const toggleEnabled = useCallback(async () => {
        setBusy('toggle');
        try {
            const nextEnabled = !enabled;
            const result = isLongCycle
                ? await window.ipcRenderer.redclawRunner.setLongCycleEnabled({ taskId: hint.taskId, enabled: nextEnabled })
                : await window.ipcRenderer.redclawRunner.setScheduledEnabled({ taskId: hint.taskId, enabled: nextEnabled });
            const error = readActionError(result, nextEnabled ? '启用任务失败。' : '暂停任务失败。');
            if (error) throw new Error(error);
            setEnabled(nextEnabled);
        } catch (error) {
            void appAlert(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy('');
        }
    }, [enabled, hint.taskId, isLongCycle]);

    const runNow = useCallback(async () => {
        setBusy('run');
        try {
            const result = isLongCycle
                ? await window.ipcRenderer.redclawRunner.runLongCycleNow({ taskId: hint.taskId })
                : await window.ipcRenderer.redclawRunner.runScheduledNow({ taskId: hint.taskId });
            const error = readActionError(result, '立即执行失败。');
            if (error) throw new Error(error);
        } catch (error) {
            void appAlert(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy('');
        }
    }, [hint.taskId, isLongCycle]);

    const openAutomationPage = useCallback(() => {
        dispatchAppIntent({ type: 'view.open', view: 'automation' });
    }, []);

    return (
        <div className="mt-3 w-full max-w-[520px] rounded-xl border border-border/80 bg-surface-primary/70 p-3.5">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-text-secondary">
                    <CalendarClock className="h-4 w-4" strokeWidth={1.7} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text-primary">{hint.name}</span>
                        <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-text-tertiary">
                            {SOURCE_LABEL[hint.source] || '自动化'}
                        </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
                        <span>{hint.scheduleLabel}</span>
                        <span>下次运行 {formatNextRun(hint.nextRunAt)}</span>
                        <span className={clsx(enabled ? 'text-green-500' : 'text-text-tertiary')}>
                            {enabled ? '已启用' : '已暂停'}
                        </span>
                    </div>
                    {hint.promptSummary && (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary">{hint.promptSummary}</p>
                    )}
                </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => void toggleEnabled()}
                    disabled={busy !== ''}
                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
                >
                    {busy === 'toggle'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : enabled
                            ? <PauseCircle className="h-3.5 w-3.5" />
                            : <PlayCircle className="h-3.5 w-3.5" />}
                    <span>{enabled ? '暂停' : '启用'}</span>
                </button>
                <button
                    type="button"
                    onClick={() => void runNow()}
                    disabled={busy !== ''}
                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
                >
                    {busy === 'run'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <PlayCircle className="h-3.5 w-3.5" />}
                    <span>立即运行</span>
                </button>
                <button
                    type="button"
                    onClick={openAutomationPage}
                    className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>自动化页</span>
                </button>
            </div>
        </div>
    );
}
