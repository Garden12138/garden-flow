export const XCLI_IMAGE_AGENTS = ['auto', 'codex', 'antigravity', 'cursor'] as const;
export type XcliImageAgent = typeof XCLI_IMAGE_AGENTS[number];

export const XCLI_IMAGE_AGENT_LABELS: Record<XcliImageAgent, string> = {
    auto: '自动（推荐）',
    codex: 'Codex',
    antigravity: 'Antigravity',
    cursor: 'Cursor',
};

export function normalizeXcliImageAgent(value: unknown): XcliImageAgent {
    const text = String(value ?? '').trim().toLowerCase();
    return XCLI_IMAGE_AGENTS.find((agent) => agent === text) ?? 'auto';
}

// Migrate saved HTTP gateway sources to the local image-only CLI.
export function normalizeXcliSource<T extends Record<string, unknown>>(source: T): T {
    if (source.presetId !== 'xcli') return source;
    const rawBase = String(source.baseURL ?? source.baseUrl ?? '').trim();
    return {
        ...source,
        baseURL: !rawBase || /^https?:\/\//i.test(rawBase) ? 'xcli' : rawBase,
        apiKey: '',
        model: normalizeXcliImageAgent(source.model),
        models: [...XCLI_IMAGE_AGENTS],
        modelsMeta: XCLI_IMAGE_AGENTS.map((id) => ({ id, capabilities: ['image'], inputCapabilities: [] })),
    };
}
