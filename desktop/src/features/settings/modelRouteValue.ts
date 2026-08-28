export function parseAiModelRoutesValue(value: unknown): Record<string, unknown> {
    const parsed = typeof value === 'string'
        ? (() => {
            try {
                return JSON.parse(value || '{}');
            } catch {
                return null;
            }
        })()
        : value;

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
}
