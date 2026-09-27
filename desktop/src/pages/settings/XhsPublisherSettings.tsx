import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import type { XhsPublisherStatus } from '../../../shared/xhsPublisher';

type StatusResult = XhsPublisherStatus & { success: boolean; error?: string };

export function XhsPublisherSettings({ isActive }: { isActive: boolean }) {
    const [status, setStatus] = useState<XhsPublisherStatus | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [binding, setBinding] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const requestId = useRef(0);

    const refresh = useCallback(async () => {
        const currentRequest = ++requestId.current;
        setRefreshing(true);
        setError('');
        setMessage('');
        try {
            const result = await window.ipcRenderer.xhsPublisher.getStatus() as StatusResult;
            if (!result?.success) throw new Error(result?.error || '发布浏览器状态读取失败');
            if (currentRequest !== requestId.current) return;
            const instances = result.instances.filter((instance) => instance.connected);
            setStatus(result);
            setSelectedId((current) => {
                if (instances.some((instance) => instance.extensionInstanceId === current)) return current;
                const bound = instances.find((instance) => instance.extensionInstanceId === result.boundExtensionInstanceId);
                return bound?.extensionInstanceId || instances[0]?.extensionInstanceId || '';
            });
        } catch (failure) {
            if (currentRequest !== requestId.current) return;
            setStatus(null);
            setSelectedId('');
            setError(failure instanceof Error ? failure.message : '发布浏览器状态读取失败');
        } finally {
            if (currentRequest === requestId.current) setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        if (isActive) void refresh();
        return () => { requestId.current += 1; };
    }, [isActive, refresh]);

    const instances = status?.instances.filter((instance) => instance.connected) || [];
    const selected = instances.find((instance) => instance.extensionInstanceId === selectedId);
    const bound = instances.find((instance) => instance.extensionInstanceId === status?.boundExtensionInstanceId);
    const selectedIsBound = Boolean(selected && selectedId === status?.boundExtensionInstanceId);
    const busy = refreshing || binding;

    const bind = async () => {
        if (!selected || busy) return;
        setBinding(true);
        setError('');
        setMessage('');
        try {
            const result = await window.ipcRenderer.xhsPublisher.bindInstance({ extensionInstanceId: selectedId }) as {
                success: boolean;
                extensionInstanceId?: string;
                error?: string;
            };
            if (!result?.success || !result.extensionInstanceId) {
                throw new Error(result?.error || '发布浏览器绑定失败');
            }
            const boundId = result.extensionInstanceId;
            setStatus((current) => current ? { ...current, boundExtensionInstanceId: boundId } : current);
            setMessage('发布浏览器已绑定并保存。可返回自动任务页重新检查。');
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '发布浏览器绑定失败');
        } finally {
            setBinding(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text-secondary" aria-live="polite">
                    {refreshing ? '正在检查发布插件…' : status ? `已连接 ${instances.length} 个发布插件实例` : '发布插件状态尚未读取'}
                </p>
                <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4${refreshing ? ' animate-spin' : ''}`} />刷新实例
                </button>
            </div>
            {status ? (
                <p className={`break-all text-xs ${bound ? 'text-emerald-600' : 'text-text-tertiary'}`}>
                    {bound
                        ? `已绑定：${bound.browser || '浏览器'} · ${bound.extensionInstanceId}`
                        : status.boundExtensionInstanceId
                            ? '已绑定的发布插件未连接，请打开对应浏览器，或选择其他已连接实例重新绑定。'
                            : '尚未绑定发布浏览器，请选择一个实例后点击绑定。'}
                </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                    <span className="mb-1.5 block text-xs font-medium text-text-secondary">专用发布插件实例</span>
                    <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={busy || instances.length === 0} className="h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-text-primary outline-none focus:border-accent-primary disabled:opacity-50">
                        {instances.length === 0 ? <option value="">未检测到已连接的发布插件</option> : null}
                        {instances.map((instance) => (
                            <option key={instance.extensionInstanceId} value={instance.extensionInstanceId}>
                                {instance.browser || '浏览器'} · {instance.extensionInstanceId}
                            </option>
                        ))}
                    </select>
                </label>
                <button type="button" onClick={() => void bind()} disabled={busy || !selected || selectedIsBound} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent-primary px-4 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                    {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : selectedIsBound ? <Check className="h-4 w-4" /> : null}
                    {binding ? '正在绑定…' : selectedIsBound ? '已绑定此浏览器' : '绑定此浏览器'}
                </button>
            </div>
            {selected ? (
                <p className="text-xs leading-5 text-text-tertiary">
                    {selected.extensionVersion ? `插件版本：${selected.extensionVersion} · ` : ''}
                    {selected.publishTabCount !== undefined ? `发布页：${selected.publishTabCount} 个` : '发布页状态未读取'}
                    {selected.detail ? ` · ${selected.detail}` : ''}
                </p>
            ) : null}
            <p className="text-xs leading-5 text-text-tertiary">在所选浏览器登录小红书创作服务平台，仅保留一个内容为空的官方发布页。绑定后立即保存。</p>
            {message ? <p role="status" className="text-xs text-emerald-600">{message}</p> : null}
            {error ? <p role="alert" className="break-all text-xs text-red-500">{error}</p> : null}
        </div>
    );
}
