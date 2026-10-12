import { z } from 'zod';

export const PRODUCT_IMAGE_WIDTH = 1440;
export const PRODUCT_IMAGE_HEIGHT = 1920;
// Bump when template output or bundled font selection changes.
export const PRODUCT_IMAGE_TEMPLATE_VERSION = 2;

export const ProductImageStyleSchema = z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FAF8F3'),
    foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#202925'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#C05640'),
}).strict();

export const ProductImageGenerationSchema = z.object({
    requestId: z.string().min(1).max(160),
    jobId: z.string().optional(),
    inputKey: z.string(),
    status: z.enum(['generating', 'succeeded', 'failed', 'interrupted']),
    error: z.string().optional(),
    startedAt: z.string(),
});

export const ProductImagePageSchema = z.object({
    id: z.string().min(1).max(80),
    role: z.enum(['cover', 'content']),
    title: z.string().max(240),
    copy: z.string().max(1400).default(''),
    layout: z.enum(['cover', 'split', 'grid']).default('split'),
    productAssetIds: z.array(z.string().min(1)).min(1).max(4),
    fit: z.enum(['contain', 'cover']).default('contain'),
    cropX: z.number().min(0).max(100).default(50),
    cropY: z.number().min(0).max(100).default(50),
    fontScale: z.number().min(0.7).max(1.3).default(1),
    aiPrompt: z.string().max(6000).default(''),
    backgroundAssetId: z.string().optional(),
    render: z.object({ inputKey: z.string(), assetId: z.string() }).optional(),
    generation: ProductImageGenerationSchema.optional(),
}).strict();

export const ProductImageSetProposalSchema = z.object({
    proposalId: z.string().min(1).max(160),
    productId: z.string().min(1),
    productUpdatedAt: z.string().min(1),
    productName: z.string().min(1).max(500),
    finalTitle: z.string().min(1).max(500),
    body: z.string().max(12000).default(''),
    hashtags: z.array(z.string().max(80)).max(30).default([]),
    style: ProductImageStyleSchema.default({}),
    pages: z.array(ProductImagePageSchema.omit({ backgroundAssetId: true, render: true, generation: true })).min(1).max(20),
}).strict().superRefine((value, context) => {
    if (value.pages[0]?.role !== 'cover' || value.pages.slice(1).some((page) => page.role === 'cover')) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: '封面必须是唯一的首张图片' });
    }
    if (new Set(value.pages.map((page) => page.id)).size !== value.pages.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: '页面 ID 不得重复' });
    }
});

export const ProductImageSetSchema = z.object({
    version: z.literal(1),
    proposalId: z.string().min(1),
    spaceId: z.string().min(1),
    productSnapshot: z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }).passthrough(),
    assets: z.array(z.object({
        id: z.string().min(1),
        relativePath: z.string().min(1),
        sha256: z.string().min(1),
        kind: z.enum(['product', 'ai', 'upload']),
    }).strict()),
    style: ProductImageStyleSchema,
    pages: z.array(ProductImagePageSchema).min(1).max(20),
    generationHistory: z.array(ProductImageGenerationSchema.extend({ pageId: z.string(), assetId: z.string().optional() })).default([]),
}).strict().superRefine((value, context) => {
    const assetIds = new Set(value.assets.map((asset) => asset.id));
    if (assetIds.size !== value.assets.length || new Set(value.pages.map((page) => page.id)).size !== value.pages.length
        || value.pages[0]?.role !== 'cover' || value.pages.slice(1).some((page) => page.role === 'cover')) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: '套图素材／页面 ID 或封面顺序无效' });
    }
    for (const page of value.pages) {
        if (page.productAssetIds.some((id) => !assetIds.has(id)) || (page.backgroundAssetId && !assetIds.has(page.backgroundAssetId))) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: `页面 ${page.title || page.id} 引用了工程外素材` });
        }
    }
});

export type ProductImageSetProposal = z.infer<typeof ProductImageSetProposalSchema>;
export type ProductImageSet = z.infer<typeof ProductImageSetSchema>;
export type ProductImagePage = z.infer<typeof ProductImagePageSchema>;

export function productImageSlotId(page: Pick<ProductImagePage, 'id' | 'role'>): string {
    return page.role === 'cover' ? 'cover' : `product-page-${page.id}`;
}

/** Compare only visual inputs; binding, job state and sibling page changes are irrelevant. */
export function productImageInputKey(set: ProductImageSet, page: ProductImagePage): string {
    const assetIds = page.backgroundAssetId ? [page.backgroundAssetId] : page.productAssetIds;
    return JSON.stringify({
        templateVersion: PRODUCT_IMAGE_TEMPLATE_VERSION,
        style: set.style,
        page: { id: page.id, role: page.role, title: page.title, copy: page.copy, layout: page.layout,
            fit: page.fit, cropX: page.cropX, cropY: page.cropY, fontScale: page.fontScale },
        assets: assetIds.map((id) => ({ id, sha256: set.assets.find((asset) => asset.id === id)?.sha256 })),
    });
}

export function productImageGenerationKey(set: ProductImageSet, page: ProductImagePage): string {
    return JSON.stringify({ render: productImageInputKey(set, page), prompt: page.aiPrompt, references: page.productAssetIds });
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** All markup is application-owned. Caller resolves verified local assets and bundled fonts. */
export function renderProductImageHtml(set: ProductImageSet, page: ProductImagePage, sources: Record<string, string>, fontCss = ''): string {
    const codePoints = [...page.title + page.copy].map((character) => character.codePointAt(0)!);
    const selectedFontCss = Array.from(fontCss.matchAll(/@font-face\s*\{[^}]+\}/g)).map((match) => match[0]).filter((rule) => {
        const range = rule.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1];
        if (!range) return true;
        return range.split(',').some((entry) => {
            const bounds = entry.trim().match(/^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i);
            if (!bounds) return true;
            const lower = Number.parseInt(bounds[1], 16); const upper = Number.parseInt(bounds[2] || bounds[1], 16);
            return codePoints.some((point) => point >= lower && point <= upper);
        });
    }).join('\n');
    const ids = page.backgroundAssetId ? [page.backgroundAssetId] : page.productAssetIds;
    const images = ids.map((id) => {
        const source = sources[id];
        if (!source || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) throw new Error(`图片素材不可用：${id}`);
        return `<img src="${source}" alt="" style="object-fit:${page.fit};object-position:${page.cropX}% ${page.cropY}%">`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'"><style>${selectedFontCss}
        *{box-sizing:border-box}html,body{margin:0;width:1440px;height:1920px;overflow:hidden}
        body{font-family:'Noto Sans SC',sans-serif;color:${set.style.foreground};background:${set.style.background}}
        .page{width:1440px;height:1920px;padding:100px;display:flex;flex-direction:column;gap:64px}
        .text{flex-shrink:0;overflow:visible;max-height:650px;overflow-wrap:anywhere}
        h1{margin:0;font-size:${Math.round(94 * page.fontScale)}px;line-height:1.25;font-weight:700;white-space:pre-wrap;text-wrap:balance;color:${set.style.accent}}
        p{margin:36px 0 0;font-size:${Math.round(46 * page.fontScale)}px;line-height:1.6;white-space:pre-wrap}
        .pictures{display:grid;gap:24px;min-height:0;flex:1;overflow:hidden;border-radius:32px}
        img{width:100%;height:100%;min-height:0;min-width:0;display:block}
        .cover .pictures{order:0}.cover .text{order:1}
        .split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.split .text{max-height:1720px;align-self:center}.split .pictures{height:100%;grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(${ids.length},minmax(0,1fr))}
        .grid .pictures{grid-template-columns:repeat(${Math.min(ids.length, 2)},minmax(0,1fr));grid-template-rows:repeat(${Math.ceil(ids.length / 2)},minmax(0,1fr))}
        .cover .pictures{grid-template-columns:repeat(${Math.min(ids.length, 2)},minmax(0,1fr))}
    </style></head><body><main class="page ${page.layout}"><section class="text"><h1>${escapeHtml(page.title)}</h1>${page.copy ? `<p>${escapeHtml(page.copy)}</p>` : ''}</section><section class="pictures">${images}</section></main></body></html>`;
}

const ProductImageProjectRequestSchema = z.object({ path: z.string().min(1).max(4096), expectedRevision: z.number().int().min(1) });
export const ProductImagePageRequestSchema = ProductImageProjectRequestSchema.extend({ pageId: z.string().min(1).max(80) });
export const ProductImagePreviewRequestSchema = ProductImagePageRequestSchema.extend({ preview: z.object({ page: ProductImagePageSchema, style: ProductImageStyleSchema }).optional() });
export const ProductImageGenerateRequestSchema = ProductImagePageRequestSchema.extend({ requestId: z.string().min(1).max(160), confirmed: z.literal(true), reviewedConfigurationKey: z.string().min(1) });
export const ProductImageExportRequestSchema = ProductImageProjectRequestSchema.extend({ format: z.enum(['png', 'directory', 'zip']), pageId: z.string().min(1).max(80).optional() });
export type ProductImagePageRequest = z.infer<typeof ProductImagePageRequestSchema>;
export type ProductImagePreviewRequest = z.infer<typeof ProductImagePreviewRequestSchema>;
export type ProductImageGenerateRequest = z.infer<typeof ProductImageGenerateRequestSchema>;
export type ProductImageExportRequest = z.infer<typeof ProductImageExportRequestSchema>;
