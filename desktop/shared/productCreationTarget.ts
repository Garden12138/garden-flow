import { z } from 'zod';

export const PRODUCT_TARGET_PROFILE_VERSION = 1;
export const TIKTOK_MAX_MEDIA_BYTES = 10_000_000_000;
export const PRODUCT_PLATFORM_LABELS = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok' } as const;
export const ProductPlatformSchema = z.enum(['xiaohongshu', 'douyin', 'tiktok']);
export type ProductPlatform = z.infer<typeof ProductPlatformSchema>;

const InsetsSchema = z.object({ top: z.number().nonnegative(), right: z.number().nonnegative(), bottom: z.number().nonnegative(), left: z.number().nonnegative() }).strict();
export const ProductCreationTargetSchema = z.object({
    platform: ProductPlatformSchema,
    contentKind: z.enum(['video', 'image-set']),
    compositionMode: z.enum(['product-images', 'existing-clips']).optional(),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
    market: z.string().trim().min(1).max(100),
    profileId: z.string().min(1),
    profileVersion: z.number().int().min(0).max(PRODUCT_TARGET_PROFILE_VERSION),
    allowPaidMedia: z.boolean().default(false),
    spec: z.object({
        width: z.number().int().min(320).max(7680), height: z.number().int().min(320).max(7680),
        aspectRatio: z.string().min(1).max(20), fps: z.number().int().min(12).max(60).optional(),
        format: z.enum(['mp4', 'png']), safeInsets: InsetsSchema.optional(),
    }).strict(),
}).strict().superRefine((target, context) => {
    if (target.contentKind === 'image-set' && (target.platform !== 'xiaohongshu' || target.compositionMode)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: '当前只支持小红书商品套图，套图不使用视频编排模式' });
    }
    if (target.contentKind === 'video' && !target.compositionMode) context.addIssue({ code: z.ZodIssueCode.custom, message: '请选择视频编排模式' });
    if (target.profileVersion === 0) {
        if (!target.profileId.startsWith('legacy-') || target.spec.safeInsets) context.addIssue({ code: z.ZodIssueCode.custom, message: '旧版规格无效' });
        return;
    }
    const portrait = target.spec.aspectRatio === '9:16';
    const landscape = target.spec.aspectRatio === '16:9' && target.platform === 'xiaohongshu';
    const spec = target.contentKind === 'image-set'
        ? { width: 1440, height: 1920, aspectRatio: '3:4', format: 'png' }
        : { width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, aspectRatio: target.spec.aspectRatio, fps: 30, format: 'mp4',
            safeInsets: portrait ? { top: 120, right: 144, bottom: 320, left: 72 } : { top: 72, right: 96, bottom: 120, left: 96 } };
    if ((target.contentKind === 'video' && !portrait && !landscape)
        || target.profileId !== `${target.platform}-${target.contentKind}-${target.spec.aspectRatio}`
        || JSON.stringify(target.spec) !== JSON.stringify(spec)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: '目标规格与当前支持的规格快照不一致，请重新选择' });
    }
});
export type ProductCreationTarget = z.infer<typeof ProductCreationTargetSchema>;

export const ProductCreationSelectionSchema = z.object({
    platform: ProductPlatformSchema.default('xiaohongshu'), contentKind: z.enum(['video', 'image-set']).default('video'),
    compositionMode: z.enum(['product-images', 'existing-clips']).default('product-images'),
    aspectRatio: z.enum(['9:16', '16:9', '3:4']).optional(), language: z.string().optional(), market: z.string().optional(),
    durationSeconds: z.number().int().min(1).max(240).default(15), pageCount: z.number().int().min(1).max(20).default(5),
}).strict();
export type ProductCreationSelection = z.input<typeof ProductCreationSelectionSchema>;

export function resolveProductCreationTarget(input: ProductCreationSelection): ProductCreationTarget {
    const selection = ProductCreationSelectionSchema.parse(input);
    const aspectRatio = selection.contentKind === 'image-set' ? '3:4' : selection.aspectRatio || '9:16';
    const portrait = aspectRatio === '9:16';
    return ProductCreationTargetSchema.parse({
        platform: selection.platform, contentKind: selection.contentKind,
        compositionMode: selection.contentKind === 'video' ? selection.compositionMode : undefined,
        language: selection.language || (selection.platform === 'tiktok' ? 'en' : 'zh-CN'),
        market: selection.market || (selection.platform === 'tiktok' ? 'International' : '中国'),
        profileId: `${selection.platform}-${selection.contentKind}-${aspectRatio}`, profileVersion: PRODUCT_TARGET_PROFILE_VERSION, allowPaidMedia: false,
        spec: selection.contentKind === 'image-set'
            ? { width: 1440, height: 1920, aspectRatio, format: 'png' }
            : { width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, aspectRatio, fps: 30, format: 'mp4',
                safeInsets: portrait ? { top: 120, right: 144, bottom: 320, left: 72 } : { top: 72, right: 96, bottom: 120, left: 96 } },
    });
}

export function productTargetKey(target: ProductCreationTarget | undefined): string {
    return target ? JSON.stringify(ProductCreationTargetSchema.parse(target)) : 'legacy-unbound';
}

export function assertProductTargetMatch(expected: unknown, actual: unknown): void {
    if (!expected && !actual) return;
    if (!expected || !actual || productTargetKey(ProductCreationTargetSchema.parse(expected)) !== productTargetKey(ProductCreationTargetSchema.parse(actual))) {
        throw new Error('提案目标与用户选择不一致，请保留已选择的平台、形式、语言和规格');
    }
}

export function productTargetLabel(target: ProductCreationTarget): string {
    return `${PRODUCT_PLATFORM_LABELS[target.platform]} · ${target.contentKind === 'video' ? '视频' : '套图'} · ${target.spec.aspectRatio} · ${target.language}`;
}

export const ProductPublicationCopySchema = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(12000), hashtags: z.array(z.string().trim().min(1).max(80)).max(30).default([]) }).strict();
export type ProductPublicationCopy = z.infer<typeof ProductPublicationCopySchema>;
export function validateProductPublicationCopy(target: ProductCreationTarget, copy: ProductPublicationCopy): void {
    if (target.platform === 'xiaohongshu' && copy.title.length > 20) throw new Error('小红书标题最多 20 个字符');
    if (target.platform === 'tiktok' && [copy.description, copy.hashtags.map(tag => '#' + tag.replace(/^#+/, '')).join(' ')].filter(Boolean).join('\n').length > 4000) throw new Error('TikTok 文案与话题合计最多 4000 字符');
}

export const ProductWorkVersionSchema = z.object({
    workId: z.string().min(1), versionId: z.string().min(1), sourceVersionId: z.string().optional(),
    copyReviewRequired: z.boolean().optional(),
    publicationBinding: z.discriminatedUnion('platform', [
        z.object({ platform: z.literal('xiaohongshu'), notePath: z.string().min(1) }).strict(),
        z.object({ platform: z.literal('douyin'), versionId: z.string().min(1) }).strict(),
        z.object({ platform: z.literal('tiktok'), versionId: z.string().min(1) }).strict(),
    ]).optional(),
}).strict();
export type ProductWorkVersion = z.infer<typeof ProductWorkVersionSchema>;
export type ProductWorkVariant = { projectId: string; title: string; target?: ProductCreationTarget; workVersion?: ProductWorkVersion; resolution: 'bound' | 'unbound' | 'conflict' };

export const PRODUCT_CREATION_CAPABILITIES = Object.entries(PRODUCT_PLATFORM_LABELS).flatMap(([platform, label]) => ['video', 'image-set'].map(contentKind => ({
    platform: platform as ProductPlatform, platformLabel: label, contentKind: contentKind as 'video' | 'image-set',
    creation: contentKind === 'video' || platform === 'xiaohongshu', export: contentKind === 'video' || platform === 'xiaohongshu',
    publication: contentKind === 'video' || platform === 'xiaohongshu', status: contentKind === 'video' || platform === 'xiaohongshu' ? 'supported' : 'pending-adaptation',
})));

export const PRODUCT_CREATION_PROFILES: ProductCreationTarget[] = PRODUCT_CREATION_CAPABILITIES.filter(item => item.creation).flatMap(item =>
    item.platform === 'xiaohongshu' && item.contentKind === 'video'
        ? [resolveProductCreationTarget({ platform: item.platform, contentKind: item.contentKind, aspectRatio: '9:16' }), resolveProductCreationTarget({ platform: item.platform, contentKind: item.contentKind, aspectRatio: '16:9' })]
        : [resolveProductCreationTarget({ platform: item.platform, contentKind: item.contentKind })]);

export const PRODUCT_TARGET_RULES = {
    profileVersion: PRODUCT_TARGET_PROFILE_VERSION, checkedAt: '2026-10-12',
    applicationLimits: { videoSceneCount: 8, sceneDurationMs: 30000, videoDurationMs: 240000, imagePageCount: 20, supportedFormats: ['mp4', 'png'], captionSafeInsets: '应用推荐，非平台硬限' },
    platformLimits: { tiktok: { maxMediaBytesExclusive: TIKTOK_MAX_MEDIA_BYTES, source: 'https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok?lang=nl', evidence: 'official-help' } },
    otherRules: { evidence: 'existing-adapter-and-acceptance', note: '画幅支持范围及文案校验来自现有应用适配；未核实的其他平台硬限不作推断。' },
};

export const ProductVariantRequestSchema = z.object({ sourceProjectId: z.string().regex(/^[a-zA-Z0-9_-]+$/), expectedUpdatedAt: z.string().min(1), target: ProductCreationTargetSchema, duplicate: z.boolean().default(false) }).strict();
