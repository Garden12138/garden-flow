import { useEffect, useState } from 'react';
import type { ProductLink, ProductLinkCandidate } from '../../../shared/productLinks';

type ProductSummary = { id: string; name: string; updatedAt: string; platform?: string };

export function ProductLinksPanel({ product, links, products, onChanged, onOpen }: {
    product: ProductSummary;
    links: ProductLink[];
    products: ProductSummary[];
    onChanged: () => Promise<void>;
    onOpen: (id: string) => void;
}) {
    const [candidates, setCandidates] = useState<ProductLinkCandidate[]>([]);
    const [sourceVersion, setSourceVersion] = useState(product.updatedAt);
    const [manualId, setManualId] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const bridge = window.ipcRenderer.brandWorkspace;
    const relatedIds = new Set(links.flatMap((link) => link.productIds).filter((id) => id !== product.id));
    const choices = products.filter((item) => item.id !== product.id && !relatedIds.has(item.id));
    const platformName = (value?: string) => ({ jd: '京东', taobao: '淘宝', tmall: '天猫' } as Record<string, string>)[value || ''] || value || '人工资料';

    useEffect(() => {
        setCandidates([]);
        setManualId('');
        setMessage('');
        setError('');
        setSourceVersion(product.updatedAt);
    }, [product.id, product.updatedAt]);

    const findMatches = async () => {
        setBusy(true); setError(''); setMessage(''); setCandidates([]);
        try {
            const result = await bridge.suggestProductLinks({ productId: product.id });
            if (!result?.success) throw new Error(result?.error || '同款推荐失败，可手动关联');
            setCandidates(result.candidates || []);
            setSourceVersion(result.productVersion || product.updatedAt);
            setMessage(result.candidates?.length ? `由 ${result.modelName || '当前文本模型'} 提供建议，确认后建立同款关系。` : '没有找到有充分依据的同款，可手动选择商品。');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '同款推荐失败'); }
        finally { setBusy(false); }
    };

    const link = async (candidate: ProductLinkCandidate, version = sourceVersion) => {
        setBusy(true); setError('');
        try {
            const result = await bridge.linkProducts({ productId: product.id, relatedProductId: candidate.productId, productVersion: version, relatedProductVersion: candidate.productVersion, reason: candidate.reason });
            if (!result?.success) throw new Error(result?.error || '关联失败');
            setCandidates((current) => current.filter((item) => item.productId !== candidate.productId));
            setManualId('');
            await onChanged();
            setMessage('已建立同款关系，两份商品资料独立保留。');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '关联失败'); }
        finally { setBusy(false); }
    };

    const unlink = async (relatedProductId: string) => {
        setBusy(true); setError('');
        try {
            const result = await bridge.unlinkProducts({ productId: product.id, relatedProductId });
            if (!result?.success) throw new Error(result?.error || '解除关联失败');
            await onChanged();
        } catch (cause) { setError(cause instanceof Error ? cause.message : '解除关联失败'); }
        finally { setBusy(false); }
    };

    return (
        <section className="space-y-3 rounded-xl border border-border bg-surface-primary p-4" aria-label="同款商品">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-text-primary">同款商品</h3>
                    <p className="mt-1 text-xs text-text-secondary">各平台商品资料独立保存，可通过同款关系互相查看。</p>
                </div>
                <button type="button" disabled={busy || choices.length === 0} onClick={() => void findMatches()} className="shrink-0 rounded-lg bg-accent-primary px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? '处理中…' : 'AI 查找同款'}</button>
            </div>
            {links.map((relation) => {
                const id = relation.productIds.find((value) => value !== product.id)!;
                const related = products.find((item) => item.id === id);
                if (!related) return null;
                return <div key={relation.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary p-3">
                    <button type="button" onClick={() => onOpen(id)} className="min-w-0 text-left text-sm text-text-primary"><span className="block font-medium">{related.name} · {platformName(related.platform)}</span><span className="mt-1 block text-xs text-text-secondary">{relation.reason}</span></button>
                    <button type="button" disabled={busy} onClick={() => void unlink(id)} className="shrink-0 text-xs text-text-secondary disabled:opacity-50">解除关联</button>
                </div>;
            })}
            {message && <p role="status" className="text-xs text-text-secondary">{message}</p>}
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            {candidates.filter((item) => !relatedIds.has(item.productId)).map((candidate) => <div key={candidate.productId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0"><p className="text-sm text-text-primary">{candidate.name} · {platformName(candidate.platform)}</p><p className="mt-1 text-xs text-text-secondary">{candidate.reason}</p></div>
                <button type="button" disabled={busy} onClick={() => void link(candidate)} className="shrink-0 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-text-primary disabled:opacity-50">确认关联</button>
            </div>)}
            <div className="flex gap-2">
                <select aria-label="手动选择同款商品" value={manualId} disabled={busy} onChange={(event) => setManualId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-surface-primary px-3 py-2 text-xs text-text-primary">
                    <option value="">手动选择商品…</option>
                    {choices.map((item) => <option key={item.id} value={item.id}>{item.name} · {platformName(item.platform)}</option>)}
                </select>
                <button type="button" disabled={busy || !manualId} onClick={() => {
                    const chosen = choices.find((item) => item.id === manualId);
                    if (chosen) void link({ productId: chosen.id, productVersion: chosen.updatedAt, name: chosen.name, reason: '用户手动确认同款' }, product.updatedAt);
                }} className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-text-primary disabled:opacity-50">确认关联</button>
            </div>
        </section>
    );
}
