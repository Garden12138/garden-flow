import { useCallback, useEffect, useState } from 'react';
import type { PublicationJobView, PublicationBrowserState, PublicationCompletion } from '../../../shared/publication';
import type { PublicationPlatform } from '../../../shared/platformPublisher';
import { PublicationPanel, PublicationButton, publicationPlatformLabel, publicationStatusLabel, openPublicationSource } from './PublicationPanel';

export function PublicationManagement({ isActive = true, onOpenSession }: { isActive?: boolean; onOpenSession?: (id: string) => void }) {
    const [jobs, setJobs] = useState<PublicationJobView[]>([]); const [offers, setOffers] = useState<PublicationCompletion[]>([]);
    const [statuses, setStatuses] = useState<PublicationBrowserState[]>([]); const [tasks, setTasks] = useState<any[]>([]);
    const [platform, setPlatform] = useState<PublicationPlatform | 'all'>('all'); const [filter, setFilter] = useState('all');
    const [selected, setSelected] = useState<PublicationJobView | null>(null); const [error, setError] = useState('');
    const load = useCallback(async () => {
        try {
            const [records, browsers, definitions] = await Promise.all([window.ipcRenderer.publication.list(), window.ipcRenderer.publication.status(), window.ipcRenderer.gardenflowRunner.listBuiltin()]);
            if (!records.success) throw new Error(records.error); setJobs(records.jobs); setOffers(records.offers); setStatuses(browsers.statuses);
            setTasks((definitions as any).tasks || []);
        } catch (reason) { setError(String(reason)); }
    }, []);
    useEffect(() => { if (!isActive) return; void window.ipcRenderer.publication.status({ refresh: true }).then(result => { if (result.success) setStatuses(result.statuses); }); void load(); const listener = () => { void load(); }; window.ipcRenderer.publication.onChanged(listener);
        return () => window.ipcRenderer.publication.offChanged(listener); }, [isActive, load]);
    const filtered = jobs.filter(job => (platform === 'all' || job.platform === platform) && (filter === 'all' || filter === 'pending' && job.publishStatus === 'not_submitted'
        || filter === 'published' && job.publishStatus === 'published' || filter === 'unknown' && ['unknown', 'pending_review', 'submitted'].includes(job.publishStatus)));
    return <section className="space-y-5 p-6" aria-label="统一发布管理">
        <header><h1 className="text-xl font-semibold">发布管理</h1><p className="mt-2 text-sm text-text-tertiary">查看当前空间的三平台账号、发布询问、任务和回执。</p></header>
        <button className="rounded-lg border px-3 py-2 text-xs" onClick={async () => { const result = await window.ipcRenderer.publication.status({ refresh: true }); if (!result.success) setError(result.error || '刷新失败'); else setStatuses(result.statuses); }}>刷新账号与发布页状态</button>
        <div className="grid gap-4 md:grid-cols-3">{(['xiaohongshu', 'douyin', 'tiktok'] as const).map(id => {
            const state = statuses.find(item => item.platform === id); const task = tasks.find(item => item.id === `${id === 'xiaohongshu' ? 'xhs' : id}-auto-publish`);
            return <article key={id} className="rounded-xl border border-border bg-surface-primary p-4"><h2 className="font-semibold">{publicationPlatformLabel[id]}</h2><p className="mt-2 text-xs text-text-tertiary">{state?.checkedAt ? `上次检查 ${new Date(state.checkedAt).toLocaleTimeString()}` : '尚未读取真实账号'}</p>
                {state?.instances.map(instance => <div className="mt-3 text-xs" key={instance.extensionInstanceId}><p>{instance.browser} · {instance.accountLabel || '账号未识别'}</p><p>{instance.connected ? '已连接' : '未连接'} · {instance.pageState || '未知'}{state.boundExtensionInstanceId === instance.extensionInstanceId && ' · 已绑定'}</p>{!instance.supported && <p>需更新发布插件</p>}<button className="mt-2 rounded border px-2 py-1" disabled={!instance.connected} onClick={async () => { const result = await window.ipcRenderer.publication.bind({ platform: id, extensionInstanceId: instance.extensionInstanceId }); if (!result.success) setError(result.error || '绑定失败'); else await window.ipcRenderer.publication.status({ refresh: true }); await load(); }}>绑定此浏览器</button></div>)}
                {!state?.instances.length && <p className="mt-3 text-xs">发布插件未连接</p>}
                <label className="mt-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(task?.enabled)} onChange={async event => { const result = await window.ipcRenderer.gardenflowRunner.setBuiltinEnabled({ taskId: `${id === 'xiaohongshu' ? 'xhs' : id}-auto-publish`, enabled: event.target.checked }); if ((result as any).success === false) setError((result as any).error); await load(); }} />完成后询问是否发布</label><p className="mt-1 text-[11px] text-text-tertiary">允许离线开启；不会自动上传或提交。</p>
            </article>;
        })}</div>
        {offers.filter(offer => offer.state === 'offered' && (platform === 'all' || offer.snapshot.platform === platform)).length > 0 && <div className="space-y-2"><h2 className="text-sm font-semibold">完成后待处理询问</h2>{offers.filter(offer => offer.state === 'offered' && (platform === 'all' || offer.snapshot.platform === platform)).map(offer => <div key={offer.id} className="flex items-center gap-3 rounded-lg border p-3 text-xs"><span className="mr-auto">{publicationPlatformLabel[offer.snapshot.platform]} · {offer.snapshot.title}</span><PublicationButton source={offer.source} origin="completion" promptId={offer.id} /><button onClick={async () => { await window.ipcRenderer.publication.dismissOffer({ id: offer.id }); await load(); }}>暂不发布</button><button onClick={() => onOpenSession?.(offer.snapshot.sessionId)}>进入编辑对话</button></div>)}</div>}
        <div className="flex gap-3 text-sm"><select aria-label="发布平台筛选" className="rounded border bg-surface-primary px-3 py-2" value={platform} onChange={event => setPlatform(event.target.value as typeof platform)}><option value="all">全部平台</option>{Object.entries(publicationPlatformLabel).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="发布状态筛选" className="rounded border bg-surface-primary px-3 py-2" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部任务</option><option value="pending">待处理</option><option value="published">已发布</option><option value="unknown">审核中／结果待核实</option></select></div>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div className="space-y-2">{filtered.map(job => <article key={job.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-4 text-xs"><div className="mr-auto"><h3 className="text-sm font-semibold">{job.title}</h3><p className="mt-1">{publicationPlatformLabel[job.platform]} · {job.accountLabel || '历史任务未记录账号'} · {publicationStatusLabel(job)}</p>{job.errorMessage && <p className="mt-1 text-amber-700">{job.errorMessage}</p>}</div><button className="rounded border px-3 py-2" onClick={() => setSelected(job)}>查看任务与回执</button>{job.source && <button onClick={() => openPublicationSource(job.source!)}>打开工程</button>}<button onClick={() => onOpenSession?.(job.sessionId)}>进入对话</button></article>)}{!filtered.length && <p className="text-sm text-text-tertiary">当前筛选没有发布任务</p>}</div>
        {selected && <PublicationPanel initialJob={selected} source={selected.source} onClose={() => { setSelected(null); void load(); }} />}
    </section>;
}
