import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Star, Video } from 'lucide-react';
import { resolveAssetUrl } from '../../utils/pathManager';

export interface ProductPreviewSnapshot {
    captureVersion?: number;
    title: string;
    externalId: string;
    sourceUrl: string;
    capturedAt: string;
    brandName?: string;
    shopName?: string;
    description?: string;
    selectedSku?: { externalId?: string; name?: string; variantText?: string };
    price?: { text: string; currency?: string; label?: string };
    parameters: Array<{ key: string; value: string }>;
    detailText?: string;
    reviewCapture?: {
        modalDetected: boolean;
        status: 'not-opened' | 'ready' | 'complete' | 'partial';
        availableFilters: Array<{
            id: string;
            label: string;
            countText?: string;
            sentiment?: 'positive' | 'neutral' | 'negative';
        }>;
        selectedFilters: Array<{ id: string; label: string; limit: number }>;
        results: Array<{
            filterId: string;
            label: string;
            requested: number;
            captured: number;
            status: 'complete' | 'partial' | 'missing';
            warning?: string;
            captureAll?: boolean;
        }>;
        reviews: Array<{
            id: string;
            authorName?: string;
            text: string;
            merchantReply?: string;
            rating?: number;
            sentiment?: 'positive' | 'neutral' | 'negative';
            matchedFilterIds: string[];
            dateText?: string;
            skuText?: string;
            badges?: string[];
            helpfulCount?: number;
            imageAssetIds: string[];
            video?: { present: true; sourceUrl?: string };
        }>;
        warnings: string[];
        sortText?: string;
        scopeText?: string;
    };
    missingFields: string[];
}

export interface ProductPreviewImage {
    id: string;
    path: string;
    role?: string;
}

export function ProductSourcePreview({ snapshot, images, reviewImages = [], legacy = false, rawText }: {
    snapshot: ProductPreviewSnapshot;
    images: ProductPreviewImage[];
    reviewImages?: ProductPreviewImage[];
    legacy?: boolean;
    rawText?: string;
}) {
    const [imageIndex, setImageIndex] = useState(0);
    const [reviewFilterId, setReviewFilterId] = useState('all');
    const [rejectedImages, setRejectedImages] = useState<Set<string>>(() => new Set());
    const imageIdentity = images.map((image) => image.path).join('\n');
    useEffect(() => {
        setImageIndex(0);
        setRejectedImages(new Set());
        setReviewFilterId('all');
    }, [imageIdentity, snapshot.capturedAt]);
    const availableImages = useMemo(() => images.filter((image) => !rejectedImages.has(image.path)), [images, rejectedImages]);
    const activeImage = availableImages[Math.min(imageIndex, availableImages.length - 1)];
    const rejectImage = (path: string) => setRejectedImages((current) => new Set([...current, path]));
    const facts = [
        ['品牌', snapshot.brandName],
        ['店铺', snapshot.shopName],
        ['当前规格', snapshot.selectedSku?.variantText || '未识别'],
        ['商品编号', snapshot.selectedSku?.externalId || snapshot.externalId],
    ].filter(([, value]) => value);
    const reviewCapture = snapshot.reviewCapture;
    const filterLabels = new Map((reviewCapture?.availableFilters || []).map((filter) => [filter.id, filter.label]));
    const reviewImageMap = new Map(reviewImages.map((image) => [image.id, image]));
    const filteredReviews = (reviewCapture?.reviews || []).filter((review) => (
        reviewFilterId === 'all' || review.matchedFilterIds.includes(reviewFilterId)
    ));

    return (
        <div className="space-y-5 text-text-primary">
            {legacy && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    这条记录由旧版网页采集保存，缺少结构化商品资料。打开京东原页，在插件中重新识别并保存，即可在资产库查看完整商品资料。
                </div>
            )}
            <div className="grid gap-5 md:grid-cols-2">
                <div className="min-w-0">
                    <div className="flex aspect-square max-h-[420px] items-center justify-center overflow-hidden rounded-xl border border-black/[0.06] bg-white p-4">
                        {activeImage ? (
                            <img
                                key={activeImage.path}
                                src={resolveAssetUrl(activeImage.path)}
                                alt={snapshot.title}
                                className="block h-auto max-h-full w-auto max-w-full object-contain"
                                onError={() => rejectImage(activeImage.path)}
                                onLoad={(event) => {
                                    const image = event.currentTarget;
                                    if (legacy && (image.naturalWidth < 160 || image.naturalHeight < 160)) rejectImage(activeImage.path);
                                }}
                            />
                        ) : (
                            <div className="space-y-2 text-center text-sm text-text-tertiary">
                                <ImageIcon className="mx-auto h-8 w-8 opacity-40" />
                                <p>{legacy ? '暂无可预览的商品大图' : '暂无已保存商品图片'}</p>
                            </div>
                        )}
                    </div>
                    {availableImages.length > 1 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="商品图片">
                            {availableImages.map((image, index) => (
                                <button
                                    key={image.id}
                                    type="button"
                                    onClick={() => setImageIndex(index)}
                                    aria-label={`查看${image.role === 'detail' ? '详情' : '商品'}图 ${index + 1}`}
                                    aria-pressed={image.path === activeImage?.path}
                                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-white p-1 ${image.path === activeImage?.path ? 'border-accent-primary ring-1 ring-accent-primary' : 'border-black/10'}`}
                                >
                                    <img src={resolveAssetUrl(image.path)} alt="" className="h-full w-full object-contain" onError={() => rejectImage(image.path)} onLoad={(event) => {
                                        const node = event.currentTarget;
                                        if (legacy && (node.naturalWidth < 160 || node.naturalHeight < 160)) rejectImage(image.path);
                                    }} />
                                </button>
                            ))}
                        </div>
                    )}
                    {activeImage && <div className="mt-2 text-xs text-text-tertiary">{activeImage.role === 'detail' ? '详情图' : '商品图'} · {Math.min(imageIndex + 1, availableImages.length)} / {availableImages.length}</div>}
                </div>
                <div className="min-w-0 space-y-4">
                    <h2 className="text-lg font-semibold leading-7">{snapshot.title}</h2>
                    <div className="rounded-xl bg-surface-secondary p-4">
                        <div className="text-xs text-text-secondary">{snapshot.price?.label || '价格快照'}</div>
                        <div className="mt-1 text-2xl font-semibold text-accent-primary">{snapshot.price?.text || '未识别'}</div>
                        <div className="mt-2 text-xs leading-5 text-text-tertiary">采集于 {new Date(snapshot.capturedAt).toLocaleString()}，以京东页面实时价格为准。</div>
                    </div>
                    <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm leading-6">
                        {facts.map(([label, value]) => (
                            <div key={label} className="contents">
                                <dt className="text-text-tertiary">{label}</dt>
                                <dd className="break-words">{value}</dd>
                            </div>
                        ))}
                    </dl>
                    {!legacy && snapshot.missingFields.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                            待补充：{snapshot.missingFields.join('、')}。可在京东展开商品详情后重新识别。
                        </div>
                    )}
                </div>
            </div>
            {snapshot.parameters.length > 0 && (
                <section>
                    <h3 className="mb-3 text-sm font-semibold">商品参数 · {snapshot.parameters.length} 项</h3>
                    <dl className="grid gap-x-6 rounded-xl border border-black/[0.06] px-4 md:grid-cols-2">
                        {snapshot.parameters.map((parameter) => (
                            <div key={parameter.key} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-black/[0.04] py-3 text-sm leading-6">
                                <dt className="text-text-tertiary">{parameter.key}</dt>
                                <dd className="break-words">{parameter.value}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}
            {reviewCapture && (
                <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">商品评论 · {reviewCapture.reviews.length} 条</h3>
                        {(reviewCapture.scopeText || reviewCapture.sortText) && (
                            <div className="text-xs text-text-tertiary">
                                {[reviewCapture.scopeText, reviewCapture.sortText].filter(Boolean).join(' · ')}
                            </div>
                        )}
                    </div>
                    {reviewCapture.results.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {reviewCapture.results.map((result) => (
                                <button
                                    key={result.filterId}
                                    type="button"
                                    onClick={() => setReviewFilterId((current) => current === result.filterId ? 'all' : result.filterId)}
                                    aria-pressed={reviewFilterId === result.filterId}
                                    className={`rounded-full border px-3 py-1 text-xs transition ${reviewFilterId === result.filterId ? 'border-accent-primary bg-accent-primary/10 text-accent-primary' : 'border-black/10 bg-white text-text-secondary hover:border-black/20'}`}
                                    title={result.warning}
                                >
                                    {result.label} {result.captureAll ? `${result.captured} 条（全部）` : `${result.captured}/${result.requested}`}
                                </button>
                            ))}
                        </div>
                    )}
                    {reviewCapture.warnings.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                            {reviewCapture.warnings.join('；')}
                        </div>
                    )}
                    {filteredReviews.length > 0 ? (
                        <div className="space-y-3">
                            {filteredReviews.map((review) => {
                                const localImages = review.imageAssetIds
                                    .map((id) => reviewImageMap.get(id))
                                    .filter((image): image is ProductPreviewImage => Boolean(image) && !rejectedImages.has(image.path));
                                const labels = Array.from(new Set(review.matchedFilterIds.map((id) => filterLabels.get(id)).filter(Boolean)));
                                return (
                                    <article key={review.id} className="rounded-xl border border-black/[0.06] bg-white p-4">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
                                            <span className="font-semibold text-text-primary">{review.authorName || '京东用户'}</span>
                                            {review.rating && (
                                                <span className="inline-flex items-center gap-1 text-amber-600">
                                                    <Star className="h-3.5 w-3.5 fill-current" />{review.rating} 星
                                                </span>
                                            )}
                                            {review.dateText && <span>{review.dateText}</span>}
                                            {review.skuText && <span>{review.skuText}</span>}
                                            {review.video?.present && <span className="inline-flex items-center gap-1"><Video className="h-3.5 w-3.5" />含视频</span>}
                                        </div>
                                        {(labels.length > 0 || (review.badges || []).length > 0) && (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {[...labels, ...(review.badges || [])].map((label) => (
                                                    <span key={label} className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-text-secondary">{label}</span>
                                                ))}
                                            </div>
                                        )}
                                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-text-secondary">{review.text}</p>
                                        {review.merchantReply && (
                                            <div className="mt-3 rounded-lg bg-surface-secondary px-3 py-2 text-xs leading-5 text-text-secondary">
                                                <span className="font-semibold text-text-primary">商家回复：</span>{review.merchantReply}
                                            </div>
                                        )}
                                        {localImages.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {localImages.map((image) => (
                                                    <img
                                                        key={image.id}
                                                        src={resolveAssetUrl(image.path)}
                                                        alt="评论图片"
                                                        className="h-24 w-24 rounded-lg border border-black/[0.06] object-cover"
                                                        onError={() => rejectImage(image.path)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        {typeof review.helpfulCount === 'number' && (
                                            <div className="mt-3 text-xs text-text-tertiary">有用 {review.helpfulCount}</div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-text-tertiary">
                            {reviewCapture.modalDetected ? '本次没有采集到评论' : '本次保存时未打开商品评价弹窗'}
                        </div>
                    )}
                </section>
            )}
            {[...new Set([snapshot.description, snapshot.detailText].filter(Boolean))].map((text) => (
                <p key={text} className="whitespace-pre-wrap break-words text-sm leading-7 text-text-secondary">{text}</p>
            ))}
            {legacy && rawText && (
                <details className="rounded-xl border border-black/[0.06] px-4 py-3 text-sm text-text-secondary">
                    <summary className="cursor-pointer">查看旧版采集原文</summary>
                    <p className="mt-3 whitespace-pre-wrap break-words leading-7">{rawText}</p>
                </details>
            )}
        </div>
    );
}
