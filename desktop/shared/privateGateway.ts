import type { ModelCapability } from './modelCapabilities.ts';

/**
 * 私有化部署的 new-api 网关（OpenAI 兼容）。
 *
 * 与 `bojinVideo.ts` 的官方视频网关（api.ziz.hk 专有协议）解耦：
 * AI 能力（聊天/向量/图片/语音/转录）全部指向本网关，
 * 视频生成走 new-api 的异步任务协议（见 videoProvider 的 `new-api` 分支）。
 */
export const PRIVATE_GATEWAY_BASE_URL = 'http://192.168.10.117:3000/v1';

/** 网关形态的补充说明，供设置页展示，让用户明确感知官方源已切换为内网私有网关。 */
export const PRIVATE_GATEWAY_DISPLAY_HINT = '私有网关（new-api）';

/**
 * endpoint 是否指向私有网关。按 URL host:port 结构化比对，
 * 供 videoProvider 等分流逻辑使用，避免依赖模型名做启发式判断。
 */
export function isPrivateGatewayEndpoint(endpoint: string): boolean {
    const raw = String(endpoint || '').trim();
    if (!raw) return false;
    try {
        const target = new URL(raw);
        const base = new URL(PRIVATE_GATEWAY_BASE_URL);
        return target.host.toLowerCase() === base.host.toLowerCase();
    } catch {
        return false;
    }
}

export interface PrivateGatewayModelMeta {
    id: string;
    capabilities: ModelCapability[];
}

/**
 * 网关「渠道模型重定向」对外暴露的模型清单。
 * 作为官方源的内置默认模型，保证离线状态下各 scope 下拉即有正确模型；
 * 在线时可用设置页「获取模型」按 `GET /v1/models` 刷新。
 */
export const PRIVATE_GATEWAY_DEFAULT_MODELS: PrivateGatewayModelMeta[] = [
    { id: 'bojin-max', capabilities: ['chat'] },
    { id: 'bojin-plus', capabilities: ['chat'] },
    { id: 'bojin-omni-plus', capabilities: ['audio'] },
    { id: 'bojin-imgae-2.0', capabilities: ['image'] },
    { id: 'bojin-imgae-3.0', capabilities: ['image'] },
    { id: 'bojin-text-embedding', capabilities: ['embedding'] },
    { id: 'bojin-speech', capabilities: ['tts'] },
    { id: 'bojin-asr-plus', capabilities: ['transcription'] },
    { id: 'bojin-video-1.1-r2v', capabilities: ['video'] },
    { id: 'bojin-video-H3', capabilities: ['video'] },
];

export const PRIVATE_GATEWAY_DEFAULT_MODEL_IDS: string[] = PRIVATE_GATEWAY_DEFAULT_MODELS.map((item) => item.id);

/** 各任务 scope 的推荐默认模型，由结构化清单承载，避免在业务代码里散落模型名。 */
export const PRIVATE_GATEWAY_SCOPE_MODELS = Object.freeze({
    chat: 'bojin-max',
    transcription: 'bojin-asr-plus',
    embedding: 'bojin-text-embedding',
    image: 'bojin-imgae-3.0',
    videoAnalysis: 'bojin-omni-plus',
    voiceTts: 'bojin-speech',
});

/**
 * 视频模型的结构化元数据：上游渠道决定 new-api metadata 的构造形状，
 * 支持的生成模式决定 UI 可选项。用元数据承载路由意图，避免按模型名写启发式判断。
 */
export type PrivateGatewayVideoUpstream = 'aliyun-bailian' | 'minimax';
export type PrivateGatewayVideoMode = 'text-to-video' | 'reference-guided' | 'first-last-frame';

export interface PrivateGatewayVideoModelMeta {
    id: string;
    upstream: PrivateGatewayVideoUpstream;
    modes: PrivateGatewayVideoMode[];
    minReferenceImages: number;
    maxReferenceImages: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
    summary: string;
}

export const PRIVATE_GATEWAY_VIDEO_MODELS: PrivateGatewayVideoModelMeta[] = [
    {
        id: 'bojin-video-1.1-r2v',
        upstream: 'aliyun-bailian',
        modes: ['reference-guided'],
        // new-api 阿里适配器的 metadata.input.media 上限为 5 张（直连可到 9 张）。
        minReferenceImages: 1,
        maxReferenceImages: 5,
        minDurationSeconds: 3,
        maxDurationSeconds: 15,
        summary: '参考图视频 · 需要 1–5 张参考图',
    },
    {
        id: 'bojin-video-H3',
        upstream: 'minimax',
        modes: ['text-to-video', 'reference-guided', 'first-last-frame'],
        minReferenceImages: 0,
        maxReferenceImages: 9,
        minDurationSeconds: 4,
        maxDurationSeconds: 15,
        summary: '文生/参考图/首尾帧视频',
    },
];

export function getPrivateGatewayVideoModelMeta(model: string): PrivateGatewayVideoModelMeta | null {
    const normalized = String(model || '').trim().toLowerCase();
    if (!normalized) return null;
    return PRIVATE_GATEWAY_VIDEO_MODELS.find((item) => item.id.toLowerCase() === normalized) || null;
}

/** 提交任务：`POST {base}/video/generations`（注意是单数 video）。 */
export const PRIVATE_GATEWAY_VIDEO_CREATE_PATH = '/video/generations';

function buildPrivateGatewayUrl(endpoint: string, suffix: string): string {
    const raw = String(endpoint || PRIVATE_GATEWAY_BASE_URL).trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        parsed.pathname = `${pathname}${suffix}`.replace(/\/{2,}/g, '/');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return `${raw}${suffix}`;
    }
}

export function buildPrivateGatewayVideoCreateUrl(endpoint: string): string {
    return buildPrivateGatewayUrl(endpoint, PRIVATE_GATEWAY_VIDEO_CREATE_PATH);
}

export function buildPrivateGatewayVideoQueryUrl(endpoint: string, taskId: string): string {
    const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
    if (!encodedTaskId) return '';
    return buildPrivateGatewayUrl(endpoint, `${PRIVATE_GATEWAY_VIDEO_CREATE_PATH}/${encodedTaskId}`);
}

/**
 * 构造 new-api 视频任务提交体。
 *
 * new-api 顶层只解析 `model/prompt/mode/image/images/size/duration/seconds/input_reference/metadata`，
 * 上游差异化参数一律走 `metadata`，且两个渠道的 metadata 形状不同（未知字段会被静默丢弃）。
 */
export function shouldRetryPrivateGatewayVideoCreate(statusCode: number, message: string): boolean {
    if (Number(statusCode) !== 400) return false;
    const raw = String(message || '');
    return /Model not exist/i.test(raw) || /fail_to_fetch_task/i.test(raw);
}

export function buildPrivateGatewayVideoRequest(input: {
    model: string;
    prompt: string;
    upstream: PrivateGatewayVideoUpstream;
    generationMode: PrivateGatewayVideoMode;
    referenceImages: string[];
    resolution: '720p' | '1080p';
    durationSeconds: number;
    maxReferenceImages: number;
    aspectRatio?: '16:9' | '9:16';
}): Record<string, unknown> {
    const resolution = input.resolution === '1080p' ? '1080P' : '720P';
    const ratio = input.aspectRatio === '9:16' ? '9:16' : '16:9';
    const references = input.referenceImages
        .map((item) => String(item || '').trim())
        .filter(Boolean);

    if (input.upstream === 'aliyun-bailian') {
        // 阿里适配器会无条件把顶层 image 写进 input.img_url，与 r2v 的 media 冲突，
        // 因此参考图只放 metadata.input.media，顶层不传 image/images。
        // duration / ratio 同时写入 parameters，对齐百炼官方 r2v 请求体。
        return {
            model: input.model,
            prompt: input.prompt,
            duration: input.durationSeconds,
            metadata: {
                input: {
                    media: references.slice(0, input.maxReferenceImages).map((url) => ({
                        type: 'reference_image',
                        url,
                    })),
                },
                parameters: {
                    resolution,
                    ratio,
                    duration: input.durationSeconds,
                },
            },
        };
    }

    // MiniMax（hailuo）适配器读取扁平 metadata 字段。
    const metadata: Record<string, unknown> = { resolution };
    if (input.generationMode === 'first-last-frame') {
        if (references[0]) metadata.first_frame_image = references[0];
        if (references[1]) metadata.last_frame_image = references[1];
    } else if (input.generationMode === 'reference-guided') {
        const images = references.slice(0, input.maxReferenceImages);
        if (images.length > 0) {
            metadata.subject_reference = [{ type: 'character', image: images }];
        }
    }
    return {
        model: input.model,
        prompt: input.prompt,
        duration: input.durationSeconds,
        metadata,
    };
}
