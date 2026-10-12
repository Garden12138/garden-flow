import { z } from 'zod';

export const ProductVideoClipReferenceSchema = z.object({
    assetId: z.string().min(1).max(160),
    title: z.string().max(500),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    hasAudio: z.boolean(),
    previewUrl: z.string().min(1),
    thumbnailUrl: z.string().optional(),
}).strict();

export const ProductVideoClipReferencesSchema = z.array(ProductVideoClipReferenceSchema).min(1).max(8)
    .refine((refs) => new Set(refs.map((ref) => ref.assetId)).size === refs.length, '视频素材不得重复');
export type ProductVideoClipReference = z.infer<typeof ProductVideoClipReferenceSchema>;

export function readProductVideoClipReferences(metadata: unknown): ProductVideoClipReference[] {
    const refs = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).explicitVideoClipRefs : undefined;
    const parsed = ProductVideoClipReferencesSchema.safeParse(refs);
    return parsed.success ? parsed.data : [];
}

/** The output rate defines cut boundaries. Never snap an end beyond the source. */
export function snapProductVideoClipRange(startMs: number, endMs: number, sourceDurationMs: number, fps: number): { startMs: number; endMs: number; durationMs: number } {
    if (![startMs, endMs, sourceDurationMs, fps].every(Number.isFinite) || fps <= 0 || startMs < 0 || endMs <= startMs || endMs > sourceDurationMs) throw new Error('截取区间超出来源视频');
    const startFrame = Math.round(startMs * fps / 1000);
    const endFrame = Math.min(Math.round(endMs * fps / 1000), Math.floor(sourceDurationMs * fps / 1000));
    if (endFrame <= startFrame) throw new Error('截取片段不足一帧');
    const snappedStart = Math.round(startFrame * 1000 / fps);
    const snappedEnd = Math.round(endFrame * 1000 / fps);
    return { startMs: snappedStart, endMs: snappedEnd, durationMs: snappedEnd - snappedStart };
}
