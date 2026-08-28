import type {
    AudioGenerationRequest,
    CoverGenerationRequest,
    DigitalHumanGenerationRequest,
    ImageGenerationRequest,
    VideoGenerationRequest,
} from './feedModel';
import type { VideoModelCapabilities } from '../../../shared/videoGenerationCapabilities';
import { videoModeReferenceRange } from '../../../shared/videoGenerationCapabilities';

export type GenerationValidationConfig = {
    hasImageConfig?: boolean;
    hasVideoConfig?: boolean;
    hasVoiceConfig?: boolean;
    audioVoiceIdsForModel?: string[];
    videoModelCapabilities?: VideoModelCapabilities | null;
};

function referenceAudioFormat(dataUrl: string, name: string): string {
    const source = String(dataUrl || '').trim().toLowerCase();
    if (source.startsWith('data:audio/mpeg') || source.startsWith('data:audio/mp3')) return 'mp3';
    if (source.startsWith('data:audio/wav') || source.startsWith('data:audio/x-wav')) return 'wav';
    return String(name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

export function validateImageGenerationRequest(
    request: ImageGenerationRequest,
    config: GenerationValidationConfig,
): string | null {
    if (!request.prompt.trim()) return '请先输入提示词';
    if (!config.hasImageConfig) return '未检测到生图配置，请先在设置中补齐';
    if (!request.model.trim()) return '未检测到已添加的生图模型，请先在设置中添加生图模型';
    if (request.generationMode === 'image-to-image' && request.referenceItems.length === 0) {
        return '图生图模式至少需要 1 张参考图';
    }
    return null;
}

export function validateVideoGenerationRequest(
    request: VideoGenerationRequest,
    config: GenerationValidationConfig,
): string | null {
    if (!request.prompt.trim()) return '请先输入提示词';
    if (!config.hasVideoConfig) return '未检测到生视频配置，请先在设置中补齐';
    if (!request.model.trim()) return '未检测到已添加的生视频模型，请先在设置中添加生视频模型';
    const capabilities = config.videoModelCapabilities;
    if (capabilities && !capabilities.supportedModes.includes(request.generationMode)) {
        return `模型 ${request.model} 不支持当前视频模式，请从该模型提供的模式中重新选择`;
    }
    if (request.generationMode === 'reference-guided'
        && request.referenceItems.length === 0
        && request.referenceAudios.length === 0) {
        return '多模态参考模式至少需要 1 个参考素材';
    }
    if (request.generationMode === 'first-last-frame' && request.referenceItems.length < 2) {
        return '首尾帧模式需要首帧和尾帧两张图片';
    }
    if (request.generationMode === 'continuation' && !request.firstClip?.dataUrl) {
        return '视频续写模式需要上传起始视频';
    }
    if (capabilities && request.generationMode === 'reference-guided') {
        const range = videoModeReferenceRange(capabilities, request.generationMode);
        if (request.referenceItems.length < range.min || request.referenceItems.length > range.max) {
            return `模型 ${request.model} 的参考图数量需要为 ${range.min === range.max ? `${range.min} 张` : `${range.min}–${range.max} 张`}`;
        }
        if (request.referenceAudios.length > 0 && !capabilities.supportsReferenceAudio) {
            return `模型 ${request.model} 不支持参考音频输入`;
        }
        if (request.referenceAudios.length > capabilities.maxReferenceAudios) {
            return `模型 ${request.model} 最多支持 ${capabilities.maxReferenceAudios} 段参考音频`;
        }
        const hasInvalidReferenceAudio = request.referenceAudios.some((item) => {
            const format = referenceAudioFormat(item.dataUrl, item.name);
            return format && !capabilities.referenceAudioFormats.includes(format);
        });
        if (hasInvalidReferenceAudio) {
            return `模型 ${request.model} 的参考音频仅支持 ${capabilities.referenceAudioFormats.join('、').toUpperCase()} 格式`;
        }
    }
    if (capabilities && !capabilities.durationSeconds.includes(request.durationSeconds)) {
        return `模型 ${request.model} 不支持 ${request.durationSeconds} 秒，请重新选择该模型提供的时长`;
    }
    if (capabilities && !capabilities.aspectRatios.includes(request.aspectRatio)) {
        return `模型 ${request.model} 不支持 ${request.aspectRatio} 比例`;
    }
    if (capabilities && !capabilities.resolutions.includes(request.resolution)) {
        return `模型 ${request.model} 不支持 ${request.resolution} 清晰度`;
    }
    if (capabilities && request.generateAudio && !capabilities.supportsGeneratedAudio) {
        return `模型 ${request.model} 不支持同步生成音频`;
    }
    return null;
}

export function validateAudioGenerationRequest(
    request: AudioGenerationRequest,
    config: GenerationValidationConfig,
): string | null {
    if (!request.prompt.trim()) return '请先输入要合成的文本';
    if (!request.voiceId.trim()) return '请先填写 voice_id';
    if (!config.hasVoiceConfig) return '未检测到声音合成配置，请先在设置中补齐';
    if (config.audioVoiceIdsForModel && !config.audioVoiceIdsForModel.includes(request.voiceId.trim())) {
        return '当前音色不属于所选 TTS 模型，请重新选择匹配的音色';
    }
    return null;
}

export function validateDigitalHumanGenerationRequest(
    request: DigitalHumanGenerationRequest,
    config: GenerationValidationConfig,
): string | null {
    if (!request.prompt.trim()) return '请先输入文案';
    if (!request.roleId || !request.voiceId || !request.videoPath) {
        return '角色需要参考视频；音色会从视频音轨自动克隆，完成后即可生成';
    }
    if (!config.hasVoiceConfig) return '未检测到声音合成配置，请先在设置中补齐';
    return null;
}

export function validateCoverGenerationRequest(
    request: CoverGenerationRequest,
    config: GenerationValidationConfig,
): string | null {
    if (!request.prompt.trim()) return '请先输入封面标题或要求';
    if (!config.hasImageConfig) return '未检测到生图配置，请先在设置中补齐';
    if (!request.model.trim()) return '未检测到已添加的生图模型，请先在设置中添加生图模型';
    return null;
}
