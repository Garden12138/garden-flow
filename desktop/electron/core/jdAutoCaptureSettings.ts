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

export function resolveJdAutoCaptureLaunch(
    settings: Record<string, unknown>,
    nowMs = Date.now(),
): {
    allKeywords: string[];
    keyword: string;
    reviewFilterLabels: string[];
    reviewsPerFilter: number;
    maxProductsPerRun: number;
    pacing: 'normal' | 'conservative';
} {
    const allKeywords = Array.from(new Set(toStringList(settings.keywords))).slice(0, 50);
    const dayIndex = Math.floor(nowMs / (24 * 60 * 60 * 1_000));
    const keyword = allKeywords.length > 0 ? allKeywords[dayIndex % allKeywords.length] : '';
    return {
        allKeywords,
        keyword,
        reviewFilterLabels: Array.from(new Set(toStringList(settings.reviewFilterLabels))).slice(0, 50),
        reviewsPerFilter: clampNumber(settings.reviewsPerFilter, 5, 1, 50),
        maxProductsPerRun: clampNumber(settings.maxProductsPerRun, 5, 1, 20),
        pacing: textValue(settings.pacing) === 'normal' ? 'normal' : 'conservative',
    };
}
