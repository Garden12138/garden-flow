import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Plus, Search, Upload, CheckCircle2, Clock3, AlertCircle, RefreshCw } from 'lucide-react';
import { useWorkCatalog } from '../features/workbench/useWorkCatalog';
import { WorkGallery } from '../features/workbench/WorkGallery';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
import type { GenerationIntent } from '../features/app-shell/types';
import type { PublicationJobView } from '../../shared/publication';

interface HomeProps {
    isActive?: boolean;
    onNavigateToCoverStudio?: () => void;
    onNavigateToGenerationStudio?: (mode: GenerationIntent['mode']) => void;
    onOpenManuscript?: (filePath: string) => void;
    onOpenVideoProject?: (projectId: string) => void;
}
export function Home({ isActive = true }: HomeProps) {
    const catalog = useWorkCatalog(isActive);
    const [pending, setPending] = useState(0);
    const [jobs, setJobs] = useState<PublicationJobView[]>([]);
    const [error, setError] = useState(''); const epoch = useRef(0);
    const loadPending = useCallback(async () => {
        const token = ++epoch.current;
        const results = await Promise.allSettled([window.ipcRenderer.teamRuntime.reviewDocketStats(), window.ipcRenderer.publication.list()]);
        if (token !== epoch.current) return;
        const [approvals, publication] = results;
        if (approvals.status === 'fulfilled') setPending(Number((approvals.value as { pending?: number }).pending || 0));
        if (publication.status === 'fulfilled' && publication.value.success) setJobs(publication.value.jobs);
        setError(results.some(result => result.status === 'rejected') || publication.status === 'fulfilled' && !publication.value.success ? '部分待处理事项读取失败，请刷新重试。' : '');
    }, []);
    useEffect(() => { if (!isActive) return; const clear = () => { epoch.current++; setPending(0); setJobs([]); void loadPending(); }; void loadPending(); window.ipcRenderer.publication.onChanged(loadPending); window.ipcRenderer.spaces.onChanged(clear); return () => { epoch.current++; window.ipcRenderer.publication.offChanged(loadPending); window.ipcRenderer.spaces.offChanged(clear); }; }, [isActive, loadPending]);
    const availableWorks = catalog.items.filter(item => item.availability === 'ready');
    const unavailableWorks = catalog.items.length - availableWorks.length;
    const needsReview = jobs.filter(job => ['unknown', 'pending_review', 'submitted'].includes(job.publishStatus) || ['blocked', 'published_reset_failed'].includes(job.status));
    const navigate = (section: 'create' | 'research' | 'library' | 'automation' | 'publish', page: string) => {
        if (section === 'create') dispatchAppIntent({ type: 'route.open', route: { section, page: 'works' } });
        else if (section === 'research') dispatchAppIntent({ type: 'route.open', route: { section, page: 'consumer' } });
        else if (section === 'library') dispatchAppIntent({ type: 'route.open', route: { section, page: 'materials' } });
        else if (section === 'publish') dispatchAppIntent({ type: 'route.open', route: { section, page: 'tasks' } });
        else dispatchAppIntent({ type: 'route.open', route: { section, page: page === 'runs' ? 'runs' : 'approvals' } });
    };
    return <div className="workspace-page workspace-home" aria-label="工作台">
        <header className="workspace-home-header"><div><p className="workspace-eyebrow">你的创作空间</p><h1>让下一件作品，向前一步。</h1><p>发现真实需求，完成创作，再从反馈中找到新的方向。</p></div><button aria-label="刷新工作台" className="workspace-icon-button" onClick={() => { void catalog.refresh(); void loadPending(); }}><RefreshCw size={17} /></button></header>
        <div className="workspace-quick-actions"><button onClick={() => dispatchAppIntent({ type: 'creation.choose' })}><span className="workspace-action-icon is-primary"><Plus size={22} /></span><span><strong>开始创作</strong><small>从一个想法到一件作品</small></span><ArrowRight size={18} /></button><button onClick={() => navigate('research', 'consumer')}><span className="workspace-action-icon"><Search size={22} /></span><span><strong>研究消费者</strong><small>从已有评论与资料找到机会</small></span><ArrowRight size={18} /></button><button onClick={() => navigate('library', 'materials')}><span className="workspace-action-icon"><Upload size={22} /></span><span><strong>导入资料</strong><small>积累下一轮创作的依据</small></span><ArrowRight size={18} /></button></div>
        <div className="workspace-home-columns"><section className="min-w-0"><div className="workspace-section-heading"><div><h2>继续创作</h2><p>最近编辑的作品</p></div><button onClick={() => navigate('create', 'works')}>全部作品<ArrowRight size={15} /></button></div>
            {catalog.error && <div role="alert" className="workspace-error">{catalog.error}<button onClick={() => void catalog.refresh()}>重试</button></div>}
            {catalog.loading ? <div className="workspace-skeleton-grid" aria-label="正在加载最近作品">{[1, 2, 3].map(id => <div key={id} />)}</div> : availableWorks.length ? <WorkGallery items={availableWorks.slice(0, 6)} /> : <div className="workspace-first-work"><p className="workspace-eyebrow">第一件作品</p><h2>把手里的资料，变成值得分享的内容。</h2><p>可以导入一份资料、选择一个商品，或直接描述你的创作目标。需要 AI 时再配置对应服务。</p><button className="workspace-primary-button" onClick={() => dispatchAppIntent({ type: 'creation.choose' })}>创建第一件作品<ArrowRight size={16} /></button><button className="workspace-text-button" onClick={() => dispatchAppIntent({ type: 'settings.open', tab: 'ai' })}>配置 AI 服务</button></div>}
        </section><aside className="workspace-pending"><div className="workspace-section-heading"><h2>待处理</h2><span>{pending + needsReview.length + unavailableWorks}</span></div>{error && <p role="alert" className="workspace-error">{error}<button onClick={() => void loadPending()}>重试</button></p>}
            {unavailableWorks > 0 && <button className="workspace-pending-item" onClick={() => navigate('create', 'works')}><AlertCircle size={18} /><span><strong>{unavailableWorks} 件作品需要检查文件</strong><small>关联记录保留，打开目录查看原因。</small></span><ArrowRight size={15} /></button>}
            {pending > 0 && <button className="workspace-pending-item" onClick={() => navigate('automation', 'approvals')}><AlertCircle size={18} /><span><strong>{pending} 项操作等待确认</strong><small>查看范围与影响，再决定是否继续</small></span><ArrowRight size={15} /></button>}
            {needsReview.map(job => <button key={job.id} className="workspace-pending-item" onClick={() => dispatchAppIntent({ type: 'route.open', route: { section: 'publish', page: 'tasks', entityId: job.id } })}><AlertCircle size={18} /><span><strong>{job.title}</strong><small>{job.errorMessage || (job.publishStatus === 'unknown' ? '提交结果需要核实' : '查看发布状态与回执')}</small></span><ArrowRight size={15} /></button>)}
            {!pending && !needsReview.length && !unavailableWorks && !error && <div className="workspace-pending-empty"><CheckCircle2 size={26} /><strong>当前没有待处理事项</strong><p>可以安心回到作品，或开始下一轮研究。</p></div>}
            <button className="workspace-running-link" onClick={() => navigate('automation', 'runs')}><Clock3 size={17} />查看运行中的任务与记录<ArrowRight size={14} /></button>
            <div className="workspace-flow-note"><span>你的下一步</span><p>资料与评论 → 消费者机会 → 作品 → 发布 → 复盘</p></div>
        </aside></div>
    </div>;
}
