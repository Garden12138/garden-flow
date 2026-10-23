import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentEvidence, Opportunity, OpportunityDetail, OpportunityStatus, SourceSnapshot, CiResult } from '../../../shared/contentIntelligence';
import { canTransitionOpportunity } from '../../../shared/contentIntelligence';
import { CREATION_CAPABILITY_LABELS, supportsCreation, type CreationCapability } from '../../../shared/creationWorkspace';
import { PRODUCT_PLATFORM_LABELS, type ProductPlatform } from '../../../shared/productCreationTarget';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';
import { OpportunityEvidence } from '../../features/creation/ContentEvidencePanel';

const statusLabels: Record<OpportunityStatus, string> = { proposed: '待采用', accepted: '已采用', needs_evidence: '需要证据', dismissed: '已忽略', archived: '已归档' };
const inputClass = 'w-full rounded border border-border bg-surface-primary p-2 text-sm';
const buttonClass = 'rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-secondary disabled:opacity-40';
function resultData<T>(result: CiResult<T>): T { if (result.success === false) throw new Error(result.error); return result.data; }
export function ContentOpportunitiesPanel() {
    const [items, setItems] = useState<Opportunity[]>([]); const [next, setNext] = useState<string>(); const [sources, setSources] = useState<SourceSnapshot[]>([]);
    const [status, setStatus] = useState<OpportunityStatus | ''>(''); const [detail, setDetail] = useState<OpportunityDetail | null>(null);
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ title: '', problem: '', audience: '', angle: '' });
    const [sourceIndex, setSourceIndex] = useState(''); const [segmentKey, setSegmentKey] = useState(''); const [quote, setQuote] = useState('');
    const [relation, setRelation] = useState<'supports' | 'contradicts' | 'context'>('supports'); const [evidence, setEvidence] = useState<Array<{ evidence: ContentEvidence; relation: typeof relation }>>([]);
    const [platform, setPlatform] = useState<ProductPlatform>('xiaohongshu'); const [capability, setCapability] = useState<CreationCapability>('note-image');
    const epoch = useRef(0); const pending = useRef(false); const requests = useRef(new Map<string, { intent: string; id: string }>());
    const requestId = (slot: string, input: unknown) => {
        const intent = JSON.stringify(input); const old = requests.current.get(slot);
        if (old?.intent === intent) return old.id;
        const id = crypto.randomUUID(); requests.current.set(slot, { intent, id }); return id;
    };
    const load = useCallback(async (token: number, after?: string) => {
        const result = resultData(await window.ipcRenderer.contentIntelligence.list({ ...(status ? { status } : {}), after }));
        if (token !== epoch.current) return;
        setItems(old => after ? [...old, ...result.items] : result.items); setNext(result.next);
    }, [status]);
    useEffect(() => {
        const token = ++epoch.current; setItems([]); setDetail(null); setError('');
        void load(token).catch(reason => { if (token === epoch.current) setError(String(reason)); });
    }, [load]);
    useEffect(() => {
        const clear = () => { epoch.current++; pending.current = false; requests.current.clear(); setItems([]); setNext(undefined); setSources([]); setDetail(null); setEvidence([]); setQuote(''); setForm({ title: '', problem: '', audience: '', angle: '' }); setShowForm(false); setSourceIndex(''); setSegmentKey(''); setError(''); setBusy(false); };
        window.ipcRenderer.spaces.onChanged(clear);
        return () => { epoch.current++; window.ipcRenderer.spaces.offChanged(clear); };
    }, []);
    async function act(operation: (token: number) => Promise<void>) {
        if (pending.current) return; const token = epoch.current; pending.current = true; setBusy(true); setError('');
        try { await operation(token); } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) { pending.current = false; setBusy(false); } }
    }
    const source = sources[Number(sourceIndex)]; const segment = source?.segments.find(segment => segment.key === segmentKey);
    return <section aria-label="消费者机会" className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4 text-text-primary">
        <div className="mb-4 flex flex-wrap items-center gap-3"><div className="flex-1"><h2 className="text-lg font-semibold">消费者机会</h2><p className="text-xs text-text-secondary">用当前空间已入库资料保留依据，采纳后进入创作。</p></div>
            <select aria-label="机会状态" value={status} onChange={event => setStatus(event.target.value as typeof status)} disabled={busy} className={inputClass + ' max-w-40'}><option value="">全部状态</option>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(async token => { await load(token); })}>刷新</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(async token => { const result = resultData(await window.ipcRenderer.contentIntelligence.sources()); if (token !== epoch.current) return; setSources(result); setShowForm(true); })}>手动新建机会</button>
        </div>
        {error && <p role="alert" className="mb-3 rounded border border-red-400 p-3 text-sm">{error}</p>}
        {showForm && <form className="mb-4 space-y-3 rounded border border-border p-4" onSubmit={event => {
            event.preventDefault(); void act(async token => {
                const input = { ...form, evidence: evidence.map(item => ({ id: item.evidence.id, relation: item.relation })) };
                const result = resultData(await window.ipcRenderer.contentIntelligence.createOpportunity({ ...input, requestId: requestId('manual', input) }));
                if (token !== epoch.current) return; setShowForm(false); setEvidence([]); setForm({ title: '', problem: '', audience: '', angle: '' }); setDetail({ opportunity: result, evidence: evidence.map(item => item.evidence) }); await load(token);
            });
        }}>
            <h3 className="font-semibold">新机会与依据</h3>
            {(['title', 'problem', 'audience', 'angle'] as const).map((key, index) => <label key={key} className="block text-xs">{['标题', '消费者问题或假设', '受众', '创作角度'][index]}<input required maxLength={4000} value={form[key]} disabled={busy} onChange={event => setForm({ ...form, [key]: event.target.value })} className={inputClass} /></label>)}
            <label className="block text-xs">来源<select aria-label="证据来源" className={inputClass} value={sourceIndex} disabled={busy} onChange={event => { setSourceIndex(event.target.value); setSegmentKey(''); setQuote(''); }}><option value="">选择来源；无来源时保存为假设</option>{sources.map((source, index) => <option key={index} value={index}>{source.title} · {source.source.namespace} · 评论 {source.coverage.captured} 条{source.coverage.partial ? ' · 部分采集' : ''}</option>)}</select></label>
            {source && sourceIndex !== '' && <><p className="text-xs">{source.coverage.issues.join('；') || '仅代表本次已采集样本'}</p>
                <select aria-label="原文片段" value={segmentKey} disabled={busy} onChange={event => { setSegmentKey(event.target.value); setQuote(''); }} className={inputClass}><option value="">选择一条评论或事实</option>{source.segments.map(segment => <option key={segment.key} value={segment.key}>{segment.kind === 'comment' ? '评论' : '资料'} · {segment.text.slice(0, 100)}</option>)}</select>
                {segment && <><p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs">{segment.text}</p><textarea aria-label="引用原文" placeholder="粘贴上述原文中的连续片段，最多 2000 字" value={quote} maxLength={2000} disabled={busy} onChange={event => setQuote(event.target.value)} className={inputClass} />
                    <select aria-label="证据关系" value={relation} onChange={event => setRelation(event.target.value as typeof relation)} disabled={busy} className={inputClass}><option value="supports">支持</option><option value="contradicts">反例</option><option value="context">背景</option></select>
                    <button type="button" className={buttonClass} disabled={busy || !quote.trim()} onClick={() => void act(async token => {
                        const start = segment.text.indexOf(quote); if (start < 0) throw new Error('引用必须与原文中的连续片段一致');
                        const result = resultData(await window.ipcRenderer.contentIntelligence.addEvidence({ source: source.source, version: source.version, locator: { key: segment.key, start, end: start + quote.length }, excerpt: quote }));
                        if (token !== epoch.current) return; setEvidence(old => [...old.filter(item => item.evidence.id !== result.id), { evidence: result, relation }]); setQuote('');
                    })}>绑定这条原文</button></>}
            </>}
            <p className="text-xs">已绑定 {evidence.length} 条证据；没有支持证据的机会会标为假设。</p>
            <div className="flex gap-2"><button type="submit" disabled={busy} className={buttonClass}>保存机会</button><button type="button" disabled={busy} className={buttonClass} onClick={() => setShowForm(false)}>收起</button></div>
        </form>}
        <div className="grid min-h-0 gap-4 lg:grid-cols-2">
            <div className="space-y-2">{!items.length && <p className="rounded border border-dashed border-border p-6 text-sm">还没有符合条件的机会。先采集资料，或手动记录需要验证的假设。</p>}
                {items.map(item => <button type="button" disabled={busy} key={item.id} onClick={() => void act(async token => { const result = resultData(await window.ipcRenderer.contentIntelligence.detail(item.id)); if (token === epoch.current) setDetail(result); })} className="block w-full rounded border border-border p-4 text-left hover:bg-surface-secondary"><h3 className="font-semibold">{item.title}</h3><p className="mt-1 text-xs">{statusLabels[item.status]} · {item.basis === 'hypothesis' ? '待验证假设' : '有样本依据'} · {item.evidence.length} 条证据</p><p className="mt-2 text-sm text-text-secondary">{item.problem}</p></button>)}
                {next && <button type="button" disabled={busy} onClick={() => void act(token => load(token, next))} className={buttonClass}>加载更多</button>}
            </div>
            {detail && <section aria-label="机会详情" className="space-y-3 rounded border border-border p-4"><h3 className="font-semibold">{detail.opportunity.title}</h3><p className="text-sm">受众：{detail.opportunity.audience}</p><p className="text-sm">角度：{detail.opportunity.angle}</p>
                <div className="flex flex-wrap gap-2">{Object.entries(statusLabels).filter(([to]) => canTransitionOpportunity(detail.opportunity.status, to as OpportunityStatus)).map(([to, label]) => <button type="button" key={to} disabled={busy} className={buttonClass} onClick={() => void act(async token => {
                    const input = { id: detail.opportunity.id, expectedRevision: detail.opportunity.revision, to: to as OpportunityStatus };
                    resultData(await window.ipcRenderer.contentIntelligence.transition({ ...input, requestId: requestId('transition', input) })); if (token !== epoch.current) return;
                    const updated = resultData(await window.ipcRenderer.contentIntelligence.detail(input.id)); if (token !== epoch.current) return; setDetail(updated); await load(token);
                })}>{to === 'accepted' ? '采纳' : to === 'dismissed' ? '忽略' : to === 'archived' ? '归档' : to === 'proposed' ? '重新打开' : label}</button>)}</div>
                <OpportunityEvidence detail={detail} />
                <div className="flex flex-wrap gap-2 border-t border-border pt-3"><select aria-label="机会创作平台" className={inputClass} disabled={busy} value={platform} onChange={event => { const value = event.target.value as ProductPlatform; setPlatform(value); if (!supportsCreation(value, capability)) setCapability('product-video'); }}>{Object.entries(PRODUCT_PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <select aria-label="机会创作形式" className={inputClass} disabled={busy} value={capability} onChange={event => setCapability(event.target.value as CreationCapability)}>{Object.entries(CREATION_CAPABILITY_LABELS).filter(([value]) => value !== 'dream-story' && supportsCreation(platform, value as CreationCapability)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <button type="button" className={buttonClass} disabled={busy || detail.opportunity.status !== 'accepted'} onClick={() => void act(async token => {
                        const input = { opportunityId: detail.opportunity.id, expectedRevision: detail.opportunity.revision, selection: { platform, capability } };
                        const result = resultData(await window.ipcRenderer.contentIntelligence.createWork({ ...input, requestId: requestId('work', input) }));
                        if (token === epoch.current) dispatchAppIntent({ type: 'creation.open', workspaceId: result.workspace.id });
                    })}>确认目标并基于此创作</button>
                </div>
            </section>}
        </div>
    </section>;
}
