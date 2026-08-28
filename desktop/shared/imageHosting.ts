export type ImageHostingProviderType = 'github';

export type GithubPublicUrlStyle = 'jsdelivr' | 'jsdmirror' | 'raw';

export type ImageHostingGithubConfig = {
    repo: string;
    branch: string;
    token: string;
    pathPrefix: string;
    customDomain: string;
    publicUrlStyle: GithubPublicUrlStyle;
};

export type ImageHostingConfig = {
    id: string;
    name: string;
    type: ImageHostingProviderType;
    github: ImageHostingGithubConfig;
};

export type ImageHostingSettings = {
    enabled: boolean;
    activeId: string;
    configs: ImageHostingConfig[];
};

export const DEFAULT_IMAGE_HOSTING_CONFIG_ID = 'github-default';
export const IMAGE_HOSTING_JSON_KEY = 'image_hosting_json';

export function normalizeGithubPublicUrlStyle(value: unknown): GithubPublicUrlStyle {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'raw' || raw === 'github-raw' || raw === 'github') return 'raw';
    if (raw === 'jsdelivr' || raw === 'jsdelivr-official') return 'jsdelivr';
    return 'jsdmirror';
}

export const createDefaultGithubConfig = (overrides?: Partial<ImageHostingGithubConfig>): ImageHostingGithubConfig => {
    const next = {
        repo: '',
        branch: 'main',
        token: '',
        pathPrefix: '',
        customDomain: '',
        publicUrlStyle: 'jsdmirror' as GithubPublicUrlStyle,
        ...overrides,
    };
    return {
        ...next,
        publicUrlStyle: normalizeGithubPublicUrlStyle(next.publicUrlStyle),
    };
};

export const createDefaultImageHostingConfig = (overrides?: Partial<ImageHostingConfig>): ImageHostingConfig => ({
    id: String(overrides?.id || DEFAULT_IMAGE_HOSTING_CONFIG_ID),
    name: String(overrides?.name || 'GitHub'),
    type: 'github',
    github: createDefaultGithubConfig(overrides?.github),
});

export const createDefaultImageHostingSettings = (): ImageHostingSettings => ({
    enabled: false,
    activeId: DEFAULT_IMAGE_HOSTING_CONFIG_ID,
    configs: [createDefaultImageHostingConfig()],
});

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function parseRawSettings(value: unknown): unknown {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            return null;
        }
    }
    return value;
}

function normalizeGithubConfig(value: unknown): ImageHostingGithubConfig {
    const record = asRecord(value) || {};
    return createDefaultGithubConfig({
        repo: String(record.repo || '').trim(),
        branch: String(record.branch || '').trim() || 'main',
        token: String(record.token || '').trim(),
        pathPrefix: String(record.pathPrefix || record.path || '').trim(),
        customDomain: String(record.customDomain || record.customUrl || '').trim(),
        publicUrlStyle: normalizeGithubPublicUrlStyle(record.publicUrlStyle || record.urlStyle),
    });
}

function normalizeConfig(value: unknown, fallbackId: string): ImageHostingConfig | null {
    const record = asRecord(value);
    if (!record) return null;
    const type = String(record.type || 'github').trim();
    if (type !== 'github') return null;
    const id = String(record.id || '').trim() || fallbackId;
    const name = String(record.name || '').trim() || 'GitHub';
    return {
        id,
        name,
        type: 'github',
        github: normalizeGithubConfig(record.github),
    };
}

export function normalizeImageHostingSettings(value: unknown): ImageHostingSettings {
    const parsed = parseRawSettings(value);
    const record = asRecord(parsed);
    const defaults = createDefaultImageHostingSettings();
    if (!record) return defaults;

    const configs = Array.isArray(record.configs)
        ? record.configs
            .map((item, index) => normalizeConfig(item, `${DEFAULT_IMAGE_HOSTING_CONFIG_ID}-${index + 1}`))
            .filter((item): item is ImageHostingConfig => Boolean(item))
        : [];
    const nextConfigs = configs.length > 0 ? configs : defaults.configs;
    const requestedActiveId = String(record.activeId || '').trim();
    const activeId = nextConfigs.some((item) => item.id === requestedActiveId)
        ? requestedActiveId
        : nextConfigs[0].id;

    return {
        enabled: Boolean(record.enabled),
        activeId,
        configs: nextConfigs,
    };
}

export function serializeImageHostingSettings(value: unknown): string {
    return JSON.stringify(normalizeImageHostingSettings(value));
}

export function getActiveImageHostingConfig(settings: ImageHostingSettings): ImageHostingConfig {
    return settings.configs.find((item) => item.id === settings.activeId) || settings.configs[0] || createDefaultImageHostingConfig();
}

export function isGithubRepoName(repo: string): boolean {
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || '').trim());
}

export function isGithubImageHostingReady(config: ImageHostingConfig | null | undefined): boolean {
    if (!config || config.type !== 'github') return false;
    const github = config.github;
    return Boolean(
        isGithubRepoName(github.repo)
        && String(github.branch || '').trim()
        && String(github.token || '').trim(),
    );
}

export function isImageHostingReady(settings: ImageHostingSettings): boolean {
    return settings.enabled && isGithubImageHostingReady(getActiveImageHostingConfig(settings));
}

export function updateActiveImageHostingSettings(
    settings: ImageHostingSettings,
    patch: {
        enabled?: boolean;
        name?: string;
        github?: Partial<ImageHostingGithubConfig>;
    },
): ImageHostingSettings {
    const normalized = normalizeImageHostingSettings(settings);
    const active = getActiveImageHostingConfig(normalized);
    const nextActive: ImageHostingConfig = {
        ...active,
        name: patch.name !== undefined ? String(patch.name || '').trim() || 'GitHub' : active.name,
        github: createDefaultGithubConfig({
            ...active.github,
            ...patch.github,
        }),
    };
    return {
        enabled: patch.enabled === undefined ? normalized.enabled : Boolean(patch.enabled),
        activeId: nextActive.id,
        configs: normalized.configs.map((item) => (item.id === nextActive.id ? nextActive : item)),
    };
}
