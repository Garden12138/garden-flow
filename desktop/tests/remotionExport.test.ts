import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { stageRemotionAssets } from '../electron/core/video-editor-v2/remotionAssetStaging.ts';
import type { MediaAssetRecord } from '../shared/videoAutoEdit.ts';
import type { VideoEditorV2RemotionComposition } from '../shared/videoAutoEditRemotion.ts';
import { shouldRenderVisualPlaceholder } from '../shared/videoMotionLayerPolicy.ts';
import { musicNormalizationGain } from '../electron/core/video-editor-v2/productVideoMusicLoudness.ts';

test('packaged renderer loads its dependencies outside the repository without pnpm symlinks', async () => {
    const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-renderer-runtime-test-'));
    try {
        const { prepareRemotionRendererRuntime } = createRequire(import.meta.url)('../scripts/prepare-remotion-renderer-runtime.cjs');
        const entryPath = await prepareRemotionRendererRuntime(fixtureDirectory);
        execFileSync(process.execPath, ['-e', 'const r = require(process.argv[1]); if (typeof r.renderMedia !== "function" || typeof r.selectComposition !== "function") process.exit(1);', entryPath], {
            cwd: fixtureDirectory,
            env: { ...process.env, NODE_PATH: '' },
        });
        const desktopPackage = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
        assert.ok(desktopPackage.build.extraResources.some((item: { from: string; to: string }) => item.from === '.remotion-renderer-runtime' && item.to === 'remotion-renderer-runtime'));
    } finally {
        await fs.rm(fixtureDirectory, { recursive: true, force: true });
    }
});

test('quiet BGM is raised before applying the standard 20% music mix', () => {
    assert.equal(musicNormalizationGain(-43.9, -26.5), 24);
    assert.equal(musicNormalizationGain(-22, -2), 0);
    assert.equal(musicNormalizationGain(-43, -0.5), 0);
});

test('audio layers never render a visual placeholder over a video or image', () => {
    assert.equal(shouldRenderVisualPlaceholder('audio', true), false);
    assert.equal(shouldRenderVisualPlaceholder('audio', false), false);
    assert.equal(shouldRenderVisualPlaceholder('image', true), false);
    assert.equal(shouldRenderVisualPlaceholder('video', true), false);
    assert.equal(shouldRenderVisualPlaceholder('unknown', true), true);
    assert.equal(shouldRenderVisualPlaceholder(undefined, true), true);
});

test('Remotion export stages image and narration assets under its served directory', async () => {
    const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-remotion-assets-test-'));
    try {
        const imagePath = path.join(fixtureDirectory, 'product.avif');
        const audioPath = path.join(fixtureDirectory, 'voice.mp3');
        const renderDirectory = path.join(fixtureDirectory, 'render');
        await Promise.all([
            fs.writeFile(imagePath, 'image bytes'),
            fs.writeFile(audioPath, 'audio bytes'),
        ]);
        const now = new Date().toISOString();
        const assets: MediaAssetRecord[] = [
            {
                id: 'image-1', kind: 'image', title: 'product', sourcePath: imagePath, projectPath: imagePath,
                relativePath: 'assets/product.avif', hash: 'image-hash', createdAt: now, updatedAt: now,
            },
            {
                id: 'voice-1', kind: 'audio', title: 'voice', sourcePath: audioPath, projectPath: audioPath,
                relativePath: 'assets/voice.mp3', hash: 'audio-hash', createdAt: now, updatedAt: now,
            },
        ];
        const composition: VideoEditorV2RemotionComposition = {
            version: 1, title: 'test', entryCompositionId: 'GardenFlowVideoMotion',
            width: 1080, height: 1920, fps: 30, durationInFrames: 30, renderMode: 'full',
            scenes: [
                { id: 'visual-1', assetId: 'image-1', assetKind: 'image', src: imagePath, startFrame: 0, durationInFrames: 30 },
                { id: 'visual-2', assetId: 'image-1', assetKind: 'image', src: imagePath, startFrame: 0, durationInFrames: 30 },
                { id: 'voice-1', assetId: 'voice-1', assetKind: 'audio', src: audioPath, startFrame: 0, durationInFrames: 30 },
            ],
            transitions: [],
            baseMedia: { sourceAssetIds: [], durationMs: 1000, width: 1080, height: 1920, status: 'test', updatedAt: 0 },
            ffmpegRecipe: { operations: [], artifacts: [], summary: '', updatedAt: 0 },
        };
        const staged = await stageRemotionAssets(assets, composition, renderDirectory);
        assert.equal(staged.scenes[0].src, '/media/asset-1.avif');
        assert.equal(staged.scenes[1].src, staged.scenes[0].src);
        assert.equal(staged.scenes[2].src, '/media/asset-2.mp3');
        assert.equal(await fs.readFile(path.join(renderDirectory, 'media', 'asset-1.avif'), 'utf8'), 'image bytes');
        assert.equal(await fs.readFile(path.join(renderDirectory, 'media', 'asset-2.mp3'), 'utf8'), 'audio bytes');
        assert.equal(composition.scenes[0].src, imagePath);
        await assert.rejects(
            stageRemotionAssets(assets, { ...composition, scenes: [{ ...composition.scenes[0], assetId: 'missing' }] }, renderDirectory),
            /渲染素材不存在/,
        );
    } finally {
        await fs.rm(fixtureDirectory, { recursive: true, force: true });
    }
});
