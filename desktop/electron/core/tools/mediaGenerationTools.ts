import type { z } from 'zod';
import {
    DeclarativeTool,
    ToolErrorType,
    ToolKind,
    type ToolResult,
    createErrorResult,
} from '../toolRegistry';
import { synthesizeVoiceSpeech } from '../mediaGenerationJobRegistry';
import { AppCliTool } from './appCliTool';
import {
    AudioGenerateParamsSchema,
    ImageGenerateParamsSchema,
    VideoGenerateParamsSchema,
} from '../../../shared/mediaGenerationContracts';

export { AudioGenerateParamsSchema, ImageGenerateParamsSchema, VideoGenerateParamsSchema };

type ImageGenerateParams = z.infer<typeof ImageGenerateParamsSchema>;
type VideoGenerateParams = z.infer<typeof VideoGenerateParamsSchema>;
type AudioGenerateParams = z.infer<typeof AudioGenerateParamsSchema>;

export class ImageGenerateTool extends DeclarativeTool<typeof ImageGenerateParamsSchema> {
    readonly name = 'image_generate';
    readonly displayName = 'Generate Image';
    readonly description = 'Generate standalone images or explicitly bind one image to a valid XHS image slot. For an image that will be used as a video reference, omit notePath and slotId; use the returned absolutePath in video_generate.referenceImages.';
    readonly kind = ToolKind.Execute;
    readonly parameterSchema = ImageGenerateParamsSchema;

    getDescription(params: ImageGenerateParams): string {
        return `Generate ${params.count || 1} image(s): ${params.prompt.slice(0, 80)}`;
    }

    async execute(params: ImageGenerateParams, signal: AbortSignal): Promise<ToolResult> {
        if (signal.aborted) {
            return createErrorResult('Image generation cancelled.', ToolErrorType.CANCELLED);
        }
        return new AppCliTool().execute({
            command: 'image generate',
            payload: params,
        });
    }
}

export class VideoGenerateTool extends DeclarativeTool<typeof VideoGenerateParamsSchema> {
    readonly name = 'video_generate';
    readonly displayName = 'Generate Video';
    readonly description = 'Generate a video with typed text, image, first/last-frame, continuation, reference-audio, and driving-audio inputs. Image assets returned by image_generate can be passed directly through referenceImages. MiniMax-H3 reference audio is passed through referenceAudios, which is separate from generateAudio (generated output track). Supports optional atomic binding to a structured XHS final-video slot.';
    readonly kind = ToolKind.Execute;
    readonly parameterSchema = VideoGenerateParamsSchema;

    getDescription(params: VideoGenerateParams): string {
        return params.operation === 'generate-note'
            ? `Generate structured video note: ${params.notePath || ''}`
            : `Generate video: ${(params.prompt || '').slice(0, 80)}`;
    }

    async execute(params: VideoGenerateParams, signal: AbortSignal): Promise<ToolResult> {
        if (signal.aborted) {
            return createErrorResult('Video generation cancelled.', ToolErrorType.CANCELLED);
        }
        return new AppCliTool().execute({
            command: params.operation === 'generate-note' ? 'video generate-note' : 'video generate',
            payload: params,
        });
    }
}

export class AudioGenerateTool extends DeclarativeTool<typeof AudioGenerateParamsSchema> {
    readonly name = 'audio_generate';
    readonly displayName = 'Generate Audio';
    readonly description = 'Generate a real speech or voiceover audio asset from text with an optional voice, model, language, speed, emotion, and output format.';
    readonly kind = ToolKind.Execute;
    readonly parameterSchema = AudioGenerateParamsSchema;

    getDescription(params: AudioGenerateParams): string {
        return `Generate audio: ${params.text.slice(0, 80)}`;
    }

    async execute(params: AudioGenerateParams, signal: AbortSignal): Promise<ToolResult> {
        if (signal.aborted) {
            return createErrorResult('Audio generation cancelled.', ToolErrorType.CANCELLED);
        }
        const result = await synthesizeVoiceSpeech({
            input: params.text,
            voiceId: params.voiceId,
            model: params.model,
            languageBoost: params.languageBoost,
            speed: params.speed,
            emotion: params.emotion,
            responseFormat: params.responseFormat,
            projectId: params.projectId,
            title: params.title,
        });
        if (signal.aborted) {
            return createErrorResult('Audio generation cancelled.', ToolErrorType.CANCELLED);
        }
        if (result.success !== true) {
            const failure = createErrorResult(String(result.error || 'Audio generation failed.'), ToolErrorType.EXECUTION_FAILED);
            return {
                ...failure,
                data: {
                    kind: 'media-generation-error',
                    mediaType: 'audio',
                    providerErrorCode: result.providerErrorCode,
                    statusCode: result.statusCode,
                    terminal: result.terminal === true,
                },
            };
        }
        const asset = result.asset && typeof result.asset === 'object'
            ? result.asset as Record<string, unknown>
            : {};
        const absolutePath = String(result.path || asset.absolutePath || '').trim();
        const previewUrl = String(asset.previewUrl || '').trim();
        const assetId = String(asset.id || '').trim();
        const effectiveVoiceId = String(result.voiceId || params.voiceId || '').trim();
        const effectiveModel = String(result.model || params.model || '').trim();
        const lines = [
            'Generated 1 audio asset.',
            effectiveVoiceId ? `voiceId=${effectiveVoiceId}` : '',
            effectiveModel ? `model=${effectiveModel}` : '',
            assetId ? `assetId=${assetId}` : '',
            absolutePath ? `absolutePath=${absolutePath}` : '',
            previewUrl ? `previewUrl=${previewUrl}` : '',
        ].filter(Boolean);
        return {
            success: true,
            llmContent: lines.join('\n'),
            display: 'audio generate',
            data: {
                kind: 'generated-audios',
                count: 1,
                voiceId: effectiveVoiceId,
                model: effectiveModel,
                assets: [{ ...asset, absolutePath, previewUrl }],
            },
        };
    }
}
