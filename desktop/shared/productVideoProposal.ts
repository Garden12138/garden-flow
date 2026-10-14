import { z } from 'zod';
import { ProductCreationTargetSchema, ProductPublicationCopySchema, validateProductPublicationCopy } from './productCreationTarget.ts';

const ProductVideoProposalSceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  durationMs: z.number().int().min(500).max(30_000),
  source: z.enum(['product-asset', 'ai-motion', 'media-clip']),
  productAssetIds: z.array(z.string().min(1)).max(3),
  overlayText: z.string().max(120).optional(),
  generationPrompt: z.string().max(4_000).optional(),
  fitMode: z.enum(['contain-blur', 'cover']),
  motionPreset: z.enum(['static', 'slow-zoom-in', 'slow-zoom-out', 'pan-left', 'pan-right']),
  mediaAssetId: z.string().min(1).optional(),
  mediaContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceStartMs: z.number().int().nonnegative().optional(),
  sourceEndMs: z.number().int().positive().optional(),
  sourceVolume: z.number().min(0).max(1).optional(),
}).strict();

export const ProductVideoComposeParamsSchema = z.object({
  version: z.literal(1).default(1),
  creationTarget: ProductCreationTargetSchema.optional(),
  publicationCopy: ProductPublicationCopySchema.optional(),
  proposalId: z.string().min(6).max(160),
  productId: z.string().min(1),
  referencedProductIds: z.array(z.string().min(1)).min(1).max(8),
  productName: z.string().min(1),
  productUpdatedAt: z.string().min(1),
  title: z.string().min(1).max(200),
  canvas: z.object({
    width: z.number().int().min(320).max(7680).default(1080),
    height: z.number().int().min(320).max(7680).default(1920),
    fps: z.number().int().min(12).max(60).default(30),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5', 'custom']).default('9:16'),
  }).strict(),
  durationMs: z.number().int().min(1_000).max(300_000),
  voiceoverEnabled: z.boolean().optional().describe('Whether approval authorizes automatic narration from screen copy. Set false for a silent video; omitted retains the existing narration default.'),
  compositionMode: z.enum(['product-images', 'existing-clips']).optional(),
  scenes: z.array(ProductVideoProposalSceneSchema).min(1).max(8),
}).strict().superRefine((value, context) => {
  if (value.creationTarget) {
    const target = value.creationTarget;
    if (target.profileVersion === 0 || target.contentKind !== 'video' || target.compositionMode !== (value.compositionMode || 'product-images')
      || value.canvas.width !== target.spec.width || value.canvas.height !== target.spec.height || value.canvas.fps !== target.spec.fps || value.canvas.aspectRatio !== target.spec.aspectRatio
      || value.durationMs > 240000 || !value.publicationCopy || (!target.allowPaidMedia && (value.voiceoverEnabled !== false || value.scenes.some(scene => scene.source === 'ai-motion')))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '视频方案须符合已选目标规格、编排模式、发布文案及媒体确认范围' });
    }
    if (value.publicationCopy) try { validateProductPublicationCopy(target, value.publicationCopy); } catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: String((error as Error).message) }); }
  }
  const uniqueProductIds = Array.from(new Set(value.referencedProductIds));
  if (uniqueProductIds.length !== 1 || uniqueProductIds[0] !== value.productId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose exactly one primary product before composing.', path: ['referencedProductIds'] });
  }
  const total = value.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  if (total !== value.durationMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'durationMs must equal the sum of scene durations.', path: ['durationMs'] });
  }
  const aiCount = value.scenes.filter((scene) => scene.source === 'ai-motion').length;
  if (new Set(value.scenes.map((scene) => scene.id)).size !== value.scenes.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '分镜 ID 不得重复', path: ['scenes'] });
  if (value.compositionMode === 'existing-clips' && (value.voiceoverEnabled !== false || value.scenes.some((scene) => scene.source !== 'media-clip'))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '混剪只能使用已选视频片段，必须关闭自动旁白', path: ['compositionMode'] });
  }
  if (aiCount > 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Phase 2 supports at most two AI motion scenes.', path: ['scenes'] });
  }
  for (const scene of value.scenes) {
    if (scene.source === 'media-clip') {
      if (value.compositionMode !== 'existing-clips' || scene.productAssetIds.length || !scene.mediaAssetId || !scene.mediaContentHash
        || scene.sourceStartMs === undefined || scene.sourceEndMs === undefined || scene.sourceEndMs - scene.sourceStartMs !== scene.durationMs || scene.motionPreset !== 'static') {
        context.addIssue({ code: z.ZodIssueCode.custom, message: '视频片段必须声明混剪模式、来源摘要和准确截取区间，不添加原图动效', path: ['scenes'] });
      }
    } else if (scene.productAssetIds.length < 1 || scene.mediaAssetId !== undefined || scene.mediaContentHash !== undefined || scene.sourceVolume !== undefined || scene.sourceStartMs !== undefined || scene.sourceEndMs !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '原图／AI 镜头必须使用商品图片，不得携带混剪来源', path: ['scenes'] });
    }
    if (scene.source === 'ai-motion' && !String(scene.generationPrompt || '').trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'AI motion scenes require generationPrompt.', path: ['scenes'] });
      break;
    }
  }
});

export const ProductVideoEditCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scene.reorder'), sceneId: z.string().min(1), targetSceneId: z.string().min(1), position: z.enum(['before', 'after']) }).strict(),
  // The main process snaps this positive millisecond request to the project's frame rate.
  z.object({ type: z.literal('scene.duration'), sceneId: z.string().min(1), durationMs: z.number().int().min(1).max(30_000) }).strict(),
  z.object({ type: z.literal('scene.fit'), sceneId: z.string().min(1), fitMode: z.enum(['contain-blur', 'cover']) }).strict(),
  z.object({ type: z.literal('scene.motion'), sceneId: z.string().min(1), motionPreset: z.enum(['static', 'slow-zoom-in', 'slow-zoom-out', 'pan-left', 'pan-right']) }).strict(),
  z.object({ type: z.literal('scene.text'), sceneId: z.string().min(1), text: z.string().max(120) }).strict(),
  z.object({ type: z.literal('scene.narration-text'), sceneId: z.string().min(1), text: z.string().max(500) }).strict(),
  z.object({ type: z.literal('scene.asset'), sceneId: z.string().min(1), assetId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('scene.trim'), sceneId: z.string().min(1), sourceStartMs: z.number().int().nonnegative(), sourceEndMs: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('scene.source-volume'), sceneId: z.string().min(1), volume: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.literal('scene.delete'), sceneId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('voiceover.remove'), sceneId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('music.remove') }).strict(),
]);

export type ProductVideoComposeParams = z.infer<typeof ProductVideoComposeParamsSchema>;
