export const GARDENFLOW_ASSET_PROTOCOL = 'gardenflow-asset';
export const GARDENFLOW_ASSET_HOST = 'asset';

export interface LocalAssetByteRange {
    start: number;
    end: number;
}

export function resolveLocalAssetByteRange(rangeHeader: string | null, fileSize: number): LocalAssetByteRange | null {
    const raw = String(rangeHeader || '').trim();
    if (!raw || !Number.isSafeInteger(fileSize) || fileSize <= 0) return null;

    const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
    if (!match || (!match[1] && !match[2])) return null;

    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
        return {
            start: Math.max(0, fileSize - suffixLength),
            end: fileSize - 1,
        };
    }

    const start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize) return null;

    const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;

    return {
        start,
        end: Math.min(requestedEnd, fileSize - 1),
    };
}

export function safeDecodeUriComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function isWindowsAbsoluteLocalPath(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(String(value || '').trim());
}

export function isUncLocalPath(value: string): boolean {
    return String(value || '').trim().startsWith('\\\\');
}

function decodeEncodedLocalPathSource(value: string): string {
    const raw = String(value || '').trim();
    if (!/%(?:2f|5c|3a)/i.test(raw)) return raw;
    const decoded = safeDecodeUriComponent(raw);
    if (/^[a-zA-Z]:[\\/]/.test(decoded) || /^[\\/]/.test(decoded)) {
        return decoded;
    }
    return raw;
}

export function isLikelyAbsoluteLocalPath(value: string): boolean {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (isWindowsAbsoluteLocalPath(raw) || isUncLocalPath(raw)) return true;
    return raw.startsWith('/') || raw.startsWith('\\');
}

export function isFileUrl(value: string): boolean {
    return /^file:/i.test(String(value || '').trim());
}

export function isGardenFlowAssetUrl(value: string): boolean {
    return String(value || '').toLowerCase().startsWith(`${GARDENFLOW_ASSET_PROTOCOL}://`);
}

export function isLocalAssetSource(value: string): boolean {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (isGardenFlowAssetUrl(raw) || isFileUrl(raw) || isLikelyAbsoluteLocalPath(raw)) {
        return true;
    }
    const decoded = decodeEncodedLocalPathSource(raw);
    return decoded !== raw && isLikelyAbsoluteLocalPath(decoded);
}

function normalizeAssetPathForUrl(pathValue: string): string {
    const raw = String(pathValue || '').trim().replace(/\\/g, '/');
    if (!raw) return '';
    if (raw.startsWith('//')) return raw;
    if (/^\/[a-zA-Z]:\//.test(raw)) return raw.slice(1);
    if (isWindowsAbsoluteLocalPath(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    return `/${raw.replace(/^\/+/, '')}`;
}

function normalizeUriForParsing(raw: string): string {
    return String(raw || '')
        .trim()
        .replace(/^file:\/\/([a-zA-Z]:[\\/])/i, 'file:///$1')
        .replace(/^file:\/([a-zA-Z]:[\\/])/i, 'file:///$1')
        .replace(/^file:([a-zA-Z]:[\\/])/i, 'file:///$1')
        .replace(/\\/g, '/');
}

export function extractLocalAssetPathCandidate(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const localPathSource = decodeEncodedLocalPathSource(raw);
    if (isLikelyAbsoluteLocalPath(localPathSource)) {
        return normalizeAssetPathForUrl(localPathSource);
    }

    if (isGardenFlowAssetUrl(raw) || isFileUrl(raw)) {
        const parseTarget = normalizeUriForParsing(raw);
        try {
            const parsed = new URL(parseTarget);
            let pathname = safeDecodeUriComponent(parsed.pathname || '');
            const host = String(parsed.host || '').trim();
            if (host === GARDENFLOW_ASSET_HOST && pathname.startsWith('//')) {
                pathname = pathname.slice(1);
            }
            if (/^\/[a-zA-Z]:/.test(pathname)) {
                pathname = pathname.slice(1);
            } else if (host && host !== GARDENFLOW_ASSET_HOST && !/^localhost$/i.test(host)) {
                pathname = `//${host}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
            }
            return normalizeAssetPathForUrl(pathname);
        } catch {
            if (isGardenFlowAssetUrl(raw)) {
                return normalizeAssetPathForUrl(
                    safeDecodeUriComponent(raw.replace(new RegExp(`^${GARDENFLOW_ASSET_PROTOCOL}:\\/\\/${GARDENFLOW_ASSET_HOST}\\/?`, 'i'), '')),
                );
            }
            return normalizeAssetPathForUrl(
                safeDecodeUriComponent(normalizeUriForParsing(raw).replace(/^file:\/+/i, '')),
            );
        }
    }

    return '';
}

export function toGardenFlowAssetUrl(absolutePath: string): string {
    const normalized = normalizeAssetPathForUrl(absolutePath);
    if (!normalized) return '';
    return `${GARDENFLOW_ASSET_PROTOCOL}://${GARDENFLOW_ASSET_HOST}/${encodeURI(normalized)}`;
}

export function coerceToGardenFlowAssetUrl(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (isGardenFlowAssetUrl(raw)) {
        const pathCandidate = extractLocalAssetPathCandidate(raw);
        return pathCandidate ? toGardenFlowAssetUrl(pathCandidate) : raw;
    }
    if (isFileUrl(raw) || isLikelyAbsoluteLocalPath(raw)) {
        const pathCandidate = extractLocalAssetPathCandidate(raw);
        return pathCandidate ? toGardenFlowAssetUrl(pathCandidate) : '';
    }
    return raw;
}
