export function shouldRenderVisualPlaceholder(
    assetKind: 'video' | 'image' | 'audio' | 'unknown' | undefined,
    showBaseMedia: boolean,
): boolean {
    return showBaseMedia && assetKind !== 'video' && assetKind !== 'image' && assetKind !== 'audio';
}
/** Preserve a visible frame for tiny clips and non-overlapping fades for short edits. */
export function sceneOpacityRange(durationInFrames: number, fps: number): number[] | null {
    const duration = Math.max(1, Math.round(durationInFrames));
    if (duration <= 2) return null;
    const fade = Math.min(Math.max(6, Math.round(fps * 0.25)), (duration - 1) / 2);
    return [0, fade, duration - fade, duration];
}
