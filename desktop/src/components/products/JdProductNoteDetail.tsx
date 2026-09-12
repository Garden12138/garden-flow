import { useEffect, useState } from 'react';
import { ExternalLink, MessageCircle, Trash2, X } from 'lucide-react';
import type { Note } from '../../features/knowledge/knowledgeModel';
import { cleanJdProductTitle, jdProductNoteSource } from '../../features/knowledge/jdProductNote';
import { ProductSourcePreview, type ProductPreviewImage, type ProductPreviewSnapshot } from './ProductSourcePreview';

type CapturedBundle = {
    assets: ProductPreviewImage[];
    sourceSnapshots?: Array<ProductPreviewSnapshot & { platform: string; imageAssetIds: string[] }>;
};

export function JdProductNoteDetail({ note, onClose, onChat, onRemove }: {
    note: Note;
    onClose: () => void;
    onChat: () => void;
    onRemove: () => void;
}) {
    const source = jdProductNoteSource(note)!;
    const [captured, setCaptured] = useState<{ snapshot: ProductPreviewSnapshot; images: ProductPreviewImage[] } | null>(null);
    useEffect(() => {
        let cancelled = false;
        void window.ipcRenderer.brandWorkspace.list<Array<{ products: CapturedBundle[] }>>().then((brands) => {
            const matches = brands.flatMap((brand) => brand.products).flatMap((bundle) => (bundle.sourceSnapshots || [])
                .filter((snapshot) => snapshot.platform === 'jd' && snapshot.captureVersion === 2 && (snapshot.selectedSku?.externalId === source.skuId || jdProductNoteSource(snapshot)?.skuId === source.skuId))
                .map((snapshot) => ({ snapshot, images: snapshot.imageAssetIds.flatMap((id) => bundle.assets.find((image) => image.id === id) || []) })));
            matches.sort((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt));
            if (!cancelled) setCaptured(matches[0] || null);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [source.skuId]);
    const snapshot = captured?.snapshot || {
        title: cleanJdProductTitle(note.title),
        externalId: source.skuId,
        sourceUrl: source.url,
        capturedAt: note.createdAt,
        parameters: [],
        missingFields: [],
    };
    const images = captured?.images || note.images.map((path, index) => ({ id: String(index), path }));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[6px]" onClick={onClose}>
            <div className="flex max-h-[90vh] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="京东商品资料" onClick={(event) => event.stopPropagation()}>
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-6 py-4">
                    <span className="text-sm font-semibold text-text-primary">京东 · 商品资料</span>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void window.ipcRenderer.openExternalUrl(source.url)} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-secondary px-3 py-2 text-xs text-text-secondary"><ExternalLink className="h-3.5 w-3.5" />打开京东原页</button>
                        <button type="button" onClick={onChat} aria-label="商品资料聊天" className="rounded-lg bg-accent-primary p-2 text-white"><MessageCircle className="h-4 w-4" /></button>
                        <button type="button" onClick={onClose} aria-label="关闭预览" className="rounded-lg bg-surface-secondary p-2 text-text-secondary"><X className="h-4 w-4" /></button>
                    </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    <ProductSourcePreview snapshot={snapshot} images={images} legacy={!captured} rawText={note.content} />
                </div>
                <footer className="flex shrink-0 items-center justify-between border-t border-black/[0.06] px-6 py-4 text-xs text-text-tertiary">
                    <span>保存于 {new Date(note.createdAt).toLocaleString()}</span>
                    <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />移除记录</button>
                </footer>
            </div>
        </div>
    );
}
