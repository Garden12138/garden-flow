import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { AppRoute } from '../features/app-shell/routes';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
const ContentOpportunitiesPanel = lazy(async () => ({ default: (await import('../components/wander/ContentOpportunitiesPanel')).ContentOpportunitiesPanel }));
const ConsumerResearchPanel = lazy(async () => ({ default: (await import('../components/wander/ConsumerResearchPanel')).ConsumerResearchPanel }));
const SourceMaintenancePanel = lazy(async () => ({ default: (await import('../components/wander/SourceMaintenancePanel')).SourceMaintenancePanel }));
const ContentCampaignsPanel = lazy(async () => ({ default: (await import('../components/campaigns/ContentCampaignsPanel')).ContentCampaignsPanel }));
const ContentExperimentsPanel = lazy(async () => ({ default: (await import('../components/experiments/ContentExperimentsPanel')).ContentExperimentsPanel }));
const PublicationManagement = lazy(async () => ({ default: (await import('../components/publication/PublicationManagement')).PublicationManagement }));
const Subjects = lazy(async () => ({ default: (await import('./Subjects')).Subjects }));
const Advisors = lazy(async () => ({ default: (await import('./Advisors')).Advisors }));
const Works = lazy(async () => ({ default: (await import('./Works')).Works }));

interface RunRecord { id: string; title: string; status: string; updatedAt: string; error?: string; sessionId?: string; }
function RunHistory() {
    const [records, setRecords] = useState<RunRecord[]>([]);
    const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const epoch = useRef(0);
    const load = useCallback(async () => {
        const token = ++epoch.current;
        try {
            const [scheduled, builtin] = await Promise.all([window.ipcRenderer.gardenflowRunner.taskList({ includeDrafts: true }), window.ipcRenderer.gardenflowRunner.listBuiltin()]);
            if (token !== epoch.current) return;
            if (scheduled.success === false) throw new Error(scheduled.error || '自动任务读取失败');
            if (builtin.success === false) throw new Error(builtin.error || '内置任务读取失败');
            const result: RunRecord[] = [];
            for (const task of builtin.tasks || []) if (task.running || task.lastRunAt) result.push({ id: task.id, title: task.name, status: task.running ? 'running' : task.lastResult === 'success' ? 'succeeded' : task.lastResult === 'error' ? 'failed' : 'interrupted', updatedAt: task.lastRunAt || '', error: task.lastError || undefined, sessionId: task.reportSessionId || undefined });
            for (const item of scheduled.items || []) {
                const value: unknown = item.latestExecution;
                if (!value || typeof value !== 'object' || result.some(record => record.id === item.sourceTaskId)) continue;
                const run = value as Record<string, unknown>;
                result.push({ id: String(item.definitionId), title: item.title || '自动任务', status: String(run.status || ''), updatedAt: String(run.updatedAt || ''), error: typeof run.lastError === 'string' ? run.lastError : undefined, sessionId: typeof run.sessionId === 'string' ? run.sessionId : undefined });
            }
            setRecords(result.sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.updatedAt.localeCompare(a.updatedAt))); setError('');
        } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) setLoading(false); }
    }, []);
    useEffect(() => {
        void load();
        const clear = () => { epoch.current++; setRecords([]); setLoading(true); void load(); };
        window.ipcRenderer.gardenflowRunner.onStatus(load); window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.gardenflowRunner.offStatus(load); window.ipcRenderer.spaces.offChanged(clear); };
    }, [load]);
    const labels: Record<string, string> = { queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
    return <div className="workspace-page"><header className="workspace-page-header"><div><p className="workspace-eyebrow">自动化</p><h1>运行记录</h1><p>查看正在执行的任务与各任务最近一次运行，进入报告核对过程与产物。</p></div><button className="workspace-secondary-button" onClick={() => void load()}>刷新记录</button></header>{error && <p role="alert" className="workspace-error">{error}<button onClick={() => void load()}>重试</button></p>}{loading && <p role="status">正在读取运行记录…</p>}{!loading && !records.length && <div className="workspace-empty"><h2>还没有运行记录</h2><p>任务开始后，执行状态和结果会显示在这里。</p><button className="workspace-primary-button" onClick={() => dispatchAppIntent({ type: 'route.open', route: { section: 'automation', page: 'tasks' } })}>查看自动任务</button></div>}<div className="workspace-records">{records.map(record => <article key={record.id} className="workspace-record"><div><span className="workspace-status-label">{labels[record.status] || '状态未知'}</span><h2>{record.title}</h2><p>{record.updatedAt}</p>{record.error && <p className="text-red-600">{record.error}</p>}</div>{record.sessionId ? <button className="workspace-secondary-button" onClick={() => dispatchAppIntent({ type: 'gardenflow.open', action: 'open-session', sessionId: record.sessionId! })}>查看执行过程</button> : <span className="text-xs text-text-tertiary">暂无关联报告</span>}</article>)}</div></div>;
}

export function WorkspacePages({ route }: { route: AppRoute }) {
    if (route.section === 'research') {
        if (route.page === 'opportunities') return <ContentOpportunitiesPanel key={route.entityId || 'list'} standalone opportunityId={route.entityId} />;
        if (route.page === 'consumer') return <div className="workspace-page"><header className="workspace-page-header"><div><p className="workspace-eyebrow">研究与选题</p><h1>消费者研究</h1><p>选择已有资料，找到受众的问题、顾虑和内容机会。</p></div></header><ConsumerResearchPanel onResults={() => undefined} /></div>;
        if (route.page === 'maintenance') return <div className="workspace-page"><header className="workspace-page-header"><div><p className="workspace-eyebrow">研究与选题</p><h1>来源复核</h1><p>核对资料变化，找到需要重新检查的机会与作品。</p></div></header><SourceMaintenancePanel /></div>;
    }
    if (route.section === 'create' && route.page === 'works') return <Works />;
    if (route.section === 'create' && route.page === 'campaigns') return <div className="workspace-feature-page"><ContentCampaignsPanel opportunityId={route.entityId} /></div>;
    if (route.section === 'publish') return <div className="workspace-feature-page"><PublicationManagement jobId={route.entityId} mode={route.page} onOpenSession={id => dispatchAppIntent({ type: 'gardenflow.open', action: 'open-session', sessionId: id })} /></div>;
    if (route.section === 'review') return <div className="workspace-feature-page"><ContentExperimentsPanel mode={route.page} /></div>;
    if (route.section === 'library' && route.page === 'characters') return <Subjects key="characters" scope="characters" />;
    if (route.section === 'automation' && route.page === 'runs') return <RunHistory />;
    if (route.section === 'settings' && route.page === 'members') return <Advisors />;
    return null;
}
