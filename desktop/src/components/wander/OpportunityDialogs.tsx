import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { ContentEvidence, Opportunity, OpportunityDetail, SourceSnapshot } from '../../../shared/contentIntelligence';
import { CREATION_CAPABILITY_LABELS, supportsCreation, type CreationCapability } from '../../../shared/creationWorkspace';
import { PRODUCT_PLATFORM_LABELS, type ProductPlatform } from '../../../shared/productCreationTarget';
import { useDialogFocus } from '../../features/workbench/useDialogFocus';

export type OpportunityDraft = Pick<Opportunity, 'title' | 'problem' | 'audience' | 'angle'>;
export type BoundEvidence = { evidence: ContentEvidence; relation: Opportunity['evidence'][number]['relation'] };
export type EvidenceInput = { source: SourceSnapshot['source']; version: string; locator: ContentEvidence['locator']; excerpt: string };
export type OpportunitySelection = { platform: ProductPlatform; capability: CreationCapability; productId?: string };
const inputClass = 'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-[14px]';

export function ManualOpportunityDialog({ sources, busy, error, onClose, onBind, onSave }: {
    sources: SourceSnapshot[]; busy: boolean; error: string; onClose: () => void;
    onBind: (input: EvidenceInput, onBound: (evidence: ContentEvidence) => void) => void;
    onSave: (form: OpportunityDraft, evidence: BoundEvidence[]) => void;
}) {
    const close = () => { if (!busy) onClose(); };
    const ref = useDialogFocus(close);
    const [form, setForm] = useState<OpportunityDraft>({ title: '', problem: '', audience: '', angle: '' });
    const [sourceIndex, setSourceIndex] = useState('');
    const [segmentKey, setSegmentKey] = useState('');
    const [quote, setQuote] = useState('');
    const [relation, setRelation] = useState<BoundEvidence['relation']>('supports');
    const [evidence, setEvidence] = useState<BoundEvidence[]>([]);
    const source = sourceIndex === '' ? undefined : sources[Number(sourceIndex)];
    const segment = source?.segments.find(item => item.key === segmentKey);
    return <div className="workspace-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
        <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="manual-opportunity-title" aria-describedby="manual-opportunity-description" className="workspace-dialog opportunity-dialog">
            <header className="flex items-start justify-between gap-4"><div><h2 id="manual-opportunity-title" className="text-[20px] font-semibold">记录一个内容方向</h2><p id="manual-opportunity-description" className="mt-2 text-[14px] text-text-secondary">把观察到的问题记下来，之后再决定是否创作。暂时没有依据也可以保存。</p></div><button type="button" aria-label="关闭手动记录" className="workspace-icon-button" disabled={busy} onClick={close}><X size={18} /></button></header>
            <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); onSave(form, evidence); }}>
                {([
                    ['title', '给这个方向起个名字', '例如：小桌面也能轻松取物'],
                    ['problem', '消费者遇到了什么问题？', '例如：桌面小，收纳后反而更难找到东西'],
                    ['audience', '这件内容想帮助谁？', '例如：在家办公、桌面空间有限的人'],
                    ['angle', '准备从什么角度讲？', '例如：比较三种收纳方式的拿取体验'],
                ] as const).map(([key, label, placeholder]) => <label key={key} className="block text-[14px] font-medium">{label}<input className={inputClass + ' mt-2 font-normal'} required maxLength={4000} value={form[key]} placeholder={placeholder} disabled={busy} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
                <details className="opportunity-disclosure">
                    <summary>添加来源依据（可选）{evidence.length > 0 && ` · 已添加 ${evidence.length} 条`}</summary>
                    <div className="space-y-3 pt-4">
                        <label className="block text-[14px]">选择资料<select aria-label="证据来源" className={inputClass + ' mt-2'} value={sourceIndex} disabled={busy} onChange={event => { setSourceIndex(event.target.value); setSegmentKey(''); setQuote(''); }}><option value="">选择已保存的资料</option>{sources.map((item, index) => <option key={JSON.stringify(item.source)} value={index}>{item.title} · {item.source.namespace}</option>)}</select></label>
                        {!sources.length && <p className="text-[14px] text-text-secondary">{busy ? '正在读取资料…' : '当前空间还没有可引用的资料，可先保存为待验证假设。'}</p>}
                        {source && <><p className="text-[14px] text-text-secondary">采集评论 {source.coverage.captured} 条 · {source.coverage.partial ? '部分样本' : '本次已采集样本'}。{source.coverage.issues.join('；') || '仅代表本次已采集的范围。'}</p>
                            <label className="block text-[14px]">选择原文<select aria-label="原文片段" className={inputClass + ' mt-2'} value={segmentKey} disabled={busy} onChange={event => { setSegmentKey(event.target.value); setQuote(source.segments.find(item => item.key === event.target.value)?.text.slice(0, 2000) || ''); }}><option value="">选择一条评论或资料片段</option>{source.segments.map(item => <option key={item.key} value={item.key}>{item.kind === 'comment' ? '评论' : '资料'} · {item.text.slice(0, 100)}</option>)}</select></label>
                            {segment && <><label className="block text-[14px]">引用内容<textarea aria-label="引用原文" rows={3} className={inputClass + ' mt-2'} value={quote} maxLength={2000} disabled={busy} onChange={event => setQuote(event.target.value)} /></label>
                                <p className="text-[12px] text-text-secondary">已带入原文，可缩短为连续片段。单条最多 2000 字。</p>
                                <details className="text-[14px] text-text-secondary"><summary className="cursor-pointer">查看完整原文</summary><p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{segment.text}</p></details>
                                <div className="flex flex-wrap items-center gap-3"><label className="text-[14px]">这条依据是<select aria-label="证据关系" className={inputClass + ' mt-2'} value={relation} disabled={busy} onChange={event => setRelation(event.target.value as typeof relation)}><option value="supports">支持这个方向</option><option value="contradicts">反例或不同意见</option><option value="context">背景信息</option></select></label>
                                    <button type="button" className="workspace-secondary-button" disabled={busy || !quote.trim()} onClick={() => {
                                        const start = segment.text.indexOf(quote);
                                        onBind({ source: source.source, version: source.version, locator: { key: segment.key, start, end: start + quote.length }, excerpt: quote }, result => {
                                            setEvidence(old => [...old.filter(item => item.evidence.id !== result.id), { evidence: result, relation }]); setQuote('');
                                        });
                                    }}>绑定这条原文</button></div>
                            </>}
                        </>}
                        <p className="text-[14px] text-text-secondary">已绑定 {evidence.length} 条证据；没有支持证据的方向会标为待验证假设。</p>
                    </div>
                </details>
                {error && <p role="alert" className="workspace-error">{error}</p>}
                <footer className="opportunity-dialog-footer"><button type="button" className="workspace-secondary-button" disabled={busy} onClick={close}>取消</button><button type="submit" className="workspace-primary-button" disabled={busy}>{busy ? '正在处理…' : '保存机会'}</button></footer>
            </form>
        </section>
    </div>;
}

export function OpportunityCreationDialog({ detail, busy, error, onClose, onConfirm }: {
    detail: OpportunityDetail; busy: boolean; error: string; onClose: () => void; onConfirm: (selection: OpportunitySelection) => void;
}) {
    const close = () => { if (!busy) onClose(); };
    const ref = useDialogFocus(close);
    const [platform, setPlatform] = useState<ProductPlatform>('xiaohongshu');
    const [capability, setCapability] = useState<CreationCapability>('note-image');
    const products = [...new Map(detail.evidence.filter(item => item.source.kind === 'product').map(item => [item.source.id, item])).values()];
    const [productId, setProductId] = useState(products[0]?.source.id || '');
    const available = (target: string) => (Object.keys(CREATION_CAPABILITY_LABELS) as CreationCapability[]).filter(kind => kind !== 'dream-story' && supportsCreation(target, kind) && (!kind.startsWith('product-') || products.length > 0));
    return <div className="workspace-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
        <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="opportunity-creation-title" aria-describedby="opportunity-creation-description" className="workspace-dialog opportunity-dialog">
            <header className="flex items-start justify-between gap-4"><div><h2 id="opportunity-creation-title" className="text-[20px] font-semibold">把这个方向变成作品</h2><p id="opportunity-creation-description" className="mt-2 text-[14px] text-text-secondary">问题、受众、创作角度和依据会一起带入编辑器。</p></div><button type="button" aria-label="关闭机会创作" className="workspace-icon-button" disabled={busy} onClick={close}><X size={18} /></button></header>
            <p className="my-5 rounded-lg bg-surface-secondary p-3 text-[14px] font-medium">{detail.opportunity.title}</p>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-[14px] font-medium">发布到哪里<select aria-label="机会创作平台" className={inputClass + ' mt-2 font-normal'} value={platform} disabled={busy} onChange={event => { const value = event.target.value as ProductPlatform; setPlatform(value); if (!available(value).includes(capability)) setCapability(available(value)[0]); }}>{Object.entries(PRODUCT_PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value} disabled={!available(value).length}>{label}</option>)}</select></label>
                <label className="text-[14px] font-medium">制作什么内容<select aria-label="机会创作形式" className={inputClass + ' mt-2 font-normal'} value={capability} disabled={busy} onChange={event => setCapability(event.target.value as CreationCapability)}>{available(platform).map(value => <option key={value} value={value}>{CREATION_CAPABILITY_LABELS[value]}</option>)}</select></label></div>
            {capability.startsWith('product-') && products.length > 1 && <label className="mt-4 block text-[14px]">围绕哪个商品创作<select aria-label="机会创作商品" className={inputClass + ' mt-2'} value={productId} disabled={busy} onChange={event => setProductId(event.target.value)}>{products.map(item => <option key={item.source.id} value={item.source.id}>{item.source.namespace} · {item.excerpt.slice(0, 60)}</option>)}</select></label>}
            <p className="my-5 text-[14px] leading-relaxed text-text-secondary">{detail.opportunity.status !== 'accepted' && '确认后会采纳这个方向，并创建作品。'}{detail.opportunity.basis === 'hypothesis' ? '当前方向尚无消费者支持证据，作品中会保留“待验证假设”说明。' : '依据仅代表已采集样本，请在编辑时继续核对。'}</p>
            {!products.length && <p className="mb-5 text-[12px] text-text-secondary">商品视频、混剪与套图需要商品来源依据，绑定后可选。</p>}
            {error && <p role="alert" className="workspace-error">{error}</p>}
            <footer className="opportunity-dialog-footer"><button type="button" className="workspace-secondary-button" disabled={busy} onClick={close}>取消</button><button type="button" className="workspace-primary-button" disabled={busy} onClick={() => onConfirm({ platform, capability, ...(capability.startsWith('product-') ? { productId } : {}) })}>{busy ? '正在创建…' : detail.opportunity.status === 'accepted' ? '创建作品' : '采纳并创建作品'}<ArrowRight size={16} /></button></footer>
        </section>
    </div>;
}
