export type SocialCapturePlatform = 'xiaohongshu' | 'douyin' | 'tiktok';

export type SocialComment = {
    id?: string;
    parentCommentId?: string;
    rootCommentId?: string;
    level?: number;
    author?: string;
    authorProfileUrl?: string;
    text?: string;
    likes?: number;
    replies?: number;
    createdAt?: string;
    location?: string;
};

export type SocialCaptureState = {
    status: 'complete' | 'partial';
    blocker?: 'BROWSER_LOGIN_REQUIRED' | 'BROWSER_SECURITY_CHALLENGE' | 'BROWSER_RATE_LIMITED';
    media: 'complete' | 'partial';
    comments: 'complete' | 'partial' | 'skipped';
    commentLimit: number;
    capturedComments: number;
    errors: string[];
    commentErrors?: string[];
};

export const SOCIAL_CAPTURE_LABELS = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok' } as const;

export function socialPlatformFromUrl(value: string): SocialCapturePlatform | null {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
        const host = url.hostname.toLowerCase();
        const domains = { xiaohongshu: ['xiaohongshu.com', 'rednote.com', 'xhslink.com'], douyin: ['douyin.com', 'iesdouyin.com'], tiktok: ['tiktok.com'] };
        for (const [platform, hosts] of Object.entries(domains)) {
            if (hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return platform as SocialCapturePlatform;
        }
    } catch { /* Invalid input has no platform. */ }
    return null;
}

export function socialExternalId(value: string, platform: SocialCapturePlatform): string {
    if (socialPlatformFromUrl(value) !== platform) return '';
    const url = new URL(value);
    if (platform === 'xiaohongshu') return url.pathname.match(/\/(?:explore|discovery\/item)\/([a-z\d]+)/i)?.[1] || '';
    if (platform === 'douyin') return url.searchParams.get('modal_id') || url.searchParams.get('aweme_id') || url.pathname.match(/\/(?:video|note|share\/video)\/(\d+)/)?.[1] || '';
    return url.pathname.match(/\/@[^/]+\/(?:video|photo)\/(\d+)/)?.[1] || '';
}

export function mergeSocialComments(previous: SocialComment[], incoming: SocialComment[]): SocialComment[] {
    const comments = new Map<string, SocialComment>();
    const positions = new Map<string, number>();
    let position = 0;
    for (const item of [...previous, ...incoming]) {
        if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
        const key = item.id || `${item.authorProfileUrl || item.author || ''}|${item.createdAt || ''}|${item.text}`;
        const populated = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined && value !== null && (typeof value !== 'string' || value.trim())));
        comments.set(key, { ...comments.get(key), ...populated });
        positions.set(key, position++);
    }
    // Older DOM snapshots used profile|displayed-time|text until the platform
    // exposed the real comment ID. Upgrade only an unambiguous same-author,
    // same-day match; distinct real IDs must remain separate comments.
    const groups = new Map<string, Array<{ key: string; item: SocialComment; fallback: boolean }>>();
    for (const [key, item] of comments) {
        const date = item.createdAt?.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T|\s|$)/);
        if (!item.authorProfileUrl || !date) continue;
        const day = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
        let profile: string;
        try { profile = new URL(item.authorProfileUrl).href; } catch { continue; }
        const first = item.id?.indexOf('|') ?? -1;
        const second = first >= 0 ? item.id!.indexOf('|', first + 1) : -1;
        let fallback = !item.id;
        if (second >= 0 && item.id!.slice(first + 1, second) === item.createdAt && item.id!.slice(second + 1) === item.text) {
            try { fallback = new URL(item.id!.slice(0, first), profile).href === profile; } catch { /* Not a generated DOM identifier. */ }
        }
        const fingerprint = JSON.stringify([profile, day, item.text, item.parentCommentId || item.rootCommentId || '', item.level || 0]);
        const group = groups.get(fingerprint) || [];
        group.push({ key, item, fallback });
        groups.set(fingerprint, group);
    }
    const upgradedIds = new Map<string, string>();
    for (const group of groups.values()) {
        const real = group.filter((entry) => !entry.fallback);
        const fallbacks = group.filter((entry) => entry.fallback);
        if (real.length !== 1 || !fallbacks.length) continue;
        const preferred = real[0];
        let merged: SocialComment = {};
        for (const entry of group.sort((a, b) => positions.get(a.key)! - positions.get(b.key)!)) merged = { ...merged, ...entry.item };
        merged.id = preferred.item.id;
        merged.createdAt = preferred.item.createdAt;
        for (const entry of fallbacks) {
            if (entry.item.id && preferred.item.id) upgradedIds.set(entry.item.id, preferred.item.id);
            comments.delete(entry.key);
        }
        comments.set(preferred.key, merged);
    }
    for (const item of comments.values()) {
        if (item.parentCommentId && upgradedIds.has(item.parentCommentId)) item.parentCommentId = upgradedIds.get(item.parentCommentId);
        if (item.rootCommentId && upgradedIds.has(item.rootCommentId)) item.rootCommentId = upgradedIds.get(item.rootCommentId);
    }
    return [...comments.values()].slice(-10000);
}
