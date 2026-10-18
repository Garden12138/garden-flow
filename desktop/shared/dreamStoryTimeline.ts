import type { VideoEditorV2Project, VideoTimelineClip, VideoTimelineV2 } from './videoAutoEdit.ts';

function captionSegments(narration: string): string[] {
    const sentences = narration.match(/[^.!?。！？\n]+[.!?。！？]?/gu) || [];
    return sentences.flatMap(sentence => {
        const chunks: string[] = []; let current = '';
        for (const word of sentence.trim().split(/\s+/u)) {
            if (current && Array.from(current + ' ' + word).length > 64) { chunks.push(current); current = ''; }
            const characters = Array.from(word);
            while (characters.length > 64) { chunks.push(characters.splice(0, 64).join('')); }
            current = [current, characters.join('')].filter(Boolean).join(' ');
        }
        if (current) chunks.push(current);
        return chunks;
    });
}

export function dreamStoryTimeline(project: VideoEditorV2Project): VideoTimelineV2 {
    const doc = project.dreamStory;
    const primary: VideoTimelineClip[] = [], voice: VideoTimelineClip[] = [], subtitles: VideoTimelineClip[] = [];
    const fps = doc?.target?.spec.fps || 30;
    let cursor = 0;
    for (const scene of doc?.director?.scenes || []) {
        const binding = doc!.media[scene.id];
        const duration = Math.ceil(Math.max(scene.plannedDurationMs, doc?.target?.narration ? binding?.audio?.durationMs || 0 : 0) / 1000 * fps) / fps * 1000;
        const end = Math.round(cursor + duration);
        const video = doc?.target?.compositionMode === 'story-video' || (doc?.target?.compositionMode === 'story-hybrid' && scene.mediaType === 'video');
        primary.push({ id: (video ? 'video_' : 'image_') + scene.id, sceneId: scene.id, assetId: (video ? binding?.video?.assetId : binding?.image?.assetId) || '',
            timelineStartMs: cursor, timelineEndMs: end, sourceStartMs: 0, sourceEndMs: duration,
            motionPreset: video ? 'static' : scene.motion, fitMode: 'cover', volume: 0 });
        if (doc?.target?.narration && binding?.audio?.assetId) voice.push({ id: 'voice_' + scene.id, sceneId: scene.id,
            assetId: binding.audio.assetId, timelineStartMs: cursor, timelineEndMs: cursor + (binding.audio.durationMs || duration),
            sourceStartMs: 0, sourceEndMs: binding.audio.durationMs || duration, volume: doc.voiceVolume });
        if (doc?.target?.subtitles) {
            const custom = doc.captions?.filter(cue => cue.sceneId === scene.id);
            const sentences = captionSegments(scene.narration);
            const budget = doc.target.narration ? binding?.audio?.durationMs || duration : duration;
            const weight = sentences.reduce((sum, text) => sum + text.length, 0);
            let elapsed = 0;
            const cues = custom || sentences.map(text => { const startMs = elapsed; elapsed += budget * text.length / Math.max(1, weight); return { text, startMs, endMs: elapsed }; });
            let priorEnd = 0;
            for (const [index, cue] of cues.entries()) {
                if (cue.startMs < priorEnd || cue.endMs <= cue.startMs || cue.endMs > duration + 1) throw new Error('字幕重叠或超出所属分镜');
                priorEnd = cue.endMs;
                subtitles.push({ id: `caption_${scene.id}_${index}`, sceneId: scene.id, assetId: '', text: cue.text,
                    timelineStartMs: Math.round(cursor + cue.startMs), timelineEndMs: Math.round(cursor + cue.endMs), sourceStartMs: 0, sourceEndMs: cue.endMs - cue.startMs });
            }
        }
        cursor = end;
    }
    const music: VideoTimelineClip[] = doc?.musicAssetId ? [{ id: 'dream_music', assetId: doc.musicAssetId,
        timelineStartMs: 0, timelineEndMs: Math.min(cursor, project.assets.find(asset => asset.id === doc.musicAssetId)?.durationMs || cursor),
        sourceStartMs: 0, sourceEndMs: Math.min(cursor, project.assets.find(asset => asset.id === doc.musicAssetId)?.durationMs || cursor), volume: doc.musicVolume }] : [];
    return { ...project.timeline, durationMs: cursor, tracks: [
        { id: 'dream_images', kind: 'primary-video', name: '梦境画面', clips: primary },
        { id: 'dream_voice', kind: 'voiceover', name: '旁白', clips: voice },
        { id: 'dream_captions', kind: 'subtitle', name: '字幕', clips: subtitles },
        { id: 'dream_music_track', kind: 'music', name: '音乐', clips: music },
    ] };
}
