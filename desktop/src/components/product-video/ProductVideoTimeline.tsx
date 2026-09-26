import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Music2, RotateCcw, Sparkles } from 'lucide-react';
import type { ProductVideoSceneState, VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { formatProductSceneSeconds, productSceneDurationFrames, resizeProductSceneDurationMs, snapProductSceneDurationMs } from '../../../shared/productVideoTiming';

type ResizeGesture = {
    sceneId: string;
    edge: 'start' | 'end';
    pointerId: number;
    startX: number;
    startScroll: number;
    originalDurationMs: number;
    durationMs: number;
    pixelsPerSecond: number;
    fine: boolean;
    handle: HTMLButtonElement;
};

type Props = {
    project: VideoEditorV2Project;
    selectedSceneId: string;
    busy: boolean;
    onSelect: (sceneId: string) => void;
    onResize: (sceneId: string, durationMs: number) => Promise<void>;
    onReorder: (sceneId: string, targetSceneId: string) => void;
    onUndo: () => Promise<void>;
    onAddMusic: () => void;
};

export function ProductVideoTimeline({ project, selectedSceneId, busy, onSelect, onResize, onReorder, onUndo, onAddMusic }: Props) {
    const [pixelsPerSecond, setPixelsPerSecond] = useState(40);
    const [draft, setDraft] = useState<{ sceneId: string; durationMs: number } | null>(null);
    const [draggedSceneId, setDraggedSceneId] = useState('');
    const gesture = useRef<ResizeGesture | null>(null);
    const scrollArea = useRef<HTMLDivElement>(null);
    const scenes = project.productVideo?.scenes || [];
    const fps = project.canvas.fps;
    const music = project.timeline.tracks.find((track) => track.kind === 'music')?.clips[0];
    const voiceovers = project.timeline.tracks.find((track) => track.kind === 'voiceover')?.clips || [];
    const durationFor = (scene: ProductVideoSceneState) => draft?.sceneId === scene.id ? draft.durationMs : scene.durationMs;
    const totalMs = scenes.reduce((sum, scene) => sum + durationFor(scene), 0);
    const timelineWidth = Math.max(1, totalMs * pixelsPerSecond / 1000);
    const rulerStepSeconds = Math.max(1, Math.ceil(40 / pixelsPerSecond));
    const cellStyle = (scene: ProductVideoSceneState) => ({ width: durationFor(scene) * pixelsPerSecond / 1000, flexShrink: 0 });

    const finishResize = useCallback(async (cancelled = false, pointerId?: number) => {
        const current = gesture.current;
        if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return;
        gesture.current = null;
        if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
        try {
            if (!cancelled && productSceneDurationFrames(current.durationMs, fps) !== productSceneDurationFrames(current.originalDurationMs, fps)) {
                await onResize(current.sceneId, current.durationMs);
            }
        } finally {
            setDraft(null);
        }
    }, [fps, onResize]);

    useEffect(() => {
        const cancel = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !gesture.current) return;
            void finishResize(true);
        };
        const release = (event: globalThis.PointerEvent) => void finishResize(false, event.pointerId);
        const cancelPointer = (event: globalThis.PointerEvent) => void finishResize(true, event.pointerId);
        const releaseMouse = () => void finishResize();
        const blur = () => void finishResize(true);
        window.addEventListener('keydown', cancel);
        // Also catch releases outside a moved handle (including native mouse drag delivery).
        window.addEventListener('pointerup', release, true);
        window.addEventListener('pointercancel', cancelPointer, true);
        window.addEventListener('mouseup', releaseMouse, true);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('keydown', cancel);
            window.removeEventListener('pointerup', release, true);
            window.removeEventListener('pointercancel', cancelPointer, true);
            window.removeEventListener('mouseup', releaseMouse, true);
            window.removeEventListener('blur', blur);
        };
    }, [finishResize]);

    const startResize = (event: PointerEvent<HTMLButtonElement>, scene: ProductVideoSceneState, edge: ResizeGesture['edge']) => {
        if (busy || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onSelect(scene.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
            sceneId: scene.id, edge, pointerId: event.pointerId, startX: event.clientX,
            startScroll: scrollArea.current?.scrollLeft || 0,
            originalDurationMs: scene.durationMs, durationMs: scene.durationMs, pixelsPerSecond, fine: event.shiftKey, handle: event.currentTarget,
        };
        setDraft({ sceneId: scene.id, durationMs: scene.durationMs });
    };

    const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const durationMs = resizeProductSceneDurationMs({
            durationMs: current.originalDurationMs,
            deltaPx: event.clientX - current.startX + (scrollArea.current?.scrollLeft || 0) - current.startScroll,
            pixelsPerSecond: current.pixelsPerSecond, edge: current.edge, fps, fine: current.fine,
        });
        current.durationMs = durationMs;
        setDraft({ sceneId: current.sceneId, durationMs });
    };

    return <section className="col-span-2 min-w-0 border-t border-border bg-[#10151C] p-3 text-white">
        <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2"><h2 className="shrink-0 text-xs font-bold">时间线</h2><span className="text-[10px] tabular-nums text-white/60">{formatProductSceneSeconds(totalMs)}s</span><span className="truncate text-[10px] text-white/45">拖动两侧调整时长 · Shift＋拖动微调 · Esc 取消</span></div>
            <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] text-white/60">缩放<input aria-label="时间线缩放" type="range" min="10" max="600" step="10" value={pixelsPerSecond} disabled={Boolean(draft)} onChange={(event) => setPixelsPerSecond(Number(event.target.value))} className="w-20 accent-[#2DD4BF]" /></label>
                <button type="button" onClick={() => void onUndo()} disabled={!project.undoStack.length || busy || Boolean(draft)} className="inline-flex items-center gap-1 text-[11px] text-white/60 disabled:opacity-30"><RotateCcw className="h-3 w-3" />撤销</button>
            </div>
        </div>
        <div className="grid grid-cols-[58px_minmax(0,1fr)] text-[10px]">
            <div className="space-y-2 pr-2 text-white/45"><div className="h-4" /><div className="flex h-14 items-center">画面</div><div className="flex h-7 items-center">文字</div><div className="flex h-7 items-center">旁白</div><div className="flex h-7 items-center">BGM</div></div>
            <div ref={scrollArea} className="overflow-x-auto pb-1">
                <div style={{ width: timelineWidth }} className="space-y-2">
                    <div className="relative h-4 text-[9px] tabular-nums text-white/40">{Array.from({ length: Math.floor(totalMs / 1000 / rulerStepSeconds) + 1 }, (_, index) => <span key={index} style={{ left: index * rulerStepSeconds * pixelsPerSecond }} className="absolute border-l border-white/20 pl-1">{index * rulerStepSeconds}s</span>)}</div>
                    <div className="flex h-14 rounded-lg bg-white/5">{scenes.map((scene, index) => <div key={scene.id} style={cellStyle(scene)} className={selectedSceneId === scene.id ? 'group relative rounded-md border border-[#2DD4BF] bg-[#173E3A]' : 'group relative rounded-md border border-white/10 bg-white/10 hover:bg-white/15'}>
                        <button type="button" draggable={!busy && !draft} disabled={busy} onDragStart={(event) => { event.dataTransfer.setData('text/plain', scene.id); event.dataTransfer.effectAllowed = 'move'; setDraggedSceneId(scene.id); }} onDragEnd={() => setDraggedSceneId('')} onDragOver={(event) => { if (!busy && !draft) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedSceneId; if (!busy && !draft && scenes.some((item) => item.id === sourceId) && sourceId !== scene.id) onReorder(sourceId, scene.id); setDraggedSceneId(''); }} onClick={() => onSelect(scene.id)} title={`${scene.title} · ${formatProductSceneSeconds(durationFor(scene))} 秒`} className="h-full w-full overflow-hidden px-3 py-1.5 text-left disabled:opacity-60">
                            <span className="block truncate font-semibold">{index + 1}. {scene.title}</span><span className="mt-1 block truncate tabular-nums text-white/60">{formatProductSceneSeconds(durationFor(scene))}s · {productSceneDurationFrames(durationFor(scene), fps)}帧</span>{scene.source === 'ai-motion' && <Sparkles className="absolute bottom-1.5 right-3 h-3 w-3 text-amber-400" />}
                        </button>
                        {(['start', 'end'] as const).map((edge) => <button key={edge} type="button" aria-label={`${scene.title}${edge === 'start' ? '左' : '右'}侧时长手柄`} aria-disabled={busy} title="拖动调整时长；方向键调整 1 帧，Shift＋方向键调整 10 帧" onPointerDown={(event) => startResize(event, scene, edge)} onPointerMove={moveResize} onPointerUp={(event) => void finishResize(false, event.pointerId)} onPointerCancel={(event) => void finishResize(true, event.pointerId)} onLostPointerCapture={(event) => void finishResize(true, event.pointerId)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
                            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                            event.preventDefault();
                            if (busy || draft) return;
                            onSelect(scene.id);
                            const direction = (event.key === 'ArrowRight' ? 1 : -1) * (edge === 'end' ? 1 : -1);
                            const durationMs = snapProductSceneDurationMs(scene.durationMs + direction * (event.shiftKey ? 10 : 1) * 1000 / fps, fps);
                            if (productSceneDurationFrames(durationMs, fps) !== productSceneDurationFrames(scene.durationMs, fps)) void onResize(scene.id, durationMs);
                        }} className={`absolute inset-y-0 z-10 flex w-2.5 touch-none select-none items-center justify-center rounded bg-white/5 hover:bg-[#2DD4BF]/40 focus-visible:bg-[#2DD4BF]/40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white ${busy ? 'cursor-default opacity-50' : 'cursor-col-resize'} ${edge === 'start' ? 'left-0' : 'right-0'}`}><span className="h-5 w-0.5 rounded bg-white/45" /></button>)}
                    </div>)}</div>
                    <div className="flex h-7 rounded-lg bg-white/5">{scenes.map((scene) => <div key={scene.id} style={cellStyle(scene)} className="overflow-hidden rounded border border-[#10151C] bg-[#D97706]/30 px-2 py-1 text-[9px] text-amber-100"><span className="block truncate">{scene.overlayText || '—'}</span></div>)}</div>
                    <div className="flex h-7 rounded-lg bg-white/5">{scenes.map((scene) => {
                        const hasVoiceover = voiceovers.some((clip) => clip.sceneId === scene.id);
                        const label = hasVoiceover ? scene.narrationText || '录音'
                            : scene.voiceoverStatus === 'duration-conflict' ? '旁白长于镜头'
                                : scene.voiceoverStatus === 'failed' ? '旁白生成失败'
                                    : scene.voiceoverStatus === 'queued' || scene.voiceoverStatus === 'generating' ? '旁白生成中'
                                        : scene.narrationText ? '待生成旁白' : '无旁白';
                        return <button key={scene.id} type="button" onClick={() => onSelect(scene.id)} style={cellStyle(scene)} className={hasVoiceover ? 'overflow-hidden rounded border border-[#10151C] bg-[#C05640]/55 px-2 text-left text-[9px] text-orange-100' : 'overflow-hidden rounded border border-dashed border-white/10 px-2 text-left text-[9px] text-white/45'}><span className="block truncate">{label}</span></button>;
                    })}</div>
                    <div className="flex h-7 rounded-lg bg-white/5">{music ? <div className="flex w-full items-center gap-2 overflow-hidden rounded bg-[#0F766E]/45 px-2 text-[9px] text-teal-100"><Music2 className="h-3 w-3 shrink-0" /><span className="truncate">{music.text || '背景音乐'} · 20%</span></div> : <button type="button" onClick={onAddMusic} className="w-full rounded border border-dashed border-white/15 text-white/35 hover:text-white/60">添加背景音乐</button>}</div>
                </div>
            </div>
        </div>
        <p aria-live="polite" className="mt-1 h-4 text-[10px] tabular-nums text-[#2DD4BF]">{draft ? `${formatProductSceneSeconds(draft.durationMs)} 秒 · ${productSceneDurationFrames(draft.durationMs, fps)} 帧 · 松手保存` : `${fps}fps · 最小 1 帧（${formatProductSceneSeconds(Math.round(1000 / fps))} 秒）；修改时长后后续镜头自动顺延`}</p>
    </section>;
}
