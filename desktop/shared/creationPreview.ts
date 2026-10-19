import type { VideoEditorV2Project } from './videoAutoEdit';
import type { ProductProjectEditOperation } from './productProjectEditor';
/** Optimistic local projection only; the main-process editor still validates every saved operation. */
export function previewProductEdits(source: VideoEditorV2Project, operations: ProductProjectEditOperation[]): VideoEditorV2Project {
    const project = structuredClone(source);
    for (const operation of operations) {
        if (!('sceneId' in operation)) continue;
        const scene = project.productVideo?.scenes.find(item => item.id === operation.sceneId);
        const primary = project.timeline.tracks.find(track => track.kind === 'primary-video');
        const visual = primary?.clips.find(clip => clip.sceneId === operation.sceneId);
        if (!scene || !visual) continue;
        if (operation.type === 'scene.text') {
            scene.overlayText = operation.text;
            const subtitles = project.timeline.tracks.find(track => track.kind === 'subtitle');
            const caption = subtitles?.clips.find(clip => clip.sceneId === scene.id);
            if (caption) caption.text = operation.text;
            else if (subtitles) subtitles.clips.push({ ...visual, id: 'preview_' + scene.id, assetId: undefined, text: operation.text });
        } else if (operation.type === 'scene.duration' && Number.isFinite(operation.durationMs) && operation.durationMs > 0) scene.durationMs = operation.durationMs;
        else if (operation.type === 'scene.fit') visual.fitMode = operation.fitMode;
        else if (operation.type === 'scene.motion') visual.motionPreset = operation.motionPreset;
        else if (operation.type === 'scene.asset') visual.assetId = operation.assetId;
        else if (operation.type === 'scene.narration-text') scene.narrationText = operation.text;
    }
    let cursor = 0;
    for (const scene of project.productVideo?.scenes || []) {
        for (const track of project.timeline.tracks) for (const clip of track.clips) if (clip.sceneId === scene.id) {
            clip.timelineStartMs = cursor; clip.timelineEndMs = cursor + scene.durationMs;
            if (track.kind === 'primary-video') clip.sourceEndMs = clip.sourceStartMs + scene.durationMs;
        }
        cursor += scene.durationMs;
    }
    project.timeline.durationMs = cursor; return project;
}
