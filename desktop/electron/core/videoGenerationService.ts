import fs from 'node:fs/promises';
import path from 'node:path';
import { getSettings } from '../db';
import { createGeneratedMediaAsset, type MediaAsset } from './mediaLibraryStore';
import { normalizeApiBaseUrl } from './urlUtils';
import {
    GARDENFLOW_OFFICIAL_VIDEO_BASE_URL,
    getGardenFlowOfficialVideoModel,
} from '../../shared/gardenflowVideo';
import {
    buildAliyunBailianVideoCreateUrl,
    buildAliyunBailianVideoCreateUrlCandidates,
    buildAliyunBailianVideoRequest,
    buildAliyunBailianVideoTaskUrl,
    buildMiniMaxVideoCreateUrl,
    buildMiniMaxVideoQueryUrl,
    buildMiniMaxVideoRequest,
    isHappyHorseReferenceVideoModel,
    normalizeMiniMaxReferenceAudioUrl,
    resolveVideoProvider,
} from '../../shared/videoProvider';
import {
    buildPrivateGatewayVideoCreateUrl,
    buildPrivateGatewayVideoQueryUrl,
    buildPrivateGatewayVideoRequest,
    shouldRetryPrivateGatewayVideoCreate,
    getPrivateGatewayVideoModelMeta,
} from '../../shared/privateGateway';
import {
    getVideoModelCapabilities,
    resolveVideoModelRoute,
    videoModeReferenceRange,
} from '../../shared/videoGenerationCapabilities';
import { normalizeMediaValueForRemote as resolveHostedMediaValue } from './imageHosting/service.ts';

export interface GenerateVideosInput {
    prompt: string;
    projectId?: string;
    title?: string;
    model?: string;
    endpoint?: string;
    apiKey?: string;
    aspectRatio?: string;
    count?: number;
    durationSeconds?: number;
    resolution?: '720p' | '1080p';
    generateAudio?: boolean;
    generationMode?: 'text-to-video' | 'reference-guided' | 'first-last-frame' | 'continuation';
    referenceImages?: string[];
    referenceAudios?: string[];
    drivingAudio?: string;
    firstClip?: string;
}

export interface GenerateVideosResult {
    model: string;
    endpoint: string;
    provider: string;
    aspectRatio: '16:9' | '9:16';
    resolution: '720p' | '1080p';
    durationSeconds: number;
    generateAudio: boolean;
    assets: MediaAsset[];
}

export class VideoGenerationProviderError extends Error {
    readonly providerCode?: string;
    readonly statusCode?: number;
    readonly terminal: boolean;

    constructor(message: string, options: { providerCode?: string; statusCode?: number; terminal?: boolean } = {}) {
        super(message);
        this.name = 'VideoGenerationProviderError';
        this.providerCode = options.providerCode;
        this.statusCode = options.statusCode;
        this.terminal = options.terminal === true;
    }
}

function maskKeySuffix(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.slice(-6);
}

type VideoGenerationMode = 'text-to-video' | 'reference-guided' | 'first-last-frame' | 'continuation';
const VIDEO_TASK_POLL_INTERVAL_MS = 3000;
const VIDEO_TASK_POLL_TIMEOUT_MS = 6 * 60 * 1000;
const ALIYUN_VIDEO_TASK_POLL_INTERVAL_MS = 15_000;
const ALIYUN_VIDEO_TASK_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MINIMAX_VIDEO_TASK_POLL_INTERVAL_MS = 10_000;
const MINIMAX_VIDEO_TASK_POLL_TIMEOUT_MS = 15 * 60 * 1000;
// new-api 后台按批次刷新上游任务状态，查询结果本身有滞后，轮询更快也拿不到更新。
const NEW_API_VIDEO_TASK_POLL_INTERVAL_MS = 10_000;
const NEW_API_VIDEO_TASK_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const NEW_API_VIDEO_SUCCESS_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETED']);
const NEW_API_VIDEO_FAILURE_STATUSES = new Set(['FAILURE', 'FAILED', 'CANCELED', 'CANCELLED']);
const aliyunEndpointFallbacks = new Map<string, string>();

function isGardenFlowCompatibleEndpoint(endpoint: string): boolean {
    const normalized = normalizeApiBaseUrl(endpoint).toLowerCase();
    return normalized.includes('api.ziz.hk') && normalized.includes('/v1');
}

function normalizeVideoAspectRatio(value: string): '16:9' | '9:16' {
    return String(value || '').trim() === '9:16' ? '9:16' : '16:9';
}

function normalizeVideoResolution(value: string): '720p' | '1080p' {
    return String(value || '').trim() === '1080p' ? '1080p' : '720p';
}

function normalizeVideoDuration(value: unknown, range: { min: number; max: number } = { min: 5, max: 12 }): number {
    const parsed = Math.floor(Number(value) || 8);
    return Math.max(range.min, Math.min(range.max, parsed));
}

function mapOpenAiVideoSize(
    aspectRatio: '16:9' | '9:16',
    resolution: '720p' | '1080p'
): '720x1280' | '1280x720' | '1024x1792' | '1792x1024' {
    if (aspectRatio === '9:16') {
        return resolution === '1080p' ? '1024x1792' : '720x1280';
    }
    return resolution === '1080p' ? '1792x1024' : '1280x720';
}

function mapOpenAiVideoSeconds(durationSeconds: number): '4' | '8' | '12' {
    if (durationSeconds <= 6) return '4';
    if (durationSeconds <= 10) return '8';
    return '12';
}

function inferMimeTypeFromPath(filePath: string): string {
    const ext = path.extname(String(filePath || '').trim()).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.mp3':
            return 'audio/mpeg';
        case '.wav':
            return 'audio/wav';
        case '.m4a':
            return 'audio/mp4';
        case '.aac':
            return 'audio/aac';
        case '.ogg':
            return 'audio/ogg';
        case '.mp4':
            return 'video/mp4';
        case '.mov':
            return 'video/quicktime';
        case '.webm':
            return 'video/webm';
        default:
            return 'application/octet-stream';
    }
}

function inferReferenceAudioFormat(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized.startsWith('data:audio/mpeg') || normalized.startsWith('data:audio/mp3')) return 'mp3';
    if (normalized.startsWith('data:audio/wav') || normalized.startsWith('data:audio/x-wav')) return 'wav';
    return normalized.split(/[?#]/, 1)[0]?.match(/\.([a-z0-9]+)$/)?.[1] || '';
}

async function normalizeMediaValueForRemote(value: string): Promise<string> {
    return resolveHostedMediaValue(value, {
        getSettings: () => getSettings(),
        readFile: (filePath) => fs.readFile(filePath),
    });
}

async function fetchGeneratedVideoBuffer(videoUrl: string, apiKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const attempts: Array<Record<string, string>> = [
        {},
        { 'x-goog-api-key': apiKey },
        { Authorization: `Bearer ${apiKey}` },
    ];
    let lastError = 'Failed to download generated video.';

    for (const headers of attempts) {
        try {
            const response = await fetch(videoUrl, { headers });
            if (!response.ok) {
                lastError = `下载生成视频失败 (${response.status} ${response.statusText})`;
                continue;
            }
            const mimeType = String(response.headers.get('content-type') || 'video/mp4').trim().toLowerCase() || 'video/mp4';
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length === 0) {
                lastError = '下载到的生视频内容为空。';
                continue;
            }
            return { buffer, mimeType };
        } catch (error) {
            lastError = String(error || '下载生成视频失败。');
        }
    }

    throw new Error(lastError);
}

function buildCompatibleVideoRouteUrl(endpoint: string, suffix: string): string {
    const normalized = normalizeApiBaseUrl(endpoint);
    try {
        const parsed = new URL(normalized);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        if (pathname.toLowerCase().endsWith(suffix.toLowerCase())) {
            return parsed.toString();
        }
        parsed.pathname = `${pathname}${suffix}`.replace(/\/{2,}/g, '/');
        return parsed.toString();
    } catch {
        return `${normalized.replace(/\/+$/, '')}${suffix}`;
    }
}

function buildCompatibleVideoRouteUrls(endpoint: string, suffix: string): string[] {
    const primary = buildCompatibleVideoRouteUrl(endpoint, suffix);
    const urls = [primary];
    if (isGardenFlowCompatibleEndpoint(endpoint)) {
        try {
            const parsed = new URL(normalizeApiBaseUrl(endpoint));
            const apiRoute = `${parsed.origin}/api/v1${suffix}`;
            const v1Route = `${parsed.origin}/v1${suffix}`;
            return [primary, apiRoute, v1Route].filter((item, index, arr) => arr.indexOf(item) === index);
        } catch {
            return urls;
        }
    }
    return urls;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTaskId(payload: any): string {
    const direct = String(payload?.task_id || payload?.taskId || '').trim();
    if (direct) return direct;
    const output = payload?.output;
    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const outputTaskId = String((output as Record<string, unknown>).task_id || (output as Record<string, unknown>).taskId || '').trim();
        if (outputTaskId) return outputTaskId;
    }
    const data = payload?.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return String((data as Record<string, unknown>).task_id || (data as Record<string, unknown>).taskId || '').trim();
    }
    return '';
}

function extractTaskStatus(payload: any): string {
    const direct = String(payload?.task_status || payload?.status || '').trim();
    if (direct) return direct.toUpperCase();
    const output = payload?.output;
    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const outputStatus = String((output as Record<string, unknown>).task_status || (output as Record<string, unknown>).status || '').trim();
        if (outputStatus) return outputStatus.toUpperCase();
    }
    const data = payload?.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return String((data as Record<string, unknown>).task_status || (data as Record<string, unknown>).status || '').trim().toUpperCase();
    }
    const task = payload?.task;
    if (task && typeof task === 'object' && !Array.isArray(task)) {
        return String((task as Record<string, unknown>).task_status || (task as Record<string, unknown>).status || '').trim().toUpperCase();
    }
    return '';
}

function extractTaskFailureMessage(payload: any): string {
    const candidates = [
        payload?.message,
        payload?.error,
        payload?.error_message,
        payload?.detail,
    ];
    const data = payload?.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        candidates.push(
            (data as Record<string, unknown>).message,
            (data as Record<string, unknown>).error,
            (data as Record<string, unknown>).error_message,
            (data as Record<string, unknown>).detail,
        );
    }
    const output = payload?.output;
    if (output && typeof output === 'object' && !Array.isArray(output)) {
        candidates.push(
            (output as Record<string, unknown>).message,
            (output as Record<string, unknown>).error,
            (output as Record<string, unknown>).error_message,
            (output as Record<string, unknown>).detail,
        );
    }
    const task = payload?.task;
    if (task && typeof task === 'object' && !Array.isArray(task)) {
        candidates.push(
            (task as Record<string, unknown>).message,
            (task as Record<string, unknown>).error,
            (task as Record<string, unknown>).error_message,
            (task as Record<string, unknown>).detail,
        );
    }
    for (const candidate of candidates) {
        const text = candidate && typeof candidate === 'object'
            ? String((candidate as Record<string, unknown>).message || JSON.stringify(candidate)).trim()
            : String(candidate || '').trim();
        if (text) return text;
    }
    return '';
}

function extractCompatibleVideoUrls(payload: any): string[] {
    const urls: string[] = [];
    const pushUrl = (value: unknown) => {
        const text = String(value || '').trim();
        if (text && /^https?:\/\//i.test(text) && !urls.includes(text)) {
            urls.push(text);
        }
    };
    const output = payload && typeof payload === 'object' ? payload : {};
    pushUrl(output.video_url);
    pushUrl(output.video);
    pushUrl(output.url);
    if (output.output && typeof output.output === 'object' && !Array.isArray(output.output)) {
        pushUrl((output.output as Record<string, unknown>).video_url);
        pushUrl((output.output as Record<string, unknown>).video);
        pushUrl((output.output as Record<string, unknown>).url);
    }
    if (output.task && typeof output.task === 'object' && !Array.isArray(output.task)) {
        const task = output.task as Record<string, unknown>;
        pushUrl(task.video_url);
        pushUrl(task.video);
        pushUrl(task.url);
        if (task.content && typeof task.content === 'object' && !Array.isArray(task.content)) {
            pushUrl((task.content as Record<string, unknown>).url);
        }
    }
    const dataRows = Array.isArray(output.data) ? output.data : [];
    for (const item of dataRows) {
        if (typeof item === 'string') {
            pushUrl(item);
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        pushUrl((item as Record<string, unknown>).video_url);
        pushUrl((item as Record<string, unknown>).video);
        pushUrl((item as Record<string, unknown>).url);
    }
    return urls;
}

async function generateViaOpenAiCompatibleVideoRoute(input: {
    prompt: string;
    endpoint: string;
    apiKey: string;
    model: string;
    count: number;
    aspectRatio: '16:9' | '9:16';
    resolution: '720p' | '1080p';
    durationSeconds: number;
    title?: string;
    projectId?: string;
    referenceImages?: string[];
    generationMode?: VideoGenerationMode;
    drivingAudio?: string;
    firstClip?: string;
}): Promise<GenerateVideosResult> {
    const createUrls = buildCompatibleVideoRouteUrls(input.endpoint, '/videos/generations/async');
    const queryUrls = buildCompatibleVideoRouteUrls(input.endpoint, '/videos/generations/tasks/query');
    const size = mapOpenAiVideoSize(input.aspectRatio, input.resolution);
    const seconds = mapOpenAiVideoSeconds(input.durationSeconds);
    const refs = Array.isArray(input.referenceImages) ? input.referenceImages.filter(Boolean) : [];
    const normalizedDrivingAudio = input.drivingAudio ? await normalizeMediaValueForRemote(input.drivingAudio) : '';
    const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        size,
        seconds,
        n: input.count,
    };
    if (isGardenFlowCompatibleEndpoint(input.endpoint)) {
        body.resolution = input.resolution === '1080p' ? '1080P' : '720P';
        body.duration = input.durationSeconds;

        if (input.generationMode === 'text-to-video') {
            if (normalizedDrivingAudio) {
                body.audio_url = normalizedDrivingAudio;
                body.driving_audio_url = normalizedDrivingAudio;
            }
        } else if (input.generationMode === 'reference-guided') {
            const referenceImages = await Promise.all(refs.slice(0, 5).map((item) => normalizeMediaValueForRemote(item)));
            const normalizedRefs = referenceImages.filter(Boolean);
            if (normalizedRefs.length) {
                body.images = normalizedRefs;
                body.reference_images = normalizedRefs;
                body.reference_image_urls = normalizedRefs;
                body.image_urls = normalizedRefs;
                body.image = normalizedRefs[0];
                body.image_url = normalizedRefs[0];
                body.reference_image = normalizedRefs[0];
                body.img_url = normalizedRefs[0];
            }
            if (normalizedDrivingAudio) {
                body.reference_voice = normalizedDrivingAudio;
                body.reference_voice_url = normalizedDrivingAudio;
                body.audio_url = normalizedDrivingAudio;
            }
        } else if (input.generationMode === 'first-last-frame') {
            const firstFrame = refs[0] ? await normalizeMediaValueForRemote(refs[0]) : '';
            const lastFrame = refs[1] ? await normalizeMediaValueForRemote(refs[1]) : '';
            if (firstFrame || lastFrame) {
                body.video_mode = 'first_last_frame';
                body.media = [
                    ...(firstFrame ? [{ type: 'first_frame', url: firstFrame }] : []),
                    ...(lastFrame ? [{ type: 'last_frame', url: lastFrame }] : []),
                    ...(normalizedDrivingAudio ? [{ type: 'driving_audio', url: normalizedDrivingAudio }] : []),
                ];
                if (firstFrame) {
                    body.image = firstFrame;
                    body.image_url = firstFrame;
                    body.reference_image = firstFrame;
                    body.img_url = firstFrame;
                }
                body.images = [firstFrame, lastFrame].filter(Boolean);
                if (lastFrame) {
                    body.last_frame = lastFrame;
                    body.last_frame_url = lastFrame;
                    body.last_image_url = lastFrame;
                }
                if (normalizedDrivingAudio) {
                    body.audio_url = normalizedDrivingAudio;
                    body.driving_audio_url = normalizedDrivingAudio;
                }
            }
        } else if (input.generationMode === 'continuation') {
            const firstClip = input.firstClip ? await normalizeMediaValueForRemote(input.firstClip) : '';
            if (firstClip) {
                body.video_mode = 'continuation';
                body.media = [{ type: 'first_clip', url: firstClip }];
                body.first_clip_url = firstClip;
                body.video_url = firstClip;
                body.video = firstClip;
            }
        }
    } else {
        if (refs[0]) {
            body.image = refs[0];
            body.image_url = refs[0];
            body.reference_image = refs[0];
            body.img_url = refs[0];
        }
        if (refs.length > 0) {
            body.images = refs.slice(0, 2);
        }
        if (normalizedDrivingAudio) {
            body.audio_url = normalizedDrivingAudio;
            body.driving_audio_url = normalizedDrivingAudio;
        }
    }
    let response: Response | null = null;
    let payload: any = {};
    let lastError = '';
    let lastNetworkError = '';
    for (const requestUrl of createUrls) {
        try {
            response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${input.apiKey}`,
                },
                body: JSON.stringify(body),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'fetch failed');
            lastNetworkError = `[${requestUrl}] ${message}`;
            lastError = `生视频网络请求失败：${lastNetworkError}`;
            console.warn('[VideoGeneration] async create failed, trying fallback route', {
                requestUrl,
                error: message,
            });
            continue;
        }
        if (response.ok) {
            payload = await response.json().catch(() => ({}));
            break;
        }
        const errorText = await response.text();
        lastError = `生视频异步创建失败 (${response.status}): ${errorText || response.statusText || 'request failed'}`;
        if (response.status !== 404) {
            throw new Error(lastError);
        }
    }
    if (!response?.ok) {
        if (lastNetworkError) {
            throw new Error(`生视频异步创建网络失败（请检查代理/网络/TLS）：${lastNetworkError}`);
        }
        throw new Error(lastError || '生视频异步创建失败');
    }

    const taskId = extractTaskId(payload);
    if (!taskId) {
        throw new Error('生视频异步创建成功，但接口未返回 task_id。');
    }
    console.log('[VideoGeneration] async task created', {
        model: input.model,
        taskId,
        requestId: String(payload?.request_id || '').trim(),
        endpoint: input.endpoint,
    });

    const deadline = Date.now() + VIDEO_TASK_POLL_TIMEOUT_MS;
    let finalPayload: any = payload;
    let finalStatus = extractTaskStatus(payload);
    let queryLastError = '';
    let queryLastNetworkError = '';

    while (Date.now() < deadline) {
        if (finalStatus === 'SUCCEEDED') {
            break;
        }
        if (finalStatus === 'FAILED' || finalStatus === 'CANCELLED') {
            const failure = extractTaskFailureMessage(finalPayload);
            throw new Error(`生视频异步任务失败：${failure || finalStatus}`);
        }

        await sleep(VIDEO_TASK_POLL_INTERVAL_MS);
        response = null;

        for (const queryUrl of queryUrls) {
            try {
                response = await fetch(queryUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${input.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: input.model,
                        task_id: taskId,
                    }),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'fetch failed');
                queryLastNetworkError = `[${queryUrl}] ${message}`;
                console.warn('[VideoGeneration] async query failed, trying fallback route', {
                    queryUrl,
                    error: message,
                    taskId,
                });
                continue;
            }

            if (response.ok) {
                finalPayload = await response.json().catch(() => ({}));
                finalStatus = extractTaskStatus(finalPayload);
                console.log('[VideoGeneration] async task polled', {
                    taskId,
                    status: finalStatus || 'UNKNOWN',
                    requestId: String(finalPayload?.request_id || payload?.request_id || '').trim(),
                });
                break;
            }

            const errorText = await response.text();
            queryLastError = `生视频异步查询失败 (${response.status}): ${errorText || response.statusText || 'request failed'}`;
            if (response.status !== 404) {
                throw new Error(queryLastError);
            }
        }

        if (!response?.ok && queryLastNetworkError) {
            queryLastError = `生视频异步查询网络失败（请检查代理/网络/TLS）：${queryLastNetworkError}`;
        }
    }

    if (finalStatus !== 'SUCCEEDED') {
        if (queryLastError) {
            throw new Error(queryLastError);
        }
        throw new Error(`生视频异步任务超时，task_id=${taskId}`);
    }

    const videoUrls = extractCompatibleVideoUrls(finalPayload);
    if (!videoUrls.length) {
        throw new Error('生视频任务已完成，但接口未返回可下载的视频地址。');
    }

    const assets: MediaAsset[] = [];
    for (const videoUrl of videoUrls.slice(0, input.count)) {
        const downloaded = await fetchGeneratedVideoBuffer(videoUrl, input.apiKey);
        const asset = await createGeneratedMediaAsset({
            prompt: input.prompt,
            dataBuffer: downloaded.buffer,
            mimeType: downloaded.mimeType,
            projectId: input.projectId?.trim() || undefined,
            provider: input.endpoint.toLowerCase().includes('/gardenflow/') ? 'gardenflow' : 'openai-compatible',
            model: input.model,
            aspectRatio: input.aspectRatio,
            size: input.resolution,
            quality: `${input.durationSeconds}s`,
            title: input.title?.trim() || undefined,
        });
        assets.push(asset);
    }

    if (!assets.length) {
        throw new Error('生视频任务已完成，但没有可保存的视频文件。');
    }

    return {
        model: input.model,
        endpoint: input.endpoint,
        provider: input.endpoint.toLowerCase().includes('/gardenflow/') ? 'gardenflow' : 'openai-compatible',
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        durationSeconds: input.durationSeconds,
        generateAudio: false,
        assets,
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

/**
 * new-api 任务查询有两种响应形态：
 * - 包裹格式 `{ code, data: { status, result_url, fail_reason, data } }`（阿里/MiniMax 渠道）
 * - 扁平格式 `{ task_id, status, url, metadata, error }`（OpenAI 风格）
 * URL 取值按 result_url → url/metadata.url → fail_reason（< v0.11.0 复用该字段承载成功 URL）
 * → 上游原始响应 三级兜底。
 */
function extractNewApiVideoUrl(payload: any): string {
    const pickUrl = (value: unknown): string => {
        const text = String(value || '').trim();
        return /^https?:\/\//i.test(text) ? text : '';
    };
    const root = asRecord(payload);
    const wrapped = asRecord(root.data);
    const candidates = [
        wrapped.result_url,
        root.result_url,
        wrapped.url,
        root.url,
        asRecord(wrapped.metadata).url,
        asRecord(root.metadata).url,
        wrapped.fail_reason,
        root.fail_reason,
    ];
    for (const candidate of candidates) {
        const url = pickUrl(candidate);
        if (url) return url;
    }
    const upstream = wrapped.data;
    if (upstream && typeof upstream === 'object') {
        const url = extractCompatibleVideoUrls(upstream)[0];
        if (url) return url;
    }
    return extractCompatibleVideoUrls(root)[0] || '';
}

function extractNewApiFailureMessage(payload: any): string {
    const root = asRecord(payload);
    const wrapped = asRecord(root.data);
    const failReason = String(wrapped.fail_reason || root.fail_reason || '').trim();
    // 成功时旧版本会把视频 URL 塞进 fail_reason，不能当成错误信息回显。
    if (failReason && !/^https?:\/\//i.test(failReason)) {
        if (/raw\.githubusercontent\.com|cdn\.jsdelivr\.net/i.test(failReason) && /Failed to download|Model not exist/i.test(failReason)) {
            return `${failReason}。阿里云通常拉不下 GitHub Raw / 官方 jsDelivr，请把图床公开访问方式改成国内镜像。`;
        }
        return failReason;
    }
    return extractTaskFailureMessage(payload);
}

async function generateViaNewApiVideoRoute(input: {
    prompt: string;
    endpoint: string;
    apiKey: string;
    model: string;
    count: number;
    aspectRatio: '16:9' | '9:16';
    resolution: '720p' | '1080p';
    durationSeconds: number;
    title?: string;
    projectId?: string;
    referenceImages?: string[];
    generationMode: VideoGenerationMode;
    maxReferenceImages: number;
}): Promise<GenerateVideosResult> {
    if (input.generationMode === 'continuation') {
        throw new Error('私有网关的两个视频上游均不支持“视频续写”模式。');
    }
    const meta = getPrivateGatewayVideoModelMeta(input.model);
    if (!meta) {
        throw new Error(`${input.model} 不在私有网关的视频模型清单中，请先在 shared/privateGateway.ts 中登记其上游与支持的模式。`);
    }
    const createUrl = buildPrivateGatewayVideoCreateUrl(input.endpoint);
    if (!createUrl) {
        throw new Error('私有网关生视频 Endpoint 无效。');
    }

    const refs = (Array.isArray(input.referenceImages) ? input.referenceImages : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, input.generationMode === 'first-last-frame' ? 2 : input.maxReferenceImages);
    const normalizedRefs = (await Promise.all(refs.map((item) => normalizeMediaValueForRemote(item)))).filter(Boolean);
    if (normalizedRefs.length) {
        console.log('[VideoGeneration] reference images hosted', {
            count: normalizedRefs.length,
            urls: normalizedRefs,
        });
    }
    if (normalizedRefs.some((item) => item.startsWith('data:') || /^[A-Za-z0-9+/=]+$/.test(item))) {
        // 实测：data URL / 本地转码图打到阿里 r2v 会变成 InvalidParameter / Model not exist。
        throw new Error('私有网关参考图生视频目前只接受公网可达的图片 URL。请先在设置中配置图床，或直接提供 https 图片地址。');
    }

    const assets: MediaAsset[] = [];
    for (let index = 0; index < input.count; index += 1) {
        const body = buildPrivateGatewayVideoRequest({
            model: input.model,
            prompt: input.prompt,
            upstream: meta.upstream,
            generationMode: input.generationMode,
            referenceImages: normalizedRefs,
            resolution: input.resolution,
            durationSeconds: input.durationSeconds,
            maxReferenceImages: input.maxReferenceImages,
            aspectRatio: input.aspectRatio,
        });
        console.log('[VideoGeneration] new-api create request', {
            model: input.model,
            durationSeconds: input.durationSeconds,
            resolution: input.resolution,
            aspectRatio: input.aspectRatio,
            mediaUrls: normalizedRefs,
            promptLength: input.prompt.length,
        });
        let response: Response | undefined;
        let createPayload: any;
        const maxCreateAttempts = 3;
        for (let attempt = 1; attempt <= maxCreateAttempts; attempt += 1) {
            try {
                response = await fetch(createUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${input.apiKey}`,
                    },
                    body: JSON.stringify(body),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'fetch failed');
                throw new Error(`私有网关生视频网络请求失败（请检查内网连通性、Endpoint 或防火墙）：${message}`);
            }
            createPayload = await response.json().catch(async () => ({ message: await response?.text().catch(() => '') }));
            if (response.ok) break;
            const failureMessage = extractNewApiFailureMessage(createPayload) || response.statusText || 'request failed';
            if (attempt < maxCreateAttempts && shouldRetryPrivateGatewayVideoCreate(response.status, failureMessage)) {
                console.log('[VideoGeneration] new-api create retry', {
                    attempt,
                    status: response.status,
                    failureMessage,
                });
                await sleep(1500 * attempt);
                continue;
            }
            throw new VideoGenerationProviderError(
                `私有网关生视频创建失败 (${response.status})：${failureMessage}`,
                { statusCode: response.status, terminal: response.status >= 400 && response.status < 500 },
            );
        }
        if (!response?.ok) {
            throw new VideoGenerationProviderError(
                `私有网关生视频创建失败 (${response?.status || 400})：${extractNewApiFailureMessage(createPayload) || 'request failed'}`,
                { statusCode: response?.status, terminal: true },
            );
        }
        const taskId = extractTaskId(createPayload) || String(createPayload?.id || '').trim();
        if (!taskId) {
            throw new Error('私有网关生视频创建成功，但接口未返回 task_id。');
        }
        const queryUrl = buildPrivateGatewayVideoQueryUrl(input.endpoint, taskId);
        if (!queryUrl) {
            throw new Error('私有网关生视频查询地址无效。');
        }
        console.log('[VideoGeneration] new-api task created', {
            model: input.model,
            upstream: meta.upstream,
            taskId,
            endpoint: createUrl,
        });

        const deadline = Date.now() + NEW_API_VIDEO_TASK_POLL_TIMEOUT_MS;
        let finalPayload: any = createPayload;
        let finalStatus = extractTaskStatus(createPayload);
        while (Date.now() < deadline) {
            if (NEW_API_VIDEO_SUCCESS_STATUSES.has(finalStatus)) break;
            if (NEW_API_VIDEO_FAILURE_STATUSES.has(finalStatus)) {
                throw new VideoGenerationProviderError(
                    `私有网关生视频任务失败：${extractNewApiFailureMessage(finalPayload) || finalStatus}`,
                    { terminal: true },
                );
            }
            await sleep(NEW_API_VIDEO_TASK_POLL_INTERVAL_MS);
            let queryResponse: Response;
            try {
                queryResponse = await fetch(queryUrl, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${input.apiKey}` },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'fetch failed');
                throw new Error(`私有网关生视频任务查询网络失败：${message}`);
            }
            finalPayload = await queryResponse.json().catch(async () => ({ message: await queryResponse.text().catch(() => '') }));
            if (!queryResponse.ok) {
                throw new VideoGenerationProviderError(
                    `私有网关生视频任务查询失败 (${queryResponse.status})：${extractNewApiFailureMessage(finalPayload) || queryResponse.statusText || 'request failed'}`,
                    { statusCode: queryResponse.status, terminal: queryResponse.status >= 400 && queryResponse.status < 500 },
                );
            }
            finalStatus = extractTaskStatus(finalPayload);
            console.log('[VideoGeneration] new-api task polled', {
                taskId,
                status: finalStatus || 'UNKNOWN',
                progress: String(asRecord(asRecord(finalPayload).data).progress || '').trim(),
            });
        }
        if (!NEW_API_VIDEO_SUCCESS_STATUSES.has(finalStatus)) {
            throw new Error(`私有网关生视频任务超时，task_id=${taskId}`);
        }
        const videoUrl = extractNewApiVideoUrl(finalPayload);
        if (!videoUrl) {
            throw new Error('私有网关生视频任务已完成，但接口未返回可下载的视频地址。');
        }
        const downloaded = await fetchGeneratedVideoBuffer(videoUrl, input.apiKey);
        assets.push(await createGeneratedMediaAsset({
            prompt: input.prompt,
            dataBuffer: downloaded.buffer,
            mimeType: downloaded.mimeType,
            projectId: input.projectId?.trim() || undefined,
            provider: 'new-api',
            model: input.model,
            aspectRatio: input.aspectRatio,
            size: input.resolution,
            quality: `${input.durationSeconds}s`,
            title: input.title?.trim() || undefined,
        }));
    }

    return {
        model: input.model,
        endpoint: input.endpoint,
        provider: 'new-api',
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        durationSeconds: input.durationSeconds,
        generateAudio: false,
        assets,
    };
}

async function generateViaMiniMaxVideoRoute(input: {
    prompt: string;
    endpoint: string;
    apiKey: string;
    model: string;
    count: number;
    aspectRatio: '16:9' | '9:16';
    resolution: '720p' | '1080p';
    durationSeconds: number;
    title?: string;
    projectId?: string;
    referenceImages?: string[];
    referenceAudios?: string[];
    generationMode: VideoGenerationMode;
    generateAudio?: boolean;
}): Promise<GenerateVideosResult> {
    if (input.generationMode === 'continuation') {
        throw new Error('MiniMax-H3 当前配置支持文生视频、参考生成和首尾帧生成；视频再生成需要独立接口，暂不支持“视频续写”模式。');
    }
    const createUrl = buildMiniMaxVideoCreateUrl(input.endpoint);
    if (!createUrl) {
        throw new Error('MiniMax 生视频 Endpoint 无效。');
    }
    const refs = (Array.isArray(input.referenceImages) ? input.referenceImages : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, input.generationMode === 'first-last-frame' ? 2 : 9);
    const normalizedRefs = (await Promise.all(refs.map((item) => normalizeMediaValueForRemote(item)))).filter(Boolean);
    const referenceAudios = (Array.isArray(input.referenceAudios) ? input.referenceAudios : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 3);
    const normalizedReferenceAudios = (
        await Promise.all(referenceAudios.map((item) => normalizeMediaValueForRemote(item)))
    ).filter(Boolean).map(normalizeMiniMaxReferenceAudioUrl);
    const assets: MediaAsset[] = [];

    for (let index = 0; index < input.count; index += 1) {
        const body = buildMiniMaxVideoRequest({
            model: input.model,
            prompt: input.prompt,
            referenceImages: normalizedRefs,
            referenceAudios: normalizedReferenceAudios,
            generationMode: input.generationMode,
            resolution: input.resolution,
            aspectRatio: input.aspectRatio,
            durationSeconds: input.durationSeconds,
        });
        let response: Response;
        try {
            response = await fetch(createUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${input.apiKey}`,
                },
                body: JSON.stringify(body),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || 'fetch failed');
            throw new Error(`MiniMax 生视频网络请求失败（请检查 Endpoint、网络或 TLS）：${message}`);
        }
        const createPayload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
        if (!response.ok) {
            throw new VideoGenerationProviderError(
                `MiniMax 生视频创建失败 (${response.status})：${extractTaskFailureMessage(createPayload) || response.statusText || 'request failed'}`,
                { statusCode: response.status, terminal: response.status >= 400 && response.status < 500 },
            );
        }
        const taskId = extractTaskId(createPayload);
        if (!taskId) {
            throw new Error('MiniMax 生视频创建成功，但接口未返回 task_id。');
        }
        const queryUrl = buildMiniMaxVideoQueryUrl(input.endpoint, taskId);
        if (!queryUrl) {
            throw new Error('MiniMax 生视频查询地址无效。');
        }
        console.log('[VideoGeneration] MiniMax task created', {
            model: input.model,
            taskId,
            requestId: String(createPayload?.request_id || '').trim(),
            endpoint: createUrl,
        });

        const deadline = Date.now() + MINIMAX_VIDEO_TASK_POLL_TIMEOUT_MS;
        let finalPayload: any = createPayload;
        let finalStatus = extractTaskStatus(createPayload);
        while (Date.now() < deadline) {
            if (finalStatus === 'SUCCEEDED') break;
            if (finalStatus === 'FAILED' || finalStatus === 'CANCELLED' || finalStatus === 'CANCELED') {
                throw new VideoGenerationProviderError(
                    `MiniMax 生视频任务失败：${extractTaskFailureMessage(finalPayload) || finalStatus}`,
                    { terminal: true },
                );
            }
            await sleep(MINIMAX_VIDEO_TASK_POLL_INTERVAL_MS);
            try {
                response = await fetch(queryUrl, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${input.apiKey}` },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'fetch failed');
                throw new Error(`MiniMax 生视频任务查询网络失败：${message}`);
            }
            finalPayload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
            if (!response.ok) {
                throw new VideoGenerationProviderError(
                    `MiniMax 生视频任务查询失败 (${response.status})：${extractTaskFailureMessage(finalPayload) || response.statusText || 'request failed'}`,
                    { statusCode: response.status, terminal: response.status >= 400 && response.status < 500 },
                );
            }
            finalStatus = extractTaskStatus(finalPayload);
            console.log('[VideoGeneration] MiniMax task polled', {
                taskId,
                status: finalStatus || 'UNKNOWN',
                requestId: String(finalPayload?.request_id || createPayload?.request_id || '').trim(),
            });
        }
        if (finalStatus !== 'SUCCEEDED') {
            throw new Error(`MiniMax 生视频任务超时，task_id=${taskId}`);
        }
        const videoUrl = extractCompatibleVideoUrls(finalPayload)[0];
        if (!videoUrl) {
            throw new Error('MiniMax 生视频任务已完成，但接口未返回 task.content.url。');
        }
        const downloaded = await fetchGeneratedVideoBuffer(videoUrl, input.apiKey);
        assets.push(await createGeneratedMediaAsset({
            prompt: input.prompt,
            dataBuffer: downloaded.buffer,
            mimeType: downloaded.mimeType,
            projectId: input.projectId?.trim() || undefined,
            provider: 'minimax',
            model: input.model,
            aspectRatio: input.aspectRatio,
            size: input.resolution,
            quality: `${input.durationSeconds}s`,
            title: input.title?.trim() || undefined,
        }));
    }

    return {
        model: input.model,
        endpoint: input.endpoint,
        provider: 'minimax',
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        durationSeconds: input.durationSeconds,
        generateAudio: Boolean(input.generateAudio),
        assets,
    };
}

async function generateViaAliyunBailianVideoRoute(input: {
    prompt: string;
    endpoint: string;
    apiKey: string;
    model: string;
    count: number;
    aspectRatio: '16:9' | '9:16';
    resolution: '720p' | '1080p';
    durationSeconds: number;
    title?: string;
    projectId?: string;
    referenceImages?: string[];
    generateAudio?: boolean;
}): Promise<GenerateVideosResult> {
    const configuredCreateUrl = buildAliyunBailianVideoCreateUrl(input.endpoint);
    const refs = (Array.isArray(input.referenceImages) ? input.referenceImages : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 9);
    if (!configuredCreateUrl) {
        throw new Error('阿里云百炼生视频 Endpoint 无效。');
    }
    if (isHappyHorseReferenceVideoModel(input.model) && refs.length === 0) {
        throw new Error(`${input.model} 是参考图生视频模型，至少需要 1 张参考图；请在参考图模式上传素材，或改用文生视频模型。`);
    }

    const normalizedRefs = (await Promise.all(refs.map((item) => normalizeMediaValueForRemote(item)))).filter(Boolean);
    const assets: MediaAsset[] = [];
    let effectiveEndpoint = aliyunEndpointFallbacks.get(configuredCreateUrl) || configuredCreateUrl;

    for (let index = 0; index < input.count; index += 1) {
        const body = buildAliyunBailianVideoRequest({
            model: input.model,
            prompt: input.prompt,
            referenceImages: normalizedRefs,
            resolution: input.resolution,
            aspectRatio: input.aspectRatio,
            durationSeconds: input.durationSeconds,
        });
        const createUrlCandidates = effectiveEndpoint === configuredCreateUrl
            ? buildAliyunBailianVideoCreateUrlCandidates(input.endpoint)
            : [effectiveEndpoint];
        let response: Response | null = null;
        let createPayload: any = null;
        let createUrl = effectiveEndpoint;
        for (const [candidateIndex, candidateUrl] of createUrlCandidates.entries()) {
            createUrl = candidateUrl;
            try {
                response = await fetch(createUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${input.apiKey}`,
                        'X-DashScope-Async': 'enable',
                    },
                    body: JSON.stringify(body),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'fetch failed');
                throw new Error(`阿里云百炼生视频网络请求失败（请检查 Endpoint、网络或 TLS）：${message}`);
            }
            createPayload = await response.json().catch(async () => ({ message: await response?.text().catch(() => '') }));
            if (response.ok) {
                effectiveEndpoint = createUrl;
                if (createUrl !== configuredCreateUrl) {
                    aliyunEndpointFallbacks.set(configuredCreateUrl, createUrl);
                }
                break;
            }
            const failureMessage = extractTaskFailureMessage(createPayload) || response.statusText || 'request failed';
            const canUsePublicFallback = response.status === 403
                && /workspace endpoint access denied/i.test(failureMessage)
                && candidateIndex < createUrlCandidates.length - 1;
            if (canUsePublicFallback) {
                console.warn('[VideoGeneration] workspace endpoint denied, retrying public Beijing endpoint', {
                    configuredEndpoint: createUrl,
                    fallbackEndpoint: createUrlCandidates[candidateIndex + 1],
                });
                continue;
            }
            throw new Error(`阿里云百炼生视频创建失败 (${response.status})：${failureMessage}`);
        }
        if (!response?.ok) {
            throw new Error('阿里云百炼生视频创建失败：未找到可用的 Endpoint。');
        }

        const taskId = extractTaskId(createPayload);
        if (!taskId) {
            throw new Error('阿里云百炼生视频创建成功，但接口未返回 output.task_id。');
        }
        const queryUrl = buildAliyunBailianVideoTaskUrl(effectiveEndpoint, taskId);
        console.log('[VideoGeneration] Aliyun Bailian task created', {
            model: input.model,
            taskId,
            requestId: String(createPayload?.request_id || '').trim(),
            endpoint: createUrl,
        });

        const deadline = Date.now() + ALIYUN_VIDEO_TASK_POLL_TIMEOUT_MS;
        let finalPayload: any = createPayload;
        let finalStatus = extractTaskStatus(createPayload);
        while (Date.now() < deadline) {
            if (finalStatus === 'SUCCEEDED') break;
            if (finalStatus === 'FAILED' || finalStatus === 'CANCELED' || finalStatus === 'CANCELLED' || finalStatus === 'UNKNOWN') {
                const failure = extractTaskFailureMessage(finalPayload);
                throw new Error(`阿里云百炼生视频任务失败：${failure || finalStatus}`);
            }

            await sleep(ALIYUN_VIDEO_TASK_POLL_INTERVAL_MS);
            try {
                response = await fetch(queryUrl, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${input.apiKey}`,
                    },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'fetch failed');
                throw new Error(`阿里云百炼生视频任务查询网络失败：${message}`);
            }
            const queryResponse = response;
            if (!queryResponse) {
                throw new Error('阿里云百炼生视频任务查询未返回响应。');
            }
            finalPayload = await queryResponse.json().catch(async () => ({ message: await queryResponse.text().catch(() => '') }));
            if (!queryResponse.ok) {
                throw new Error(`阿里云百炼生视频任务查询失败 (${queryResponse.status})：${extractTaskFailureMessage(finalPayload) || queryResponse.statusText || 'request failed'}`);
            }
            finalStatus = extractTaskStatus(finalPayload);
            console.log('[VideoGeneration] Aliyun Bailian task polled', {
                taskId,
                status: finalStatus || 'UNKNOWN',
                requestId: String(finalPayload?.request_id || createPayload?.request_id || '').trim(),
            });
        }

        if (finalStatus !== 'SUCCEEDED') {
            throw new Error(`阿里云百炼生视频任务超时，task_id=${taskId}`);
        }
        const videoUrl = extractCompatibleVideoUrls(finalPayload)[0];
        if (!videoUrl) {
            throw new Error('阿里云百炼生视频任务已完成，但接口未返回 output.video_url。');
        }
        const downloaded = await fetchGeneratedVideoBuffer(videoUrl, input.apiKey);
        assets.push(await createGeneratedMediaAsset({
            prompt: input.prompt,
            dataBuffer: downloaded.buffer,
            mimeType: downloaded.mimeType,
            projectId: input.projectId?.trim() || undefined,
            provider: 'aliyun-bailian',
            model: input.model,
            aspectRatio: input.aspectRatio,
            size: input.resolution,
            quality: `${input.durationSeconds}s`,
            title: input.title?.trim() || undefined,
        }));
    }

    return {
        model: input.model,
        endpoint: effectiveEndpoint,
        provider: 'aliyun-bailian',
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        durationSeconds: input.durationSeconds,
        generateAudio: Boolean(input.generateAudio),
        assets,
    };
}

export async function generateVideosToMediaLibrary(input: GenerateVideosInput): Promise<GenerateVideosResult> {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) {
        throw new Error('Prompt is required');
    }

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const generationMode = (String(input.generationMode || '').trim() || 'text-to-video') as VideoGenerationMode;
    const configuredRoute = resolveVideoModelRoute(settings, input.model);
    const endpoint = normalizeApiBaseUrl(
        String(input.endpoint || configuredRoute?.provider.endpoint || settings.video_endpoint || GARDENFLOW_OFFICIAL_VIDEO_BASE_URL).trim(),
        GARDENFLOW_OFFICIAL_VIDEO_BASE_URL
    );
    const configuredModel = String(input.model || configuredRoute?.model || settings.video_model || '').trim();
    const model = configuredModel || getGardenFlowOfficialVideoModel(generationMode);
    const provider = resolveVideoProvider(endpoint, model);
    const inputApiKey = String(input.apiKey || '').trim();
    const videoApiKey = String(configuredRoute?.provider.apiKey || settings.video_api_key || '').trim();
    const globalApiKey = String(settings.api_key || '').trim();
    // 直连上游需要各自的专用 key；private new-api 网关与官方源共用同一个 sk- 令牌，
    // 因此可以回落到全局 api_key。
    const providerRequiresDedicatedKey = provider === 'aliyun-bailian' || provider === 'minimax';
    const apiKey = inputApiKey || videoApiKey || (providerRequiresDedicatedKey ? '' : globalApiKey);
    const selectedKeySource = inputApiKey
        ? 'input.apiKey'
        : videoApiKey
            ? 'settings.video_api_key'
            : !providerRequiresDedicatedKey && globalApiKey
                ? 'settings.api_key'
                : 'none';
    const aspectRatio = normalizeVideoAspectRatio(String(input.aspectRatio || '').trim());
    const resolution = normalizeVideoResolution(String(input.resolution || '').trim());
    const modelCapabilities = getVideoModelCapabilities(model, endpoint);
    const durationSeconds = normalizeVideoDuration(
        input.durationSeconds,
        provider === 'aliyun-bailian'
            ? { min: 3, max: 15 }
            : provider === 'minimax'
                ? { min: 4, max: 15 }
                : provider === 'new-api'
                    ? {
                        min: modelCapabilities.durationSeconds[0] ?? 4,
                        max: modelCapabilities.durationSeconds[modelCapabilities.durationSeconds.length - 1] ?? 15,
                    }
                    : { min: 5, max: 12 },
    );
    const count = Math.max(1, Math.min(2, Number(input.count) || 1));
    const generateAudio = Boolean(input.generateAudio);
    const maxReferenceImages = provider === 'aliyun-bailian' || provider === 'minimax'
        ? 9
        : provider === 'new-api'
            ? Math.max(modelCapabilities.maxReferenceImages, generationMode === 'first-last-frame' ? 2 : 0)
            : generationMode === 'reference-guided' ? 5 : 2;
    const referenceImages = Array.isArray(input.referenceImages)
        ? input.referenceImages.filter(Boolean).slice(0, maxReferenceImages)
        : [];
    const referenceAudios = Array.isArray(input.referenceAudios)
        ? input.referenceAudios.filter(Boolean)
        : [];
    const drivingAudio = String(input.drivingAudio || '').trim();
    const firstClip = String(input.firstClip || '').trim();
    if (!endpoint) {
        throw new Error('生视频 Endpoint 未配置。请先在设置中填写视频服务地址。');
    }
    if (!apiKey) {
        throw new Error(provider === 'aliyun-bailian'
            ? '阿里云百炼 API Key 未配置。请在生视频模型设置中填写 DASHSCOPE_API_KEY。'
            : provider === 'minimax'
                ? 'MiniMax API Key 未配置。请在生视频模型设置中填写 MINIMAX_API_KEY。'
                : provider === 'new-api'
                    ? '私有网关令牌未配置。请在设置中为官方源或该视频服务商填写 sk- 开头的网关令牌。'
                    : '生视频 API Key 未配置。请先在设置中填写视频服务密钥。');
    }
    if (!modelCapabilities.supportedModes.includes(generationMode)) {
        throw new Error(`${model} 不支持“${generationMode}”模式。该模型支持：${modelCapabilities.supportedModes.join('、')}。`);
    }
    if (!modelCapabilities.durationSeconds.includes(durationSeconds)) {
        throw new Error(`${model} 不支持 ${durationSeconds} 秒视频。可用时长：${modelCapabilities.durationSeconds.join('、')} 秒。`);
    }
    if (!modelCapabilities.aspectRatios.includes(aspectRatio)) {
        throw new Error(`${model} 不支持 ${aspectRatio} 视频比例。`);
    }
    if (!modelCapabilities.resolutions.includes(resolution)) {
        throw new Error(`${model} 不支持 ${resolution} 清晰度。`);
    }
    if (generateAudio && !modelCapabilities.supportsGeneratedAudio) {
        throw new Error(`${model} 当前不支持同步生成音频，请关闭音频选项后重试。`);
    }
    console.log('[VideoGeneration] auth prepared', {
        endpoint,
        keySource: selectedKeySource,
        keySuffix: maskKeySuffix(apiKey),
        videoKeySuffix: maskKeySuffix(videoApiKey),
        globalKeySuffix: maskKeySuffix(globalApiKey),
        model,
        provider,
        generationMode,
        hasDrivingAudio: Boolean(drivingAudio),
        referenceAudioCount: referenceAudios.length,
    });
    if (referenceAudios.length > 0 && generationMode !== 'reference-guided') {
        throw new Error('参考音频只能在多模态参考模式中使用。');
    }
    if (referenceAudios.length > 0 && !modelCapabilities.supportsReferenceAudio) {
        throw new Error(`${model} 不支持参考音频输入。`);
    }
    if (referenceAudios.length > modelCapabilities.maxReferenceAudios) {
        throw new Error(`${model} 最多支持 ${modelCapabilities.maxReferenceAudios} 段参考音频。`);
    }
    const invalidReferenceAudio = referenceAudios.find((item) => {
        const format = inferReferenceAudioFormat(item);
        return format && !modelCapabilities.referenceAudioFormats.includes(format);
    });
    if (invalidReferenceAudio) {
        throw new Error(`${model} 的参考音频仅支持 ${modelCapabilities.referenceAudioFormats.join('、').toUpperCase()} 格式。`);
    }
    if (generationMode === 'reference-guided' && referenceImages.length < 1 && referenceAudios.length < 1) {
        throw new Error('多模态参考模式至少需要 1 个参考素材。');
    }
    if (generationMode === 'reference-guided') {
        const range = videoModeReferenceRange(modelCapabilities, generationMode);
        if (referenceImages.length < range.min || referenceImages.length > range.max) {
            throw new Error(`${model} 的参考图数量需要为 ${range.min === range.max ? `${range.min} 张` : `${range.min}–${range.max} 张`}。`);
        }
    }
    if (provider === 'aliyun-bailian' && isHappyHorseReferenceVideoModel(model) && referenceImages.length < 1) {
        throw new Error(`${model} 是参考图生视频模型，至少需要 1 张参考图；请在参考图模式上传素材，或改用文生视频模型。`);
    }
    if (generationMode === 'first-last-frame' && referenceImages.length < 2) {
        throw new Error('首尾帧视频模式需要 2 张参考图。');
    }
    if (generationMode === 'continuation' && !firstClip) {
        throw new Error('视频续写模式需要 1 段起始视频。');
    }

    if (provider === 'aliyun-bailian') {
        return generateViaAliyunBailianVideoRoute({
            prompt,
            endpoint,
            apiKey,
            model,
            count,
            aspectRatio,
            resolution,
            durationSeconds,
            title: input.title,
            projectId: input.projectId,
            referenceImages,
            generateAudio,
        });
    }

    if (provider === 'new-api') {
        return generateViaNewApiVideoRoute({
            prompt,
            endpoint,
            apiKey,
            model,
            count,
            aspectRatio,
            resolution,
            durationSeconds,
            title: input.title,
            projectId: input.projectId,
            referenceImages,
            generationMode,
            maxReferenceImages,
        });
    }

    if (provider === 'minimax') {
        return generateViaMiniMaxVideoRoute({
            prompt,
            endpoint,
            apiKey,
            model,
            count,
            aspectRatio,
            resolution,
            durationSeconds,
            title: input.title,
            projectId: input.projectId,
            referenceImages,
            referenceAudios,
            generationMode,
            generateAudio,
        });
    }

    return generateViaOpenAiCompatibleVideoRoute({
        prompt,
        endpoint,
        apiKey,
        model,
        count,
        aspectRatio,
        resolution,
        durationSeconds,
        title: input.title,
        projectId: input.projectId,
        referenceImages,
        generationMode,
        drivingAudio,
        firstClip,
    });
}
