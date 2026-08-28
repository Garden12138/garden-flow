import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, PlayCircle, RefreshCw, Settings2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { appAlert } from '../utils/appDialogs';

type BuiltinTask = RedClawBuiltinAutomationTask;
type Readiness = RedClawBuiltinAutomationReadiness;
type SettingField = RedClawBuiltinAutomationSettingField;

interface BuiltinAutomationSectionProps {
    isActive?: boolean;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function settingValueToText(field: SettingField, value: unknown): string {
    if (field.type === 'string-list') {
        return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }
    return value === undefined || value === null ? '' : String(value);
}

function textToSettingValue(field: SettingField, text: string): unknown {
    if (field.type === 'string-list') {
        return text
            .split(/[,，\n|]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (field.type === 'number') {
        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : field.defaultValue;
    }
    return text;
}

function formatRunTime(value?: string): string {
    if (!value) return '未安排';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return '未安排';
    return new Date(ms).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function lastResultLabel(task: BuiltinTask): string {
    if (task.running) return '正在执行';
    if (!task.lastRunAt) return '尚未运行';
    if (task.lastResult === 'success') return `上次运行成功 · ${formatRunTime(task.lastRunAt)}`;
    if (task.lastResult === 'skipped') return `上次跳过 · ${task.lastError || '未就绪'}`;
    if (task.lastResult === 'error') return `上次失败 · ${task.lastError || '未知错误'}`;
    return `上次运行 ${formatRunTime(task.lastRunAt)}`;
}

function readError(result: unknown, fallback: string): string {
    if (!result || typeof result !== 'object') return fallback;
    const record = result as { success?: unknown; error?: unknown };
    if (record.success === false) return String(record.error || fallback);
    return '';
}

/**
 * 自动化页的「内置任务」分组。
 * 内置任务定义在主进程注册表中，这里按 settingsSchema 渲染表单，不为单个任务写死 UI。
 */
export function BuiltinAutomationSection({ isActive = true }: BuiltinAutomationSectionProps) {
    const [tasks, setTasks] = useState<BuiltinTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [readiness, setReadiness] = useState<Record<string, Readiness>>({});
    const [checkingId, setCheckingId] = useState('');
    const [busyId, setBusyId] = useState('');
    const [configTaskId, setConfigTaskId] = useState('');
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [draftTime, setDraftTime] = useState('');
    const loadRequestRef = useRef(0);

    const load = useCallback(async () => {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const result = await window.ipcRenderer.redclawRunner.listBuiltin();
            if (requestId !== loadRequestRef.current) return;
            if (result?.success === false) {
                throw new Error(result.error || '加载内置任务失败。');
            }
            setTasks(Array.isArray(result?.tasks) ? result.tasks : []);
        } catch (loadError) {
            if (requestId !== loadRequestRef.current) return;
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        } finally {
            if (requestId === loadRequestRef.current) {
                setLoading(false);
            }
        }
    }, []);

    const refreshReadiness = useCallback(async (taskId: string) => {
        setCheckingId(taskId);
        try {
            const result = await window.ipcRenderer.redclawRunner.builtinReadiness({ taskId });
            const message = readError(result, '就绪检查失败。');
            if (message) throw new Error(message);
            if (result?.readiness) {
                setReadiness((current) => ({ ...current, [taskId]: result.readiness as Readiness }));
            }
        } catch (checkError) {
            void appAlert(checkError instanceof Error ? checkError.message : String(checkError));
        } finally {
            setCheckingId('');
        }
    }, []);

    useEffect(() => {
        if (!isActive) return;
        void load();
    }, [isActive, load]);

    useEffect(() => {
        if (!isActive) return;
        const listener = (_event: unknown, status: { currentAutomationTaskId?: string | null } | undefined) => {
            if (!status || typeof status !== 'object') return;
            const runningId = status.currentAutomationTaskId || null;
            setTasks((prev) => {
                let changed = false;
                const next = prev.map((task) => {
                    const running = runningId === task.id;
                    if (Boolean(task.running) === running) return task;
                    changed = true;
                    return { ...task, running };
                });
                if (changed && !runningId) {
                    queueMicrotask(() => {
                        void load();
                    });
                }
                return changed ? next : prev;
            });
        };
        window.ipcRenderer.redclawRunner.onStatus(listener);
        return () => window.ipcRenderer.redclawRunner.offStatus(listener);
    }, [isActive, load]);

    const configTask = useMemo(
        () => tasks.find((task) => task.id === configTaskId) || null,
        [configTaskId, tasks],
    );

    const openConfig = useCallback((task: BuiltinTask) => {
        const nextDraft: Record<string, string> = {};
        for (const field of task.settingsSchema) {
            nextDraft[field.key] = settingValueToText(field, task.settings?.[field.key]);
        }
        setDraft(nextDraft);
        setDraftTime(task.scheduleTime || '10:00');
        setConfigTaskId(task.id);
    }, []);

    const saveConfig = useCallback(async () => {
        if (!configTask) return;
        if (!TIME_PATTERN.test(draftTime)) {
            void appAlert('执行时间格式必须是 HH:mm，例如 10:00。');
            return;
        }
        const settings: Record<string, unknown> = {};
        for (const field of configTask.settingsSchema) {
            settings[field.key] = textToSettingValue(field, draft[field.key] ?? '');
        }
        setBusyId(configTask.id);
        try {
            const result = await window.ipcRenderer.redclawRunner.setBuiltinSettings({
                taskId: configTask.id,
                settings,
                scheduleTime: draftTime,
            });
            const message = readError(result, '保存内置任务配置失败。');
            if (message) throw new Error(message);
            setConfigTaskId('');
            await load();
            await refreshReadiness(configTask.id);
        } catch (saveError) {
            void appAlert(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
            setBusyId('');
        }
    }, [configTask, draft, draftTime, load, refreshReadiness]);

    const toggleEnabled = useCallback(async (task: BuiltinTask) => {
        const stealBusy = busyId !== task.id;
        if (stealBusy) setBusyId(task.id);
        try {
            const result = await window.ipcRenderer.redclawRunner.setBuiltinEnabled({
                taskId: task.id,
                enabled: !task.enabled,
            });
            const message = readError(result, task.enabled ? '关闭内置任务失败。' : '开启内置任务失败。');
            if (message) throw new Error(message);
            if (result?.readiness) {
                setReadiness((current) => ({ ...current, [task.id]: result.readiness as Readiness }));
            }
            await load();
        } catch (toggleError) {
            void appAlert(toggleError instanceof Error ? toggleError.message : String(toggleError));
            await refreshReadiness(task.id);
        } finally {
            if (stealBusy) setBusyId('');
        }
    }, [busyId, load, refreshReadiness]);

    const runNow = useCallback(async (task: BuiltinTask) => {
        setBusyId(task.id);
        try {
            const result = await window.ipcRenderer.redclawRunner.runBuiltinNow({ taskId: task.id });
            const message = readError(result, '立即运行内置任务失败。');
            if (message) throw new Error(message);
            await load();
        } catch (runError) {
            void appAlert(runError instanceof Error ? runError.message : String(runError));
        } finally {
            setBusyId('');
        }
    }, [load]);

    if (!loading && !error && tasks.length === 0) {
        return null;
    }

    return (
        <section className="automation-section" aria-label="内置自动化任务">
            <div className="automation-section-title">内置任务</div>
            <div className="mt-4 flex flex-col gap-3">
                {loading && tasks.length === 0 && (
                    <div className="automation-state">
                        <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                )}
                {!loading && error && (
                    <button type="button" onClick={() => void load()} className="automation-error">
                        {error}
                    </button>
                )}
                {tasks.map((task) => {
                    const report = readiness[task.id];
                    const busy = busyId === task.id;
                    const executing = busy || Boolean(task.running);
                    const platformBlocked = !task.supportedOnCurrentPlatform;
                    return (
                        <div key={task.id} className="rounded-2xl border border-border/70 bg-surface-primary/60 p-4">
                            <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-[15px] font-medium text-text-primary">{task.name}</span>
                                        <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-text-tertiary">
                                            内置
                                        </span>
                                        {platformBlocked && (
                                            <span className="shrink-0 rounded-full border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-600">
                                                仅 macOS
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-text-tertiary">{task.description}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
                                        <span>每天 {task.scheduleTime}</span>
                                        <span>下次运行 {formatRunTime(task.nextRunAt)}</span>
                                        <span>{lastResultLabel(task)}</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void toggleEnabled(task)}
                                    disabled={platformBlocked}
                                    className={clsx(
                                        'relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50',
                                        task.enabled ? 'border-transparent bg-green-500' : 'border-border/70 bg-surface-tertiary/60',
                                    )}
                                    aria-label={task.enabled ? '关闭内置任务' : '开启内置任务'}
                                    title={task.enabled ? (executing ? '关闭（当前这轮仍会跑完，但不会再自动开下一轮）' : '关闭') : '开启'}
                                >
                                    <span
                                        className={clsx(
                                            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                                            task.enabled ? 'left-[22px]' : 'left-0.5',
                                        )}
                                    />
                                </button>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openConfig(task)}
                                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                >
                                    <Settings2 className="h-3.5 w-3.5" />
                                    <span>配置</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void refreshReadiness(task.id)}
                                    disabled={checkingId === task.id}
                                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
                                >
                                    {checkingId === task.id
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <RefreshCw className="h-3.5 w-3.5" />}
                                    <span>检查就绪状态</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runNow(task)}
                                    disabled={executing || platformBlocked}
                                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
                                >
                                    {executing
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <PlayCircle className="h-3.5 w-3.5" />}
                                    <span>{executing ? '正在执行' : '立即运行'}</span>
                                </button>
                                {task.documentationUrl && (
                                    <a
                                        href={task.documentationUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        <span>安装说明</span>
                                    </a>
                                )}
                            </div>

                            {report && (
                                <div className="mt-3 rounded-xl border border-border/60 bg-surface-secondary/30 p-3">
                                    <div className="mb-2 flex items-center gap-2 text-xs">
                                        {report.ready
                                            ? <Check className="h-3.5 w-3.5 text-green-500" />
                                            : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                                        <span className={report.ready ? 'text-green-600' : 'text-amber-600'}>
                                            {report.ready ? '全部检查通过，可以开启' : report.blockingReason || '存在未通过的检查项'}
                                        </span>
                                    </div>
                                    <ul className="flex flex-col gap-1.5">
                                        {report.checks.map((check) => (
                                            <li key={check.id} className="flex items-start gap-2 text-xs">
                                                <span
                                                    className={clsx(
                                                        'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                                                        check.status === 'ok'
                                                            ? 'bg-green-500'
                                                            : check.status === 'failed'
                                                                ? 'bg-red-500'
                                                                : 'bg-text-tertiary',
                                                    )}
                                                />
                                                <div className="min-w-0">
                                                    <div className="text-text-secondary">
                                                        {check.label}
                                                        <span className="ml-2 text-text-tertiary">{check.detail}</span>
                                                    </div>
                                                    {check.status !== 'ok' && check.hint && (
                                                        <div className="mt-0.5 text-text-tertiary">{check.hint}</div>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {configTask && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6">
                    <div className="w-full max-w-[520px] rounded-2xl border border-border/70 bg-background p-5 shadow-2xl">
                        <div className="mb-4 flex items-center justify-between">
                            <span className="text-sm font-medium text-text-primary">{configTask.name} · 配置</span>
                            <button
                                type="button"
                                onClick={() => setConfigTaskId('')}
                                className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                                aria-label="关闭"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex flex-col gap-3">
                            {configTask.settingsSchema.map((field) => (
                                <label key={field.key} className="flex flex-col gap-1">
                                    <span className="text-xs text-text-secondary">
                                        {field.label}
                                        {field.required && <span className="ml-1 text-red-500">*</span>}
                                    </span>
                                    {field.type === 'select' ? (
                                        <select
                                            value={draft[field.key] ?? ''}
                                            onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                                            className="rounded-lg border border-border/70 bg-surface-primary px-2.5 py-1.5 text-sm text-text-primary"
                                        >
                                            {(field.options || []).map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type={field.type === 'number' ? 'number' : 'text'}
                                            min={field.min}
                                            max={field.max}
                                            value={draft[field.key] ?? ''}
                                            placeholder={field.placeholder}
                                            onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                                            className="rounded-lg border border-border/70 bg-surface-primary px-2.5 py-1.5 text-sm text-text-primary"
                                        />
                                    )}
                                    {field.description && (
                                        <span className="text-[11px] text-text-tertiary">{field.description}</span>
                                    )}
                                </label>
                            ))}

                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-text-secondary">每天执行时间</span>
                                <input
                                    type="time"
                                    value={draftTime}
                                    onChange={(event) => setDraftTime(event.target.value)}
                                    className="rounded-lg border border-border/70 bg-surface-primary px-2.5 py-1.5 text-sm text-text-primary"
                                />
                            </label>
                        </div>

                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfigTaskId('')}
                                className="rounded-md border border-border/70 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void saveConfig()}
                                disabled={busyId === configTask.id}
                                className="flex items-center gap-1.5 rounded-md bg-accent-primary px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                                {busyId === configTask.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
