import type { DouyinVideoVersion, DouyinPublishJob } from './platformVideoVersion';

export interface TikTokPublishSettings {
    visibility: 'everyone' | 'friends' | 'only_me';
    allowComments: boolean;
    allowReuse: boolean;
    allowRemix: boolean;
    audience18Plus: boolean;
    commercialContent: 'none' | 'own_brand' | 'paid_partnership';
    aiGenerated: boolean;
}

interface TikTokVideoVersionBase extends Omit<DouyinVideoVersion, 'coverAssetId' | 'sourceProductId' | 'sourceProductUpdatedAt'> {
    language: string;
    market: string;
    publishSettings?: TikTokPublishSettings;
    coverFrame?: { timeMs: number; renderId: string };
}

export type TikTokVideoSource = { kind: 'product'; productId: string; productUpdatedAt: string }
    | { kind: 'dream-story'; projectId: string; revision: string; targetDigest: string };
export type TikTokVideoVersion = TikTokVideoVersionBase & (
    { source?: Extract<TikTokVideoSource, { kind: 'product' }>; sourceProductId: string; sourceProductUpdatedAt: string }
    | { source: Extract<TikTokVideoSource, { kind: 'dream-story' }>; sourceProductId?: never; sourceProductUpdatedAt?: never }
);

export function normalizeTikTokVideoVersion(value: TikTokVideoVersion): TikTokVideoVersion {
    if (value.source) return value;
    if (!value.sourceProductId || !value.sourceProductUpdatedAt) throw new Error('旧 TikTok 版本缺少商品来源');
    return { ...value, sourceProductId: value.sourceProductId, sourceProductUpdatedAt: value.sourceProductUpdatedAt,
        source: { kind: 'product', productId: value.sourceProductId, productUpdatedAt: value.sourceProductUpdatedAt } };
}

export interface TikTokPublishJob extends Omit<DouyinPublishJob, 'platform' | 'imageCover'> {
    platform: 'tiktok';
    language: string;
    market: string;
    publishSettings: TikTokPublishSettings;
    mediaSha256: string;
    mediaSize: number;
    mediaDurationMs?: number;
    receipt?: TikTokPostReceipt;
}

export interface TikTokPostReceipt {
    source: 'tiktok-studio-posts';
    videoId: string;
    url: string;
    accountId: string;
    caption: string;
    visibility: TikTokPublishSettings['visibility'];
    durationText: string;
    publishedLabel: string;
    observedAt: number;
}

export interface TikTokLocalizationProposal {
    id: string;
    versionId: string;
    expectedRevision: number;
    projectUpdatedAt: string;
    language: string;
    market: string;
    title: string;
    description: string;
    hashtags: string[];
    scenes: Array<{ sceneId: string; overlayText: string; narrationText: string }>;
}

export function validateTikTokPublishSettings(value: unknown): TikTokPublishSettings {
    const settings = value as Partial<TikTokPublishSettings> | null;
    if (!settings || !['everyone', 'friends', 'only_me'].includes(String(settings.visibility))
        || !['none', 'own_brand', 'paid_partnership'].includes(String(settings.commercialContent))
        || [settings.allowComments, settings.allowReuse, settings.allowRemix, settings.audience18Plus, settings.aiGenerated].some(value => typeof value !== 'boolean')) {
        throw new Error('请明确选择 TikTok 可见范围、评论及内容标记后再准备发布');
    }
    if (settings.commercialContent === 'paid_partnership' && settings.visibility === 'only_me') {
        throw new Error('品牌合作内容不能选择仅自己可见，请核对 TikTok 的实际可用范围');
    }
    return { visibility: settings.visibility!, allowComments: settings.allowComments!, allowReuse: settings.allowReuse!,
        allowRemix: settings.allowRemix!, audience18Plus: settings.audience18Plus!,
        commercialContent: settings.commercialContent!, aiGenerated: settings.aiGenerated! };
}
