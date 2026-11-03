import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, FileSearch, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import type { Opportunity, OpportunityDetail, OpportunityStatus, SourceSnapshot, SourceIdentity, CiResult } from '../../../shared/contentIntelligence';
import { canTransitionOpportunity } from '../../../shared/contentIntelligence';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';
import { OpportunityEvidence } from '../../features/creation/ContentEvidencePanel';
import { ConsumerResearchPanel } from './ConsumerResearchPanel';
import { SourceMaintenancePanel } from './SourceMaintenancePanel';
import { ManualOpportunityDialog, OpportunityCreationDialog, type OpportunitySelection } from './OpportunityDialogs';

const statusLabels: Record<OpportunityStatus, string> = { proposed: '待采用', accepted: '已采用', needs_evidence: '需要证据', dismissed: '已忽略', archived: '已归档' };
const transitionLabels: Record<OpportunityStatus, string> = { proposed: '重新打开', accepted: '先采纳，稍后创作', needs_evidence: '标记为需要证据', dismissed: '忽略这个方向', archived: '归档这个方向' };
function resultData<T>(result: CiResult<T>): T { if (result.success === false) throw new Error(result.error); return result.data; }
function MoreActions({ children, disabled }: { children: ReactNode; disabled: boolean }) {
    const ref = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const close = (event: MouseEvent) => { if (ref.current && !event.composedPath().includes(ref.current)) ref.current.removeAttribute('open'); };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);
    return <details ref={ref} className="opportunity-menu" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); } }}>
        <summary className="workspace-secondary-button" aria-label="更多机会操作"><MoreHorizontal size={16} />更多</summary>
        <div className="opportunity-menu-items" onClick={event => { if (!disabled && (event.target as HTMLElement).closest('button')) { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); } }}>{children}</div>
    </details>;
}
function OpportunityGuide({ onStart, onManual }: { onStart: () => void; onManual?: () => void }) {
    return <section aria-label="机会使用指南" className="opportunity-guide">
        <div className="opportunity-guide-intro"><p className="workspace-eyebrow">从消费者的问题开始</p><h2>下一件内容，可以从这里找到方向</h2><p>把资料和评论中的困惑，整理成值得创作的选题。每个方向都保留依据，方便你判断是否值得做。</p>
            <div className="flex flex-wrap gap-3"><button type="button" className="workspace-primary-button" onClick={onStart}>开始发现机会<ArrowRight size={16} /></button>{onManual && <button type="button" className="workspace-secondary-button" onClick={onManual}>已有想法，手动记录</button>}</div>
        </div>
        <div className="opportunity-guide-example"><span className="opportunity-badge">示例 · 非真实研究结果</span><p>“收纳以后，反而找不到东西了。”</p><div><ArrowRight size={16} /><span>内容方向：小桌面如何收纳，让物品更好找？</span></div></div>
        <ol className="opportunity-guide-steps"><li><span>1</span><div><strong>准备资料</strong><p>导入或采集你关心的商品、资料与评论。</p></div></li><li><span>2</span><div><strong>发现需求</strong><p>在消费者研究中选择资料，确认后分析。</p></div></li><li><span>3</span><div><strong>选一个方向创作</strong><p>回来核对依据，将选中的机会带入作品。</p></div></li></ol>
    </section>;
}

export function ContentOpportunitiesPanel({ standalone = false, opportunityId }: { standalone?: boolean; opportunityId?: string } = {}) {
    const [items, setItems] = useState<Opportunity[]>([]);
    const [next, setNext] = useState<string>();
    const [sources, setSources] = useState<SourceSnapshot[]>([]);
    const [status, setStatus] = useState<OpportunityStatus | ''>('');
    const [sort, setSort] = useState<'recent' | 'priority'>('recent');
    const [sourceFilter, setSourceFilter] = useState('');
    const [detail, setDetail] = useState<OpportunityDetail | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(Boolean(opportunityId));
    const [showForm, setShowForm] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [showResearch, setShowResearch] = useState(false);
    const [showMaintenance, setShowMaintenance] = useState(false);
    const [scope, setScope] = useState(0);
    const epoch = useRef(0);
    const listRequest = useRef(0);
    const pending = useRef(false);
    const requests = useRef(new Map<string, { intent: string; id: string }>());
    const requestId = (slot: string, input: unknown) => {
        const intent = JSON.stringify(input); const old = requests.current.get(slot);
        if (old?.intent === intent) return old.id;
        const id = crypto.randomUUID(); requests.current.set(slot, { intent, id }); return id;
    };
    const load = useCallback(async (token: number, after?: string) => {
        const request = ++listRequest.current;
        setLoading(true);
        try {
            const source = sourceFilter ? JSON.parse(sourceFilter) as SourceIdentity : undefined;
            const result = resultData(await window.ipcRenderer.contentIntelligence.list({ ...(status ? { status } : {}), after, sort, source }));
            if (token !== epoch.current || request !== listRequest.current) return;
            setItems(old => after ? [...old, ...result.items] : result.items); setNext(result.next);
        } finally { if (token === epoch.current && request === listRequest.current) setLoading(false); }
    }, [status, sort, sourceFilter]);
    useEffect(() => {
        const token = epoch.current;
        let cancelled = false;
        setItems([]); setNext(undefined); setError('');
        void load(token).catch(reason => { if (!cancelled && token === epoch.current) setError(String(reason)); });
        return () => { cancelled = true; };
    }, [load, scope]);
    useEffect(() => {
        const clear = () => {
            epoch.current++; listRequest.current++; pending.current = false; requests.current.clear();
            setItems([]); setNext(undefined); setSources([]); setStatus(''); setSort('recent'); setSourceFilter('');
            setShowResearch(false); setShowMaintenance(false); setDetail(null); setDetailLoading(false); setShowForm(false); setShowCreate(false); setError(''); setBusy(false); setScope(value => value + 1);
        };
        window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, []);
    useEffect(() => {
        if (!opportunityId) return;
        const token = epoch.current;
        let cancelled = false;
        setDetail(null); setDetailLoading(true);
        void window.ipcRenderer.contentIntelligence.detail(opportunityId).then(result => { if (!cancelled && token === epoch.current) setDetail(resultData(result)); }).catch(reason => { if (!cancelled && token === epoch.current) setError(String(reason)); }).finally(() => { if (!cancelled && token === epoch.current) setDetailLoading(false); });
        return () => { cancelled = true; };
    }, [opportunityId]);
    async function act(operation: (token: number) => Promise<void>) {
        if (pending.current) return;
        const token = epoch.current; pending.current = true; setBusy(true); setError('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    function openResearch() {
        if (standalone) dispatchAppIntent({ type: 'route.open', route: { section: 'research', page: 'consumer' } });
        else { setShowResearch(true); setShowMaintenance(false); }
    }
    function openMaintenance() {
        if (standalone) dispatchAppIntent({ type: 'route.open', route: { section: 'research', page: 'maintenance' } });
        else { setShowMaintenance(true); setShowResearch(false); }
    }
    function openManual() {
        setShowForm(true); setError('');
        void act(async token => { const result = resultData(await window.ipcRenderer.contentIntelligence.sources()); if (token === epoch.current) setSources(result); });
    }
    function back() {
        if (standalone) dispatchAppIntent({ type: 'route.open', route: { section: 'research', page: 'opportunities' } });
        else { setDetail(null); setError(''); }
    }
    async function transition(to: OpportunityStatus, token: number) {
        if (!detail) throw new Error('请重新打开机会');
        const input = { id: detail.opportunity.id, expectedRevision: detail.opportunity.revision, to };
        const updated = resultData(await window.ipcRenderer.contentIntelligence.transition({ ...input, requestId: requestId('transition', input) }));
        if (token !== epoch.current) return;
        const value = { ...detail, opportunity: updated };
        setDetail(value);
        return value;
    }
    function createWork(selection: OpportunitySelection) {
        void act(async token => {
            if (!detail) return;
            const current = detail.opportunity.status === 'accepted' ? detail : await transition('accepted', token);
            if (!current || token !== epoch.current) return;
            const input = { opportunityId: current.opportunity.id, expectedRevision: current.opportunity.revision, selection };
            const result = resultData(await window.ipcRenderer.contentIntelligence.createWork({ ...input, requestId: requestId('work', input) }));
            if (token === epoch.current) dispatchAppIntent({ type: 'creation.open', workspaceId: result.workspace.id });
        });
    }
    const hasDetail = Boolean(detail || opportunityId);
    const firstUse = !loading && !error && !items.length && !status && !sourceFilter;
    const invalidEvidence = detail?.evidence.some(item => item.validity !== 'verified');
    const inactive = detail?.opportunity.status === 'dismissed' || detail?.opportunity.status === 'archived';
    return <section aria-label="消费者机会" className="workspace-opportunities workspace-page">
        {hasDetail ? <>
            <div className="opportunity-detail-top"><button type="button" className="workspace-back-button" disabled={busy} onClick={back}><ArrowLeft size={16} />返回机会列表</button>{detail && <MoreActions disabled={busy}>
                {detail.opportunity.status === 'accepted' && <button type="button" disabled={busy} onClick={() => dispatchAppIntent({ type: 'route.open', route: { section: 'create', page: 'campaigns', entityId: detail.opportunity.id } })}>加入成组内容</button>}
                {Object.entries(transitionLabels).filter(([to]) => canTransitionOpportunity(detail.opportunity.status, to as OpportunityStatus)).map(([to, label]) => <button type="button" key={to} disabled={busy} onClick={() => void act(async token => { await transition(to as OpportunityStatus, token); if (token === epoch.current) await load(token); })}>{label}</button>)}
                <button type="button" disabled={busy} onClick={() => void act(async token => { const value = resultData(await window.ipcRenderer.contentIntelligence.detail(detail.opportunity.id)); if (token === epoch.current) setDetail(value); })}><RefreshCw size={14} />刷新详情</button>
            </MoreActions>}</div>
            {detailLoading && <p role="status" className="py-8 text-text-secondary">正在读取机会与依据…</p>}
            {detail && <section aria-label="机会详情" className="opportunity-detail">
                <header className="opportunity-detail-header"><div className="mb-4 flex flex-wrap gap-2"><span className="opportunity-badge">{statusLabels[detail.opportunity.status]}</span><span className="opportunity-badge">{detail.opportunity.basis === 'hypothesis' ? '待验证假设' : `${detail.evidence.length} 条来源依据`}</span></div><h1>{detail.opportunity.title}</h1><p>先看消费者的问题和依据，觉得值得做，再把它变成作品。</p></header>
                <div className="opportunity-detail-columns"><div className="min-w-0 space-y-7">
                    <section className="opportunity-brief" aria-label="创作方向"><div><h2>消费者的问题</h2><p>{detail.opportunity.problem}</p></div><div><h2>想帮助谁</h2><p>{detail.opportunity.audience}</p></div><div><h2>可以怎么讲</h2><p>{detail.opportunity.angle}</p></div></section>
                    <section className="opportunity-evidence"><div className="mb-4 flex items-center justify-between gap-3"><h2>这个方向的依据</h2><span className="text-[12px] text-text-secondary">支持、反例与背景</span></div>
                        {detail.opportunity.basis === 'hypothesis' && <p className="opportunity-notice mb-4">目前还没有消费者支持证据。这是待验证的想法，创作时请保留假设说明。</p>}
                        <OpportunityEvidence detail={detail} />
                    </section>
                    {detail.opportunity.research && <details className="opportunity-disclosure"><summary>查看研究建议与评分说明</summary><div className="space-y-3 pt-4 text-[14px] leading-relaxed text-text-secondary"><p>模型排序建议 {detail.opportunity.research.weightedScore} / 5；不是统计置信度或成功概率。依据 30%、适配 25%、制作 20%、业务 15%、新鲜 10%。置信提示：{detail.opportunity.research.confidence === 'unknown' ? '证据不足' : detail.opportunity.research.confidence === 'low' ? '低' : '中'}。</p>{Object.entries(detail.opportunity.research.scores).map(([key, score]) => <p key={key}>{({ evidence: '依据', fit: '适配', feasibility: '制作', business: '业务', freshness: '新鲜' } as Record<string, string>)[key]} {score.value}/5：{score.reason}</p>)}{detail.opportunity.research.uncertainties.map((text, index) => <p key={index}>{text}</p>)}</div></details>}
                </div><aside className="opportunity-next-step"><span className="opportunity-step-icon"><FileSearch size={20} /></span><h2>{inactive ? '暂时收起的方向' : '准备好开始了吗？'}</h2><p>{inactive ? '重新打开后，可以继续核对依据和创作。' : '选好平台和内容形式，就能进入编辑器。方向与依据会自动带入。'}</p>
                    {invalidEvidence && <p className="opportunity-notice">部分依据已更新或不可核验。先复核来源，再开始创作。</p>}
                    {inactive ? <button type="button" className="workspace-primary-button" disabled={busy} onClick={() => void act(async token => { await transition('proposed', token); })}>重新打开机会</button> : invalidEvidence ? <button type="button" className="workspace-primary-button" disabled={busy} onClick={openMaintenance}>前往来源复核<ArrowRight size={16} /></button> : <button type="button" className="workspace-primary-button" disabled={busy} onClick={() => { setError(''); setShowCreate(true); }}>基于此创作<ArrowRight size={16} /></button>}
                    {!inactive && <p className="opportunity-next-note"><Check size={14} />可以先编辑，再决定何时生成和发布。</p>}
                </aside></div>
            </section>}
        </> : <>
            <header className="workspace-page-header"><div><p className="workspace-eyebrow">研究与选题</p><h1>消费者机会</h1><p>从消费者的真实问题中，找到下一件值得做的内容。</p></div><div className="flex flex-wrap items-center gap-2">{!firstUse && <button type="button" className="workspace-primary-button" disabled={busy} onClick={openResearch}><Plus size={16} />发现内容机会</button>}<MoreActions disabled={busy}><button type="button" disabled={busy} onClick={openManual}>手动新建机会</button><button type="button" disabled={busy} onClick={openMaintenance}>来源复核</button><button type="button" disabled={busy} onClick={() => void act(token => load(token))}><RefreshCw size={14} />刷新列表</button></MoreActions></div></header>
            {showResearch && <ConsumerResearchPanel onResults={() => { void load(epoch.current).catch(reason => setError(String(reason))); }} />}
            {showMaintenance && <SourceMaintenancePanel />}
            {firstUse ? <OpportunityGuide onStart={openResearch} onManual={openManual} /> : <>
                {!loading && items.length > 0 && <details className="opportunity-help"><summary><BookOpen size={16} />第一次使用？了解如何从机会开始创作<ChevronRight size={16} /></summary><OpportunityGuide onStart={openResearch} /></details>}
                <div className="workspace-filterbar opportunity-filters"><select aria-label="机会状态" value={status} onChange={event => setStatus(event.target.value as typeof status)} disabled={busy}><option value="">全部状态</option>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="机会排序" value={sort} disabled={busy} onChange={event => setSort(event.target.value as typeof sort)}><option value="recent">最近记录</option><option value="priority">建议优先级（非概率）</option></select>
                    <details className="opportunity-source-filter"><summary>按来源筛选{sourceFilter && ' · 已选择'}</summary><select aria-label="机会来源筛选" value={sourceFilter} disabled={busy} onFocus={() => { if (!sources.length) void act(async token => { const value = resultData(await window.ipcRenderer.contentIntelligence.sources()); if (token === epoch.current) setSources(value); }); }} onChange={event => setSourceFilter(event.target.value)}><option value="">全部来源</option>{sources.map(item => <option key={JSON.stringify(item.source)} value={JSON.stringify(item.source)}>{item.title} · {item.source.namespace}</option>)}</select></details>
                </div>
                {loading && <p role="status" className="py-6 text-text-secondary">正在读取机会…</p>}
                {!loading && !error && !items.length && <div className="workspace-empty"><h2>没有符合筛选条件的机会</h2><p>试试其他状态，或清除筛选查看全部方向。</p><button type="button" className="workspace-secondary-button" onClick={() => { setStatus(''); setSourceFilter(''); }}>清除筛选</button></div>}
                <div className="opportunity-list">{items.map(item => <button type="button" key={item.id} disabled={busy} className="opportunity-card" onClick={() => standalone ? dispatchAppIntent({ type: 'route.open', route: { section: 'research', page: 'opportunities', entityId: item.id } }) : void act(async token => { const value = resultData(await window.ipcRenderer.contentIntelligence.detail(item.id)); if (token === epoch.current) setDetail(value); })}>
                    <div className="mb-4 flex flex-wrap gap-2"><span className="opportunity-badge">{statusLabels[item.status]}</span><span className="opportunity-card-basis">{item.basis === 'hypothesis' ? '待验证假设' : `${item.evidence.length} 条依据`}</span></div><h3>{item.title}</h3><p className="opportunity-card-problem">{item.problem}</p><p className="opportunity-card-audience">帮助谁 · {item.audience}</p><div className="opportunity-card-angle"><span>创作角度</span><p>{item.angle}</p></div><span className="opportunity-card-open">查看方向与依据<ArrowRight size={16} /></span>
                </button>)}</div>
                {next && <button type="button" className="workspace-secondary-button mt-5" disabled={busy || loading} onClick={() => void act(token => load(token, next))}>加载更多</button>}
            </>}
        </>}
        {error && !showForm && !showCreate && <div role="alert" className="workspace-error mt-4">{error}<button type="button" disabled={busy} onClick={() => void act(async token => { if (opportunityId) { const value = resultData(await window.ipcRenderer.contentIntelligence.detail(opportunityId)); if (token === epoch.current) setDetail(value); } else await load(token); })}>重新加载</button></div>}
        {showForm && <ManualOpportunityDialog sources={sources} busy={busy} error={error} onClose={() => { setShowForm(false); setError(''); }} onBind={(input, onBound) => void act(async token => {
            if (input.locator.start < 0) throw new Error('引用必须与原文中的连续片段一致');
            const value = resultData(await window.ipcRenderer.contentIntelligence.addEvidence(input)); if (token === epoch.current) onBound(value);
        })} onSave={(form, evidence) => void act(async token => {
            const input = { ...form, evidence: evidence.map(item => ({ id: item.evidence.id, relation: item.relation })) };
            const value = resultData(await window.ipcRenderer.contentIntelligence.createOpportunity({ ...input, requestId: requestId('manual', input) }));
            if (token !== epoch.current) return;
            setShowForm(false);
            if (standalone) dispatchAppIntent({ type: 'route.open', route: { section: 'research', page: 'opportunities', entityId: value.id } });
            else setDetail({ opportunity: value, evidence: evidence.map(item => item.evidence) });
            await load(token);
        })} />}
        {showCreate && detail && <OpportunityCreationDialog detail={detail} busy={busy} error={error} onClose={() => { setShowCreate(false); setError(''); }} onConfirm={createWork} />}
    </section>;
}
