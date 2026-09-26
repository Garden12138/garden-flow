export const MAX_PRODUCT_SCENE_DURATION_MS = 30_000;

export function productSceneDurationFrames(durationMs: number, fps: number): number {
    if (!Number.isFinite(durationMs) || !Number.isFinite(fps) || fps <= 0) {
        throw new Error('Invalid scene duration or frame rate');
    }
    return Math.max(1, Math.min(Math.floor(MAX_PRODUCT_SCENE_DURATION_MS * fps / 1000), Math.round(durationMs * fps / 1000)));
}

export function snapProductSceneDurationMs(durationMs: number, fps: number): number {
    return Math.round(productSceneDurationFrames(durationMs, fps) * 1000 / fps);
}

export function resizeProductSceneDurationMs(input: {
    durationMs: number;
    deltaPx: number;
    pixelsPerSecond: number;
    edge: 'start' | 'end';
    fps: number;
    fine?: boolean;
}): number {
    if (!Number.isFinite(input.deltaPx) || !Number.isFinite(input.pixelsPerSecond) || input.pixelsPerSecond <= 0) {
        throw new Error('Invalid timeline scale');
    }
    const direction = input.edge === 'end' ? 1 : -1;
    const deltaMs = direction * input.deltaPx * 1000 / input.pixelsPerSecond / (input.fine ? 10 : 1);
    return snapProductSceneDurationMs(input.durationMs + deltaMs, input.fps);
}

// Quantize cumulative boundaries, not each millisecond duration, to avoid gaps at 30/60 fps.
export function productSceneFrameRanges(scenes: Array<{ id: string; durationMs: number }>, fps: number) {
    let cursorFrames = 0;
    return scenes.map((scene) => {
        const startFrame = cursorFrames;
        cursorFrames += productSceneDurationFrames(scene.durationMs, fps);
        return {
            id: scene.id,
            startFrame,
            endFrame: cursorFrames,
            startMs: Math.round(startFrame * 1000 / fps),
            endMs: Math.round(cursorFrames * 1000 / fps),
        };
    });
}

export function formatProductSceneSeconds(durationMs: number): string {
    return (durationMs / 1000).toFixed(3).replace(/\.?0+$/, '');
}
