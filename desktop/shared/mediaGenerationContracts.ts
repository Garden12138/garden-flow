import { z } from 'zod';

export const MEDIA_GENERATION_TOOL_NAMES = [
    'image_generate',
    'video_generate',
    'audio_generate',
] as const;

export type GenerationAgentIntent = 'image_creation' | 'video_creation' | 'audio_creation' | 'cover_generation';

export function generationIntentForMode(mode: 'image' | 'video' | 'audio' | 'cover' | 'digital-human'): GenerationAgentIntent {
    if (mode === 'video') return 'video_creation';
    if (mode === 'audio') return 'audio_creation';
    if (mode === 'cover') return 'cover_generation';
    return 'image_creation';
}

const OptionalXhsBindingSchema = {
    notePath: z.string().min(1).optional().describe('Optional structured XHS note path. Omit this for standalone intermediate assets such as video reference images.'),
    slotId: z.string().min(1).optional().describe('Optional XHS media slot. Must be provided together with notePath.'),
    completionScope: z.enum(['note', 'slot']).optional(),
    replace: z.boolean().optional(),
};

export const ImageGenerateParamsSchema = z.object({
    prompt: z.string().min(1).describe('Final image generation prompt.'),
    count: z.number().int().min(1).max(4).optional(),
    aspectRatio: z.string().min(1).optional(),
    size: z.string().min(1).optional(),
    quality: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    providerTemplate: z.string().min(1).optional(),
    generationMode: z.enum(['text-to-image', 'image-to-image', 'reference-guided']).optional(),
    referenceImages: z.array(z.string().min(1)).max(4).optional(),
    subjectIds: z.array(z.string().min(1)).max(4).optional(),
    subjectQuery: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    videoProjectId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    ...OptionalXhsBindingSchema,
}).superRefine((value, context) => {
    if (Boolean(value.notePath) !== Boolean(value.slotId)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'notePath and slotId must be provided together; omit both for a standalone image.',
            path: value.notePath ? ['slotId'] : ['notePath'],
        });
    }
});

export const VideoGenerateParamsSchema = z.object({
    operation: z.enum(['generate', 'generate-note']).optional().describe('Use generate-note only for a structured XHS video note; otherwise use generate.'),
    prompt: z.string().min(1).optional().describe('Required for generate. generate-note reads the approved prompt from the note.'),
    generationMode: z.enum(['text-to-video', 'reference-guided', 'first-last-frame', 'continuation']).optional(),
    referenceImages: z.array(z.string().min(1)).max(9).optional().describe('Absolute paths or supported asset URLs. Paths returned by image_generate can be passed here directly.'),
    referenceAudios: z.array(z.string().min(1)).max(3).optional().describe('Reference-audio paths or URLs for models that support multimodal reference input, such as MiniMax-H3.'),
    firstClip: z.string().min(1).optional(),
    drivingAudio: z.string().min(1).optional(),
    count: z.number().int().min(1).max(4).optional(),
    durationSeconds: z.number().min(1).max(300).optional(),
    aspectRatio: z.string().min(1).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
    generateAudio: z.boolean().optional(),
    model: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    videoProjectId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    subjectIds: z.array(z.string().min(1)).max(5).optional(),
    subjectQuery: z.string().min(1).optional(),
    resume: z.boolean().optional(),
    ...OptionalXhsBindingSchema,
}).superRefine((value, context) => {
    const operation = value.operation || 'generate';
    if (operation === 'generate' && !value.prompt) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'prompt is required for generate.', path: ['prompt'] });
    }
    if (operation === 'generate-note' && !value.notePath) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'notePath is required for generate-note.', path: ['notePath'] });
    }
    if (Boolean(value.notePath) !== Boolean(value.slotId)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'notePath and slotId must be provided together.',
            path: value.notePath ? ['slotId'] : ['notePath'],
        });
    }
    const references = value.referenceImages || [];
    const referenceAudios = value.referenceAudios || [];
    if (value.generationMode === 'reference-guided' && references.length === 0 && referenceAudios.length === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reference-guided requires at least one reference image or audio.', path: ['referenceImages'] });
    }
    if (value.generationMode === 'first-last-frame' && references.length !== 2) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'first-last-frame requires exactly two images in first/last order.', path: ['referenceImages'] });
    }
    if (value.generationMode === 'continuation' && !value.firstClip) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'continuation requires firstClip.', path: ['firstClip'] });
    }
});

export const AudioGenerateParamsSchema = z.object({
    text: z.string().min(1).describe('Text to synthesize.'),
    voiceId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    languageBoost: z.string().min(1).optional(),
    speed: z.number().min(0.25).max(4).optional(),
    emotion: z.string().min(1).optional(),
    responseFormat: z.enum(['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a']).optional(),
    projectId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
});

/**
 * Inputs selected explicitly in Generation Studio. These values are owned by
 * the UI, not by the agent, and must be applied immediately before a media
 * tool is validated and executed.
 */
export const GenerationToolConstraintsSchema = z.object({
    imageGenerate: z.object({
        model: z.string().min(1).optional(),
    }).strict().optional(),
    videoGenerate: z.object({
        operation: z.enum(['generate', 'generate-note']).optional(),
        generationMode: z.enum(['text-to-video', 'reference-guided', 'first-last-frame', 'continuation']).optional(),
        referenceImages: z.array(z.string().min(1)).max(9).optional(),
        referenceAudios: z.array(z.string().min(1)).max(3).optional(),
        firstClip: z.string().min(1).optional(),
        drivingAudio: z.string().min(1).optional(),
        count: z.number().int().min(1).max(4).optional(),
        durationSeconds: z.number().min(1).max(300).optional(),
        aspectRatio: z.string().min(1).optional(),
        resolution: z.enum(['720p', '1080p']).optional(),
        generateAudio: z.boolean().optional(),
        model: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
    }).strict().optional(),
    audioGenerate: z.object({
        model: z.string().min(1).optional(),
        voiceId: z.string().min(1).optional(),
    }).strict().optional(),
}).strict();

export type GenerationToolConstraints = z.infer<typeof GenerationToolConstraintsSchema>;

export function normalizeGenerationToolConstraints(input: unknown): GenerationToolConstraints | undefined {
    const parsed = GenerationToolConstraintsSchema.safeParse(input);
    return parsed.success ? parsed.data : undefined;
}

export function applyGenerationToolConstraints(
    toolName: string,
    args: Record<string, unknown>,
    input: unknown,
): Record<string, unknown> {
    const constraints = normalizeGenerationToolConstraints(input);
    const lockedImageInputs = constraints?.imageGenerate;
    const lockedVideoInputs = constraints?.videoGenerate;
    const lockedAudioInputs = constraints?.audioGenerate;

    if (toolName === 'image_generate' && lockedImageInputs) {
        return {
            ...args,
            ...lockedImageInputs,
        };
    }

    if (toolName === 'video_generate' && lockedVideoInputs) {
        return {
            ...args,
            ...lockedVideoInputs,
        };
    }

    if (toolName === 'audio_generate' && lockedAudioInputs) {
        return {
            ...args,
            ...lockedAudioInputs,
        };
    }

    if (toolName === 'app_cli') {
        const command = String(args.command || '').trim();
        const payload = args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
            ? args.payload as Record<string, unknown>
            : {};
        if (command === 'image generate' && lockedImageInputs) {
            return {
                ...args,
                payload: {
                    ...payload,
                    ...lockedImageInputs,
                },
            };
        }
        if ((command !== 'video generate' && command !== 'video generate-note') || !lockedVideoInputs) return args;
        return {
            ...args,
            payload: {
                ...payload,
                ...lockedVideoInputs,
            },
        };
    }

    return args;
}
