import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Terminal, FileEdit, Info, X, Check, Image as ImageIcon, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { resolveAssetUrl } from '../utils/pathManager';

interface ToolConfirmDialogProps {
    request: ToolConfirmRequest | null;
    onConfirm: (callId: string) => void;
    onCancel: (callId: string) => void;
    onReplan?: (callId: string) => void;
    isResolving?: boolean;
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

export function ToolConfirmDialog({ request, onConfirm, onCancel, onReplan, isResolving = false }: ToolConfirmDialogProps) {
    const [productReference, setProductReference] = useState<ProductReference | null>(null);
    const [voiceoverConfig, setVoiceoverConfig] = useState<{ configured: boolean; model: string; voiceId: string; reason?: string } | null>(null);

    useEffect(() => {
        setProductReference(null);
        setVoiceoverConfig(null);
        if (request?.name !== 'product_video_compose') return;
        let active = true;
        void window.ipcRenderer.videoEditorV2.getProductVoiceoverConfig().then((result) => {
            if (active) setVoiceoverConfig(result.success && result.config ? result.config : { configured: false, model: '', voiceId: '', reason: '无法读取语音配置' });
        }).catch(() => {
            if (active) setVoiceoverConfig({ configured: false, model: '', voiceId: '', reason: '无法读取语音配置' });
        });
        const productId = String(request.params?.productId || '').trim();
        if (productId) void window.ipcRenderer.brandWorkspace.getProductCreativeReference<{
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
    const isExecuting = request.status === 'executing' || isResolving;
    const isInvalidated = request.status === 'invalidated';
    const productDeleted = request.invalidation?.reason === 'product-deleted';
    const confirmationCopy = request.name === 'product_video_compose'
        ? {
            idle: '确认并创建工程',
            executing: '正在创建工程…',
        }
        : request.name === 'video_generate'
            ? {
                idle: '确认生成视频',
                executing: '正在提交生成…',
            }
            : {
                idle: '确认执行',
                executing: '正在执行…',
            };

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
                        {request.name === 'product_video_compose'
                            ? isInvalidated
                                ? isExecuting
                                    ? '正在按最新商品资料重新规划。新分镜需要再次确认后才会创建工程。'
                                    : '旧分镜已失效。请按最新资料重新规划，或重新选择商品。'
                                : isExecuting
                                    ? '已确认分镜，正在创建工程并提交已选的生成任务。'
                                    : '请核对分镜、素材和旁白。确认后才会创建工程并提交可能计费的生成任务。'
                            : request.name === 'video_generate'
                                ? '请核对生成描述和规格。只有点击确认后才会提交视频模型任务并消耗生成额度。'
                                : '检测到高风险或受限操作，执行前需要用户确认。'}
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
                            <p className="text-[10px] text-[#C05640]">旁白：{voiceoverConfig === null ? '正在检查语音配置…' : voiceoverConfig.configured ? `${proposalScenes.filter((scene) => String(scene.overlayText || '').trim()).length} 段语音任务 · ${voiceoverConfig.model} / ${voiceoverConfig.voiceId}` : `${voiceoverConfig.reason || '语音服务未配置'}；确认后仍会创建工程，旁白可稍后生成`}</p>
                            {productSpecification && <p className="text-[10px] text-text-tertiary">规格：{productSpecification}</p>}
                            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                                {proposalScenes.map((scene, index) => {
                                    const assets = productReference?.assets.filter((item) => scene.productAssetIds.includes(item.id)) || [];
                                    return (
                                        <div key={scene.id} className="flex gap-2 rounded-xl border border-border bg-surface-secondary p-2">
                                            <div className={clsx(
                                                'grid h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/80',
                                                assets.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
                                            )}>
                                                {assets.length > 0
                                                    ? assets.map((asset) => (
                                                        <img
                                                            key={asset.id}
                                                            src={resolveAssetUrl(asset.previewUrl)}
                                                            alt={`${scene.title} · ${asset.role}`}
                                                            className="h-full min-h-0 w-full object-cover"
                                                        />
                                                    ))
                                                    : <ImageIcon className="h-4 w-4 text-white/40" />}
                                            </div>
                                            <div className="min-w-0 flex-1 py-0.5">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-bold text-text-tertiary">{index + 1}</span>
                                                    <p className="truncate text-xs font-semibold text-text-primary">{scene.title}</p>
                                                </div>
                                                <p className="mt-1 text-[10px] text-text-tertiary">{(scene.durationMs / 1000).toFixed(1)} 秒 · {scene.source === 'ai-motion' ? 'AI 动效' : '原始素材'} · {assets.map((asset) => asset.role).join(' + ') || '图片'}</p>
                                                {scene.overlayText && <p className="mt-1 line-clamp-2 text-[10px] text-text-secondary">文字：{scene.overlayText}</p>}
                                                {scene.overlayText && <p className="mt-1 line-clamp-2 text-[10px] text-[#C05640]">将朗读：{scene.overlayText}</p>}
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
                    {request.details.warnings && request.details.warnings.length > 0 && (
                        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                需人工核对（不阻止创建）
                            </div>
                            <ul className="space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-400">
                                {request.details.warnings.map((warning, index) => (
                                    <li key={`${index}-${warning}`} className="list-disc leading-relaxed">{warning}</li>
                                ))}
                            </ul>
                        </div>
                    )}
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

            {isInvalidated && <div className="px-4 py-3 text-sm text-amber-700 dark:text-amber-300" role="status">
                {productDeleted ? '商品已删除，旧分镜已失效。请关闭此卡并重新选择商品。' : '商品资料已更新，旧分镜已失效。按最新资料重新规划后，需要再次确认。'}
            </div>}
            <div className="px-4 py-3 bg-surface-secondary border-t border-border flex items-center justify-end gap-2">
                    <button
                        onClick={() => onCancel(request.callId)}
                        disabled={isExecuting}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary bg-surface-primary border border-border rounded-xl hover:bg-surface-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <X className="w-4 h-4" />
                        取消
                    </button>
                    <button
                        onClick={() => isInvalidated ? onReplan?.(request.callId) : onConfirm(request.callId)}
                        disabled={isExecuting || (isInvalidated ? productDeleted || !onReplan : request.name === 'product_video_compose' && voiceoverConfig === null)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-accent-primary hover:bg-accent-primary/90 rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Check className="w-4 h-4" />
                        {isInvalidated ? (isExecuting ? '正在重新规划…' : '按最新资料重新规划') : isExecuting ? confirmationCopy.executing : confirmationCopy.idle}
                    </button>
            </div>
        </div>
    );
}
