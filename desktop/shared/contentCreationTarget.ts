import { z } from 'zod';

export const CreationLanguageSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
export const CreationMarketSchema = z.string().trim().min(1).max(100);
export const DREAM_STORY_SPEC = {
    width: 1080, height: 1920, aspectRatio: '9:16', fps: 30, format: 'mp4',
    safeInsets: { top: 120, right: 144, bottom: 320, left: 72 },
} as const;
export const DreamStoryTargetSchema = z.object({
    platform: z.literal('tiktok'), publishSurface: z.literal('tiktok-studio-web'),
    contentKind: z.literal('video'), compositionMode: z.enum(['story-keyframes', 'story-video', 'story-hybrid']),
    language: CreationLanguageSchema.default('en'), market: CreationMarketSchema.default('International'),
    profileId: z.literal('tiktok-dream-story-video-9:16'), profileVersion: z.union([z.literal(1), z.literal(2)]),
    targetDurationMs: z.number().int().min(60000).max(90000).default(72000),
    narration: z.boolean().default(true), subtitles: z.boolean().default(true),
    voiceId: z.string().trim().min(1).max(200).default('alloy'),
    spec: z.object({
        width: z.literal(1080), height: z.literal(1920), aspectRatio: z.literal('9:16'),
        fps: z.literal(30), format: z.literal('mp4'),
        safeInsets: z.object({ top: z.literal(120), right: z.literal(144), bottom: z.literal(320), left: z.literal(72) }).strict(),
    }).strict(),
}).strict().superRefine((value, context) => { if (value.profileVersion === 1 && value.compositionMode !== 'story-keyframes') context.addIssue({ code: z.ZodIssueCode.custom, message: '旧梦境目标仅支持图片模式' }); });
export type DreamStoryTarget = z.infer<typeof DreamStoryTargetSchema>;
export type ContentCreationTarget = import('./productCreationTarget').ProductCreationTarget | DreamStoryTarget;
export function resolveDreamStoryTarget(input: Partial<Pick<DreamStoryTarget, 'language' | 'market' | 'targetDurationMs' | 'narration' | 'subtitles' | 'voiceId' | 'compositionMode'>> = {}): DreamStoryTarget {
    return DreamStoryTargetSchema.parse({ ...input, platform: 'tiktok', publishSurface: 'tiktok-studio-web',
        contentKind: 'video', compositionMode: input.compositionMode || 'story-hybrid', profileId: 'tiktok-dream-story-video-9:16', profileVersion: 2, spec: DREAM_STORY_SPEC });
}
