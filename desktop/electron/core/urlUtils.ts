const TERMINAL_API_SUFFIXES = [
    '/chat/completions',
    '/responses',
    '/completions',
    '/embeddings',
    '/audio/transcriptions',
    '/images/generations',
];

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

export function parseMediaProviderEndpoint(endpoint: string): URL {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error('媒体服务地址无效，请填写包含 http:// 或 https:// 的完整地址。');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('媒体服务地址必须为 HTTP(S) URL，且不能包含账号、密码、查询参数或片段。');
    }
    return url;
}

export const normalizeApiBaseUrl = (value: string, fallback = ''): string => {
    const raw = String(value || '').trim() || String(fallback || '').trim();
    if (!raw) {
        return '';
    }

    try {
        const url = new URL(raw);
        const normalizedPath = trimTrailingSlashes(url.pathname || '');
        const matchedSuffix = TERMINAL_API_SUFFIXES.find((suffix) => normalizedPath.endsWith(suffix));
        if (matchedSuffix) {
            const stripped = normalizedPath.slice(0, normalizedPath.length - matchedSuffix.length);
            url.pathname = stripped || '/';
            url.search = '';
            url.hash = '';
        }
        return trimTrailingSlashes(url.toString());
    } catch {
        return trimTrailingSlashes(raw);
    }
};

export const safeUrlJoin = (baseURL: string, nextPath: string): string => {
    const normalized = normalizeApiBaseUrl(baseURL);
    if (!normalized) {
        return nextPath;
    }
    if (normalized.endsWith(nextPath)) {
        return normalized;
    }
    return `${normalized}${nextPath.startsWith('/') ? '' : '/'}${nextPath}`;
};

export const normalizeRemoteAssetUrl = (value: string): string => {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    if (raw.startsWith('//')) {
        return `https:${raw}`;
    }
    return raw;
};
