export type ChatAssetReferenceLike = {
    id: string;
    name?: string;
};

export type PastedAssetMentionSegment<T extends ChatAssetReferenceLike> =
    | { type: 'text'; text: string }
    | { type: 'mention'; asset: T };

export type PastedAssetMentionPlan<T extends ChatAssetReferenceLike> = {
    segments: Array<PastedAssetMentionSegment<T>>;
    ambiguousNames: string[];
    matchedAssets: T[];
};

type AssetNameGroup<T extends ChatAssetReferenceLike> = {
    name: string;
    assets: T[];
};

function assetNameGroups<T extends ChatAssetReferenceLike>(available: T[]): Array<AssetNameGroup<T>> {
    const groups = new Map<string, T[]>();
    for (const asset of available) {
        const name = String(asset?.name || '').trim();
        const id = String(asset?.id || '').trim();
        if (!name || !id) continue;
        const current = groups.get(name) || [];
        if (!current.some((item) => String(item.id || '').trim() === id)) current.push(asset);
        groups.set(name, current);
    }
    return Array.from(groups.entries())
        .map(([name, assets]) => ({ name, assets }))
        .sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name, 'zh-CN'));
}

function isMentionBoundary(text: string, index: number): boolean {
    if (index >= text.length) return true;
    return !/[\p{L}\p{N}_]/u.test(text[index]);
}

function findNextAssetMention<T extends ChatAssetReferenceLike>(
    text: string,
    start: number,
    groups: Array<AssetNameGroup<T>>,
): { index: number; group: AssetNameGroup<T> } | null {
    let best: { index: number; group: AssetNameGroup<T> } | null = null;
    for (const group of groups) {
        const label = `@${group.name}`;
        let index = text.indexOf(label, start);
        while (index >= 0) {
            const prefixBoundary = index === 0 || isMentionBoundary(text, index - 1);
            const suffixBoundary = isMentionBoundary(text, index + label.length);
            if (prefixBoundary && suffixBoundary) break;
            index = text.indexOf(label, index + label.length);
        }
        if (index < 0) continue;
        if (!best || index < best.index || (index === best.index && group.name.length > best.group.name.length)) {
            best = { index, group };
        }
    }
    return best;
}

export function planPastedAssetMentions<T extends ChatAssetReferenceLike>(
    input: string,
    available: T[],
): PastedAssetMentionPlan<T> {
    const text = String(input || '');
    const groups = assetNameGroups(available);
    if (!text || groups.length === 0) {
        return {
            segments: text ? [{ type: 'text', text }] : [],
            ambiguousNames: [],
            matchedAssets: [],
        };
    }

    const segments: Array<PastedAssetMentionSegment<T>> = [];
    const ambiguousNames = new Set<string>();
    const matchedAssets = new Map<string, T>();
    const pushText = (value: string) => {
        if (!value) return;
        const previous = segments[segments.length - 1];
        if (previous?.type === 'text') {
            previous.text += value;
        } else {
            segments.push({ type: 'text', text: value });
        }
    };
    let offset = 0;
    while (offset < text.length) {
        const match = findNextAssetMention(text, offset, groups);
        if (!match) {
            pushText(text.slice(offset));
            break;
        }
        if (match.index > offset) {
            pushText(text.slice(offset, match.index));
        }
        const label = `@${match.group.name}`;
        if (match.group.assets.length === 1) {
            const asset = match.group.assets[0];
            segments.push({ type: 'mention', asset });
            matchedAssets.set(String(asset.id).trim(), asset);
        } else {
            pushText(label);
            ambiguousNames.add(match.group.name);
        }
        offset = match.index + label.length;
    }

    return {
        segments,
        ambiguousNames: Array.from(ambiguousNames),
        matchedAssets: Array.from(matchedAssets.values()),
    };
}

export function findPlainAssetMentionNames<T extends ChatAssetReferenceLike>(
    input: string,
    available: T[],
): string[] {
    const plan = planPastedAssetMentions(input, available);
    const names = new Set<string>(plan.ambiguousNames);
    for (const asset of plan.matchedAssets) {
        const name = String(asset.name || '').trim();
        if (name) names.add(name);
    }
    return Array.from(names);
}

export function resolveSubmittedAssetMentions<T extends ChatAssetReferenceLike>(
    mentionIds: string[],
    available: T[],
    selected: T[],
): T[] {
    const byId = new Map<string, T>();
    for (const item of [...available, ...selected]) {
        const id = String(item?.id || '').trim();
        if (id && !byId.has(id)) byId.set(id, item);
    }
    const seen = new Set<string>();
    return mentionIds.flatMap((rawId) => {
        const id = String(rawId || '').trim();
        if (!id || seen.has(id)) return [];
        seen.add(id);
        const item = byId.get(id);
        return item ? [item] : [];
    });
}
