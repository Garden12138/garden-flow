export type AudioModelSource = {
    id: string;
    name: string;
    baseURL: string;
    apiKey: string;
    presetId: string;
    protocol: string;
    models: string[];
};

export type AudioModelRoute = {
    source: AudioModelSource | null;
    model: string;
    baseURL: string;
    apiKey: string;
};

export type DashScopeMiniMaxSpeechRequest = {
    model: string;
    input: {
        text: string;
        voice_setting: {
            voice_id: string;
            speed: number;
            vol: number;
            pitch: number;
            emotion?: string;
        };
        audio_setting: {
            sample_rate: number;
            bitrate: number;
            format: 'mp3' | 'wav' | 'flac' | 'pcm';
            channel: number;
        };
        language_boost?: string;
        subtitle_enable: boolean;
        output_format: 'hex';
    };
};

export type DashScopeMiniMaxSpeechResponse = {
    audio: string;
    encoding: 'hex' | 'url';
    format: string;
};

export type DashScopeMiniMaxVoice = {
    id: string;
    name: string;
    label: string;
    description: string[];
    source: 'system' | 'voice_cloning';
    systemVoice: boolean;
    targetTtsModel: string;
    supportedModels: string[];
    languageBoost: string;
    provider: 'dashscope';
};

export const DASHSCOPE_MINIMAX_DEFAULT_VOICE_ID = 'male-qn-qingse';
export const DASHSCOPE_MINIMAX_VOICE_QUERY_MODEL = 'MiniMax/speech-2.8-turbo';
export const DASHSCOPE_MINIMAX_EMOTIONS = [
    'happy',
    'sad',
    'angry',
    'fearful',
    'disgusted',
    'surprised',
    'calm',
    'whisper',
] as const;
export const DASHSCOPE_MINIMAX_LANGUAGES = [
    'Chinese',
    'English',
    'Arabic',
    'Russian',
    'Spanish',
    'French',
    'Portuguese',
    'German',
    'Turkish',
    'Dutch',
    'Ukrainian',
    'Vietnamese',
    'Indonesian',
    'Japanese',
    'Italian',
    'Korean',
    'Thai',
    'Polish',
    'Romanian',
    'Greek',
    'Czech',
    'Finnish',
    'Hindi',
    'Bulgarian',
    'Danish',
    'Hebrew',
    'Malay',
    'Persian',
    'Slovak',
    'Swedish',
    'Croatian',
    'Filipino',
    'Hungarian',
    'Norwegian',
    'Slovenian',
    'Catalan',
    'Nynorsk',
    'Tamil',
    'Afrikaans',
    'auto',
] as const;

function stringValue(value: unknown): string {
    return String(value || '').trim();
}

function parseArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value !== 'string' || !value.trim()) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(stringValue).filter(Boolean)));
}

export function parseAudioModelSources(value: unknown): AudioModelSource[] {
    return parseArray(value).flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const source = candidate as Record<string, unknown>;
        const modelsMeta = Array.isArray(source.modelsMeta) ? source.modelsMeta : [];
        const models = uniqueStrings([
            ...(Array.isArray(source.models) ? source.models : []),
            ...modelsMeta.map((item) => (
                item && typeof item === 'object' ? (item as Record<string, unknown>).id : ''
            )),
            source.model,
            source.modelName,
        ]);
        return [{
            id: stringValue(source.id) || `ai-source-${index + 1}`,
            name: stringValue(source.name) || 'AI source',
            baseURL: stringValue(source.baseURL) || stringValue(source.baseUrl) || stringValue(source.endpoint),
            apiKey: stringValue(source.apiKey) || stringValue(source.key),
            presetId: stringValue(source.presetId) || stringValue(source.preset_id),
            protocol: stringValue(source.protocol),
            models,
        }];
    });
}

function sourceContainsModel(source: AudioModelSource, model: string): boolean {
    const normalized = model.trim().toLowerCase();
    return Boolean(normalized) && source.models.some((candidate) => candidate.toLowerCase() === normalized);
}

export function resolveAudioModelRoute(
    settings: Record<string, unknown>,
    requestedModel = '',
): AudioModelRoute {
    const sources = parseAudioModelSources(settings.ai_sources_json);
    const routes = parseObject(settings.ai_model_routes_json);
    const voiceRoute = parseObject(routes.voiceTts);
    const routeSourceId = stringValue(voiceRoute.sourceId) || stringValue(voiceRoute.source_id);
    const configuredModel = stringValue(voiceRoute.model)
        || stringValue(voiceRoute.modelName)
        || stringValue(voiceRoute.model_name)
        || stringValue(settings.voice_tts_model)
        || stringValue(settings.tts_model);
    const requested = requestedModel.trim();
    const requestedCandidates = requested
        ? sources.filter((source) => sourceContainsModel(source, requested))
        : [];
    const model = requestedCandidates.length > 0
        ? requested
        : configuredModel || requested || 'gpt-4o-mini-tts';
    const candidates = sources.filter((source) => sourceContainsModel(source, model));
    const defaultSourceId = stringValue(settings.default_ai_source_id);
    const routeSource = routeSourceId ? sources.find((source) => source.id === routeSourceId) : undefined;
    const source = (
        routeSource && (sourceContainsModel(routeSource, model) || candidates.length === 0)
            ? routeSource
            : undefined
    )
        || (defaultSourceId ? candidates.find((candidate) => candidate.id === defaultSourceId) : undefined)
        || candidates[0]
        || null;

    return {
        source,
        model,
        baseURL: source?.baseURL
            || stringValue(settings.voice_endpoint)
            || stringValue(settings.tts_endpoint)
            || stringValue(settings.api_endpoint),
        apiKey: source?.apiKey
            || stringValue(settings.voice_api_key)
            || stringValue(settings.tts_api_key)
            || stringValue(settings.api_key),
    };
}

export function isDashScopeMiniMaxSpeechRoute(model: string, baseURL: string): boolean {
    const normalizedModel = model.trim();
    if (!/^MiniMax\/speech-/i.test(normalizedModel)) return false;
    try {
        const host = new URL(baseURL).hostname.toLowerCase();
        return host === 'dashscope.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com');
    } catch {
        return /(?:dashscope|\.maas)\.aliyuncs\.com/i.test(baseURL);
    }
}

export function buildDashScopeMultimodalGenerationUrl(baseURL: string): string {
    const endpoint = baseURL.trim();
    if (!endpoint) return '';
    const suffix = '/services/aigc/multimodal-generation/generation';
    try {
        const url = new URL(endpoint);
        let pathname = url.pathname.replace(/\/+$/, '');
        if (pathname.endsWith(suffix)) return url.toString().replace(/\/$/, '');
        pathname = pathname.replace(/\/compatible-mode\/v1$/i, '/api/v1');
        if (!/\/api\/v1$/i.test(pathname)) pathname = `${pathname}/api/v1`;
        url.pathname = `${pathname}${suffix}`.replace(/\/{2,}/g, '/');
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        const normalized = endpoint.replace(/\/+$/, '').replace(/\/compatible-mode\/v1$/i, '/api/v1');
        const base = /\/api\/v1$/i.test(normalized) ? normalized : `${normalized}/api/v1`;
        return `${base}${suffix}`;
    }
}

function normalizeLanguageBoost(value: string): string {
    const normalized = value.trim();
    if (!normalized) return '';
    const aliases: Record<string, string> = {
        zh: 'Chinese',
        'zh-cn': 'Chinese',
        chinese: 'Chinese',
        en: 'English',
        'en-us': 'English',
        english: 'English',
    };
    return aliases[normalized.toLowerCase()] || normalized;
}

export function buildDashScopeMiniMaxSpeechRequest(input: {
    model: string;
    text: string;
    voiceId?: string;
    speed?: number;
    emotion?: string;
    languageBoost?: string;
    responseFormat?: string;
}): DashScopeMiniMaxSpeechRequest {
    const speed = Number.isFinite(input.speed) ? Number(input.speed) : 1;
    if (speed < 0.5 || speed > 2) {
        throw new Error('MiniMax 语速必须在 0.5–2.0 之间');
    }
    const format = (input.responseFormat || 'mp3').trim().toLowerCase();
    if (!['mp3', 'wav', 'flac', 'pcm'].includes(format)) {
        throw new Error(`MiniMax 不支持 ${format} 音频格式，请选择 mp3、wav 或 flac`);
    }
    const emotion = (input.emotion || '').trim().toLowerCase();
    if (emotion && !DASHSCOPE_MINIMAX_EMOTIONS.includes(emotion as typeof DASHSCOPE_MINIMAX_EMOTIONS[number])) {
        throw new Error(`MiniMax 不支持 ${emotion} 情绪`);
    }
    if (emotion === 'whisper' && /speech-2\.8-/i.test(input.model)) {
        throw new Error(`${input.model} 不支持 whisper 情绪`);
    }
    const languageBoost = normalizeLanguageBoost(input.languageBoost || '');
    return {
        model: input.model,
        input: {
            text: input.text,
            voice_setting: {
                voice_id: (input.voiceId || '').trim() || DASHSCOPE_MINIMAX_DEFAULT_VOICE_ID,
                speed,
                vol: 1,
                pitch: 0,
                ...(emotion ? { emotion } : {}),
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: format as 'mp3' | 'wav' | 'flac' | 'pcm',
                channel: 1,
            },
            ...(languageBoost ? { language_boost: languageBoost } : {}),
            subtitle_enable: false,
            output_format: 'hex',
        },
    };
}

function dashScopeOutput(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') throw new Error('DashScope 返回了无效响应');
    const payload = value as Record<string, unknown>;
    const output = payload.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
        throw new Error(stringValue(payload.message) || stringValue(payload.code) || 'DashScope 响应缺少 output');
    }
    const result = output as Record<string, unknown>;
    const baseResponse = parseObject(result.base_resp);
    const statusCode = Number(baseResponse.status_code);
    if (Number.isFinite(statusCode) && statusCode !== 0) {
        throw new Error(`DashScope MiniMax 错误 ${statusCode}: ${stringValue(baseResponse.status_msg) || '语音生成失败'}`);
    }
    return result;
}

export function parseDashScopeMiniMaxSpeechResponse(value: unknown): DashScopeMiniMaxSpeechResponse {
    const output = dashScopeOutput(value);
    const data = parseObject(output.data);
    const audio = stringValue(data.audio);
    if (!audio) throw new Error('DashScope MiniMax 响应缺少音频数据');
    const extraInfo = parseObject(output.extra_info);
    return {
        audio,
        encoding: /^https?:\/\//i.test(audio) ? 'url' : 'hex',
        format: stringValue(extraInfo.audio_format) || 'mp3',
    };
}

export function parseDashScopeMiniMaxVoices(value: unknown, targetModel: string): DashScopeMiniMaxVoice[] {
    const output = dashScopeOutput(value);
    const languageBoost = DASHSCOPE_MINIMAX_LANGUAGES.join(',');
    const voiceGroups: Array<{ key: 'system_voice' | 'voice_cloning'; source: 'system' | 'voice_cloning' }> = [
        { key: 'system_voice', source: 'system' },
        { key: 'voice_cloning', source: 'voice_cloning' },
    ];
    return voiceGroups.flatMap(({ key, source }) => {
        const values = Array.isArray(output[key]) ? output[key] as unknown[] : [];
        return values.flatMap((candidate) => {
            if (!candidate || typeof candidate !== 'object') return [];
            const voice = candidate as Record<string, unknown>;
            const id = stringValue(voice.voice_id) || stringValue(voice.id);
            if (!id) return [];
            const name = stringValue(voice.voice_name) || stringValue(voice.name) || id;
            return [{
                id,
                name,
                label: name,
                description: Array.isArray(voice.description)
                    ? voice.description.map(stringValue).filter(Boolean)
                    : [],
                source,
                systemVoice: source === 'system',
                targetTtsModel: targetModel,
                supportedModels: [targetModel],
                languageBoost,
                provider: 'dashscope',
            } satisfies DashScopeMiniMaxVoice];
        });
    });
}

export function createDashScopeMiniMaxFallbackVoice(targetModel: string): DashScopeMiniMaxVoice {
    return {
        id: DASHSCOPE_MINIMAX_DEFAULT_VOICE_ID,
        name: '青涩青年音色',
        label: '青涩青年音色',
        description: [],
        source: 'system',
        systemVoice: true,
        targetTtsModel: targetModel,
        supportedModels: [targetModel],
        languageBoost: DASHSCOPE_MINIMAX_LANGUAGES.join(','),
        provider: 'dashscope',
    };
}
