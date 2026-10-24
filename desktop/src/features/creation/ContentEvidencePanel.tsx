import { useEffect, useRef, useState } from 'react';
import type { EvidenceSourceView, OpportunityDetail } from '../../../shared/contentIntelligence';

export const evidenceLabels = { verified: '可定位原文', stale: '来源已更新', missing: '来源不可用', unverifiable: '不可核验' };
export function EvidenceSource({ view, onClose }: { view: EvidenceSourceView; onClose: () => void }) {
    const segment = view.snapshot.segments.find(segment => segment.key === view.evidence.locator.key);
    return <section aria-label="原始来源快照" className="space-y-2 rounded border border-border bg-surface-secondary p-3 text-xs">
        <div className="flex justify-between gap-3"><strong className="min-w-0 break-words">{view.snapshot.title}</strong><button type="button" className="shrink-0" onClick={onClose}>关闭原文</button></div>
        <p>{view.snapshot.source.namespace} · {evidenceLabels[view.evidence.validity]} · 历史版本 {view.snapshot.version.slice(0, 12)}</p>
        <p className="break-all">定位：{view.evidence.locator.key}，字符 {view.evidence.locator.start}–{view.evidence.locator.end}</p>
        <p className="whitespace-pre-wrap break-words">{segment?.text || '原文片段不可用'}</p>
        {view.snapshot.sourceUrl && <a className="underline" href={view.snapshot.sourceUrl} target="_blank" rel="noreferrer">来源网页（可能已有更新）</a>}
        {view.current && view.current.version !== view.snapshot.version && <p>当前来源为新版本，以上历史依据保持原样，请复核。</p>}
    </section>;
}
export function OpportunityEvidence({ detail }: { detail: OpportunityDetail }) {
    const [view, setView] = useState<EvidenceSourceView | null>(null); const [error, setError] = useState(''); const epoch = useRef(0);
    useEffect(() => { epoch.current++; setView(null); setError(''); return () => { epoch.current++; }; }, [detail.opportunity.id]);
    return <div className="space-y-2 text-xs">
        {detail.inheritedFromWorkspaceId && <p>继承自来源工程 {detail.inheritedFromWorkspaceId} 的历史依据。副本内容须单独复核。</p>}
        {!detail.evidence.length && <p>用户假设，尚无消费者证据。</p>}
        {detail.evidence.map(evidence => <div key={evidence.id} className="space-y-1 rounded border border-border p-3">
            <p>{detail.opportunity.evidence.find(ref => ref.id === evidence.id)?.relation === 'contradicts' ? '反例' : detail.opportunity.evidence.find(ref => ref.id === evidence.id)?.relation === 'context' ? '背景' : '支持'} · {evidenceLabels[evidence.validity]} · {evidence.source.namespace}</p>
            <blockquote className="whitespace-pre-wrap break-words">{evidence.excerpt}</blockquote>
            <p>采集评论 {evidence.coverage.captured} 条{evidence.coverage.requested !== undefined ? ` / 请求 ${evidence.coverage.requested} 条` : ''} · {evidence.coverage.partial ? '部分样本' : '本次已采集样本'}</p>
            {evidence.coverage.issues.map((issue, index) => <p key={index}>{issue}</p>)}
            <button type="button" className="underline" onClick={async () => {
                const token = ++epoch.current;
                try { const result = await window.ipcRenderer.contentIntelligence.evidenceSource(evidence.id); if (token !== epoch.current) return; if (result.success === false) throw new Error(result.error); setView(result.data); setError(''); }
                catch (reason) { if (token === epoch.current) setError(String(reason)); }
            }}>打开原始来源与定位</button>
        </div>)}
        {error && <p role="alert">{error}</p>}
        {view && <EvidenceSource view={view} onClose={() => setView(null)} />}
    </div>;
}
export function ContentEvidencePanel({ workspaceId }: { workspaceId: string }) {
    const [open, setOpen] = useState(false); const [items, setItems] = useState<OpportunityDetail[]>([]); const [error, setError] = useState('');
    const epoch = useRef(0);
    useEffect(() => {
        const clear = () => { epoch.current++; setOpen(false); setItems([]); setError(''); };
        clear(); window.ipcRenderer.spaces.onChanged(clear);
        return () => { clear(); window.ipcRenderer.spaces.offChanged(clear); };
    }, [workspaceId]);
    return <div className="shrink-0 border-b border-border px-3 py-2 text-xs text-text-secondary">
        <button type="button" aria-expanded={open} onClick={async () => {
            if (open) { epoch.current++; setOpen(false); return; }
            const token = ++epoch.current; setOpen(true); setError('');
            try { const result = await window.ipcRenderer.contentIntelligence.workEvidence(workspaceId); if (token !== epoch.current) return; if (result.success === false) throw new Error(result.error); setItems(result.data); }
            catch (reason) { if (token === epoch.current) setError(String(reason)); }
        }}>创作依据{open ? ' ▴' : ' ▾'}</button>
        {open && <div className="max-h-72 space-y-3 overflow-y-auto pt-2">
            {error ? <p role="alert">{error}</p> : !items.length ? <p>此作品尚未关联消费者机会。</p> : items.map(item => <section key={item.opportunity.id}><h3 className="mb-2 font-semibold">{item.opportunity.title}</h3><OpportunityEvidence detail={item} /></section>)}
        </div>}
    </div>;
}
