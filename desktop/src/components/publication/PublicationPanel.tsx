import { resolveAssetUrl } from '../../utils/pathManager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { PublicationSource, PublicationSnapshot, PublicationJobView, PublicationBrowserState } from '../../../shared/publication';
import { useProductEditorContext } from '../product-video/ProductEditorContext';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

export const publicationPlatformLabel = { xiaohongshu: '小红书', douyin: '抖音', tiktok: 'TikTok' };
export function publicationStatusLabel(job: PublicationJobView): string {
    if (job.status === 'superseded') return '旧确认已失效';
    if (job.status === 'cancelled') return '已取消';
    if (job.publishStatus === 'unknown') return '结果未知，需核实';
    if (job.publishStatus === 'pending_review') return '已提交待审核';
    if (job.publishStatus === 'published') return job.resetStatus === 'failed' ? '已发布，页面恢复失败' : '已发布';
    if (job.status === 'uploading') return '上传中';
    if (['queued', 'preflighting', 'submitting'].includes(job.status)) return '正在提交';
    if (job.status === 'blocked') return '上传或提交前检查失败';
    return job.phase === 'awaiting-submit' ? '已上传，待最终确认' : job.phase === 'legacy' ? '旧任务，需重新准备' : '待允许上传';
}
const button = 'rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40';
export function PublicationPanel({ source, initialJob, origin = 'manual', promptId, onClose }: { source?: PublicationSource; initialJob?: PublicationJobView; origin?: 'manual' | 'completion'; promptId?: string; onClose: () => void }) {
    const editor = useProductEditorContext();
    const [snapshot, setSnapshot] = useState<PublicationSnapshot | null>(initialJob?.context?.snapshot || null);
    const [job, setJob] = useState<PublicationJobView | null>(initialJob || null);
    const [statuses, setStatuses] = useState<PublicationBrowserState[]>([]);
    const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
    const [coverAcknowledged, setCoverAcknowledged] = useState(false);
    const coverPreview = useRef<HTMLVideoElement>(null);
    const refresh = useCallback(async () => {
        const result = await window.ipcRenderer.publication.status({ refresh: true });
        if (!result.success) throw new Error(result.error || '读取发布状态失败'); setStatuses(result.statuses);
    }, []);
    useEffect(() => { let active = true;
        if (source) void window.ipcRenderer.publication.readSource({ source }).then(result => { if (!active) return; if (!result.success || !result.snapshot) setError(result.error || '工程未就绪'); else setSnapshot(result.snapshot); });
        void refresh().catch(reason => { if (active) setError(String(reason)); });
        return () => { active = false; };
    }, [JSON.stringify(source), refresh]);
    useEffect(() => {
        if (!job) return;
        let active = true;
        const load = async () => { const result = await window.ipcRenderer.publication.getJob({ platform: job.platform, jobId: job.id }); if (active && result.success && result.job) setJob(result.job); };
        const listener = () => { void load(); }; window.ipcRenderer.publication.onChanged(listener);
        const timer = window.setInterval(() => { if (['queued', 'preflighting', 'uploading', 'submitting', 'returning'].includes(job.status)) void load(); }, 750);
        return () => { active = false; clearInterval(timer); window.ipcRenderer.publication.offChanged(listener); };
    }, [job?.id, job?.status]);
    const act = async (action: 'prepare' | 'upload' | 'cover' | 'submit' | 'cancel' | 'recover' | 'review' | 'receipt') => {
        setBusy(action); setError('');
        try {
            if (['prepare', 'upload', 'cover', 'submit'].includes(action)) await editor?.beforeSend();
            const result = action === 'prepare' && snapshot ? await window.ipcRenderer.publication.prepare({ source: snapshot.source, expectedRevision: snapshot.revision, origin, promptId })
                : job && action === 'cover' ? await window.ipcRenderer.publication.upload({ platform: job.platform, jobId: job.id, expectedDigest: job.contentDigest, acknowledged: coverAcknowledged, coverOnly: true })
                : job && action !== 'prepare' ? await window.ipcRenderer.publication[action]({ platform: job.platform, jobId: job.id, expectedDigest: job.contentDigest, acknowledged }) : null;
            if (!result?.success || !result.job) throw new Error(result?.error || '请先读取完整工程'); setJob(result.job);
            if (action === 'cover') setCoverAcknowledged(false);
        } catch (reason) { setError(String(reason)); }
        finally { setBusy(''); }
    };
    const platform = snapshot?.platform || job?.platform;
    const status = statuses.find(item => item.platform === platform);
    const media = job?.media || snapshot?.media.map(item => ({ ...item, previewUrl: resolveAssetUrl(item.path) })) || [];
    const coverCandidates = job?.context?.snapshot.coverCandidates || snapshot?.coverCandidates;
    const coverVideo = media.find(item => item.role === 'video');
    const canAct = job?.publishStatus === 'not_submitted' && ['awaiting_confirmation', 'blocked'].includes(job.status) && job.phase !== 'legacy';
    const canSubmit = job?.phase === 'awaiting-submit' && (job.platform !== 'tiktok' || job.status === 'awaiting_confirmation') && (job.platform !== 'xiaohongshu' || Boolean(job.context?.uploadReview?.pageSettings?.visibilityLabel && job.context.uploadReview.pageSettings.scheduled === false));
    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-6" data-publication-panel="">
        <section role="dialog" aria-label="准备发布" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-surface-primary p-5 text-text-primary shadow-xl">
            <header className="flex items-center justify-between"><h2 className="font-semibold">{platform ? publicationPlatformLabel[platform] : ''} · 准备发布</h2><button type="button" onClick={onClose} aria-label="关闭发布面板"><X className="h-5 w-5" /></button></header>
            <p className="mt-3 text-xs text-text-tertiary">{snapshot?.target && `${snapshot.target.spec.width}×${snapshot.target.spec.height} · ${snapshot.target.spec.aspectRatio} · ${snapshot.target.language} · ${snapshot.target.market}`}</p>
            <p className="my-3 text-xs text-text-tertiary">先上传到目标账号页面供核对；回读通过后，再单独确认最终发布。</p>
            <div className="space-y-2 rounded-xl border border-border p-3 text-xs"><div className="flex justify-between"><strong>真实账号与发布浏览器</strong><button className={button} disabled={Boolean(busy)} onClick={() => void refresh().catch(reason => setError(String(reason)))}>刷新状态</button></div>
                {status?.instances.map(instance => <div className="flex justify-between gap-3" key={instance.extensionInstanceId}><span>{instance.browser} · {instance.accountLabel || '账号未识别'} · {instance.pageState || '未知'}{!instance.connected && ' · 未连接'}<br /><span className="text-text-tertiary">{instance.detail || instance.accountId}</span></span><button className={button} disabled={!instance.connected || Boolean(busy)} onClick={async () => { const result = await window.ipcRenderer.publication.bind({ platform: platform!, extensionInstanceId: instance.extensionInstanceId }); if (!result.success) setError(result.error || '绑定失败'); else await refresh(); }}>{status.boundExtensionInstanceId === instance.extensionInstanceId ? '已绑定' : '绑定此浏览器'}</button></div>)}
                {!status?.instances.length && <p>未检测到对应平台发布插件。请连接新版插件并打开已登录的发布页。</p>}
            </div>
            <div className="my-4 space-y-2 text-sm"><h3 className="font-semibold">{job?.title || snapshot?.title}</h3><p className="whitespace-pre-wrap">{job?.body || snapshot?.body}</p><p className="text-xs text-text-tertiary">{(job?.hashtags || snapshot?.hashtags)?.map(tag => `#${tag}`).join(' ')}</p>{snapshot?.settings && <p className="text-xs">TikTok：{{ everyone: '所有人可见', friends: '好友可见', only_me: '仅自己可见' }[snapshot.settings.visibility]} · 评论{snapshot.settings.allowComments ? '开启' : '关闭'} · 二次使用{snapshot.settings.allowReuse ? '允许' : '关闭'} · 混剪{snapshot.settings.allowRemix ? '允许' : '关闭'} · 成年观众限制{snapshot.settings.audience18Plus ? '开启' : '关闭'} · {{ none: '未标记商业内容', own_brand: '自有品牌', paid_partnership: '品牌合作' }[snapshot.settings.commercialContent]} · AI 内容标记{snapshot.settings.aiGenerated ? '开启' : '关闭'}</p>}</div>
            <div className="flex gap-3 overflow-x-auto">{media.map(item => <figure key={item.slotId} className="w-28 shrink-0"><span className="text-xs">{item.order + 1} · {item.role === 'cover' ? '封面' : item.role === 'video' ? '视频' : '内容页'}</span>{item.previewUrl && (item.role === 'video' ? <video controls src={item.previewUrl} className="w-full rounded" /> : <img src={item.previewUrl} className="aspect-[3/4] w-full rounded object-contain" alt={`第 ${item.order + 1} 张`} />)}</figure>)}</div>
            {Boolean(coverCandidates?.length) && coverVideo && <section className="my-4 rounded-lg border border-border p-3 text-xs"><p>封面候选帧 · 点击幕号预览；请在 TikTok Studio 中核对并选择实际封面。</p><video ref={coverPreview} controls preload="metadata" src={coverVideo.previewUrl} className="my-3 max-h-64 rounded" /><div className="flex flex-wrap gap-2">{coverCandidates!.map((candidate, index) => <button className={button} key={candidate.sceneId} onClick={() => { if (coverPreview.current) { coverPreview.current.pause(); coverPreview.current.currentTime = candidate.timeMs / 1000; } }}>第 {index + 1} 幕 · {(candidate.timeMs / 1000).toFixed(1)} 秒</button>)}</div></section>}
            {job && <div className="my-3 rounded-lg bg-surface-secondary p-3 text-xs"><strong>{publicationStatusLabel(job)}</strong><p className="mt-1">目标账号：{job.accountLabel || '历史任务未记录账号'}</p>{job.errorMessage && <p className="mt-2 text-amber-700">{job.errorMessage}</p>}{job.receiptUrl ? <a href={job.receiptUrl} target="_blank" rel="noreferrer" className="mt-2 block underline">查看作品回执</a> : <p className="mt-1 text-text-tertiary">尚未提供可信作品链接</p>}{job.receiptSource && <p>核实来源：{job.receiptSource}</p>}</div>}
            {job?.platform === 'xiaohongshu' && job.context?.uploadReview?.pageSettings && <p className="my-3 text-xs">页面回读：{job.context.uploadReview.pageSettings.visibilityLabel}{typeof job.context.uploadReview.pageSettings.original === 'boolean' && ` · 原创声明${job.context.uploadReview.pageSettings.original ? '开启' : '未开启'}`}{typeof job.context.uploadReview.pageSettings.allowCopy === 'boolean' && ` · 正文复制${job.context.uploadReview.pageSettings.allowCopy ? '允许' : '关闭'}`} · 立即发布</p>}
            {error && <p role="alert" className="my-3 whitespace-pre-wrap text-xs text-red-600">{error}</p>}
            {canAct && job?.phase === 'awaiting-submit' && !canSubmit && <p className="my-3 text-xs text-amber-700">{job.platform === 'tiktok' ? '当前页面核对已失效；仅修改封面时可在下方重新核对，其他变化请重新准备。' : '旧上传核验缺少当前发布设置，请先重新上传核对。'}</p>}
            {canAct && job?.platform === 'tiktok' && job.phase === 'awaiting-submit' && <div className="my-3 space-y-2 rounded-lg border border-border p-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={coverAcknowledged} onChange={event => setCoverAcknowledged(event.target.checked)} />我仅在 Studio 修改了封面，未替换视频或修改文案、设置</label><p>保存实际封面后重新核对。此操作不上传视频、不修改页面、不发布；其他内容变化仍会阻止提交。</p><button className={button} disabled={!coverAcknowledged || Boolean(busy)} onClick={() => void act('cover')}>重新核对封面（不上传）</button></div>}
            <footer className="mt-4 flex flex-wrap items-center gap-2">
                {snapshot && (!job || job.phase === 'legacy' || ['cancelled', 'superseded'].includes(job.status)) && <button className={button} disabled={Boolean(busy)} onClick={() => void act('prepare')}>准备当前版本</button>}
                {canAct && <><button className={button} disabled={Boolean(busy)} onClick={() => void act('upload')}>上传到页面供核对（不发布）</button><button className={`${button} bg-accent-primary text-white`} disabled={Boolean(busy) || !canSubmit} onClick={() => void act('submit')}>最终确认发布</button><button className={button} disabled={Boolean(busy)} onClick={() => void act('cancel')}>取消任务</button></>}
                {job && ['unknown', 'pending_review', 'submitted', 'published'].includes(job.publishStatus) && <><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />已在目标账号作品管理中人工核实</label><button className={button} disabled={!acknowledged || Boolean(busy)} onClick={() => void act('review')}>记录已发布</button>{job.publishStatus === 'unknown' && <button className={button} disabled={!acknowledged || Boolean(busy)} onClick={() => void act('recover')}>已核实未发布，恢复核对</button>}{job.platform === 'tiktok' && <button className={button} disabled={Boolean(busy)} onClick={() => void act('receipt')}>读取作品回执</button>}</>}
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            </footer>
        </section>
    </div>;
}
export function PublicationButton({ source, label = '准备发布', origin = 'manual', promptId }: { source: PublicationSource; label?: string; origin?: 'manual' | 'completion'; promptId?: string }) {
    const editor = useProductEditorContext(); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    return <><button type="button" className={button} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await editor?.beforeSend(); setOpen(true); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } }}>{label}</button>{error && <span role="alert" className="text-xs text-red-600">{error}</span>}{open && <PublicationPanel source={source} origin={origin} promptId={promptId} onClose={() => setOpen(false)} />}</>;
}
export function PublicationOfferCard({ offer }: { offer: { id: string; source: PublicationSource; title: string } }) {
    const [dismissed, setDismissed] = useState(false); const [error, setError] = useState('');
    useEffect(() => { let active = true; const load = () => { void window.ipcRenderer.publication.list().then(result => { if (active && result.success) setDismissed(result.offers.find(event => event.id === offer.id)?.state !== 'offered'); }); }; load(); window.ipcRenderer.publication.onChanged(load); return () => { active = false; window.ipcRenderer.publication.offChanged(load); }; }, [offer.id]);
    return <div className="my-3 rounded-xl border border-border bg-surface-secondary p-4 text-sm"><p>《{offer.title}》已完成导出</p>{dismissed ? <p className="mt-2 text-xs">此询问已处理；可从工程按钮手动准备发布。</p> : <div className="mt-3 flex gap-2"><PublicationButton source={offer.source} origin="completion" promptId={offer.id} /><button className={button} onClick={async () => { const result = await window.ipcRenderer.publication.dismissOffer({ id: offer.id }); if (result.success) setDismissed(true); else setError(result.error || '处理询问失败'); }}>暂不发布</button></div>}{error && <p className="text-xs text-red-600">{error}</p>}</div>;
}
export function openPublicationSource(source: PublicationSource): void {
    if (source.kind === 'video' || source.kind === 'dream-story') dispatchAppIntent({ type: 'video-project.open', projectId: source.projectId });
    else dispatchAppIntent({ type: 'manuscript.open', manuscriptPath: source.path });
}
