import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ProductVideoComposeParamsSchema, ProductVideoEditCommandSchema } from '../shared/productVideoProposal.ts';
import { buildVideoEditorV2RemotionComposition } from '../shared/videoAutoEditRemotion.ts';
import type { VideoEditorV2Project } from '../shared/videoAutoEdit.ts';

test('Remotion packages stay pinned to one exact version', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
    dependencies: Record<string, string>;
  };
  const versions = [
    packageJson.dependencies['@remotion/bundler'],
    packageJson.dependencies['@remotion/player'],
    packageJson.dependencies['@remotion/renderer'],
    packageJson.dependencies.remotion,
  ];
  assert.equal(new Set(versions).size, 1);
  assert.match(versions[0], /^\d+\.\d+\.\d+$/);
});

const proposal = {
  version: 1 as const,
  proposalId: 'proposal-product-video-001',
  productId: 'product_001',
  referencedProductIds: ['product_001'],
  productName: '测试商品',
  productUpdatedAt: '2026-09-13T00:00:00.000Z',
  title: '测试商品｜15 秒商品视频',
  canvas: { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16' as const },
  durationMs: 15000,
  scenes: Array.from({ length: 5 }, (_, index) => ({
    id: `scene-${index + 1}`,
    title: `镜头 ${index + 1}`,
    durationMs: 3000,
    source: index < 2 ? 'ai-motion' as const : 'product-asset' as const,
    productAssetIds: [`source-${index + 1}`],
    overlayText: `可信文字 ${index + 1}`,
    generationPrompt: index < 2 ? 'Preserve the product exactly; clean image without baked-in text.' : undefined,
    fitMode: 'contain-blur' as const,
    motionPreset: 'slow-zoom-in' as const,
  })),
};

test('product video proposal accepts the default five-scene/two-AI 15-second contract', () => {
  const parsed = ProductVideoComposeParamsSchema.safeParse(proposal);
  assert.equal(parsed.success, true);
  assert.equal(proposal.scenes.length, 5);
  assert.equal(proposal.scenes.filter((scene) => scene.source === 'ai-motion').length, 2);
});

test('product video proposal rejects mismatched duration and more than two AI scenes', () => {
  const parsed = ProductVideoComposeParamsSchema.safeParse({
    ...proposal,
    durationMs: 14000,
    scenes: proposal.scenes.map((scene, index) => index === 2 ? {
      ...scene,
      source: 'ai-motion',
      generationPrompt: 'A third AI scene',
    } : scene),
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.match(parsed.error.message, /sum of scene durations/);
    assert.match(parsed.error.message, /at most two AI motion scenes/);
  }
});

test('product video proposal rejects ambiguous multi-product references', () => {
  const parsed = ProductVideoComposeParamsSchema.safeParse({
    ...proposal,
    referencedProductIds: ['product_001', 'product_002'],
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.error.message, /exactly one primary product/);
});

test('product video edit commands reject untyped project mutations', () => {
  assert.equal(ProductVideoEditCommandSchema.safeParse({
    type: 'scene.fit',
    sceneId: 'scene-1',
    fitMode: 'contain-blur',
  }).success, true);
  assert.equal(ProductVideoEditCommandSchema.safeParse({
    type: 'project.replace',
    project: { status: 'exported' },
  }).success, false);
  assert.equal(ProductVideoEditCommandSchema.safeParse({
    type: 'scene.duration',
    sceneId: 'scene-1',
    durationMs: Number.NaN,
  }).success, false);
});

test('product video Remotion composition keeps image fit, overlays, muted video, and BGM defaults together', () => {
  const now = '2026-09-13T00:00:00.000Z';
  const project: VideoEditorV2Project = {
    version: 2,
    id: 'video-project-001',
    title: proposal.title,
    projectKind: 'product-video',
    projectDir: '/tmp/video-project-001',
    createdAt: now,
    updatedAt: now,
    status: 'ready',
    canvas: proposal.canvas,
    assets: [
      ...proposal.scenes.map((scene, index) => ({
        id: `asset-${index + 1}`,
        kind: index < 2 ? 'video' as const : 'image' as const,
        title: scene.title,
        sourcePath: `/tmp/source-${index + 1}.${index < 2 ? 'mp4' : 'png'}`,
        projectPath: `/tmp/project-${index + 1}.${index < 2 ? 'mp4' : 'png'}`,
        relativePath: `assets/project-${index + 1}.${index < 2 ? 'mp4' : 'png'}`,
        hash: `hash-${index + 1}`,
        createdAt: now,
        updatedAt: now,
      })),
      {
        id: 'bgm', kind: 'audio', title: 'BGM', sourcePath: '/tmp/bgm.mp3', projectPath: '/tmp/bgm-copy.mp3',
        relativePath: 'assets/bgm.mp3', hash: 'bgm-hash', createdAt: now, updatedAt: now,
      },
    ],
    transcriptTracks: [],
    timeline: {
      id: 'timeline',
      durationMs: 15000,
      tracks: [
        {
          id: 'visual', kind: 'primary-video', name: '画面', clips: proposal.scenes.map((scene, index) => ({
            id: `clip-${index + 1}`, sceneId: scene.id, assetId: `asset-${index + 1}`, sourceStartMs: 0, sourceEndMs: 3000,
            timelineStartMs: index * 3000, timelineEndMs: (index + 1) * 3000, fitMode: scene.fitMode, motionPreset: scene.motionPreset,
          })),
        },
        {
          id: 'text', kind: 'subtitle', name: '文字', clips: proposal.scenes.map((scene, index) => ({
            id: `text-${index + 1}`, sceneId: scene.id, sourceStartMs: 0, sourceEndMs: 3000,
            timelineStartMs: index * 3000, timelineEndMs: (index + 1) * 3000, text: scene.overlayText,
          })),
        },
        {
          id: 'music', kind: 'music', name: 'BGM', clips: [{
            id: 'music-1', assetId: 'bgm', sourceStartMs: 0, sourceEndMs: 15000,
            timelineStartMs: 0, timelineEndMs: 15000, volume: 0.2, fadeInMs: 500, fadeOutMs: 500,
          }],
        },
      ],
    },
    autoEditRuns: [],
    undoStack: [],
    renderOutputs: [],
    productVideo: {
      proposal,
      productSnapshot: { id: proposal.productId, name: proposal.productName, updatedAt: proposal.productUpdatedAt, facts: [] },
      scenes: proposal.scenes.map((scene) => ({ ...scene, generationStatus: scene.source === 'ai-motion' ? 'ready' : 'not-required' })),
    },
  };

  const composition = buildVideoEditorV2RemotionComposition(project);
  assert.ok(composition);
  assert.equal(composition.width, 1080);
  assert.equal(composition.height, 1920);
  assert.equal(composition.durationInFrames, 450);
  assert.equal(composition.scenes.filter((scene) => scene.assetKind !== 'audio').length, 5);
  assert.equal(composition.scenes[0].fitMode, 'contain-blur');
  assert.equal(composition.scenes[0].muted, true);
  assert.equal(composition.scenes[0].overlays?.[0]?.text, '可信文字 1');
  const music = composition.scenes.find((scene) => scene.assetKind === 'audio');
  assert.equal(music?.volume, 0.2);
  assert.equal(music?.fadeInFrames, 15);
  assert.equal(music?.fadeOutFrames, 15);
});
