import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe2, Loader2, X } from 'lucide-react';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import type { TikTokLocalizationProposal, TikTokPublishJob, TikTokPublishSettings, TikTokVideoVersion } from '../../../shared/tiktokVideo';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';
import { appConfirm } from '../../utils/appDialogs';
import { useProductEditorContext } from './ProductEditorContext';
import { subscribeDataChanged } from '../../bridge/appEvents';

type Response = { success?: boolean; error?: string; version?: TikTokVideoVersion | null; versions?: TikTokVideoVersion[];
    productChanged?: boolean; proposal?: TikTokLocalizationProposal; job?: TikTokPublishJob; videoPreviewUrl?: string;
    instances?: Instance[]; boundExtensionInstanceId?: string };
type Instance = { extensionInstanceId: string; browser?: string; accountLabel?: string; pageState?: string; detail?: string };
const fieldClass = 'mt-1 w-full rounded-lg border border-border bg-white p-2 text-sm';
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40';
const statuses: Record<string, string> = { awaiting_confirmation: '等待确认', queued: '已排队', preflighting: '核对页面',
    uploading: '上传中', submitting: '正在提交', completed: '已发布', submitted_pending_review: '已提交，等待审核',
    submit_result_unknown: '提交结果待核实', blocked: '已停止', cancelled: '已取消', superseded: '已被新版本替代',
    published_reset_failed: '已发布，页面待恢复' };

export function TikTokVideoPanel({ project, disabled }: { project: VideoEditorV2Project; disabled: boolean }) {
    const editor = useProductEditorContext();
    const dirtyRef = useRef(false);
    const localEpoch = useRef(0);
    const changeDraft = (operation: () => void) => { dirtyRef.current = true; localEpoch.current++; editor?.markDirty(); operation(); };
    const [version, setVersion] = useState<TikTokVideoVersion | null>(null);
    const [versions, setVersions] = useState<TikTokVideoVersion[]>([]);
    const [changed, setChanged] = useState(false);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState('');
    const [language, setLanguage] = useState('en');
    const [market, setMarket] = useState('International');
    const [settings, setSettings] = useState<Partial<TikTokPublishSettings>>({});
    const [proposal, setProposal] = useState<TikTokLocalizationProposal | null>(null);
    const [instances, setInstances] = useState<Instance[]>([]);
    const [binding, setBinding] = useState('');
    const [job, setJob] = useState<TikTokPublishJob | null>(null);
    const [preview, setPreview] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const fill = useCallback((value: TikTokVideoVersion | null) => {
        setVersion(value); setTitle(value?.title || ''); setDescription(value?.description || '');
        setTags((value?.hashtags || []).join(' ')); setLanguage(value?.language || 'en');
        setMarket(value?.market || 'International'); setSettings(value?.publishSettings || {});
    }, []);
    const load = useCallback(async () => {
        const result = await window.ipcRenderer.tiktokVideo.getVersion({ projectId: project.id, sourceProjectId: project.id }) as Response;
        if (!result.success) throw new Error(result.error || '读取 TikTok 版本失败');
        if (dirtyRef.current) { setError('稿件有新修改，已保留输入；请保存或按最新工程重试'); return; }
        fill(result.version?.projectId === project.id ? result.version : null);
        setVersions(result.versions || []); setChanged(Boolean(result.productChanged));
    }, [fill, project.id]);
    const action = async (name: string, operation: () => Promise<void>) => {
        setBusy(name); setError('');
        try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { setBusy(''); }
    };
    useEffect(() => { setOpen(false); setProposal(null); setJob(null); setPreview(''); void load().catch(failure => setError(String(failure))); }, [load]);
    useEffect(() => subscribeDataChanged((_event, payload) => {
        if (payload?.scope === 'video-editor-v2' && payload.entityId === project.id) void load().catch(failure => setError(String(failure)));
    }), [load, project.id]);
    const loadPublisher = useCallback(async () => {
        if (!version) return;
        const [status, latest] = await Promise.all([window.ipcRenderer.tiktokPublisher.getStatus(),
            window.ipcRenderer.tiktokPublisher.getJob({ versionId: version.id })]) as Response[];
        if (!status.success) throw new Error(status.error || '读取发布浏览器失败');
        setInstances(status.instances || []); setBinding(status.boundExtensionInstanceId || '');
        setJob(latest.job || null); setPreview(latest.videoPreviewUrl || '');
    }, [version]);
    useEffect(() => { if (open && version) void loadPublisher().catch(failure => setError(String(failure))); }, [open, loadPublisher]);
    useEffect(() => {
        const listener = (_event: unknown, value: unknown) => {
            const updated = value as TikTokPublishJob;
            if (updated.versionId === version?.id) { setJob(updated); setAcknowledged(false); }
        };
        window.ipcRenderer.tiktokPublisher.onJobChanged(listener);
        return () => window.ipcRenderer.tiktokPublisher.offJobChanged(listener);
    }, [version?.id]);
    const create = (duplicate = false) => action('create', async () => {
        const result = await window.ipcRenderer.tiktokVideo.createVersion({ sourceProjectId: project.id, duplicate }) as Response;
        if (!result.success || !result.version) throw new Error(result.error || '创建 TikTok 版本失败');
        dispatchAppIntent({ type: 'video-project.open', projectId: result.version.projectId });
    });
    const saveDraft = async () => {
        await editor?.settleDraft();
        const editing = localEpoch.current;
        if (!version) return;
        const complete = ['visibility', 'allowComments', 'allowReuse', 'allowRemix', 'audience18Plus', 'commercialContent', 'aiGenerated']
            .every(key => (settings as Record<string, unknown>)[key] !== undefined);
        if (!complete && Object.values(settings).some(value => value !== undefined)) throw new Error('请补齐发布设置；当前输入已保留，消息尚未发送');
        const result = await window.ipcRenderer.tiktokVideo.saveVersion({ versionId: version.id, expectedRevision: version.revision,
            title, description, hashtags: tags.split(/[\s,，#]+/u).filter(Boolean), language, market,
            publishSettings: complete ? settings : null }) as Response;
        if (!result.success || !result.version) throw new Error(result.error || '保存 TikTok 版本失败');
        if (editing !== localEpoch.current) throw new Error('保存期间出现新输入，已保留草稿');
        dirtyRef.current = false; fill(result.version); setProposal(null);
    };
    const save = () => action('save', saveDraft);
    useEffect(() => editor?.registerFlush('tiktok-copy', async () => { if (dirtyRef.current) { await saveDraft(); } }));
    const suggest = () => action('suggest', async () => {
        if (!version) return;
        const result = await window.ipcRenderer.tiktokVideo.suggestLocalization({ versionId: version.id, expectedRevision: version.revision, language, market }) as Response;
        if (!result.success || !result.proposal) throw new Error(result.error || '生成语言建议失败');
        setProposal(result.proposal);
    });
    const apply = () => action('apply', async () => {
        if (!proposal) return;
        const result = await window.ipcRenderer.tiktokVideo.applyLocalization({ proposalId: proposal.id }) as Response;
        if (!result.success || !result.version) throw new Error(result.error || '应用语言建议失败');
        fill(result.version); setProposal(null);
    });
    const prepare = () => action('prepare', async () => {
        if (!version) return;
        await loadPublisher();
        const result = await window.ipcRenderer.tiktokPublisher.prepare({ versionId: version.id }) as Response;
        if (!result.success || !result.job) throw new Error(result.error || '准备 TikTok 发布失败');
        setJob(result.job); setPreview(result.videoPreviewUrl || ''); setAcknowledged(false);
    });
    const runJob = (mode: 'stageDraft' | 'confirm' | 'cancel' | 'recoverUnpublished' | 'reviewPublished' | 'readReceipt') => action(mode, async () => {
        if (!job) return;
        if (mode === 'confirm' && !(await appConfirm('将当前确认的成片和文案发布到 TikTok ' + job.accountLabel + '，可见范围：' + ({ everyone: '所有人', friends: '互关好友', only_me: '仅自己' }[job.publishSettings.visibility]) + '。确认发布？'))) return;
        const api = window.ipcRenderer.tiktokPublisher;
        const result = await (mode === 'recoverUnpublished' ? api.recoverUnpublished({ jobId: job.id, acknowledgedNotPublished: acknowledged })
            : mode === 'reviewPublished' ? api.reviewPublished({ jobId: job.id, acknowledgedPublished: acknowledged })
                : api[mode]({ jobId: job.id })) as Response;
        if (!result.success || !result.job) throw new Error(result.error || '发布任务未完成');
        setJob(result.job); setAcknowledged(false);
    });
    const blocked = disabled || Boolean(busy);
    const unsaved = Boolean(version && (title !== version.title || description !== version.description
        || tags !== version.hashtags.join(' ') || language !== version.language || market !== version.market
        || JSON.stringify(settings) !== JSON.stringify(version.publishSettings || {})));
    const flag = (key: 'allowComments' | 'allowReuse' | 'allowRemix' | 'audience18Plus' | 'aiGenerated', label: string) => <label className="text-xs">{label}
        <select className={fieldClass} value={settings[key] === undefined ? '' : String(settings[key])} onChange={event => changeDraft(() => setSettings(current => ({ ...current, [key]: event.target.value === '' ? undefined : event.target.value === 'true' })))}>
            <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
        </select></label>;
    return <>
        <button type="button" className={buttonClass} disabled={blocked} onClick={() => version ? setOpen(true) : void create()}><Globe2 className="mr-1 inline h-3.5 w-3.5" />{version ? 'TikTok · 文案与语言' : versions.length ? '打开 TikTok 版本' : '创建 TikTok 版本'}</button>
        {error && !open && <span className="max-w-40 truncate text-xs text-red-700" title={error}>{error}</span>}
        {open && version && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <section className="max-h-[92vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" aria-label="TikTok 独立视频版本">
                <div className="flex items-center justify-between"><h2 className="font-bold">TikTok · 第 {version.revision} 版</h2><button type="button" onClick={() => setOpen(false)} aria-label="关闭 TikTok 稿件"><X className="h-4 w-4" /></button></div>
                <p className="text-xs text-text-secondary">此版本的镜头、字幕、旁白和发布文案可独立修改。修改画面或音频后，请在工作台重新保存 MP4。</p>
                {changed && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">商品资料已更新，请复核当前事实；此版本保留创作时的商品快照。</p>}
                <div className="grid grid-cols-2 gap-3"><label className="text-xs">语言代码<input className={fieldClass} value={language} onChange={event => changeDraft(() => setLanguage(event.target.value))} placeholder="en / ja / en-US" /></label><label className="text-xs">目标市场<input className={fieldClass} value={market} onChange={event => changeDraft(() => setMarket(event.target.value))} /></label></div>
                <label className="block text-xs">内部标题<input className={fieldClass} value={title} onChange={event => changeDraft(() => setTitle(event.target.value))} maxLength={200} /></label>
                <label className="block text-xs">发布文案<textarea className={fieldClass} value={description} onChange={event => changeDraft(() => setDescription(event.target.value))} rows={4} maxLength={4000} /></label>
                <label className="block text-xs">话题<input className={fieldClass} value={tags} onChange={event => changeDraft(() => setTags(event.target.value))} placeholder="以空格分隔" /></label>
                <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={blocked} onClick={() => void save()}>保存文案与设置</button><button type="button" className={buttonClass} disabled={blocked} onClick={() => void suggest()}>AI 语言建议</button><button type="button" className={buttonClass} disabled={blocked} onClick={() => void create(true)}>再复制一版</button><button type="button" className={buttonClass} onClick={() => dispatchAppIntent({ type: 'video-project.open', projectId: version.sourceProjectId })}>查看来源工程</button></div>
                <p className="text-xs text-text-tertiary">AI 使用已配置的文本模型，依据已保存稿件生成建议。旁白音频需在工作台单独生成或导入。</p>
                {proposal && <div className="space-y-3 rounded-xl border border-border p-4">
                    <h3 className="text-sm font-semibold">语言建议 · {proposal.language} / {proposal.market}</h3>
                    <p className="text-sm">{proposal.title}</p><p className="whitespace-pre-wrap text-sm">{proposal.description}</p><p className="text-xs">{proposal.hashtags.map(tag => '#' + tag).join(' ')}</p>
                    {proposal.scenes.map(scene => { const before = project.productVideo?.scenes.find(item => item.id === scene.sceneId); return <div key={scene.sceneId} className="grid grid-cols-2 gap-3 border-t border-border pt-2 text-xs"><div className="text-text-tertiary"><p>{before?.overlayText || '无字幕'}</p><p>旁白：{before?.narrationText || '无'}</p></div><div><p>{scene.overlayText || '无字幕'}</p><p>旁白：{scene.narrationText || '无'}</p></div></div>; })}
                    <button type="button" className={buttonClass} disabled={blocked} onClick={() => void apply()}>确认应用文案、字幕和旁白文字</button><button type="button" className="ml-3 text-xs" onClick={() => setProposal(null)}>放弃建议</button>
                </div>}
                <div className="space-y-3 border-t border-border pt-4">
                    <h3 className="text-sm font-semibold">发布设置</h3>
                    <div className="grid grid-cols-2 gap-3"><label className="text-xs">可见范围<select className={fieldClass} value={settings.visibility || ''} onChange={event => changeDraft(() => setSettings(current => ({ ...current, visibility: event.target.value as TikTokPublishSettings['visibility'] || undefined })))}><option value="">请选择</option><option value="everyone">所有人 · Everyone</option><option value="friends">互关好友 · Friends</option><option value="only_me">仅自己 · Only you</option></select></label>
                        <label className="text-xs">商业内容<select className={fieldClass} value={settings.commercialContent || ''} onChange={event => changeDraft(() => setSettings(current => ({ ...current, commercialContent: event.target.value as TikTokPublishSettings['commercialContent'] || undefined })))}><option value="">请选择</option><option value="none">无商业披露</option><option value="own_brand">自己的品牌 · Your brand</option><option value="paid_partnership">品牌合作 · Branded content</option></select></label>
                        {flag('allowComments', '允许评论')}{flag('allowReuse', '允许内容复用')}{flag('allowRemix', '允许 Remix')}{flag('audience18Plus', '仅限 18 岁以上')}{flag('aiGenerated', '标记 AI 生成内容')}
                    </div>
                    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={blocked} onClick={() => void action('status', loadPublisher)}>检查发布浏览器</button>
                        <select aria-label="TikTok 发布浏览器" className="rounded-lg border border-border p-2 text-xs" value={binding} onChange={event => void action('bind', async () => { const result = await window.ipcRenderer.tiktokPublisher.bindInstance({ extensionInstanceId: event.target.value }) as Response; if (!result.success) throw new Error(result.error || '绑定失败'); await loadPublisher(); })}><option value="">选择发布插件实例</option>{instances.map(instance => <option key={instance.extensionInstanceId} value={instance.extensionInstanceId}>{instance.browser} · {instance.accountLabel || '未识别账号'} · {instance.pageState}</option>)}</select>
                        <button type="button" className={buttonClass} disabled={blocked || unsaved} onClick={() => void prepare()}>准备已保存版本的发布</button></div>
                    {unsaved && <p className="text-xs text-amber-800">当前文案或设置尚未保存，请保存后准备发布。</p>}
                    {instances.find(instance => instance.extensionInstanceId === binding)?.detail && <p className="text-xs text-text-secondary">{instances.find(instance => instance.extensionInstanceId === binding)?.detail}</p>}
                    {job && <div className="space-y-3 rounded-xl border border-border p-4">
                        <p className="text-sm font-semibold">{statuses[job.status] || job.status} · {job.accountLabel} · 第 {job.versionRevision} 版</p>
                        {preview && <video controls src={preview} className="max-h-60 w-full rounded-lg bg-black" />}
                        <p className="whitespace-pre-wrap text-sm">{job.description}</p><p className="text-xs">{job.hashtags.map(tag => '#' + tag).join(' ')}</p>
                        <p className="text-xs">可见范围：{job.publishSettings.visibility}；评论：{job.publishSettings.allowComments ? '允许' : '关闭'}；内容复用：{job.publishSettings.allowReuse ? '允许' : '关闭'}；Remix：{job.publishSettings.allowRemix ? '允许' : '关闭'}；18+：{job.publishSettings.audience18Plus ? '是' : '否'}；商业披露：{job.publishSettings.commercialContent}；AI 标记：{job.publishSettings.aiGenerated ? '是' : '否'}</p>
                        {job.errorMessage && <p className="text-xs text-red-700">{job.errorMessage}</p>}
                        {job.publishStatus === 'published' && <div className="space-y-2">
                            {job.receipt && <><button type="button" className="text-sm text-[#4b326b] underline" onClick={() => void window.ipcRenderer.openExternalUrl(job.receipt!.url)}>查看已发布作品 · {job.receipt.videoId}</button><p className="text-xs text-text-secondary">TikTok 回执：{job.receipt.publishedLabel} · {job.receipt.durationText} · {job.receipt.visibility === 'only_me' ? '仅自己' : job.receipt.visibility === 'friends' ? '互关好友' : '所有人'}</p></>}
                            <button type="button" className={buttonClass} disabled={blocked} onClick={() => void runJob('readReceipt')}>读取已发布作品回执</button>
                            <p className="text-xs text-text-tertiary">请在已绑定浏览器打开 TikTok Studio Posts。读取不会上传或再次发布。</p>
                        </div>}
                        {['awaiting_confirmation', 'blocked'].includes(job.status) && job.publishStatus === 'not_submitted' && <div className="flex gap-2"><button type="button" className={buttonClass} disabled={blocked} onClick={() => void runJob('stageDraft')}>上传并填入编辑页</button><button type="button" className="rounded-lg bg-[#4b326b] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" disabled={blocked} onClick={() => void runJob('confirm')}>确认发布到 TikTok</button><button type="button" className={buttonClass} disabled={blocked} onClick={() => void runJob('cancel')}>取消任务</button></div>}
                        {['submit_result_unknown', 'submitted_pending_review', 'published_reset_failed'].includes(job.status) && <div className="space-y-2"><p className="text-xs">请先在 TikTok Posts 核对该账号、成片和文案，确认结果后记录。</p><label className="flex gap-2 text-xs"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />已人工核对原任务结果</label><div className="flex gap-2"><button type="button" className={buttonClass} disabled={blocked || !acknowledged} onClick={() => void runJob('reviewPublished')}>核实已发布并恢复页面</button>{job.status === 'submit_result_unknown' && <button type="button" className={buttonClass} disabled={blocked || !acknowledged} onClick={() => void runJob('recoverUnpublished')}>核实未发布并关闭旧任务</button>}</div></div>}
                    </div>}
                </div>
                {busy && <p className="flex items-center gap-2 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在处理…</p>}
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </section>
        </div>}
    </>;
}
