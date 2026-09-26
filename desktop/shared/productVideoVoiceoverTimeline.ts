import { createHash } from 'node:crypto';
import type { ProductVideoSceneState, ProductVideoVoiceoverStatus, VideoEditorV2Project } from './videoAutoEdit';

export function migrateProductVideoVoiceoverProject(project: VideoEditorV2Project): VideoEditorV2Project {
  if (project.projectKind !== 'product-video' || !project.productVideo) return project;
  const tracks = project.timeline.tracks;
  const withMusic = tracks.some((track) => track.kind === 'music') ? tracks : [
    ...tracks,
    { id: 'track_music', kind: 'music' as const, name: 'BGM', clips: [] },
  ];
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: withMusic.some((track) => track.kind === 'voiceover') ? withMusic : [
        ...withMusic.filter((track) => track.kind !== 'music'),
        { id: 'track_voiceover', kind: 'voiceover', name: '旁白', clips: [] },
        ...withMusic.filter((track) => track.kind === 'music'),
      ],
    },
    productVideo: {
      ...project.productVideo,
      scenes: project.productVideo.scenes.map((scene) => ({
        ...scene,
        narrationText: scene.narrationText ?? String(scene.overlayText || '').trim(),
        voiceoverStatus: scene.voiceoverStatus || (String(scene.overlayText || '').trim() ? 'needs-configuration' : 'not-required'),
      })),
    },
  };
}

export function productVideoNarrationHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

export function resolveProductVoiceoverPlacement(
  scene: ProductVideoSceneState,
  sceneDurationMs: number,
): { clipDurationMs: number; status: ProductVideoVoiceoverStatus } {
  const durationMs = Math.round(Number(scene.voiceoverDurationMs || 0));
  const priorStatus = scene.voiceoverStatus || 'not-required';
  if (!scene.voiceoverAssetId || durationMs <= 0) return { clipDurationMs: 0, status: priorStatus };
  if (durationMs > sceneDurationMs) return { clipDurationMs: 0, status: 'duration-conflict' };
  if (priorStatus === 'duration-conflict') {
    return {
      clipDurationMs: durationMs,
      status: scene.voiceoverTextHash === productVideoNarrationHash(scene.narrationText || '') ? 'ready' : 'stale',
    };
  }
  return { clipDurationMs: durationMs, status: priorStatus };
}
