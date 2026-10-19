import { CreationConfigSchema, CreationPresetSchema, SourceRefSchema } from './noteCards.ts';
import { z } from 'zod';
import { ProductPlatformSchema } from './productCreationTarget.ts';

export const CreationCapabilitySchema = z.enum(['note-image', 'note-video', 'product-video', 'product-remix', 'product-image-set', 'dream-story']);
export type CreationCapability = z.infer<typeof CreationCapabilitySchema>;
export const CREATION_CAPABILITY_LABELS: Record<CreationCapability, string> = {
    'note-image': '图文笔记', 'note-video': '视频笔记', 'product-video': '商品视频', 'product-remix': '已有视频混剪', 'product-image-set': '商品套图', 'dream-story': '梦境故事',
};
export function supportsCreation(platform: string, capability: CreationCapability): boolean {
    return capability === 'dream-story' ? platform === 'tiktok'
        : ['note-image', 'note-video', 'product-image-set'].includes(capability) ? platform === 'xiaohongshu'
            : ProductPlatformSchema.safeParse(platform).success;
}
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const CreationStartSchema = z.object({ platform: ProductPlatformSchema, capability: CreationCapabilitySchema, presetId: CreationPresetSchema.optional(), sourceRefs: z.array(SourceRefSchema).max(20).optional(), productId: Id.optional(), entry: z.enum(['platform', 'attachment', 'document', 'product', 'conversation']).optional(), sourceSessionId: z.string().max(160).optional(), requestId: Id.optional(), brief: z.string().max(12000).optional() }).strict().refine(value => !value.presetId || value.capability === 'note-image', '预设只适用于图文笔记').refine(value => supportsCreation(value.platform, value.capability), '当前平台不支持此创作方式');
export const CreationDraftSchema = z.object({
    creationConfig: CreationConfigSchema.optional(),
    title: z.string().max(200).default(''), brief: z.string().max(12000).default(''), body: z.string().max(12000).default(''),
    hashtags: z.array(z.string().max(80)).max(30).default([]), productId: z.string().max(160).default(''),
    language: z.string().max(35).default('zh-CN'), market: z.string().max(100).default('中国'),
    aspectRatio: z.enum(['9:16', '16:9', '3:4']).default('9:16'),
    sourceAssetIds: z.array(z.string().max(160)).max(8).default([]),
    scenes: z.array(z.object({ id: Id, title: z.string().max(200), visual: z.string().max(6000).default(''), text: z.string().max(120).default(''),
        narration: z.string().max(500).default(''), mediaMode: z.enum(['product-asset', 'ai-motion']).default('product-asset'), durationMs: z.number().int().min(1).max(30000).default(5000), assetId: z.string().max(160).default(''),
        sourceStartMs: z.number().int().nonnegative().default(0), sourceVolume: z.number().min(0).max(1).default(1),
    }).strict()).max(8).default([]),
    pages: z.array(z.object({ id: Id, title: z.string().max(240), copy: z.string().max(1400).default(''), assetIds: z.array(z.string().max(160)).max(4).default([]), layout: z.enum(['cover', 'split', 'grid']).default('split') }).strict()).max(20).default([]),
}).strict();
export type CreationDraft = z.infer<typeof CreationDraftSchema>;
export type CreationNativeRef = { kind: 'video'; projectId: string } | { kind: 'note'; path: string };
export interface CreationWorkspace {
    version: 1; id: string; spaceId: string; platform: z.infer<typeof ProductPlatformSchema>; capability: CreationCapability;
    sessionId: string; revision: string; draftEpoch: number; draft: CreationDraft; native?: CreationNativeRef;
    receipts?: Array<{ id: string; digest: string }>; unapplied?: Array<{ id: string; draft: CreationDraft; basedOnRevision: string }>;
    sourceSessionId?: string; entry?: string; requestId?: string; startDigest?: string;
    sourceId?: string; createdAt: string; updatedAt: string; undo: CreationDraft[];
}
export const CreationTurnSchema = z.object({ workspaceId: Id, spaceId: Id, requestId: Id, expectedRevision: Id, expectedDraftEpoch: z.number().int().nonnegative(), selectedId: Id.optional() }).strict();
export type CreationTurn = z.infer<typeof CreationTurnSchema>;
export const CreationSaveSchema = CreationTurnSchema.extend({ draft: CreationDraftSchema, origin: z.enum(['manual', 'ai']).default('manual') });
export function creationWorkspaceSessionId(metadata: unknown, spaceId: string): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const value = metadata as Record<string, unknown>;
    return value.spaceId === spaceId && Id.safeParse(value.creationWorkspaceId).success ? String(value.creationWorkspaceId) : null;
}

export function creationNativeSessionRef(metadata: unknown, spaceId: string): CreationNativeRef | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const value = metadata as Record<string, any>;
    if (value.spaceId !== spaceId) return null;
    if (value.editorBindingKind === 'product-project' && value.productProjectEditorBinding?.spaceId === spaceId) {
        const ref = value.productProjectEditorBinding.project;
        if (ref?.kind === 'video' && Id.safeParse(ref.projectId).success) return { kind: 'video', projectId: ref.projectId };
        if (ref?.kind === 'image-set' && typeof ref.path === 'string') return { kind: 'note', path: ref.path };
    }
    if (value.editorBindingKind === 'xiaohongshu-note' && typeof value.activeXhsNotePath === 'string') return { kind: 'note', path: value.activeXhsNotePath };
    return null;
}
