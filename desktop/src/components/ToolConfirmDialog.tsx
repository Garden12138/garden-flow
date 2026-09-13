import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Terminal, FileEdit, Info, X, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { resolveAssetUrl } from '../utils/pathManager';

interface ToolConfirmDialogProps {
    request: ToolConfirmRequest | null;
    onConfirm: (callId: string) => void;
    onCancel: (callId: string) => void;
}

const TYPE_ICONS = {
    exec: Terminal,
    edit: FileEdit,
    info: Info,
};

const TYPE_COLORS = {
    exec: 'border-yellow-500/50 bg-yellow-500/5',
    edit: 'border-blue-500/50 bg-blue-500/5',
    info: 'border-gray-500/50 bg-gray-500/5',
};

type ProductReference = {
    id: string;
    name: string;
    skus?: Array<{ id: string; name: string; variantText?: string }>;
    assets: Array<{ id: string; role: string; origin: string; previewUrl: string }>;
};

type ProductProposalScene = {
    id: string;
    title: string;
    durationMs: number;
    source: 'product-asset' | 'ai-motion';
    productAssetIds: string[];
    overlayText?: string;
    generationPrompt?: string;
};

export function ToolConfirmDialog({ request, onConfirm, onCancel }: ToolConfirmDialogProps) {
    const [productReference, setProductReference] = useState<ProductReference | null>(null);

    useEffect(() => {
        setProductReference(null);
        if (request?.name !== 'product_video_compose') return;
        const productId = String(request.params?.productId || '').trim();
        if (!productId) return;
        let active = true;
        void window.ipcRenderer.brandWorkspace.getProductCreativeReference<{
            success?: boolean;
            product?: ProductReference;
        }>({ id: productId }).then((result) => {
            if (active && result.success && result.product) setProductReference(result.product);
        }).catch(() => undefined);
        return () => {
            active = false;
        };
    }, [request]);

    const proposalScenes = useMemo(() => (
        Array.isArray(request?.params?.scenes)
            ? request.params.scenes.filter((scene): scene is ProductProposalScene => Boolean(scene && typeof scene === 'object'))
            : []
    ), [request]);

    if (!request) return null;

    const Icon = TYPE_ICONS[request.details.type] || AlertTriangle;
    const colorClass = TYPE_COLORS[request.details.type] || TYPE_COLORS.info;
    const productSpecification = productReference?.skus
        ?.map((sku) => String(sku.variantText || sku.name || '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ');

    return (
        <div className={clsx(
            'mb-3 w-full rounded-2xl border shadow-sm overflow-hidden',
            colorClass,
        )}>
            <div className="px-4 py-3 bg-surface-primary/90 border-b border-border flex items-start gap-3">
                <div className="mt-0.5 p-2 rounded-lg bg-surface-primary border border-border">
                    <Icon className="w-4 h-4 text-yellow-500" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-text-primary">
                            {request.details.title}
                        </h3>
                        <span className="rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[11px] text-text-tertiary">
                            {request.name}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">
                        检测到高风险或受限操作，执行前需要用户确认。
                    </p>
                </div>
            </div>

            <div className="px-4 py-3 bg-surface-primary">
                <div className="space-y-3">
                    {request.name === 'product_video_compose' && proposalScenes.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-text-primary">{productReference?.name || String(request.params?.productName || '商品')}</span>
                                <span className="text-text-tertiary">{proposalScenes.filter((scene) => scene.source === 'ai-motion').length} 个 AI 镜头</span>
                            </div>
                            {productSpecification && <p className="text-[10px] text-text-tertiary">规格：{productSpecification}</p>}
                            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                                {proposalScenes.map((scene, index) => {
                                    const asset = productReference?.assets.find((item) => scene.productAssetIds.includes(item.id));
                                    return (
                                        <div key={scene.id} className="flex gap-2 rounded-xl border border-border bg-surface-secondary p-2">
                                            <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/80">
                                                {asset?.previewUrl
                                                    ? <img src={resolveAssetUrl(asset.previewUrl)} alt={scene.title} className="h-full w-full object-cover" />
                                                    : <ImageIcon className="h-4 w-4 text-white/40" />}
                                            </div>
                                            <div className="min-w-0 flex-1 py-0.5">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-bold text-text-tertiary">{index + 1}</span>
                                                    <p className="truncate text-xs font-semibold text-text-primary">{scene.title}</p>
                                                </div>
                                                <p className="mt-1 text-[10px] text-text-tertiary">{(scene.durationMs / 1000).toFixed(1)} 秒 · {scene.source === 'ai-motion' ? 'AI 动效' : '原始素材'} · {asset?.role || '图片'}</p>
                                                {scene.overlayText && <p className="mt-1 line-clamp-2 text-[10px] text-text-secondary">文字：{scene.overlayText}</p>}
                                                {scene.source === 'ai-motion' && <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700"><Sparkles className="h-3 w-3" />参考图生成，无内置音频</p>}
                                                {scene.source === 'ai-motion' && scene.generationPrompt && <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-text-secondary">生成描述：{scene.generationPrompt}</p>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className="text-xs text-text-secondary whitespace-pre-wrap font-mono bg-surface-secondary p-3 rounded-xl border border-border max-h-40 overflow-auto">
                        {request.details.description}
                    </div>
                    {request.details.impact && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
                            <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-yellow-700 dark:text-yellow-400">
                                {request.details.impact}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="px-4 py-3 bg-surface-secondary border-t border-border flex items-center justify-end gap-2">
                    <button
                        onClick={() => onCancel(request.callId)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary bg-surface-primary border border-border rounded-xl hover:bg-surface-secondary transition-colors"
                    >
                        <X className="w-4 h-4" />
                        取消
                    </button>
                    <button
                        onClick={() => onConfirm(request.callId)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/90 rounded-xl transition-colors"
                    >
                        <Check className="w-4 h-4" />
                        确认执行
                    </button>
            </div>
        </div>
    );
}
