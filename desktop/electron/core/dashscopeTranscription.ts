const FLASH_ASR_MODEL = /^qwen-audio-3\.[01]-asr-flash(?:-\d{4}-\d{2}-\d{2})?$/i;
const AUDIO_FORMATS: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/flac': 'flac' };

export function supportsDashscopeFlashTranscription(endpoint: string, model: string): boolean {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && !url.username && !url.password
            && (['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'].includes(url.hostname) || url.hostname.endsWith('.maas.aliyuncs.com'))
            && FLASH_ASR_MODEL.test(model);
    } catch {
        return false;
    }
}

/** Qwen Audio 3.x Flash uses the native multimodal API, not /audio/transcriptions. */
export async function transcribeDashscopeFlash(input: {
    endpoint: string; model: string; apiKey: string; audioBuffer: Buffer; mimeType: string; sampleRate?: number;
}, request: typeof fetch = fetch): Promise<string> {
    if (!supportsDashscopeFlashTranscription(input.endpoint, input.model)) throw new Error('当前端点或模型不支持百炼 Flash 语音识别');
    const format = AUDIO_FORMATS[input.mimeType];
    if (!format || input.audioBuffer.length === 0) throw new Error('语音识别需要有效的音频文件');
    const prefix = `data:${input.mimeType};base64,`;
    if (prefix.length + Math.ceil(input.audioBuffer.length / 3) * 4 > 10 * 1024 * 1024) throw new Error('百炼 Flash 音频编码后超过 10 MB，请使用更短的音频');
    const response = await request(new URL('/api/v1/services/aigc/multimodal-generation/generation', input.endpoint), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'disable' },
        body: JSON.stringify({
            model: input.model,
            input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: prefix + input.audioBuffer.toString('base64') } }] }] },
            parameters: { format, ...(input.sampleRate ? { sample_rate: input.sampleRate } : {}) },
        }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { code?: unknown; message?: unknown };
        const code = typeof error.code === 'string' && /^[\w.-]{1,100}$/.test(error.code) ? error.code : '';
        const message = typeof error.message === 'string' ? error.message.replaceAll(input.apiKey, '[redacted]').replace(/data:audio\/[^\s"']+/g, '[redacted audio]').slice(0, 300) : '';
        throw new Error(`百炼语音识别请求失败：HTTP ${response.status}${code ? ` ${code}` : ''}${message ? ` — ${message}` : ''}`);
    }
    const payload = await response.json() as { output?: { text?: unknown; sentence?: { text?: unknown } } };
    const text = payload.output?.text ?? payload.output?.sentence?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('百炼语音识别未返回有效文本');
    return text.trim();
}
