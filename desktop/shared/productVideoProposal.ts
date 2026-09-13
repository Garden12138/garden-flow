import { z } from 'zod';

const ProductVideoProposalSceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  durationMs: z.number().int().min(500).max(30_000),
  source: z.enum(['product-asset', 'ai-motion']),
  productAssetIds: z.array(z.string().min(1)).min(1).max(3),
  overlayText: z.string().max(120).optional(),
  generationPrompt: z.string().max(4_000).optional(),
  fitMode: z.enum(['contain-blur', 'cover']),
  motionPreset: z.enum(['static', 'slow-zoom-in', 'slow-zoom-out', 'pan-left', 'pan-right']),
}).strict();

export const ProductVideoComposeParamsSchema = z.object({
  version: z.literal(1).default(1),
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
  scenes: z.array(ProductVideoProposalSceneSchema).min(1).max(8),
}).strict().superRefine((value, context) => {
  const uniqueProductIds = Array.from(new Set(value.referencedProductIds));
  if (uniqueProductIds.length !== 1 || uniqueProductIds[0] !== value.productId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose exactly one primary product before composing.', path: ['referencedProductIds'] });
  }
  const total = value.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  if (total !== value.durationMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'durationMs must equal the sum of scene durations.', path: ['durationMs'] });
  }
  const aiCount = value.scenes.filter((scene) => scene.source === 'ai-motion').length;
  if (aiCount > 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Phase 2 supports at most two AI motion scenes.', path: ['scenes'] });
  }
  for (const scene of value.scenes) {
    if (scene.source === 'ai-motion' && !String(scene.generationPrompt || '').trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'AI motion scenes require generationPrompt.', path: ['scenes'] });
      break;
    }
  }
});

export const ProductVideoEditCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scene.reorder'), sceneId: z.string().min(1), targetSceneId: z.string().min(1), position: z.enum(['before', 'after']) }).strict(),
  z.object({ type: z.literal('scene.duration'), sceneId: z.string().min(1), durationMs: z.number().int().min(500).max(30_000) }).strict(),
  z.object({ type: z.literal('scene.fit'), sceneId: z.string().min(1), fitMode: z.enum(['contain-blur', 'cover']) }).strict(),
  z.object({ type: z.literal('scene.motion'), sceneId: z.string().min(1), motionPreset: z.enum(['static', 'slow-zoom-in', 'slow-zoom-out', 'pan-left', 'pan-right']) }).strict(),
  z.object({ type: z.literal('scene.text'), sceneId: z.string().min(1), text: z.string().max(120) }).strict(),
  z.object({ type: z.literal('scene.asset'), sceneId: z.string().min(1), assetId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('scene.delete'), sceneId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('music.remove') }).strict(),
]);

export type ProductVideoComposeParams = z.infer<typeof ProductVideoComposeParamsSchema>;
