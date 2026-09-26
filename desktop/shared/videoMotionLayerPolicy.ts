export function shouldRenderVisualPlaceholder(
    assetKind: 'video' | 'image' | 'audio' | 'unknown' | undefined,
    showBaseMedia: boolean,
): boolean {
    return showBaseMedia && assetKind !== 'video' && assetKind !== 'image' && assetKind !== 'audio';
}
