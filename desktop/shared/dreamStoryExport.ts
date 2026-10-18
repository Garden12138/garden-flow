import type { DreamStoryDocument } from './dreamStory.ts';
/** Explicit export projection: never serialize a whole engineering object into a share archive. */
export function dreamShareDocument(doc: DreamStoryDocument) {
    const director = doc.director;
    return { schemaVersion: doc.schemaVersion, kind: 'dream-story', target: doc.target,
        title: director?.title, story: director?.story, emotionalArc: director?.emotionalArc,
        visualStyle: director?.visualStyle, creativeAdditions: director?.creativeAdditions,
        characters: director?.characters.map(({ id, description, wardrobe, props }) => ({ id, description, wardrobe, props })),
        settings: director?.settings?.map(({ id, description }) => ({ id, description })),
        scenes: director?.scenes.map(({ id, visual, narration, plannedDurationMs, motion, settingId, continuity, mediaType, videoReason, referenceFraming, spatialAnchors }) => ({ id, visual, narration, plannedDurationMs, motion, settingId, continuity, mediaType, videoReason, referenceFraming, spatialAnchors })),
        publication: director?.publication };
}
export function dreamMarkdown(doc: DreamStoryDocument): string {
    const share = dreamShareDocument(doc);
    return `# ${share.title || '梦境故事'}\n\n${share.story || ''}\n\n制作模式：${share.target?.compositionMode || 'story-keyframes'}\n\n${share.scenes?.map((scene, index) => `## 第 ${index + 1} 幕 · ${scene.mediaType === 'video' ? 'AI视频' : '图片运镜'}\n\n场景：${scene.settingId || '未指定'} · 衔接：${scene.continuity === 'continue' ? '延续上一幕' : '切场'}\n\n参考构图：${scene.referenceFraming === 'new-shot' ? '换机位，保留原位置' : '沿用空间布局'}${scene.spatialAnchors?.length ? '\n\n空间约束：\n' + scene.spatialAnchors.map(anchor => `- ${anchor.object} × ${anchor.count}；位置：${anchor.location}；状态：${anchor.state}`).join('\n') : ''}\n\n${scene.visual}\n\n${scene.narration}`).join('\n\n') || ''}\n`;
}
export function dreamSrt(project: import('./videoAutoEdit').VideoEditorV2Project): string {
    const time = (ms: number) => { const n = Math.round(ms); return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`; };
    return project.timeline.tracks.filter(track => track.kind === 'subtitle').flatMap(track => track.clips).map((clip, index) => `${index + 1}\n${time(clip.timelineStartMs)} --> ${time(clip.timelineEndMs)}\n${clip.text || ''}`).join('\n\n');
}
