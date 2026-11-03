import { WorkspaceGuide, WorkspaceHelp } from '../../features/workbench/WorkspaceGuidance';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicationJobView, PublicationBrowserState, PublicationCompletion } from '../../../shared/publication';
import type { PublicationPlatform } from '../../../shared/platformPublisher';
import { PublicationPanel, PublicationButton, publicationPlatformLabel, publicationStatusLabel, openPublicationSource } from './PublicationPanel';

export function PublicationManagement({ isActive = true, onOpenSession, mode = 'all', jobId }: { jobId?: string; isActive?: boolean; onOpenSession?: (id: string) => void; mode?: 'all' | 'tasks' | 'history' | 'connections' }) {
    const [jobs, setJobs] = useState<PublicationJobView[]>([]); const [offers, setOffers] = useState<PublicationCompletion[]>([]);
    const [statuses, setStatuses] = useState<PublicationBrowserState[]>([]); const [tasks, setTasks] = useState<Array<{ id: string; enabled?: boolean }>>([]);
    const [platform, setPlatform] = useState<PublicationPlatform | 'all'>('all'); const [filter, setFilter] = useState('all');
    const [selected, setSelected] = useState<PublicationJobView | null>(null); const [error, setError] = useState('');
    const epoch = useRef(0);
    const load = useCallback(async (refresh = false) => {
        const token = ++epoch.current;
        try {
            const [records, browsers, definitions] = await Promise.all([window.ipcRenderer.publication.list(), window.ipcRenderer.publication.status({ refresh }), window.ipcRenderer.gardenflowRunner.listBuiltin()]);
            if (token !== epoch.current) return;
            if (!records.success) throw new Error(records.error);
            if (!browsers.success) throw new Error(browsers.error || '发布连接读取失败');
            setJobs(records.jobs); setOffers(records.offers); setStatuses(browsers.statuses); setTasks(definitions.tasks || []); setError('');
        } catch (reason) { if (token === epoch.current) setError(String(reason)); }
    }, []);
    useEffect(() => {
        if (!isActive) return;
        void load(true);
        const listener = () => { void load(); };
        const clear = () => { epoch.current++; setJobs([]); setOffers([]); setStatuses([]); setSelected(null); setTasks([]); void load(true); };
        window.ipcRenderer.publication.onChanged(listener); window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.publication.offChanged(listener); window.ipcRenderer.spaces.offChanged(clear); };
    }, [isActive, load]);
    useEffect(() => { if (jobId && jobs.length) setSelected(jobs.find(job => job.id === jobId) || null); }, [jobId, jobs]);
    const filtered = jobs.filter(job => (mode !== 'history' || ['completed', 'cancelled', 'superseded', 'published', 'published_reset_failed'].includes(job.status)) && (mode !== 'tasks' || !['completed', 'cancelled', 'superseded', 'published'].includes(job.status)) && (platform === 'all' || job.platform === platform) && (filter === 'all' || filter === 'pending' && job.publishStatus === 'not_submitted'
        || filter === 'published' && job.publishStatus === 'published' || filter === 'unknown' && ['unknown', 'pending_review', 'submitted'].includes(job.publishStatus)));
    return <section className="workspace-page space-y-5" aria-label="统一发布管理">
        <header className="workspace-page-header"><div><p className="workspace-eyebrow">发布</p><h1>{mode === 'tasks' ? '发布任务' : mode === 'history' ? '发布历史' : mode === 'connections' ? '账号与连接' : '发布管理'}</h1><p className="mt-2 text-sm text-text-tertiary">核对作品和账号，清楚掌握每一步发布状态。</p></div></header>
        {mode === 'connections' ? <WorkspaceHelp title="如何连接发布账号"><WorkspaceGuide title="先连接浏览器，再核对平台账号" description="发布通过浏览器插件执行，每个平台分别识别当前账号与页面。" steps={[{ title: '准备插件', description: '从设置中的连接页面安装并连接发布插件。' }, { title: '打开平台发布页', description: '登录正确账号，回到这里刷新真实页面状态。' }, { title: '绑定浏览器', description: '选择本次使用的浏览器，后续上传和最终发布各自确认。' }]}><button className="workspace-secondary-button" onClick={() => dispatchAppIntent({ type: 'route.open', route: { section: 'settings', page: 'connections' } })}>查看插件连接设置</button></WorkspaceGuide></WorkspaceHelp> : !jobs.length && <WorkspaceGuide title={mode === 'history' ? '发布后，在这里回看结果' : '从一件准备好的作品开始'} description={mode === 'history' ? '提交状态、可信回执和异常会保存在发布记录里。结果未知时请核实平台页面。' : '在作品编辑器中准备发布，核对平台、账号和内容后再继续。'} steps={[{ title: '准备作品', description: '打开已有作品，完成编辑、预览和必要导出。' }, { title: '上传并核对', description: '确认上传到正确账号，检查标题、正文和媒体。' }, { title: '最终提交', description: '再次明确确认，再查看提交结果与可信回执。' }]}><button className="workspace-primary-button" onClick={() => dispatchAppIntent({ type: 'route.open', route: { section: 'create', page: 'works' } })}>选择一件作品</button></WorkspaceGuide>}
        <div hidden={mode === 'tasks' || mode === 'history'}><button className="workspace-secondary-button" onClick={() => void load(true)}>刷新账号与发布页状态</button>
        <div className="grid gap-4 md:grid-cols-3">{(['xiaohongshu', 'douyin', 'tiktok'] as const).map(id => {
            const state = statuses.find(item => item.platform === id); const task = tasks.find(item => item.id === `${id === 'xiaohongshu' ? 'xhs' : id}-auto-publish`);
            return <article key={id} className="rounded-xl border border-border bg-surface-primary p-4"><h2 className="font-semibold">{publicationPlatformLabel[id]}</h2><p className="mt-2 text-xs text-text-tertiary">{state?.checkedAt ? `上次检查 ${new Date(state.checkedAt).toLocaleTimeString()}` : '尚未读取真实账号'}</p>
                {state?.instances.map(instance => <div className="mt-3 text-xs" key={instance.extensionInstanceId}><p>{instance.browser} · {instance.accountLabel || '账号未识别'}</p><p>{instance.connected ? '已连接' : '未连接'} · {instance.pageState || '未知'}{state.boundExtensionInstanceId === instance.extensionInstanceId && ' · 已绑定'}</p>{!instance.supported && <p>需更新发布插件</p>}<button className="workspace-secondary-button mt-2" disabled={!instance.connected} onClick={async () => { const result = await window.ipcRenderer.publication.bind({ platform: id, extensionInstanceId: instance.extensionInstanceId }); if (!result.success) setError(result.error || '绑定失败'); else await window.ipcRenderer.publication.status({ refresh: true }); await load(); }}>绑定此浏览器</button></div>)}
                {!state?.instances.length && <p className="mt-3 text-xs">发布插件未连接</p>}
                <label className="mt-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(task?.enabled)} onChange={async event => { const result = await window.ipcRenderer.gardenflowRunner.setBuiltinEnabled({ taskId: `${id === 'xiaohongshu' ? 'xhs' : id}-auto-publish`, enabled: event.target.checked }); if (result.success === false) setError(result.error); await load(); }} />完成后询问是否发布</label><p className="mt-1 text-xs text-text-tertiary">允许离线开启；不会自动上传或提交。</p>
            </article>;
        })}</div></div>
        <div hidden={mode === 'connections'}>{offers.filter(offer => offer.state === 'offered' && (platform === 'all' || offer.snapshot.platform === platform)).length > 0 && <div className="space-y-2"><h2 className="text-sm font-semibold">完成后待处理询问</h2>{offers.filter(offer => offer.state === 'offered' && (platform === 'all' || offer.snapshot.platform === platform)).map(offer => <div key={offer.id} className="flex items-center gap-3 rounded-lg border p-3 text-xs"><span className="mr-auto">{publicationPlatformLabel[offer.snapshot.platform]} · {offer.snapshot.title}</span><PublicationButton source={offer.source} origin="completion" promptId={offer.id} /><button onClick={async () => { await window.ipcRenderer.publication.dismissOffer({ id: offer.id }); await load(); }}>暂不发布</button><button onClick={() => onOpenSession?.(offer.snapshot.sessionId)}>进入编辑对话</button></div>)}</div>}
        <div className="workspace-filterbar"><select aria-label="发布平台筛选" className="rounded border bg-surface-primary px-3 py-2" value={platform} onChange={event => setPlatform(event.target.value as typeof platform)}><option value="all">全部平台</option>{Object.entries(publicationPlatformLabel).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="发布状态筛选" className="rounded border bg-surface-primary px-3 py-2" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部任务</option><option value="pending">待处理</option><option value="published">已发布</option><option value="unknown">审核中／结果待核实</option></select></div>
        </div>{error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div hidden={mode === 'connections'} className="space-y-2">{filtered.map(job => <article key={job.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface-primary p-4 text-xs"><div className="publication-work-preview">{job.media[0]?.previewUrl ? job.media[0].mimeType.startsWith('video/') ? <video src={job.media[0].previewUrl} preload="metadata" muted /> : <img src={job.media[0].previewUrl} alt="" /> : <span>作品</span>}</div><div className="mr-auto"><h3 className="text-sm font-semibold">{job.title}</h3><p className="mt-1">{publicationPlatformLabel[job.platform]} · {job.accountLabel || '历史任务未记录账号'} · {publicationStatusLabel(job)}</p>{job.errorMessage && <p className="mt-1 text-amber-700">{job.errorMessage}</p>}</div><button className="workspace-primary-button" onClick={() => setSelected(job)}>查看任务与回执</button>{job.source && <button onClick={() => openPublicationSource(job.source!)}>打开工程</button>}<button onClick={() => onOpenSession?.(job.sessionId)}>进入对话</button></article>)}{!filtered.length && jobs.length > 0 && <div className="workspace-empty"><h2>当前筛选没有发布任务</h2><p>试试其他平台或状态。</p><button className="workspace-secondary-button" onClick={() => { setPlatform('all'); setFilter('all'); }}>清除筛选</button></div>}</div>
        {selected && <PublicationPanel initialJob={selected} source={selected.source} onClose={() => { setSelected(null); void load(); }} />}
    </section>;
}
