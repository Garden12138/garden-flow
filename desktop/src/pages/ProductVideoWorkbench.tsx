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
    Mic2,
    RefreshCw,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import type { ProductVideoEditCommand, ProductVideoMotionPreset, ProductVideoFitMode, VideoEditorV2Project } from '../../shared/videoAutoEdit';
import { buildVideoEditorV2RemotionComposition } from '../../shared/videoAutoEditRemotion';
import { formatProductSceneSeconds, productSceneDurationFrames, snapProductSceneDurationMs } from '../../shared/productVideoTiming';
import { subscribeDataChanged } from '../bridge/appEvents';
import { ProductVideoTimeline } from '../components/product-video/ProductVideoTimeline';
import { VideoMotionComposition } from '../components/manuscripts/remotion/VideoMotionComposition';
import type { RemotionCompositionConfig } from '../components/manuscripts/remotion/types';
import { appAlert, appConfirm } from '../utils/appDialogs';
import { resolveAssetUrl } from '../utils/pathManager';
import { dispatchAppIntent } from '../features/app-shell/appIntent';
import type { DouyinPublishJob, DouyinVideoVersion } from '../../shared/platformVideoVersion';

type ProductVideoWorkbenchProps = {
    projectId: string;
    onClose?: () => void;
};

type ProjectResponse = { success?: boolean; error?: string; project?: VideoEditorV2Project; canceled?: boolean; outputPath?: string; mediaAssetId?: string };
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

function voiceoverStatusLabel(status?: string): string {
    if (status === 'queued' || status === 'generating') return '旁白生成中';
    if (status === 'ready') return '旁白已就绪';
    if (status === 'failed') return '旁白生成失败';
    if (status === 'duration-conflict') return '旁白长于镜头';
    if (status === 'stale') return '旁白与当前文案不一致';
    if (status === 'needs-configuration') return '待生成旁白';
    return '无旁白';
}

export function ProductVideoWorkbench({ projectId, onClose }: ProductVideoWorkbenchProps) {
    const [project, setProject] = useState<VideoEditorV2Project | null>(null);
    const [selectedSceneId, setSelectedSceneId] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [musicPickerOpen, setMusicPickerOpen] = useState(false);
    const [voicePickerOpen, setVoicePickerOpen] = useState(false);
    const [libraryAudio, setLibraryAudio] = useState<LibraryAudioAsset[]>([]);
    const [douyinVersion, setDouyinVersion] = useState<DouyinVideoVersion | null>(null);
    const [douyinVersions, setDouyinVersions] = useState<DouyinVideoVersion[]>([]);
    const [productChanged, setProductChanged] = useState(false);
    const [douyinEditorOpen, setDouyinEditorOpen] = useState(false);
    const [douyinTitle, setDouyinTitle] = useState('');
    const [douyinDescription, setDouyinDescription] = useState('');
    const [douyinTags, setDouyinTags] = useState('');
    const [douyinCoverId, setDouyinCoverId] = useState('');
    const [publisherOpen, setPublisherOpen] = useState(false);
    const [publisherInstances, setPublisherInstances] = useState<Array<{ extensionInstanceId: string; browser?: string; accountId?: string; accountLabel?: string; pageState?: string; detail?: string; imageCoverSupported?: boolean }>>([]);
    const [publisherBinding, setPublisherBinding] = useState('');
    const [publishJob, setPublishJob] = useState<DouyinPublishJob | null>(null);
    const [publishPreviewUrl, setPublishPreviewUrl] = useState('');
    const [acknowledgedNotPublished, setAcknowledgedNotPublished] = useState(false);
    const [acknowledgedPublished, setAcknowledgedPublished] = useState(false);

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

    const loadDouyinVersion = useCallback(async () => {
        const result = await window.ipcRenderer.douyinVideo.getVersion({ projectId, sourceProjectId: projectId }) as {
            success?: boolean; version?: DouyinVideoVersion | null; versions?: DouyinVideoVersion[]; productChanged?: boolean;
        };
        if (!result.success) return;
        const own = result.version?.projectId === projectId ? result.version : null;
        setDouyinVersion(own);
        setDouyinVersions(result.versions || []);
        setProductChanged(Boolean(result.productChanged));
        setDouyinTitle(own?.title || '');
        setDouyinDescription(own?.description || '');
        setDouyinTags((own?.hashtags || []).join(' '));
        setDouyinCoverId(own?.coverAssetId || '');
    }, [projectId]);

    useEffect(() => { void loadDouyinVersion(); }, [loadDouyinVersion]);

    const createDouyinVersion = useCallback(async (duplicate = false) => {
        setBusy('douyin.create');
        try {
            const result = await window.ipcRenderer.douyinVideo.createVersion({ sourceProjectId: projectId, duplicate }) as {
                success?: boolean; error?: string; version?: DouyinVideoVersion;
            };
            if (!result.success || !result.version) throw new Error(result.error || '创建抖音版本失败');
            if (result.version.projectId === projectId) {
                await loadDouyinVersion();
                setDouyinEditorOpen(true);
            } else {
                dispatchAppIntent({ type: 'video-project.open', projectId: result.version.projectId });
            }
        } catch (createError) {
            void appAlert(createError instanceof Error ? createError.message : String(createError));
        } finally {
            setBusy('');
        }
    }, [loadDouyinVersion, projectId]);

    const saveDouyinCopy = useCallback(async () => {
        if (!douyinVersion) return;
        setBusy('douyin.save');
        try {
            const result = await window.ipcRenderer.douyinVideo.saveVersion({
                versionId: douyinVersion.id,
                expectedRevision: douyinVersion.revision,
                title: douyinTitle,
                description: douyinDescription,
                hashtags: douyinTags.split(/[\s,，#]+/u).filter(Boolean),
                coverAssetId: douyinCoverId || undefined,
            }) as { success?: boolean; error?: string; version?: DouyinVideoVersion };
            if (!result.success || !result.version) throw new Error(result.error || '保存抖音稿件失败');
            setDouyinVersion(result.version);
            setDouyinEditorOpen(false);
        } catch (saveError) {
            void appAlert(saveError instanceof Error ? saveError.message : String(saveError));
            await loadDouyinVersion();
        } finally {
            setBusy('');
        }
    }, [douyinVersion, douyinTitle, douyinDescription, douyinTags, douyinCoverId, loadDouyinVersion]);

    const loadPublisher = useCallback(async () => {
        if (!douyinVersion) return;
        const [status, latest] = await Promise.all([
            window.ipcRenderer.douyinPublisher.getStatus(),
            window.ipcRenderer.douyinPublisher.getJob({ versionId: douyinVersion.id }),
        ]) as [
            { success?: boolean; boundExtensionInstanceId?: string; instances?: typeof publisherInstances },
            { success?: boolean; job?: DouyinPublishJob; videoPreviewUrl?: string },
        ];
        if (status.success) {
            setPublisherBinding(status.boundExtensionInstanceId || '');
            setPublisherInstances(status.instances || []);
        }
        if (latest.job) {
            setPublishJob(latest.job);
            setPublishPreviewUrl(latest.videoPreviewUrl || '');
        }
    }, [douyinVersion]);

    useEffect(() => {
        if (!publisherOpen || !douyinVersion) return;
        void loadPublisher();
        const timer = window.setInterval(() => { void loadPublisher(); }, 2000);
        return () => window.clearInterval(timer);
    }, [publisherOpen, douyinVersion?.id, loadPublisher]);

    const bindPublisher = useCallback(async (extensionInstanceId: string) => {
        const result = await window.ipcRenderer.douyinPublisher.bindInstance({ extensionInstanceId }) as { success?: boolean; error?: string };
        if (!result.success) { void appAlert(result.error || '绑定浏览器失败'); return; }
        await loadPublisher();
    }, [loadPublisher]);

    const prepareDouyinPublication = useCallback(async () => {
        if (!douyinVersion) return;
        setBusy('douyin.prepare');
        try {
            const result = await window.ipcRenderer.douyinPublisher.prepare({ versionId: douyinVersion.id }) as {
                success?: boolean; error?: string; job?: DouyinPublishJob; videoPreviewUrl?: string;
            };
            if (!result.success || !result.job) throw new Error(result.error || '准备发布失败');
            setPublishJob(result.job);
            setPublishPreviewUrl(result.videoPreviewUrl || '');
        } catch (publishError) { void appAlert(publishError instanceof Error ? publishError.message : String(publishError)); }
        finally { setBusy(''); }
    }, [douyinVersion]);

    const actOnDouyinJob = useCallback(async (action: 'confirm' | 'cancel' | 'stageDraft') => {
        if (!publishJob) return;
        setBusy(`douyin.${action}`);
        try {
            const result = await window.ipcRenderer.douyinPublisher[action]({ jobId: publishJob.id }) as { success?: boolean; error?: string; job?: DouyinPublishJob };
            if (!result.success || !result.job) throw new Error(result.error || '发布操作失败');
            setPublishJob(result.job);
        } catch (publishError) { void appAlert(publishError instanceof Error ? publishError.message : String(publishError)); }
        finally { setBusy(''); }
    }, [publishJob]);

    const recoverDouyinJob = useCallback(async () => {
        if (!publishJob || !acknowledgedNotPublished) return;
        setBusy('douyin.recover');
        try {
            const result = await window.ipcRenderer.douyinPublisher.recoverUnpublished({ jobId: publishJob.id, acknowledgedNotPublished: true }) as {
                success?: boolean; error?: string; job?: DouyinPublishJob;
            };
            if (!result.success || !result.job) throw new Error(result.error || '无法安全恢复旧草稿');
            setPublishJob(result.job);
            setAcknowledgedNotPublished(false);
        } catch (recoverError) { void appAlert(recoverError instanceof Error ? recoverError.message : String(recoverError)); }
        finally { setBusy(''); }
    }, [publishJob, acknowledgedNotPublished]);

    const reviewPublishedDouyinJob = useCallback(async () => {
        if (!publishJob || !acknowledgedPublished) return;
        setBusy('douyin.reviewPublished');
        try {
            const result = await window.ipcRenderer.douyinPublisher.reviewPublished({ jobId: publishJob.id, acknowledgedPublished: true }) as {
                success?: boolean; error?: string; job?: DouyinPublishJob;
            };
            if (!result.success || !result.job) throw new Error(result.error || '无法记录作品管理核验结果');
            setPublishJob(result.job);
            setAcknowledgedPublished(false);
        } catch (reviewError) { void appAlert(reviewError instanceof Error ? reviewError.message : String(reviewError)); }
        finally { setBusy(''); }
    }, [publishJob, acknowledgedPublished]);

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
    const selectedVoiceAsset = project?.assets.find((asset) => asset.id === selectedScene?.voiceoverAssetId);
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

    const undoTimeline = useCallback(async () => {
        setBusy('undo');
        try {
            const result = await window.ipcRenderer.videoEditorV2.undoTimeline({ projectId }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '撤销失败');
            setProject(result.project);
        } catch (undoError) {
            void appAlert(undoError instanceof Error ? undoError.message : String(undoError));
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

    const generateVoiceover = useCallback(async () => {
        if (!selectedScene) return;
        setBusy('voiceover.generate');
        try {
            const result = await window.ipcRenderer.videoEditorV2.generateProductVoiceover({ projectId, sceneId: selectedScene.id }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '旁白生成提交失败');
            setProject(result.project);
        } catch (voiceError) {
            void appAlert(voiceError instanceof Error ? voiceError.message : String(voiceError));
        } finally {
            setBusy('');
        }
    }, [projectId, selectedScene]);

    const replaceVoiceover = useCallback(async (sourceAssetId?: string) => {
        if (!selectedScene) return;
        setVoicePickerOpen(false);
        setBusy('voiceover.replace');
        try {
            const result = await window.ipcRenderer.videoEditorV2.setProductVoiceover({ projectId, sceneId: selectedScene.id, sourceAssetId }) as ProjectResponse;
            if (result.canceled) return;
            if (!result.success || !result.project) throw new Error(result.error || '替换旁白失败');
            setProject(result.project);
        } catch (voiceError) {
            void appAlert(voiceError instanceof Error ? voiceError.message : String(voiceError));
        } finally {
            setBusy('');
        }
    }, [projectId, selectedScene]);

    const renderVideo = useCallback(async () => {
        setBusy('render');
        try {
            const result = await window.ipcRenderer.videoEditorV2.render({ projectId }) as ProjectResponse;
            if (!result.success || !result.project) throw new Error(result.error || '导出失败');
            setProject(result.project);
            void appAlert(result.mediaAssetId ? 'MP4 已保存到资产库的媒体列表，可从媒体预览中下载。' : 'MP4 导出完成。');
        } catch (renderError) {
            void appAlert(renderError instanceof Error ? renderError.message : String(renderError));
        } finally {
            setBusy('');
        }
    }, [projectId]);

    if (loading) return <div className="flex h-full items-center justify-center text-text-tertiary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />商品视频工程加载中…</div>;
    if (!project || !project.productVideo) return <div className="flex h-full flex-col items-center justify-center gap-3 text-text-secondary"><Film className="h-8 w-8" /><p>{error || '商品视频工程不存在'}</p>{onClose && <button type="button" className="rounded-lg border border-border px-3 py-2" onClick={onClose}>返回创作页</button>}</div>;

    return (
        <div className="relative flex h-full min-h-0 flex-col bg-[#F7F8FA] text-text-primary">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-white px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D1117] text-white"><Film className="h-4 w-4" /></div>
                    <div className="min-w-0"><h1 className="truncate text-sm font-bold">{project.title}</h1><p className="text-[11px] text-text-tertiary">{project.productVideo.productSnapshot.name} · {project.canvas.width}×{project.canvas.height} · {statusLabel(project.status)}</p></div>
                </div>
                <div className="flex items-center gap-2">
                    {douyinVersion ? <>
                        <button type="button" onClick={() => setDouyinEditorOpen(true)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">抖音稿件 · 第 {douyinVersion.revision} 版</button>
                        <button type="button" onClick={() => setPublisherOpen(true)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">准备抖音发布</button>
                        <button type="button" onClick={() => dispatchAppIntent({ type: 'video-project.open', projectId: douyinVersion.sourceProjectId })} className="rounded-lg border border-border px-3 py-2 text-xs">查看来源</button>
                        <button type="button" onClick={() => void createDouyinVersion(true)} disabled={Boolean(busy)} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">再复制一版</button>
                    </> : <button type="button" onClick={() => void createDouyinVersion()} disabled={Boolean(busy)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">{douyinVersions.length ? '打开抖音版本' : '创建抖音版本'}</button>}
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
                    <button type="button" onClick={() => void renderVideo()} disabled={Boolean(busy) || !composition} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === 'render' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}保存 MP4 到资产库</button>
                    {onClose && <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-secondary"><X className="h-4 w-4" /></button>}
                </div>
            </header>

            {douyinVersion && productChanged && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">商品资料已变化，请复核抖音稿件中的商品事实；当前工程与文案不会自动改写。</div>}
            {douyinEditorOpen && douyinVersion && <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
                <section className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
                    <div className="flex items-center justify-between"><h2 className="text-base font-bold">抖音短视频稿件 · 第 {douyinVersion.revision} 版</h2><button type="button" onClick={() => setDouyinEditorOpen(false)} aria-label="关闭抖音稿件"><X className="h-4 w-4" /></button></div>
                    <p className="text-xs text-text-secondary">首句尽快说明看点；检查字幕不要落在抖音按钮和文案区域。视频镜头、旁白与 BGM 可在工作台单独修改，修改后需重新导出此版本。</p>
                    <label className="block text-xs font-semibold">内部标题<input value={douyinTitle} onChange={(event) => setDouyinTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" /></label>
                    <label className="block text-xs font-semibold">发布描述<textarea value={douyinDescription} onChange={(event) => setDouyinDescription(event.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" /></label>
                    <label className="block text-xs font-semibold">话题（空格分隔）<input value={douyinTags} onChange={(event) => setDouyinTags(event.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" /></label>
                    <label className="block text-xs font-semibold">封面素材
                        <select value={douyinCoverId} onChange={(event) => setDouyinCoverId(event.target.value)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
                            <option value="">使用视频默认封面</option>
                            {project.assets.filter((asset) => asset.kind === 'image').map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
                        </select>
                    </label>
                    {douyinCoverId && <div className="space-y-2"><p className="text-xs text-text-secondary">所选图片将居中裁切为竖封面 3:4 和横封面 4:3。请核对主体和文字是否完整；发布确认卡会展示实际上传的两张封面。</p><div className="flex items-end gap-4">{(['portrait', 'landscape'] as const).map((orientation) => <figure key={orientation} className="w-32"><img src={resolveAssetUrl(project.assets.find((asset) => asset.id === douyinCoverId)?.projectPath)} alt={orientation === 'portrait' ? '竖封面裁切预览' : '横封面裁切预览'} className={`w-full rounded-lg bg-black object-cover ${orientation === 'portrait' ? 'aspect-[3/4]' : 'aspect-[4/3]'}`} /><figcaption className="mt-1 text-center text-xs text-text-secondary">{orientation === 'portrait' ? '竖封面 3:4' : '横封面 4:3'}</figcaption></figure>)}</div></div>}
                    <div className="flex justify-end gap-2"><button type="button" onClick={() => setDouyinEditorOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs">取消</button><button type="button" onClick={() => void saveDouyinCopy()} disabled={Boolean(busy)} className="rounded-lg bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">保存独立稿件</button></div>
                </section>
            </div>}

            {publisherOpen && douyinVersion && <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
                <section className="max-h-full w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
                    <div className="flex items-center justify-between"><h2 className="text-base font-bold">抖音发布确认</h2><button type="button" onClick={() => setPublisherOpen(false)} aria-label="关闭发布确认"><X className="h-4 w-4" /></button></div>
                    <div className="space-y-2 text-xs"><p className="font-semibold">目标浏览器与账号</p>{publisherInstances.map((instance) => <div key={instance.extensionInstanceId} className="flex items-center justify-between rounded-lg border border-border p-2"><span>{instance.browser || '浏览器'} · {instance.accountLabel || '账号未识别'} · {instance.pageState || '未知'}<br /><span className="text-text-tertiary">{instance.detail || instance.accountId || instance.extensionInstanceId}</span></span><button type="button" onClick={() => void bindPublisher(instance.extensionInstanceId)} className="rounded border border-border px-2 py-1">{publisherBinding === instance.extensionInstanceId ? '已绑定' : '绑定'}</button></div>)}{publisherInstances.length === 0 && <p>请安装新版发布插件，并打开已登录的抖音创作者发布页。</p>}</div>
                    {douyinVersion.coverAssetId && <p className="text-xs text-text-secondary">已选封面素材：{project.assets.find((asset) => asset.id === douyinVersion.coverAssetId)?.title || douyinVersion.coverAssetId}，将应用为横、竖双封面。{!publisherInstances.some((instance) => instance.extensionInstanceId === publisherBinding && instance.imageCoverSupported) && <span className="text-amber-700">请更新发布插件并绑定支持图片封面的浏览器。</span>}</p>}
                    {publishJob ? <div className="space-y-3 rounded-xl border border-border bg-surface-secondary/40 p-4 text-xs">
                        <div className="font-semibold">《{publishJob.title}》· 第 {publishJob.versionRevision} 版 · {publishJob.status}</div>
                        <div>目标账号：{publishJob.accountLabel}（{publishJob.accountId}）</div>
                        {publishPreviewUrl && <video src={publishPreviewUrl} controls preload="metadata" className="max-h-64 rounded-lg bg-black" />}
                        {publishJob.imageCover ? <div className="space-y-2"><p>实际上传封面（居中裁切）</p><div className="flex items-end gap-4">{publishJob.imageCover.files.map((file) => <figure key={file.orientation} className="w-32"><img src={resolveAssetUrl(file.path)} alt={file.orientation === 'portrait' ? '实际竖封面' : '实际横封面'} className="w-full rounded-lg" /><figcaption className="mt-1 text-center">{file.orientation === 'portrait' ? '竖封面 3:4' : '横封面 4:3'}</figcaption></figure>)}</div></div> : <p>封面：视频默认封面</p>}
                        <p className="whitespace-pre-wrap">{publishJob.description}</p>
                        <p>{publishJob.hashtags.map((tag) => `#${tag}`).join(' ')}</p>
                        {publishJob.errorMessage && <p className="text-amber-700">{publishJob.errorMessage}</p>}
                        {['awaiting_confirmation', 'blocked'].includes(publishJob.status) && publishJob.publishStatus === 'not_submitted' && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void actOnDouyinJob('stageDraft')} disabled={Boolean(busy)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-50">上传到页面供核对（不发布）</button><button type="button" onClick={() => void actOnDouyinJob('confirm')} disabled={Boolean(busy) || Boolean(publishJob.imageCover && !publisherInstances.some((instance) => instance.extensionInstanceId === publishJob.extensionInstanceId && instance.imageCoverSupported))} className="rounded-lg bg-[#0F766E] px-3 py-2 font-semibold text-white disabled:opacity-50">{publishJob.status === 'blocked' ? '复核后重试发布' : publishJob.imageCover ? '确认视频、封面、文案和账号后发布' : '确认视频、文案和账号后发布'}</button><button type="button" onClick={() => void actOnDouyinJob('cancel')} disabled={Boolean(busy)} className="rounded-lg border border-border px-3 py-2">取消</button></div>}
                        {publishJob.status === 'submitted_pending_review' && <p>平台已接收，正在审核；请在作品管理核对后再认定发布成功。</p>}
                        {publishJob.status === 'submit_result_unknown' && <div className="space-y-2"><p>提交结果未知，请先检查抖音作品管理。核实前不要重新提交。</p><label className="flex items-center gap-2"><input type="checkbox" checked={acknowledgedNotPublished} onChange={(event) => setAcknowledgedNotPublished(event.target.checked)} />我已在抖音作品管理核实这次没有发布成功</label><button type="button" onClick={() => void recoverDouyinJob()} disabled={!acknowledgedNotPublished || Boolean(busy)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-50">已核实未发布，恢复发布页</button></div>}
                        {(['submit_result_unknown', 'submitted_pending_review', 'published_reset_failed'].includes(publishJob.status) || (publishJob.status === 'completed' && !publishJob.publishedReview)) && <div className="space-y-2"><label className="flex items-center gap-2"><input type="checkbox" checked={acknowledgedPublished} onChange={(event) => setAcknowledgedPublished(event.target.checked)} />我已在目标账号的作品管理核实《{publishJob.title}》显示“已发布”</label><button type="button" onClick={() => void reviewPublishedDouyinJob()} disabled={!acknowledgedPublished || Boolean(busy)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-50">{publishJob.status === 'published_reset_failed' ? '复核空白发布页并完成收尾' : publishJob.status === 'completed' ? '补记作品管理核实结果' : '记录已发布并复核空白发布页'}</button></div>}
                        {publishJob.status === 'completed' && <p>{publishJob.publishedReview ? '作品管理已人工核实发布成功' : '平台已确认发布成功'}，原浏览器已返回空白视频发布页。</p>}
                    </div> : <p className="text-xs text-text-secondary">确认卡会展示实际导出 MP4、完整文案及页面读取的目标账号。准备操作不会提交视频。</p>}
                    <div className="flex justify-end"><button type="button" onClick={() => void prepareDouyinPublication()} disabled={Boolean(busy) || !publisherBinding || Boolean(douyinVersion.coverAssetId && !publisherInstances.some((instance) => instance.extensionInstanceId === publisherBinding && instance.imageCoverSupported))} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">准备当前版本</button></div>
                </section>
            </div>}

            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(360px,1fr)_280px] grid-rows-[minmax(0,1fr)_250px]">
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
                        <div className="relative h-full max-h-[calc(100vh-350px)] overflow-hidden rounded-[18px] border-[6px] border-[#0D1117] bg-[#0D1117] shadow-[0_20px_50px_-24px_rgba(13,17,23,0.7)]" style={{ aspectRatio: `${project.canvas.width}/${project.canvas.height}` }}>
                            {composition ? <Player component={VideoMotionComposition} inputProps={{ composition: composition as RemotionCompositionConfig, runtime: 'preview' }} durationInFrames={composition.durationInFrames} fps={composition.fps} compositionWidth={composition.width} compositionHeight={composition.height} controls loop style={{ width: '100%', height: '100%' }} /> : <div className="flex h-full items-center justify-center text-xs text-white/60">暂无可预览镜头</div>}
                            {douyinVersion && <div className="pointer-events-none absolute inset-0" aria-label="抖音竖屏安全区示意">
                                <div className="absolute right-0 top-[20%] h-[58%] w-[17%] border-l border-white/50 bg-black/15" />
                                <div className="absolute bottom-0 left-0 h-[20%] w-full border-t border-white/50 bg-black/20" />
                                <span className="absolute bottom-[21%] left-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">抖音按钮／文案安全区示意</span>
                            </div>}
                        </div>
                    </div>
                </main>

                <aside className="min-h-0 overflow-y-auto border-l border-border bg-white p-4">
                    {selectedScene ? <div className="space-y-5">
                        <div><div className="flex items-center justify-between"><h2 className="text-sm font-bold">{selectedScene.title}</h2><span className="rounded-full bg-surface-secondary px-2 py-1 text-[10px] text-text-tertiary">{selectedScene.source === 'ai-motion' ? 'AI 动效' : '原始素材'}</span></div>{selectedScene.generationStatus === 'failed' && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p>{selectedScene.error || '生成失败，当前使用原图回退。'}</p><button type="button" onClick={() => void retryScene()} disabled={busy === 'retry'} className="mt-2 inline-flex items-center gap-1 font-bold"><RefreshCw className={busy === 'retry' ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />重试此镜头</button></div>}{selectedScene.generationStatus === 'ready' && <p className="mt-2 inline-flex items-center gap-1 text-xs text-[#0F766E]"><CheckCircle2 className="h-3.5 w-3.5" />AI 镜头已生成</p>}</div>
                        <div>
                            <label className="block text-xs font-semibold">镜头时长（秒）<input type="number" min={Math.round(1000 / project.canvas.fps) / 1000} max="30" step="0.001" disabled={Boolean(busy)} defaultValue={formatProductSceneSeconds(selectedScene.durationMs)} key={`${selectedScene.id}-${selectedScene.durationMs}`} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={(event) => {
                                const requestedMs = Math.round(Number(event.target.value) * 1000);
                                if (!event.target.value.trim() || !Number.isFinite(requestedMs) || requestedMs <= 0 || requestedMs > 30_000) {
                                    event.target.value = formatProductSceneSeconds(selectedScene.durationMs);
                                    void appAlert('请输入大于 0 且不超过 30 秒的时长。');
                                    return;
                                }
                                const durationMs = snapProductSceneDurationMs(requestedMs, project.canvas.fps);
                                event.target.value = formatProductSceneSeconds(durationMs);
                                if (productSceneDurationFrames(durationMs, project.canvas.fps) !== productSceneDurationFrames(selectedScene.durationMs, project.canvas.fps)) void applyCommand({ type: 'scene.duration', sceneId: selectedScene.id, durationMs });
                            }} className="mt-2 w-full rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm tabular-nums disabled:opacity-50" /></label>
                            <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-tertiary">镜头帧数<input aria-label="镜头帧数" type="number" min="1" max={30 * project.canvas.fps} step="1" disabled={Boolean(busy)} defaultValue={productSceneDurationFrames(selectedScene.durationMs, project.canvas.fps)} key={`frames-${selectedScene.id}-${selectedScene.durationMs}`} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={(event) => {
                                const frames = Number(event.target.value);
                                if (!event.target.value.trim() || !Number.isInteger(frames) || frames < 1 || frames > 30 * project.canvas.fps) {
                                    event.target.value = String(productSceneDurationFrames(selectedScene.durationMs, project.canvas.fps));
                                    void appAlert(`请输入 1～${30 * project.canvas.fps} 的整数帧数。`);
                                    return;
                                }
                                if (frames !== productSceneDurationFrames(selectedScene.durationMs, project.canvas.fps)) void applyCommand({ type: 'scene.duration', sceneId: selectedScene.id, durationMs: Math.round(frames * 1000 / project.canvas.fps) });
                            }} className="w-24 rounded border border-border bg-[#F7F8FA] px-2 py-1 text-xs tabular-nums disabled:opacity-50" /></label>
                            <p className="mt-1.5 text-[10px] text-text-tertiary">按 {project.canvas.fps}fps 对齐到最近一帧，也可拖动时间线两侧调整。</p>
                        </div>
                        <label className="block text-xs font-semibold">画面适配<select value={selectedScene.fitMode} onChange={(event) => void applyCommand({ type: 'scene.fit', sceneId: selectedScene.id, fitMode: event.target.value as ProductVideoFitMode })} className="mt-2 w-full rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm">{FIT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                        <label className="block text-xs font-semibold">静态动效<select value={selectedScene.motionPreset} onChange={(event) => void applyCommand({ type: 'scene.motion', sceneId: selectedScene.id, motionPreset: event.target.value as ProductVideoMotionPreset })} className="mt-2 w-full rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm">{MOTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                        <label className="block text-xs font-semibold">屏幕文字<textarea defaultValue={selectedScene.overlayText || ''} key={`${selectedScene.id}-${selectedScene.overlayText}`} onBlur={(event) => void applyCommand({ type: 'scene.text', sceneId: selectedScene.id, text: event.target.value.trim() })} rows={4} className="mt-2 w-full resize-none rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm" /></label>
                        <div className="border-t border-border pt-4">
                            <div className="flex items-center justify-between"><h3 className="inline-flex items-center gap-1.5 text-xs font-bold"><Mic2 className="h-3.5 w-3.5 text-[#C05640]" />镜头旁白</h3><span className="text-[10px] text-text-tertiary">独立于屏幕文字 · 音量 100%</span></div>
                            <label className="mt-3 block text-xs font-semibold">朗读文案<textarea defaultValue={selectedScene.narrationText || ''} key={`${selectedScene.id}-${selectedScene.narrationText}`} onBlur={(event) => { const value = event.target.value.trim(); if (value !== (selectedScene.narrationText || '')) void applyCommand({ type: 'scene.narration-text', sceneId: selectedScene.id, text: value }); }} rows={3} className="mt-2 w-full resize-none rounded-lg border border-border bg-[#F7F8FA] px-3 py-2 text-sm" /></label>
                            <div className="mt-2 rounded-lg border border-border bg-[#F7F8FA] p-2.5 text-[11px]">
                                <p className={selectedScene.voiceoverStatus === 'failed' || selectedScene.voiceoverStatus === 'duration-conflict' ? 'font-semibold text-amber-700' : 'font-semibold text-text-secondary'}>{voiceoverStatusLabel(selectedScene.voiceoverStatus)}{selectedScene.voiceoverSource === 'imported' ? ' · 导入录音' : selectedScene.voiceoverSource === 'tts' ? ' · AI 合成' : ''}</p>
                                {selectedScene.voiceoverError && <p className="mt-1 break-words text-amber-700">{selectedScene.voiceoverError}</p>}
                                {selectedScene.voiceoverStatus === 'duration-conflict' && <p className="mt-1 text-amber-700">音频约 {((selectedScene.voiceoverDurationMs || 0) / 1000).toFixed(1)} 秒，镜头仅 {(selectedScene.durationMs / 1000).toFixed(1)} 秒。请延长镜头或换一段较短录音；当前不会裁剪音频。</p>}
                                {selectedScene.voiceoverStatus === 'stale' && <p className="mt-1 text-amber-700">朗读文案已变更，现有音频仍可试听；请重新生成或替换。</p>}
                                {selectedVoiceAsset && <audio key={selectedVoiceAsset.id} controls preload="none" src={resolveAssetUrl(selectedVoiceAsset.projectPath)} className="mt-2 h-8 w-full" aria-label={`${selectedScene.title}旁白试听`} />}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" onClick={() => void generateVoiceover()} disabled={Boolean(busy) || !selectedScene.narrationText?.trim() || selectedScene.voiceoverStatus === 'queued' || selectedScene.voiceoverStatus === 'generating'} className="inline-flex items-center gap-1 rounded-lg bg-[#C05640] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40">{busy === 'voiceover.generate' || selectedScene.voiceoverStatus === 'generating' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic2 className="h-3 w-3" />}{selectedScene.voiceoverStatus === 'ready' ? '重新生成旁白' : selectedScene.voiceoverStatus === 'failed' || selectedScene.voiceoverStatus === 'stale' ? '重试生成' : '生成旁白'}</button>
                                <div className="relative"><button type="button" onClick={() => setVoicePickerOpen((open) => !open)} disabled={Boolean(busy)} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-40">{selectedVoiceAsset ? '替换录音' : '导入录音'}</button>
                                    {voicePickerOpen && <div className="absolute right-0 top-9 z-30 w-64 rounded-xl border border-border bg-white p-2 shadow-xl"><p className="px-2 pb-1 text-[10px] font-bold text-text-tertiary">素材库音频</p><div className="max-h-36 overflow-y-auto">{libraryAudio.map((asset) => <button key={asset.id} type="button" onClick={() => void replaceVoiceover(asset.id)} className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-surface-secondary">{asset.title || '未命名音频'}</button>)}{libraryAudio.length === 0 && <p className="px-2 py-2 text-[11px] text-text-tertiary">素材库暂无音频</p>}</div><button type="button" onClick={() => void replaceVoiceover()} className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-2 pt-2 text-left text-xs font-semibold"><FolderOpen className="h-3 w-3" />从本地文件导入</button></div>}
                                </div>
                                <button type="button" onClick={() => void applyCommand({ type: 'voiceover.remove', sceneId: selectedScene.id })} disabled={Boolean(busy) || !selectedVoiceAsset} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-text-secondary disabled:opacity-40">移除</button>
                            </div>
                        </div>
                        <button type="button" onClick={async () => { if (await appConfirm(`删除镜头“${selectedScene.title}”？`)) void applyCommand({ type: 'scene.delete', sceneId: selectedScene.id }); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600"><Trash2 className="h-3.5 w-3.5" />删除镜头</button>
                    </div> : <p className="text-xs text-text-tertiary">选择时间线中的镜头后编辑属性。</p>}
                </aside>

                <ProductVideoTimeline project={project} selectedSceneId={selectedSceneId} busy={Boolean(busy)} onSelect={setSelectedSceneId} onResize={(sceneId, durationMs) => applyCommand({ type: 'scene.duration', sceneId, durationMs })} onReorder={(sceneId, targetSceneId) => void applyCommand({ type: 'scene.reorder', sceneId, targetSceneId, position: 'before' })} onUndo={undoTimeline} onAddMusic={() => setMusicPickerOpen(true)} />
            </div>
        </div>
    );
}
