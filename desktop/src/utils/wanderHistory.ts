export type WanderHistorySourceMode = 'inspiration' | 'comment_insight';

export interface WanderHistorySubjectRef {
    id: string;
    name: string;
    categoryId?: string;
    categoryName?: string;
    description?: string;
    tags: string[];
    attributes: Array<{ key: string; value: string }>;
    primaryPreviewUrl?: string;
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function normalizeWanderHistorySubjectRefs(raw: unknown): WanderHistorySubjectRef[] {
    const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item): WanderHistorySubjectRef | null => {
        if (!item || typeof item !== 'object') return null;
        const payload = item as Record<string, unknown>;
        const id = String(payload.id || '').trim();
        const name = String(payload.name || '').trim();
        if (!id || !name) return null;
        return {
            id,
            name,
            categoryId: String(payload.categoryId || '').trim() || undefined,
            categoryName: String(payload.categoryName || '').trim() || undefined,
            description: String(payload.description || '').trim() || undefined,
            tags: Array.isArray(payload.tags)
                ? payload.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
                : [],
            attributes: Array.isArray(payload.attributes)
                ? payload.attributes.map((attribute) => {
                    const value = attribute && typeof attribute === 'object'
                        ? attribute as Record<string, unknown>
                        : {};
                    return {
                        key: String(value.key || '').trim(),
                        value: String(value.value || '').trim(),
                    };
                }).filter((attribute) => attribute.key && attribute.value)
                : [],
            primaryPreviewUrl: String(payload.primaryPreviewUrl || '').trim() || undefined,
        };
    }).filter((item): item is WanderHistorySubjectRef => Boolean(item));
}

export function resolveWanderHistorySourceMode(input: {
    sourceMode?: unknown;
    resultSourceMode?: unknown;
    items?: Array<{ meta?: Record<string, unknown> }>;
}): WanderHistorySourceMode {
    const persistedMode = String(input.sourceMode || '').trim().toLowerCase();
    if (persistedMode === 'comment_insight' || persistedMode === 'comments' || persistedMode === 'comment') {
        return 'comment_insight';
    }
    if (persistedMode === 'inspiration' || persistedMode === 'random') {
        return 'inspiration';
    }
    const hasCommentSource = (input.items || []).some((item) => {
        const meta = item.meta || {};
        return String(meta.sourceType || meta.captureKind || meta.type || '').trim().toLowerCase() === 'xhs-comments';
    });
    if (hasCommentSource) return 'comment_insight';
    const resultMode = String(input.resultSourceMode || '').trim().toLowerCase();
    return resultMode === 'comment_insight' || resultMode === 'comments' || resultMode === 'comment'
        ? 'comment_insight'
        : 'inspiration';
}
