const RENDERABLE_ASSET_PROTOCOL = /^(https?:|file:|local-file:|redbox-asset:|data:|blob:)/i;

export function resolveRuntimeAssetUrl(assetPath: string): string {
    const raw = String(assetPath || '').trim();
    if (!raw) return '';
    if (RENDERABLE_ASSET_PROTOCOL.test(raw)) return raw;

    const normalized = raw.replace(/^\.?\/+/, '');
    if (!normalized) return '';
    if (typeof window === 'undefined') return `./${normalized}`;

    try {
        const href = String(window.location.href || '');
        if (/^(local-file|redbox-asset):/i.test(href)) {
            const fileBaseHref = href
                .replace(/^local-file:/i, 'file:')
                .replace(/^redbox-asset:\/\/asset\//i, 'file:///');
            return new URL(normalized, fileBaseHref).toString();
        }
        return new URL(normalized, href).toString();
    } catch {
        return `./${normalized}`;
    }
}
