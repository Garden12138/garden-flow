export type NewApiVideoUpstream = 'aliyun-bailian' | 'minimax';
export type NewApiVideoMode = 'text-to-video' | 'reference-guided' | 'first-last-frame';

export const NEW_API_VIDEO_CREATE_PATH = '/video/generations';

function buildNewApiUrl(endpoint: string, suffix: string): string {
    const raw = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}${suffix}`.replace(/\/{2,}/g, '/');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return `${raw}${suffix}`;
    }
}

export function buildNewApiVideoCreateUrl(endpoint: string): string {
    return buildNewApiUrl(endpoint, NEW_API_VIDEO_CREATE_PATH);
}

export function buildNewApiVideoQueryUrl(endpoint: string, taskId: string): string {
    const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
    return encodedTaskId ? buildNewApiUrl(endpoint, `${NEW_API_VIDEO_CREATE_PATH}/${encodedTaskId}`) : '';
}

export function shouldRetryNewApiVideoCreate(statusCode: number, message: string): boolean {
    return Number(statusCode) === 400 && (/Model not exist/i.test(String(message || '')) || /fail_to_fetch_task/i.test(String(message || '')));
}

export function buildNewApiVideoRequest(input: {
    model: string;
    prompt: string;
    upstream: NewApiVideoUpstream;
    generationMode: NewApiVideoMode;
    referenceImages: string[];
    resolution: '720p' | '1080p';
    durationSeconds: number;
    maxReferenceImages: number;
    aspectRatio?: '16:9' | '9:16';
}): Record<string, unknown> {
    const resolution = input.resolution === '1080p' ? '1080P' : '720P';
    const ratio = input.aspectRatio === '9:16' ? '9:16' : '16:9';
    const references = input.referenceImages.map((item) => String(item || '').trim()).filter(Boolean);
    if (input.upstream === 'aliyun-bailian') {
        return {
            model: input.model,
            prompt: input.prompt,
            duration: input.durationSeconds,
            metadata: {
                input: { media: references.slice(0, input.maxReferenceImages).map((url) => ({ type: 'reference_image', url })) },
                parameters: { resolution, ratio, duration: input.durationSeconds },
            },
        };
    }
    const metadata: Record<string, unknown> = { resolution };
    if (input.generationMode === 'first-last-frame') {
        if (references[0]) metadata.first_frame_image = references[0];
        if (references[1]) metadata.last_frame_image = references[1];
    } else if (input.generationMode === 'reference-guided' && references.length) {
        metadata.subject_reference = [{ type: 'character', image: references.slice(0, input.maxReferenceImages) }];
    }
    return { model: input.model, prompt: input.prompt, duration: input.durationSeconds, metadata };
}
