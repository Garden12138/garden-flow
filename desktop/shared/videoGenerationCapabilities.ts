import {
    isHappyHorseReferenceVideoModel,
    resolveVideoProvider,
    type VideoProviderPreset,
    type VideoProviderKind,
} from './videoProvider.ts';

export type VideoGenerationMode = 'text-to-video' | 'reference-guided' | 'first-last-frame' | 'continuation';
export type VideoResolution = '720p' | '1080p';
export type VideoAspectRatio = '16:9' | '9:16';

export type VideoProviderConfig = {
    id: string;
    name: string;
    preset: VideoProviderPreset;
    endpoint: string;
    apiKey: string;
    model: string;
    models: string[];
};

export type VideoModelCapabilities = {
    providerKind: VideoProviderKind;
    supportedModes: VideoGenerationMode[];
    aspectRatios: VideoAspectRatio[];
    resolutions: VideoResolution[];
    durationSeconds: number[];
    minReferenceImages: number;
    maxReferenceImages: number;
    supportsReferenceAudio: boolean;
    maxReferenceAudios: number;
    referenceAudioFormats: string[];
    supportsGeneratedAudio: boolean;
    summary: string;
};

export type VideoModelRoute = {
    provider: VideoProviderConfig;
    model: string;
    capabilities: VideoModelCapabilities;
};

const ALL_ASPECT_RATIOS: VideoAspectRatio[] = ['16:9', '9:16'];
const ALL_RESOLUTIONS: VideoResolution[] = ['720p', '1080p'];

function stringList(value: unknown): string[] {
    const candidates = Array.isArray(value)
        ? value
        : typeof value === 'string' && value.trim()
            ? (() => {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : value.split(/[\n,]/);
                } catch {
                    return value.split(/[\n,]/);
                }
            })()
            : [];
    return Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)));
}

function parseProviderCandidates(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function parseVideoProviderConfigs(settings: Record<string, unknown>): VideoProviderConfig[] {
    const candidates = parseProviderCandidates(settings.video_providers_json);
    const seen = new Set<string>();
    const providers = candidates.flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const record = candidate as Record<string, unknown>;
        const model = String(record.model || '').trim();
        const models = stringList(record.models);
        if (model && !models.includes(model)) models.push(model);
        const endpoint = String(record.endpoint || '').trim();
        const preset = String(record.preset || '').trim() as VideoProviderPreset;
        if (!['aliyun-bailian', 'minimax', 'new-api-aliyun', 'new-api-minimax', 'custom'].includes(preset)) return [];
        const signature = `${endpoint}\n${models.join('\n')}`;
        if (!endpoint || models.length === 0 || seen.has(signature)) return [];
        seen.add(signature);
        return [{
            id: String(record.id || `video-provider-${index + 1}`).trim() || `video-provider-${index + 1}`,
            name: String(record.name || '').trim() || '视频服务商',
            preset,
            endpoint,
            apiKey: String(record.apiKey || '').trim(),
            model: model || models[0],
            models,
        } satisfies VideoProviderConfig];
    });
    if (providers.length > 0) return providers;

    const model = String(settings.video_model || '').trim();
    const models = stringList(settings.video_models_json);
    if (model && !models.includes(model)) models.push(model);
    const fallbackModel = model || models[0] || '';
    return [{
        id: 'video-provider-current',
        name: '当前视频服务商',
        preset: 'custom',
        endpoint: String(settings.video_endpoint || '').trim(),
        apiKey: String(settings.video_api_key || '').trim(),
        model: fallbackModel,
        models: models.length > 0 ? models : (fallbackModel ? [fallbackModel] : []),
    }];
}

function integerRange(min: number, max: number): number[] {
    return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

export function getVideoModelCapabilities(model: string, endpoint = '', preset?: VideoProviderPreset): VideoModelCapabilities {
    const normalizedModel = String(model || '').trim().toLowerCase();
    const providerKind = resolveVideoProvider(endpoint, model, preset);

    if (providerKind === 'new-api-aliyun' || providerKind === 'new-api-minimax') {
        const aliyun = providerKind === 'new-api-aliyun';
        return {
            providerKind,
            supportedModes: aliyun ? ['text-to-video', 'reference-guided'] : ['text-to-video', 'reference-guided', 'first-last-frame'],
            aspectRatios: ALL_ASPECT_RATIOS,
            resolutions: ALL_RESOLUTIONS,
            durationSeconds: integerRange(aliyun ? 3 : 4, 15),
            minReferenceImages: 0,
            maxReferenceImages: aliyun ? 5 : 9,
            supportsReferenceAudio: false,
            maxReferenceAudios: 0,
            referenceAudioFormats: [],
            supportsGeneratedAudio: false,
            summary: aliyun ? 'New API · 阿里云视频上游' : 'New API · MiniMax 视频上游',
        };
    }

    if (isHappyHorseReferenceVideoModel(model)) {
        return {
            providerKind,
            supportedModes: ['reference-guided'],
            aspectRatios: ALL_ASPECT_RATIOS,
            resolutions: ALL_RESOLUTIONS,
            durationSeconds: integerRange(3, 15),
            minReferenceImages: 1,
            maxReferenceImages: 9,
            supportsReferenceAudio: false,
            maxReferenceAudios: 0,
            referenceAudioFormats: [],
            supportsGeneratedAudio: false,
            summary: '参考图视频 · 需要 1–5 张参考图',
        };
    }
    if (providerKind === 'aliyun-bailian' && /(?:^|[-_.])t2v(?:$|[-_.])/i.test(normalizedModel)) {
        return {
            providerKind,
            supportedModes: ['text-to-video'],
            aspectRatios: ALL_ASPECT_RATIOS,
            resolutions: ALL_RESOLUTIONS,
            durationSeconds: integerRange(3, 15),
            minReferenceImages: 0,
            maxReferenceImages: 0,
            supportsReferenceAudio: false,
            maxReferenceAudios: 0,
            referenceAudioFormats: [],
            supportsGeneratedAudio: false,
            summary: '文生视频',
        };
    }
    if (providerKind === 'aliyun-bailian' && /(?:^|[-_.])i2v(?:$|[-_.])/i.test(normalizedModel)) {
        return {
            providerKind,
            supportedModes: ['reference-guided'],
            aspectRatios: ALL_ASPECT_RATIOS,
            resolutions: ALL_RESOLUTIONS,
            durationSeconds: integerRange(3, 15),
            minReferenceImages: 1,
            maxReferenceImages: 1,
            supportsReferenceAudio: false,
            maxReferenceAudios: 0,
            referenceAudioFormats: [],
            supportsGeneratedAudio: false,
            summary: '图生视频 · 需要 1 张图片',
        };
    }
    if (providerKind === 'aliyun-bailian') {
        return {
            providerKind,
            supportedModes: ['text-to-video', 'reference-guided'],
            aspectRatios: ALL_ASPECT_RATIOS,
            resolutions: ALL_RESOLUTIONS,
            durationSeconds: integerRange(3, 15),
            minReferenceImages: 0,
            maxReferenceImages: 9,
            supportsReferenceAudio: false,
            maxReferenceAudios: 0,
            referenceAudioFormats: [],
            supportsGeneratedAudio: false,
            summary: '百炼视频生成',
        };
    }
    if (providerKind === 'minimax') {
        return {
            providerKind,
            supportedModes: ['text-to-video', 'reference-guided', 'first-last-frame'],
            aspectRatios: ALL_ASPECT_RATIOS,
            resolutions: ALL_RESOLUTIONS,
            durationSeconds: integerRange(4, 15),
            minReferenceImages: 0,
            maxReferenceImages: 9,
            supportsReferenceAudio: normalizedModel === 'minimax-h3',
            maxReferenceAudios: normalizedModel === 'minimax-h3' ? 3 : 0,
            referenceAudioFormats: normalizedModel === 'minimax-h3' ? ['mp3', 'wav'] : [],
            supportsGeneratedAudio: false,
            summary: normalizedModel === 'minimax-h3'
                ? '文生/多模态参考/首尾帧视频'
                : '文生/参考图/首尾帧视频',
        };
    }
    return {
        providerKind,
        supportedModes: ['text-to-video', 'reference-guided', 'first-last-frame', 'continuation'],
        aspectRatios: ALL_ASPECT_RATIOS,
        resolutions: ALL_RESOLUTIONS,
        durationSeconds: [4, 8, 12],
        minReferenceImages: 0,
        maxReferenceImages: 5,
        supportsReferenceAudio: false,
        maxReferenceAudios: 0,
        referenceAudioFormats: [],
        supportsGeneratedAudio: false,
        summary: 'OpenAI 兼容视频接口',
    };
}

export function buildVideoModelRoutes(settings: Record<string, unknown>): VideoModelRoute[] {
    const providers = parseVideoProviderConfigs(settings);
    const activeProviderId = String(settings.active_video_provider_id || '').trim();
    const orderedProviders = [...providers].sort((left, right) => (
        left.id === activeProviderId ? -1 : right.id === activeProviderId ? 1 : 0
    ));
    const routes: VideoModelRoute[] = [];
    const seenModels = new Set<string>();
    for (const provider of orderedProviders) {
        for (const model of provider.models) {
            const key = model.trim().toLowerCase();
            if (!key || seenModels.has(key)) continue;
            seenModels.add(key);
            routes.push({
                provider,
                model,
                capabilities: getVideoModelCapabilities(model, provider.endpoint, provider.preset),
            });
        }
    }
    return routes;
}

export function resolveVideoModelRoute(settings: Record<string, unknown>, requestedModel?: string): VideoModelRoute | null {
    const routes = buildVideoModelRoutes(settings);
    const model = String(requestedModel || settings.video_model || '').trim();
    return routes.find((route) => route.model === model) || routes[0] || null;
}

export function videoModeReferenceRange(
    capabilities: VideoModelCapabilities,
    mode: VideoGenerationMode,
): { min: number; max: number } {
    if (mode === 'first-last-frame') return { min: 2, max: 2 };
    if (mode === 'reference-guided') {
        return {
            min: Math.max(0, capabilities.minReferenceImages),
            max: Math.max(0, capabilities.maxReferenceImages),
        };
    }
    return { min: 0, max: 0 };
}
