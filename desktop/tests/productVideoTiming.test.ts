import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductVideoEditCommandSchema } from '../shared/productVideoProposal.ts';
import { formatProductSceneSeconds, productSceneDurationFrames, productSceneFrameRanges, resizeProductSceneDurationMs, snapProductSceneDurationMs } from '../shared/productVideoTiming.ts';

// Run from the repository root: pnpm test

test('duration edits accept sub-half-second values but reject invalid IPC input', () => {
    for (const durationMs of [1, 17, 33, 100, 267, 30_000]) {
        assert.equal(ProductVideoEditCommandSchema.safeParse({ type: 'scene.duration', sceneId: 'scene-1', durationMs }).success, true);
    }
    for (const durationMs of [0, -1, 30_001, 33.3, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(ProductVideoEditCommandSchema.safeParse({ type: 'scene.duration', sceneId: 'scene-1', durationMs }).success, false);
    }
});

test('scene durations snap to the project frame rate with a one-frame minimum', () => {
    assert.equal(snapProductSceneDurationMs(1, 30), 33);
    assert.equal(snapProductSceneDurationMs(100, 30), 100);
    assert.equal(snapProductSceneDurationMs(250, 30), 267);
    assert.equal(snapProductSceneDurationMs(1, 60), 17);
    assert.equal(snapProductSceneDurationMs(1, 24), 42);
    assert.equal(snapProductSceneDurationMs(40_000, 30), 30_000);
    assert.throws(() => snapProductSceneDurationMs(Number.NaN, 30));
    assert.throws(() => snapProductSceneDurationMs(100, 0));
});

test('both resize handles extend and shrink with frozen scale, fine adjustment and limits', () => {
    const resize = (deltaPx: number, edge: 'start' | 'end', fine = false) => resizeProductSceneDurationMs({
        durationMs: 3000, deltaPx, edge, pixelsPerSecond: 40, fps: 30, fine,
    });
    assert.equal(resize(40, 'end'), 4000);
    assert.equal(resize(-40, 'end'), 2000);
    assert.equal(resize(-40, 'start'), 4000);
    assert.equal(resize(40, 'start'), 2000);
    assert.equal(resize(40, 'end', true), 3100);
    assert.equal(resize(-1000, 'end'), 33);
    assert.equal(resize(2000, 'end'), 30_000);
    assert.equal(resize(1, 'end'), 3033);
    assert.throws(() => resizeProductSceneDurationMs({ durationMs: 3000, deltaPx: 1, edge: 'end', pixelsPerSecond: 0, fps: 30 }));
});

test('cumulative frame boundaries remain contiguous after repeated tiny scene edits', () => {
    for (const fps of [12, 24, 30, 60]) {
        const scenes = Array.from({ length: 8 }, (_, index) => ({ id: `scene-${index}`, durationMs: Math.round((index + 1) * 1000 / fps) }));
        const ranges = productSceneFrameRanges(scenes, fps);
        assert.equal(ranges[0].startMs, 0);
        ranges.forEach((range, index) => {
            assert.equal(Math.round(range.startMs * fps / 1000), range.startFrame);
            assert.equal(Math.round(range.endMs * fps / 1000), range.endFrame);
            assert.equal(Math.round((range.endMs - range.startMs) * fps / 1000), productSceneDurationFrames(scenes[index].durationMs, fps));
            if (index) assert.equal(range.startMs, ranges[index - 1].endMs);
        });
        assert.equal(ranges.at(-1)?.endFrame, 36);
    }
});

test('timeline labels retain millisecond precision without trailing zeros', () => {
    assert.equal(formatProductSceneSeconds(33), '0.033');
    assert.equal(formatProductSceneSeconds(267), '0.267');
    assert.equal(formatProductSceneSeconds(3100), '3.1');
    assert.equal(formatProductSceneSeconds(30_000), '30');
});
