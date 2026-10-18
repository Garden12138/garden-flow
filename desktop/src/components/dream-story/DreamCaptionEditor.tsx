import { useEffect, useRef, useState } from 'react';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import type { DreamStoryDocument } from '../../../shared/dreamStory';
export function DreamCaptionEditor({ project, onSave, registerFlush }: { project: VideoEditorV2Project; onSave: (cues: NonNullable<DreamStoryDocument['captions']>) => Promise<void>; registerFlush?: (flush: () => Promise<void>) => void }) {
    const [cues, setCues] = useState<NonNullable<DreamStoryDocument['captions']>>([]);
    const dirty = useRef(false); const [error, setError] = useState('');
    const save = async () => { if (!dirty.current) return; try { await onSave(cues); dirty.current = false; setError(''); } catch (reason) { setError(String(reason)); throw reason; } };
    useEffect(() => { registerFlush?.(save); return () => registerFlush?.(async () => undefined); });
    useEffect(() => {
        if (dirty.current) return;
        if (project.dreamStory?.captions) setCues(project.dreamStory.captions);
        else { const scenes = project.timeline.tracks.find(track => track.kind === 'primary-video')?.clips || [];
            setCues(project.timeline.tracks.filter(track => track.kind === 'subtitle').flatMap(track => track.clips).map(clip => ({ sceneId: clip.sceneId!, text: clip.text || '',
                startMs: clip.timelineStartMs - (scenes.find(scene => scene.sceneId === clip.sceneId)?.timelineStartMs || 0), endMs: clip.timelineEndMs - (scenes.find(scene => scene.sceneId === clip.sceneId)?.timelineStartMs || 0) }))); }
    }, [project.dreamStory?.revision]);
    return <details className="rounded-lg border border-border p-3 text-xs" onInput={() => { dirty.current = true; }}><summary>编辑字幕与逐幕时间</summary><p className="my-2 text-text-tertiary">时间从所属幕开始计，不能重叠或超出该幕。无供应商时间戳时使用句长分配。</p><div className="max-h-80 overflow-y-auto">{cues.map((cue, index) => <div key={index} className="mb-2 grid grid-cols-[80px_80px_1fr] gap-2"><input aria-label={`字幕 ${index + 1} 开始秒数`} type="number" min={0} step={0.01} value={cue.startMs / 1000} onChange={event => setCues(old => old.map((item, i) => i === index ? { ...item, startMs: Math.round(Number(event.target.value) * 1000) } : item))} className="rounded border border-border p-1" /><input aria-label={`字幕 ${index + 1} 结束秒数`} type="number" step={0.01} value={cue.endMs / 1000} onChange={event => setCues(old => old.map((item, i) => i === index ? { ...item, endMs: Math.round(Number(event.target.value) * 1000) } : item))} className="rounded border border-border p-1" /><input aria-label={`字幕 ${index + 1} 文本`} value={cue.text} onChange={event => setCues(old => old.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} className="rounded border border-border p-1" /></div>)}</div><button type="button" className="mt-2 rounded border border-border p-2" onClick={() => void save().catch(() => undefined)}>保存字幕修改</button>{error && <p role="alert" className="mt-2 text-red-600">{error}</p>}</details>;
}
