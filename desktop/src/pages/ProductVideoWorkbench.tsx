import { useCallback, useEffect, useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import {
    CheckCircle2,
    Download,
    Film,
    FolderOpen,
    Image as ImageIcon,
    Loader2,
    Music2,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import type { ProductVideoEditCommand, ProductVideoMotionPreset, ProductVideoFitMode, VideoEditorV2Project } from '../../shared/videoAutoEdit';
import { buildVideoEditorV2RemotionComposition } from '../../shared/videoAutoEditRemotion';
import { subscribeDataChanged } from '../bridge/appEvents';
import { VideoMotionComposition } from '../components/manuscripts/remotion/VideoMotionComposition';
import type { RemotionCompositionConfig } from '../components/manuscripts/remotion/types';
import { appAlert, appConfirm } from '../utils/appDialogs';
import { resolveAssetUrl } from '../utils/pathManager';

type ProductVideoWorkbenchProps = {
    projectId: string;
    onClose?: () => void;
};

type ProjectResponse = { success?: boolean; error?: string; project?: VideoEditorV2Project; canceled?: boolean; outputPath?: string };
type LibraryAudioAsset = { id: string; title?: string; mimeType?: string; absolutePath?: string; relativePath?: string; exists?: boolean };

const FIT_OPTIONS: Array<{ value: ProductVideoFitMode; label: string }> = [
    { value: 'contain-blur', label: '完整展示＋模糊背景' },
    { value: 'cover', label: '居中裁切铺满' },
];

const MOTION_OPTIONS: Array<{ value: ProductVideoMotionPreset; label: string }> = [
    { value: 'static', label: '静止' },
    { value: 'slow-zoom-in', label: '缓慢推进' },
    { value: 'slow-zoom-out', label: '缓慢拉远' },
    { value: 'pan-left', label: '向左平移' },
    { value: 'pan-right', label: '向右平移' },
];

function statusLabel(status: string): string {
    if (status === 'generating') return '生成中';
    if (status === 'partial') return '部分镜头待重试';
    if (status === 'ready') return '可编辑';
    if (status === 'rendering') return '导出中';
    if (status === 'exported') return '已导出';
    return '草稿';
}

export function ProductVideoWorkbench({ projectId, onClose }: ProductVideoWorkbenchProps) {
    const [project, setProject] = useState<VideoEditorV2Project | null>(null);
    const [selectedSceneId, setSelectedSceneId] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [draggedSceneId, setDraggedSceneId] = useState('');
    const [musicPickerOpen, setMusicPickerOpen] = useState(false);
    const [libraryAudio, setLibraryAudio] = useState<LibraryAudioAsset[]>([]);

    const loadProject = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.videoEditorV2.getProject({ projectId }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '商品视频工程不存在');
            if (result.project.projectKind !== 'product-video' || !result.project.productVideo) throw new Error('该工程不是商品视频工程');
            setProject(result.project);
            setSelectedSceneId((current) => current && result.project?.productVideo?.scenes.some((scene) => scene.id === current)
                ? current
                : result.project?.productVideo?.scenes[0]?.id || '');
            setError('');
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        setLoading(true);
        void loadProject();
        return subscribeDataChanged((payload) => {
            if (payload?.scope === 'video-editor-v2' && payload?.entityId === projectId) void loadProject();
        });
    }, [loadProject, projectId]);

    useEffect(() => {
        void window.ipcRenderer.media.list<{ success?: boolean; assets?: LibraryAudioAsset[] }>({ limit: 200 }).then((result) => {
            const audio = (result.assets || []).filter((asset) => (
                asset.exists !== false
                && Boolean(asset.absolutePath)
                && (/^audio\//i.test(String(asset.mimeType || '')) || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(String(asset.absolutePath || asset.relativePath || '')))
            ));
            setLibraryAudio(audio);
        }).catch(() => undefined);
    }, []);

    const scenes = project?.productVideo?.scenes || [];
    const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) || scenes[0] || null;
    const visualAssets = project?.assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video') || [];
    const musicTrack = project?.timeline.tracks.find((track) => track.kind === 'music');
    const composition = useMemo(() => project ? buildVideoEditorV2RemotionComposition(project) : null, [project]);

    const applyCommand = useCallback(async (command: ProductVideoEditCommand) => {
        setBusy(command.type);
        try {
            const result = await window.ipcRenderer.videoEditorV2.applyProductCommand({ projectId, command }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '保存编辑失败');
            setProject(result.project);
        } catch (commandError) {
            void appAlert(commandError instanceof Error ? commandError.message : String(commandError));
        } finally {
            setBusy('');
        }
    }, [projectId]);

    const retryScene = useCallback(async () => {
        if (!selectedScene) return;
        setBusy('retry');
        try {
            const result = await window.ipcRenderer.videoEditorV2.retryProductScene({ projectId, sceneId: selectedScene.id }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '重试失败');
            setProject(result.project);
        } catch (retryError) {
            void appAlert(retryError instanceof Error ? retryError.message : String(retryError));
            await loadProject();
        } finally {
            setBusy('');
        }
    }, [loadProject, projectId, selectedScene]);

    const addMusic = useCallback(async (sourcePath?: string) => {
        setMusicPickerOpen(false);
        setBusy('music');
        try {
            const result = await window.ipcRenderer.videoEditorV2.setProductMusic({ projectId, sourcePath }) as ProjectResponse;
            if (result.canceled) return;
            if (!result.success || !result.project) throw new Error(result.error || '添加背景音乐失败');
            setProject(result.project);
        } catch (musicError) {
            void appAlert(musicError instanceof Error ? musicError.message : String(musicError));
        } finally {
            setBusy('');
        }
    }, [projectId]);

    const renderVideo = useCallback(async () => {
        setBusy('render');
        try {
            const result = await window.ipcRenderer.videoEditorV2.render({ projectId }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '导出失败');
            setProject(result.project);
            if (result.outputPath) await window.ipcRenderer.openPath(result.outputPath);
        } catch (renderError) {
            void appAlert(renderError instanceof Error ? renderError.message : String(renderError));
        } finally {
            setBusy('');
        }
    }, [projectId]);

    if (loading) return <div className="flex h-full items-center justify-center text-text-tertiary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />商品视频工程加载中…</div>;
    if (!project || !project.productVideo) return <div className="flex h-full flex-col items-center justify-center gap-3 text-text-secondary"><Film className="h-8 w-8" /><p>{error || '商品视频工程不存在'}</p>{onClose && <button type="button" className="rounded-lg border border-border px-3 py-2" onClick={onClose}>返回创作页</button>}</div>;

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#F7F8FA] text-text-primary">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-white px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D1117] text-white"><Film className="h-4 w-4" /></div>
                    <div className="min-w-0"><h1 className="truncate text-sm font-bold">{project.title}</h1><p className="text-[11px] text-text-tertiary">{project.productVideo.productSnapshot.name} · {project.canvas.width}×{project.canvas.height} · {statusLabel(project.status)}</p></div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void applyCommand({ type: 'music.remove' })} disabled={!musicTrack?.clips.length || Boolean(busy)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary disabled:opacity-40">移除 BGM</button>
                    <div className="relative">
                        <button type="button" onClick={() => setMusicPickerOpen((open) => !open)} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold"><Music2 className="h-3.5 w-3.5" />添加 BGM</button>
                        {musicPickerOpen && <div className="absolute right-0 top-11 z-30 w-64 overflow-hidden rounded-xl border border-border bg-white p-2 shadow-xl">
                            <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-tertiary">素材库音乐</p>
                            <div className="max-h-48 space-y-1 overflow-y-auto">
                                {libraryAudio.map((asset) => <button key={asset.id} type="button" onClick={() => void addMusic(asset.absolutePath)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-surface-secondary"><Music2 className="h-3.5 w-3.5 shrink-0 text-[#0F766E]" /><span className="truncate">{asset.title || '未命名音频'}</span></button>)}
                                {libraryAudio.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-text-tertiary">素材库暂无音频</p>}
                            </div>
                            <button type="button" onClick={() => void addMusic()} className="mt-2 flex w-full items-center gap-2 border-t border-border px-2 pt-3 text-left text-xs font-semibold"><FolderOpen className="h-3.5 w-3.5" />从本地文件导入</button>
                        </div>}
                    </div>
                    <button type="button" onClick={() => void renderVideo()} disabled={Boolean(busy) || !composition} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === 'render' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}导出 MP4</button>
                    {onClose && <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-secondary"><X className="h-4 w-4" /></button>}
                </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(360px,1fr)_280px] grid-rows-[minmax(0,1fr)_210px]">
                <aside className="row-span-2 min-h-0 overflow-y-auto border-r border-border bg-white p-3">
                    <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">工程素材</h2><span className="text-[10px] text-text-tertiary">{visualAssets.length}</span></div>
                    <div className="space-y-2">
                        {visualAssets.map((asset) => {
                            const source = resolveAssetUrl(asset.thumbnailPath || asset.projectPath);
                            const generated = asset.provenance?.kind === 'ai-generated';
                            return <button key={asset.id} type="button" onClick={() => selectedScene && void applyCommand({ type: 'scene.asset', sceneId: selectedScene.id, assetId: asset.id })} className="group flex w-full gap-2 rounded-xl border border-border bg-[#F7F8FA] p-2 text-left hover:border-[#0F766E]/40">
                                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[#0D1117]">{asset.kind === 'video' ? <video src={source} muted className="h-full w-full object-cover" /> : <img src={source} alt="" className="h-full w-full object-cover" />}</div>
                                <div className="min-w-0 py-0.5"><p className="line-clamp-2 text-[11px] font-semibold">{asset.title}</p><span className={generated ? 'mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700' : 'mt-1 inline-flex items-center gap-1 text-[10px] text-text-tertiary'}>{generated ? <Sparkles className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}{generated ? 'AI 动效' : '商品原图'}</span></div>
                            </button>;
                        })}
                    </div>
                </aside>

                <main className="min-h-0 overflow-hidden bg-[#E9ECEF] p-4">
                    <div className="flex h-full items-center justify-center">
                        <div className="h-full max-h-[calc(100vh-310px)] overflow-hidden rounded-[18px] border-[6px] border-[#0D1117] bg-[#0D1117] shadow-[0_20px_50px_-24px_rgba(13,17,23,0.7)]" style={{ aspectRatio: `${project.canvas.width}/${project.canvas.height}` }}>
                            {composition ? <Player component={VideoMotionComposition} inputProps={{ composition: composition as RemotionCompositionConfig, runtime: 'preview' }} durationInFrames={composition.durationInFrames} fps={composition.fps} compositionWidth={composition.width} compositionHeight={composition.height} controls loop style={{ width: '100%', height: '100%' }} /> : <div className="flex h-full items-center justify-center text-xs text-white/60">暂无可预览镜头</div>}
                        </div>
                    </div>
                </main>

                <aside className="min-h-0 overflow-y-auto border-l border-border bg-white p-4">
                    {selectedScene ? <div className="space-y-5">
                        <div><div className="flex items-center justify-between"><h2 className="text-sm font-bold">{selectedScene.title}</h2><span className="rounded-full bg-surface-secondary px-2 py-1 text-[10px] text-text-tertiary">{selectedScene.source === 'ai-motion' ? 'AI 动效' : '原始素材'}</span></div>{selectedScene.generationStatus === 'failed' && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p>{selectedScene.error || '生成失败，当前使用原图回退。'}</p><button type="button" onClick={() => void retryScene()} disabled={busy === 'retry'} className="mt-2 inline-flex items-center gap-1 font-bold"><RefreshCw className={busy === 'retry' ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />重试此镜头</button></div>}{selectedScene.generationStatus === 'ready' && <p className="mt-2 inline-flex items-center gap-1 text-xs text-[#0F766E]"><CheckCircle2 className="h-3.5 w-3.5" />AI 镜头已生成</p>}</div>
                        <label className="block text-xs font-semibold">镜头时长（秒）<input type="number" min="0.5" max="30" step="0.5" defaultValue={selectedScene.durationMs / 1000} key={`${selectedScene.id}-${selectedScene.durationMs}`} onBlur={(event) => void applyCommand({ type: 'scene.duration', sceneId: selectedScene.id, durationMs: Math.round(Number(event.target.value) * 1000) })} className="mt-2 w-full rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm" /></label>
                        <label className="block text-xs font-semibold">画面适配<select value={selectedScene.fitMode} onChange={(event) => void applyCommand({ type: 'scene.fit', sceneId: selectedScene.id, fitMode: event.target.value as ProductVideoFitMode })} className="mt-2 w-full rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm">{FIT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                        <label className="block text-xs font-semibold">静态动效<select value={selectedScene.motionPreset} onChange={(event) => void applyCommand({ type: 'scene.motion', sceneId: selectedScene.id, motionPreset: event.target.value as ProductVideoMotionPreset })} className="mt-2 w-full rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm">{MOTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                        <label className="block text-xs font-semibold">屏幕文字<textarea defaultValue={selectedScene.overlayText || ''} key={`${selectedScene.id}-${selectedScene.overlayText}`} onBlur={(event) => void applyCommand({ type: 'scene.text', sceneId: selectedScene.id, text: event.target.value.trim() })} rows={4} className="mt-2 w-full resize-none rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm" /></label>
                        <button type="button" onClick={async () => { if (await appConfirm(`删除镜头“${selectedScene.title}”？`)) void applyCommand({ type: 'scene.delete', sceneId: selectedScene.id }); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600"><Trash2 className="h-3.5 w-3.5" />删除镜头</button>
                    </div> : <p className="text-xs text-text-tertiary">选择时间线中的镜头后编辑属性。</p>}
                </aside>

                <section className="col-span-2 min-w-0 border-t border-border bg-[#10151C] p-3 text-white">
                    <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><h2 className="text-xs font-bold">时间线</h2><span className="text-[10px] text-white/45">{(project.timeline.durationMs / 1000).toFixed(1)}s</span></div><button type="button" onClick={async () => { const result = await window.ipcRenderer.videoEditorV2.undoTimeline({ projectId }) as ProjectResponse; if (result.project) setProject(result.project); }} disabled={!project.undoStack.length || Boolean(busy)} className="inline-flex items-center gap-1 text-[11px] text-white/60 disabled:opacity-30"><RotateCcw className="h-3 w-3" />撤销</button></div>
                    <div className="grid grid-cols-[58px_1fr] gap-y-2 text-[10px]">
                        <div className="flex items-center text-white/45">画面</div><div className="flex h-14 gap-1 overflow-hidden rounded-lg bg-white/5 p-1">{scenes.map((scene, index) => <button draggable key={scene.id} type="button" onDragStart={() => setDraggedSceneId(scene.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedSceneId && draggedSceneId !== scene.id) void applyCommand({ type: 'scene.reorder', sceneId: draggedSceneId, targetSceneId: scene.id, position: 'before' }); setDraggedSceneId(''); }} onClick={() => setSelectedSceneId(scene.id)} style={{ flexGrow: scene.durationMs }} className={selectedSceneId === scene.id ? 'relative min-w-[54px] overflow-hidden rounded-md border border-[#2DD4BF] bg-[#173E3A] p-1.5 text-left' : 'relative min-w-[54px] overflow-hidden rounded-md border border-white/10 bg-white/10 p-1.5 text-left hover:bg-white/15'}><span className="block truncate font-semibold">{index + 1}. {scene.title}</span><span className="mt-1 block text-white/50">{(scene.durationMs / 1000).toFixed(1)}s</span>{scene.source === 'ai-motion' && <Sparkles className="absolute bottom-1.5 right-1.5 h-3 w-3 text-amber-400" />}</button>)}</div>
                        <div className="flex items-center text-white/45">文字</div><div className="flex h-8 gap-1 rounded-lg bg-white/5 p-1">{scenes.map((scene) => <div key={scene.id} style={{ flexGrow: scene.durationMs }} className="min-w-[54px] truncate rounded bg-[#D97706]/30 px-2 py-1 text-[9px] text-amber-100">{scene.overlayText || '—'}</div>)}</div>
                        <div className="flex items-center text-white/45">BGM</div><div className="flex h-8 rounded-lg bg-white/5 p-1">{musicTrack?.clips[0] ? <div className="flex w-full items-center gap-2 rounded bg-[#0F766E]/45 px-2 text-[9px] text-teal-100"><Music2 className="h-3 w-3" />{musicTrack.clips[0].text || '背景音乐'} · 20%</div> : <button type="button" onClick={() => setMusicPickerOpen(true)} className="w-full rounded border border-dashed border-white/15 text-white/35 hover:text-white/60">添加背景音乐</button>}</div>
                    </div>
                </section>
            </div>
        </div>
    );
}
