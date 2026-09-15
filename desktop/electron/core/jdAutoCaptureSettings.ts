export const JD_AUTO_CAPTURE_TASK_ID = 'jd-product-auto-capture';

function textValue(value: unknown): string {
    return String(value ?? '').trim();
}

function toStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => textValue(item)).filter(Boolean);
    }
    const raw = textValue(value);
    if (!raw) return [];
    return raw
        .split(/[,，\n|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeJdProductUrl(value: unknown): string {
    const raw = textValue(value);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        const hostname = url.hostname.toLowerCase();
        if (!/^https?:$/.test(url.protocol)) return '';
        if (!/(^|\.)jd\.(com|hk)$/.test(hostname)) return '';
        if (!/\/\d+\.html$/i.test(url.pathname)) return '';
        url.protocol = 'https:';
        url.hash = '';
        url.search = '';
        return url.toString();
    } catch {
        return '';
    }
}

export function resolveJdAutoCaptureLaunch(
    settings: Record<string, unknown>,
    nowMs = Date.now(),
): {
    allProductUrls: string[];
    productUrls: string[];
    invalidProductUrls: string[];
    reviewFilterLabels: string[];
    reviewsPerFilter: number;
    maxProductsPerRun: number;
    pacing: 'normal' | 'conservative';
} {
    const configuredUrls = Array.from(new Set(toStringList(settings.productUrls)));
    const normalizedUrls = configuredUrls.map((value) => normalizeJdProductUrl(value));
    const allProductUrls = Array.from(new Set(normalizedUrls.filter(Boolean)));
    const invalidProductUrls = configuredUrls.filter((_value, index) => !normalizedUrls[index]);
    const maxProductsPerRun = clampNumber(settings.maxProductsPerRun, 5, 1, 20);
    const count = Math.min(maxProductsPerRun, allProductUrls.length);
    const dayIndex = Math.floor(nowMs / (24 * 60 * 60 * 1_000));
    const startIndex = allProductUrls.length > 0 ? (dayIndex * maxProductsPerRun) % allProductUrls.length : 0;
    const productUrls = Array.from({ length: count }, (_unused, index) => (
        allProductUrls[(startIndex + index) % allProductUrls.length]
    ));
    return {
        allProductUrls,
        productUrls,
        invalidProductUrls,
        reviewFilterLabels: Array.from(new Set(toStringList(settings.reviewFilterLabels))).slice(0, 50),
        reviewsPerFilter: clampNumber(settings.reviewsPerFilter, 5, 1, 50),
        maxProductsPerRun,
        pacing: textValue(settings.pacing) === 'normal' ? 'normal' : 'conservative',
    };
}
