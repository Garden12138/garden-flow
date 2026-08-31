import { isPrivateGatewayEndpoint } from './privateGateway.ts';

export type VideoProviderKind = 'gardenflow' | 'aliyun-bailian' | 'minimax' | 'new-api' | 'openai-compatible';

export const ALIYUN_BAILIAN_VIDEO_SYNTHESIS_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
export const ALIYUN_BAILIAN_BEIJING_PUBLIC_ENDPOINT = `https://dashscope.aliyuncs.com${ALIYUN_BAILIAN_VIDEO_SYNTHESIS_PATH}`;
export const MINIMAX_VIDEO_BASE_URL = 'https://api.minimaxi.com';
export const MINIMAX_VIDEO_MODEL = 'MiniMax-H3';
export const MINIMAX_VIDEO_CREATE_PATH = '/v2/video_generation';
export const MINIMAX_VIDEO_QUERY_PATH = '/v2/query/video_generation';

export function isHappyHorseReferenceVideoModel(model: string): boolean {
    return /^happyhorse-[\w.-]*-r2v$/i.test(String(model || '').trim());
}

export function resolveVideoProvider(endpoint: string, model = ''): VideoProviderKind {
    const normalizedEndpoint = String(endpoint || '').trim().toLowerCase();
    const normalizedModel = String(model || '').trim().toLowerCase();
    if (normalizedEndpoint.includes('api.ziz.hk') && normalizedEndpoint.includes('/v1')) {
        return 'gardenflow';
    }
    // 私有网关按 endpoint 结构化判定，必须排在下面两个「含模型名判定」的分支之前，
    // 以免网关对外别名与上游原名撞车时路由到直连协议。
    if (isPrivateGatewayEndpoint(normalizedEndpoint)) {
        return 'new-api';
    }
    if (
        normalizedEndpoint.includes('.maas.aliyuncs.com')
        || normalizedEndpoint.includes('dashscope.aliyuncs.com')
        || normalizedEndpoint.includes('/services/aigc/video-generation/video-synthesis')
        || normalizedModel.startsWith('happyhorse-')
    ) {
        return 'aliyun-bailian';
    }
    if (
        normalizedEndpoint.includes('api.minimaxi.com')
        || normalizedModel === MINIMAX_VIDEO_MODEL.toLowerCase()
    ) {
        return 'minimax';
    }
    return 'openai-compatible';
}

export function buildMiniMaxVideoCreateUrl(endpoint: string): string {
    const raw = String(endpoint || MINIMAX_VIDEO_BASE_URL).trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        if (!pathname.toLowerCase().endsWith(MINIMAX_VIDEO_CREATE_PATH)) {
            parsed.pathname = `${pathname}${MINIMAX_VIDEO_CREATE_PATH}`.replace(/\/{2,}/g, '/');
        }
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return raw.toLowerCase().endsWith(MINIMAX_VIDEO_CREATE_PATH)
            ? raw
            : `${raw}${MINIMAX_VIDEO_CREATE_PATH}`;
    }
}

export function buildMiniMaxVideoQueryUrl(endpoint: string, taskId: string): string {
    const createUrl = buildMiniMaxVideoCreateUrl(endpoint);
    const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
    if (!createUrl || !encodedTaskId) return '';
    try {
        const parsed = new URL(createUrl);
        const markerIndex = parsed.pathname.toLowerCase().lastIndexOf(MINIMAX_VIDEO_CREATE_PATH);
        const prefix = markerIndex >= 0 ? parsed.pathname.slice(0, markerIndex) : parsed.pathname.replace(/\/+$/, '');
        parsed.pathname = `${prefix}${MINIMAX_VIDEO_QUERY_PATH}/${encodedTaskId}`.replace(/\/{2,}/g, '/');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        const markerIndex = createUrl.toLowerCase().lastIndexOf(MINIMAX_VIDEO_CREATE_PATH);
        const prefix = markerIndex >= 0 ? createUrl.slice(0, markerIndex) : createUrl;
        return `${prefix}${MINIMAX_VIDEO_QUERY_PATH}/${encodedTaskId}`;
    }
}

/** MiniMax derives the input format from the data-URL media subtype. */
export function normalizeMiniMaxReferenceAudioUrl(value: string): string {
    return String(value || '').replace(/^data:audio\/mpeg(?=[;,])/i, 'data:audio/mp3');
}

export function buildMiniMaxVideoRequest(input: {
    model: string;
    prompt: string;
    referenceImages: string[];
    referenceAudios?: string[];
    generationMode: 'text-to-video' | 'reference-guided' | 'first-last-frame';
    resolution: '720p' | '1080p';
    aspectRatio: '16:9' | '9:16';
    durationSeconds: number;
}): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
    if (input.generationMode === 'reference-guided') {
        input.referenceImages.slice(0, 9).forEach((url) => {
            content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
        });
        (input.referenceAudios || []).slice(0, 3).forEach((url) => {
            content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
        });
    } else if (input.generationMode === 'first-last-frame') {
        if (input.referenceImages[0]) {
            content.push({ type: 'image_url', image_url: { url: input.referenceImages[0] }, role: 'first_frame' });
        }
        if (input.referenceImages[1]) {
            content.push({ type: 'image_url', image_url: { url: input.referenceImages[1] }, role: 'last_frame' });
        }
    }
    return {
        model: input.model,
        content,
        resolution: input.resolution === '1080p' ? '2K' : '768P',
        duration: input.durationSeconds,
        ratio: input.generationMode === 'first-last-frame' ? 'adaptive' : input.aspectRatio,
    };
}

export function buildAliyunBailianVideoCreateUrl(endpoint: string): string {
    const raw = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        if (pathname.toLowerCase().endsWith(ALIYUN_BAILIAN_VIDEO_SYNTHESIS_PATH)) {
            return parsed.toString().replace(/\/$/, '');
        }
        if (pathname.toLowerCase().endsWith('/api/v1')) {
            parsed.pathname = `${pathname}/services/aigc/video-generation/video-synthesis`;
        } else {
            parsed.pathname = `${pathname}${ALIYUN_BAILIAN_VIDEO_SYNTHESIS_PATH}`.replace(/\/{2,}/g, '/');
        }
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return raw.toLowerCase().endsWith(ALIYUN_BAILIAN_VIDEO_SYNTHESIS_PATH)
            ? raw
            : `${raw}${ALIYUN_BAILIAN_VIDEO_SYNTHESIS_PATH}`;
    }
}

export function buildAliyunBailianVideoCreateUrlCandidates(endpoint: string): string[] {
    const primary = buildAliyunBailianVideoCreateUrl(endpoint);
    if (!primary) return [];
    try {
        const hostname = new URL(primary).hostname.toLowerCase();
        if (hostname.endsWith('.cn-beijing.maas.aliyuncs.com')) {
            return [primary, ALIYUN_BAILIAN_BEIJING_PUBLIC_ENDPOINT];
        }
    } catch {
        return [primary];
    }
    return [primary];
}

export function buildAliyunBailianVideoTaskUrl(endpoint: string, taskId: string): string {
    const createUrl = buildAliyunBailianVideoCreateUrl(endpoint);
    const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
    if (!createUrl || !encodedTaskId) return '';
    try {
        const parsed = new URL(createUrl);
        const markerIndex = parsed.pathname.toLowerCase().indexOf('/api/v1/');
        const prefix = markerIndex >= 0 ? parsed.pathname.slice(0, markerIndex) : '';
        parsed.pathname = `${prefix}/api/v1/tasks/${encodedTaskId}`.replace(/\/{2,}/g, '/');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        const markerIndex = createUrl.toLowerCase().indexOf('/api/v1/');
        const prefix = markerIndex >= 0 ? createUrl.slice(0, markerIndex) : createUrl;
        return `${prefix}/api/v1/tasks/${encodedTaskId}`;
    }
}

export function buildAliyunBailianVideoRequest(input: {
    model: string;
    prompt: string;
    referenceImages: string[];
    resolution: '720p' | '1080p';
    aspectRatio: '16:9' | '9:16';
    durationSeconds: number;
}): Record<string, unknown> {
    return {
        model: input.model,
        input: {
            prompt: input.prompt,
            media: input.referenceImages.slice(0, 9).map((url) => ({
                type: 'reference_image',
                url,
            })),
        },
        parameters: {
            resolution: input.resolution === '1080p' ? '1080P' : '720P',
            ratio: input.aspectRatio,
            duration: input.durationSeconds,
        },
    };
}
