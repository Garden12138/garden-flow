import type { createBrandWorkspaceStore, ProductSourceSnapshot } from '../brandWorkspaceStore.ts';
import type { WanderItem } from '../knowledgeLoader.ts';
import { socialPlatformFromUrl } from '../../../shared/socialCapture.ts';
import { SourceIdentitySchema, SourceSnapshotSchema, type SourceSnapshot, type SourceIdentity, type ContentEvidence } from '../../../shared/contentIntelligence.ts';
import { ciDigest, sourceKey } from './repository.ts';

type ProductBundle = Awaited<ReturnType<ReturnType<typeof createBrandWorkspaceStore>['list']>>[number]['products'][number];
export interface CiSourceDependencies {
    products: () => Promise<ProductBundle[]>;
    knowledge: () => Promise<WanderItem[]>;
}
function safeSourceUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
        for (const key of [...url.searchParams.keys()]) if (!['id', 'modal_id', 'aweme_id'].includes(key)) url.searchParams.delete(key);
        url.hash = ''; return url.href;
    } catch { return undefined; }
}
function timestamp(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 8640000000000000 ? parsed : undefined;
}
function finish(payload: Omit<SourceSnapshot, 'version'>): SourceSnapshot {
    return SourceSnapshotSchema.parse({ ...payload, version: ciDigest(payload) });
}
function commentsToSegments(comments: Array<{ id?: string; text: string }>, issues: string[]): SourceSnapshot['segments'] {
    const unique = new Map<string, string>(); const conflicts = new Set<string>();
    for (const comment of comments) {
        if (!comment.text.trim()) continue;
        const key = 'comment_' + ciDigest(comment.id || ['text-identity', comment.text]);
        const existing = unique.get(key);
        if (existing !== undefined && existing !== comment.text) conflicts.add(key);
        else unique.set(key, comment.text);
    }
    if (conflicts.size) issues.push('部分评论标识存在冲突，已排除');
    const available = [...unique].filter(([key]) => !conflicts.has(key));
    if (available.length > 800) issues.push(`仅提供前 800 条去重评论，另 ${available.length - 800} 条未纳入`);
    return available.slice(0, 800).map(([key, text]) => ({ key, text, kind: 'comment' }));
}
export function productSourceSnapshot(bundle: ProductBundle, capture?: ProductSourceSnapshot): SourceSnapshot {
    const issues: string[] = [...(capture?.reviewCapture?.warnings || [])];
    const reviewCapture = capture?.reviewCapture;
    const comments = commentsToSegments((reviewCapture?.reviews || []).map(review => ({ id: review.platformReviewId || review.id, text: review.text })), issues);
    if (!reviewCapture || reviewCapture.status === 'not-opened') issues.push('评论尚未采集');
    if (reviewCapture && reviewCapture.status !== 'complete') issues.push('评论为部分采集样本');
    if (!capture) issues.push('用户录入商品资料；无平台采集快照');
    if (capture?.missingFields.length) issues.push('商品采集有缺少字段');
    const facts: SourceSnapshot['segments'] = [
        { key: 'title', kind: 'fact', text: capture?.title || bundle.product.name },
        ...(capture?.selectedSku ? [{ key: 'selectedSku', kind: 'fact' as const, text: JSON.stringify(capture.selectedSku) }] : []),
        ...(capture?.price ? [{ key: 'price', kind: 'fact' as const, text: JSON.stringify(capture.price) }] : []),
        ...(capture?.parameters || []).map((parameter, index) => ({ key: 'parameter_' + index, kind: 'fact' as const, text: `${parameter.key}: ${parameter.value}` })),
        ...bundle.product.facts.filter(fact => fact.origin === 'user-confirmed').map((fact, index) => ({ key: 'user_fact_' + index, kind: 'fact' as const, text: `${fact.key}: ${fact.value}` })),
    ];
    const requested = reviewCapture?.results.reduce((sum, result) => sum + result.requested, 0);
    return finish({ source: { kind: 'product', namespace: capture?.platform || 'local', id: bundle.product.id }, title: bundle.product.name,
        sourceUrl: safeSourceUrl(capture?.sourceUrl), capturedAt: timestamp(capture?.capturedAt || bundle.product.updatedAt),
        coverage: { captured: comments.length, requested, partial: issues.length > 0, issues }, segments: [...facts, ...comments] });
}
export function knowledgeSourceSnapshot(item: WanderItem): SourceSnapshot | null {
    const meta = item.meta || {}; const url = safeSourceUrl(meta.sourceUrl || meta.source || meta.url);
    const platform = socialPlatformFromUrl(url || '');
    const document = meta.sourceType === 'document';
    if (!document && !platform && meta.sourceType !== 'youtube') return null;
    const source: SourceIdentity = document
        ? { kind: 'document', namespace: 'knowledge', id: ciDigest([meta.sourceId, meta.relativePath]) }
        : { kind: 'social', namespace: platform || 'youtube', id: item.id };
    const issues: string[] = [];
    const rawComments = Array.isArray(meta.commentsSnapshot) ? meta.commentsSnapshot : Array.isArray(meta.xhsComments?.comments) ? meta.xhsComments.comments : [];
    const comments = commentsToSegments(rawComments.map((comment: any) => ({
        id: comment.id || comment.commentId || ciDigest([comment.author, comment.createdAt, comment.parentCommentId, comment.content?.text || comment.text]),
        text: typeof comment.content?.text === 'string' ? comment.content.text : typeof comment.text === 'string' ? comment.text : '',
    })), issues);
    if (document) issues.push('知识预览最多 12000 字；仅验证本次可见原文');
    if (!document && !rawComments.length) issues.push('评论未采集或为空，不能推断消费者无意见');
    if (meta.capture?.status !== 'complete' || meta.capture?.comments !== 'complete') issues.push('采集完整性未确认');
    const requested = Number.isSafeInteger(meta.capture?.commentLimit) && meta.capture.commentLimit >= 0 ? meta.capture.commentLimit : undefined;
    const segments: SourceSnapshot['segments'] = item.content ? [{ key: 'body', kind: 'text', text: item.content }] : [];
    return finish({ source, title: item.title, sourceUrl: url, capturedAt: timestamp(meta.updatedAt || meta.capturedAt || meta.createdAt),
        coverage: { captured: comments.length, requested, partial: issues.length > 0, issues }, segments: [...segments, ...comments] });
}
export function createCiSourceAdapter(dependencies: CiSourceDependencies) {
    async function list(): Promise<SourceSnapshot[]> {
        const [products, knowledge] = await Promise.all([dependencies.products(), dependencies.knowledge()]);
        const values = products.flatMap(bundle => {
            const newest = new Map<string, ProductSourceSnapshot>();
            for (const capture of bundle.sourceSnapshots) {
                const old = newest.get(capture.platform);
                if (!old || capture.capturedAt > old.capturedAt) newest.set(capture.platform, capture);
            }
            return newest.size ? [...newest.values()].map(capture => productSourceSnapshot(bundle, capture)) : [productSourceSnapshot(bundle)];
        });
        values.push(...knowledge.map(knowledgeSourceSnapshot).filter((value): value is SourceSnapshot => value !== null));
        if (new Set(values.map(value => sourceKey(value.source))).size !== values.length) throw new Error('来源身份冲突，请核对资料');
        return values;
    }
    async function read(input: unknown): Promise<SourceSnapshot> {
        const source = SourceIdentitySchema.parse(input);
        const value = (await list()).find(value => sourceKey(value.source) === sourceKey(source));
        if (!value) throw Object.assign(new Error('来源不存在或不属于当前空间'), { code: 'CI_SOURCE_MISSING' });
        return value;
    }
    async function validity(evidence: ContentEvidence): Promise<ContentEvidence['validity']> {
        try {
            const current = await read(evidence.source);
            if (current.version !== evidence.sourceVersion) return 'stale';
            const text = current.segments.find(segment => segment.key === evidence.locator.key)?.text;
            return text?.slice(evidence.locator.start, evidence.locator.end) === evidence.excerpt ? 'verified' : 'unverifiable';
        } catch (error) { if ((error as { code?: string }).code === 'CI_SOURCE_MISSING') return 'missing'; throw error; }
    }
    return { list, read, validity };
}
export type CiSourceAdapter = ReturnType<typeof createCiSourceAdapter>;
