import { CreationWorkbench } from '../../features/workbench/CreationWorkbench';
import { useCreationAutosave } from '../../features/workbench/useCreationAutosave';
import { PublicationButton } from '../publication/PublicationPanel';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Download, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2, Upload } from 'lucide-react';
import type { ChatMessageLinkTarget } from '../MessageItem';
import { ConfirmDialog } from '../ConfirmDialog';
import { subscribeDataChanged } from '../../bridge/appEvents';
import { resolveAssetUrl } from '../../utils/pathManager';
import { ProductImagePageSchema, productImageSpec, productImageSlotId, type ProductImagePage, type ProductImageSet } from '../../../shared/productImageSet';
import type { XhsNoteDocument, XhsNoteProjectSnapshot } from '../../../shared/xhsNote';
import { useProductEditorContext } from '../product-video/ProductEditorContext';

type Result = Partial<XhsNoteProjectSnapshot> & { success?: boolean; error?: string; canceled?: boolean; outputPath?: string; xhsNote?: XhsNoteDocument; html?: string };
const control = 'w-full rounded-lg border border-border bg-surface-primary px-2.5 py-2 text-xs text-text-primary';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-secondary disabled:opacity-40';

export function ProductImageSetPane({ target, chat, actions }: { target: ChatMessageLinkTarget; chat?: ReactNode; actions?: ReactNode }) {
    const editor = useProductEditorContext();
    const projectPath = target.projectPath || target.localPathCandidate || target.relativePath || target.href;
    const [snapshot, setSnapshot] = useState<XhsNoteProjectSnapshot | null>(null);
    const [draft, setDraft] = useState<XhsNoteDocument | null>(target.xhsNote || null);
    const [activeId, setActiveId] = useState(target.xhsNote?.productImageSet?.pages[0]?.id || '');
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    const editSequenceRef = useRef(0);
    const refreshSequenceRef = useRef(0);
    const busyRef = useRef(false);
    const saving = useRef<Promise<XhsNoteProjectSnapshot> | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const [html, setHtml] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState('');
    const [config, setConfig] = useState<{ configured: boolean; model: string; reason?: string; configurationKey: string } | null>(null);
    const [confirmAi, setConfirmAi] = useState(false);
    const [refreshConfirm, setRefreshConfirm] = useState(false);
    const set = draft?.productImageSet;
    const page = set?.pages.find((item) => item.id === activeId) || set?.pages[0];
    const activeIndex = set?.pages.findIndex((item) => item.id === page?.id) || 0;

    const apply = useCallback((result: Result) => {
        if (!result.success || !result.projectPath || !result.document) throw new Error(result.error || '无法读取套图工程');
        const next = result as XhsNoteProjectSnapshot;
        refreshSequenceRef.current++;
        setSnapshot(next); setDraft(next.document); setDirty(false); dirtyRef.current = false; setMessage('');
        setActiveId((id) => next.document.productImageSet?.pages.some((item) => item.id === id) ? id : next.document.productImageSet?.pages[0]?.id || '');
    }, []);

    const refresh = useCallback(async (discardChanges = false) => {
        const sequence = ++refreshSequenceRef.current;
        const editing = editSequenceRef.current;
        try {
            const result = await window.ipcRenderer.manuscripts.getXhsNote<Result>(projectPath);
            if (sequence !== refreshSequenceRef.current || editing !== editSequenceRef.current || (dirtyRef.current && !discardChanges)) return;
            apply(result);
        } catch (error) {
            if (sequence === refreshSequenceRef.current) setMessage(error instanceof Error ? error.message : String(error));
        }
    }, [apply, projectPath]);

    useEffect(() => {
        dirtyRef.current = false;
        setDirty(false); setDraft(null); setSnapshot(null); setHtml('');
        void refresh();
        return () => { refreshSequenceRef.current++; };
    }, [refresh]);
    useEffect(() => {
        let active = true;
        void window.ipcRenderer.manuscripts.productImageGenerationConfig<{ configured: boolean; model: string; reason?: string; configurationKey: string }>()
            .then((next) => { if (active) setConfig(next); })
            .catch((error) => { if (active) setConfig({ configured: false, model: '', configurationKey: '', reason: `无法读取图片模型配置：${String(error)}` }); });
        return () => { active = false; };
    }, [snapshot]);
    useEffect(() => subscribeDataChanged((_event, payload?: { scope?: string }) => {
        if (!['manuscripts', 'media'].includes(payload?.scope || '')) return;
        if (dirtyRef.current) { setMessage('工程有新结果；请先保存当前修改，或刷新读取最新版本。'); return; }
        void refresh();
    }), [refresh]);

    useEffect(() => {
        if (!snapshot || !page || !set) return;
        let active = true;
        const timer = window.setTimeout(() => {
            void window.ipcRenderer.manuscripts.previewProductImagePage<Result>({ path: projectPath, pageId: page.id, expectedRevision: snapshot.version, preview: { page, style: set.style } }).then((result) => {
                if (!active) return;
                if (!result.success) { setMessage(result.error || '预览失败'); setHtml(''); }
                else setHtml(result.html || '');
            }).catch((error) => { if (active) setMessage(String(error)); });
        }, 350);
        return () => { active = false; window.clearTimeout(timer); };
    }, [snapshot, page, set?.style, projectPath]);

    useEffect(() => {
        const parent = previewRef.current;
        if (!parent) return;
        const update = () => parent.style.setProperty('--product-preview-scale', String(parent.clientWidth / (set ? productImageSpec(set).width : 1440)));
        update(); const observer = new ResizeObserver(update); observer.observe(parent);
        return () => observer.disconnect();
    }, [Boolean(set)]);

    const edit = (next: XhsNoteDocument) => { editSequenceRef.current++; setDraft(next); setDirty(true); dirtyRef.current = true; editor?.markDirty(); };
    const editSet = (next: ProductImageSet) => { if (draft) edit({ ...draft, productImageSet: next }); };
    const editPage = (patch: Partial<ProductImagePage>) => { if (set && page) editSet({ ...set, pages: set.pages.map((item) => item.id === page.id ? { ...item, ...patch } : item) }); };

    const save = async (): Promise<XhsNoteProjectSnapshot> => {
        if (saving.current) return saving.current;
        if (!draft || !snapshot) throw new Error('工程尚未加载');
        if (!dirtyRef.current) return snapshot;
        const operation = (async () => {
            await editor?.settleDraft();
            const editing = editSequenceRef.current;
            const result = await window.ipcRenderer.manuscripts.saveXhsNote<Result>({ path: projectPath, document: draft, expectedRevision: snapshot.version });
            if (!result.success || !result.document) throw new Error(result.error || '保存失败，输入已保留');
            if (editing !== editSequenceRef.current) { setSnapshot(result as XhsNoteProjectSnapshot); return result as XhsNoteProjectSnapshot; }
            apply(result); return result as XhsNoteProjectSnapshot;
        })(); saving.current = operation;
        try { return await operation; } finally { saving.current = null; }
    };
    const autoSave = useCreationAutosave(dirty, editSequenceRef.current, save);
    useEffect(() => { if (autoSave.error) setMessage(autoSave.error); }, [autoSave.error]);
    useEffect(() => editor?.registerFlush('image-set', async () => {
        if (busyRef.current) throw new Error('工程正在处理，请稍后发送');
        busyRef.current = true; setBusy('save');
        try { return await save(); }
        finally { busyRef.current = false; setBusy(''); }
    }));
    useEffect(() => { editor?.select(page?.id); }, [editor, page?.id]);
    const undo = () => perform('undo', async () => {
        await save();
        const current = await window.ipcRenderer.videoEditorV2.readProductEditor({ project: { kind: 'image-set', path: projectPath } });
        if (!current.success || !current.snapshot) throw new Error(current.error || '读取撤销凭据失败');
        const value = current.snapshot;
        const result = await window.ipcRenderer.videoEditorV2.undoProductEditor({ binding: value.binding, requestId: crypto.randomUUID(), expectedRevision: value.revision, expectedDraftEpoch: value.draftEpoch });
        if (!result.success || !result.result?.imageSet) throw new Error(result.error || '撤销失败');
        apply({ ...result.result.imageSet, success: true }); setMessage('已撤销；发布确认需重新准备');
    });

    const perform = async (name: string, operation: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(name); setMessage('');
        try { await operation(); }
        catch (error) {
            // Failed generation or partial export can persist a newer revision. Reload it before a manual retry.
            if (!dirtyRef.current) await refresh();
            setMessage(error instanceof Error ? error.message : String(error));
        }
        finally { busyRef.current = false; setBusy(''); }
    };

    const exportImages = (format: 'png' | 'directory' | 'zip') => perform('export', async () => {
        const saved = await save();
        const result = await window.ipcRenderer.manuscripts.exportProductImageSet<Result>({ path: projectPath, expectedRevision: saved.version, format, pageId: page?.id });
        if (result.canceled) return;
        apply(result); setMessage(`已导出：${result.outputPath}`);
    });

    const generate = () => perform('generate', async () => {
        setConfirmAi(false);
        const saved = await save();
        const result = await window.ipcRenderer.manuscripts.generateProductImagePage<Result>({ path: projectPath, pageId: page!.id, expectedRevision: saved.version, confirmed: true, requestId: crypto.randomUUID(), reviewedConfigurationKey: config!.configurationKey });
        apply(result); setMessage('本页 AI 画面已保存；标题与文案仍可编辑，导出时将重新排版。');
    });

    const upload = () => perform('upload', async () => {
        const saved = await save();
        const imported = await window.ipcRenderer.media.importFiles<{ success?: boolean; canceled?: boolean; error?: string; imported?: Array<{ id: string }> }>({ kind: 'image', multiple: false });
        if (imported.canceled) return;
        if (!imported.success || !imported.imported?.[0]) throw new Error(imported.error || '未导入图片');
        apply(await window.ipcRenderer.manuscripts.importProductImageAsset<Result>({ path: projectPath, pageId: page!.id, assetId: imported.imported[0].id, expectedRevision: saved.version }));
    });

    const addPage = () => {
        if (!set || set.pages.length >= 20) return;
        const next = ProductImagePageSchema.parse({ id: crypto.randomUUID(), role: 'content', title: '新的内容页', productAssetIds: set.pages[0].productAssetIds });
        editSet({ ...set, pages: [...set.pages, next] }); setActiveId(next.id);
    };

    const reorder = (offset: number) => {
        if (!set || !page || activeIndex < 1 || activeIndex + offset < 1 || activeIndex + offset >= set.pages.length) return;
        const pages = [...set.pages]; [pages[activeIndex], pages[activeIndex + offset]] = [pages[activeIndex + offset], pages[activeIndex]];
        editSet({ ...set, pages });
    };

    if (!set || !page) return <div className="flex h-full items-center justify-center text-sm text-text-tertiary">{message || '正在加载商品套图…'}</div>;
    const assetUrl = (id: string) => {
        const asset = set.assets.find((item) => item.id === id);
        return asset ? resolveAssetUrl(`${snapshot?.projectPath || projectPath}/${asset.relativePath}`) : '';
    };

    const editorPane = <div className="h-full overflow-y-auto p-3">            <nav aria-label="套图页面" className="mb-4 flex gap-2 overflow-x-auto border-b border-border pb-3">
                {set.pages.map((item, index) => {
                    const slot = snapshot?.document.mediaSlots.find((value) => value.id === productImageSlotId(item));
                    return <button key={item.id} onClick={() => setActiveId(item.id)} className={`w-20 shrink-0 rounded-lg border p-1.5 text-left ${page.id === item.id ? 'border-accent-primary' : 'border-border'}`}>
                        <img src={slot?.status === 'ready' && !dirty ? resolveAssetUrl(slot.previewUrl) : assetUrl(item.backgroundAssetId || item.productAssetIds[0])} alt={item.title} className="aspect-[3/4] w-full rounded object-contain bg-surface-secondary" />
                        <span className="mt-1 block truncate text-[10px]">{index + 1} · {item.role === 'cover' ? '封面' : item.title}</span>
                    </button>;
                })}
                <button className={`${button} w-full`} disabled={Boolean(busy) || set.pages.length >= 20} onClick={addPage}><Plus className="h-3 w-3" />加页</button>
            </nav>                    <div className="my-3 flex flex-wrap gap-2">
                        <button className={button} disabled={Boolean(busy)} onClick={() => void exportImages('png')}>导出本页</button>
                        <button className={button} disabled={Boolean(busy)} onClick={() => void exportImages('directory')}>导出图片目录</button>
                        <button className={button} disabled={Boolean(busy) || activeIndex < 2} onClick={() => reorder(-1)} aria-label="页面上移"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button className={button} disabled={Boolean(busy) || activeIndex < 1 || activeIndex === set.pages.length - 1} onClick={() => reorder(1)} aria-label="页面下移"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button className={button} disabled={Boolean(busy) || page.role === 'cover'} onClick={() => { editSet({ ...set, pages: set.pages.filter((item) => item.id !== page.id) }); setActiveId(set.pages[0].id); }} aria-label="删除页面"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    <fieldset disabled={Boolean(busy)} className="grid gap-3">
                        <label className="text-xs">页面标题<input className={`${control} mt-1`} value={page.title} maxLength={240} onChange={(event) => editPage({ title: event.target.value })} /></label>
                        <label className="text-xs">页面文案<textarea className={`${control} mt-1`} rows={3} value={page.copy} maxLength={1400} onChange={(event) => editPage({ copy: event.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-xs">布局<select className={`${control} mt-1`} value={page.layout} onChange={(event) => editPage({ layout: event.target.value as ProductImagePage['layout'] })}><option value="cover">封面大图</option><option value="split">图文分栏</option><option value="grid">多图细节</option></select></label>
                            <label className="text-xs">图片适配<select className={`${control} mt-1`} value={page.fit} onChange={(event) => editPage({ fit: event.target.value as 'contain' | 'cover' })}><option value="contain">完整显示</option><option value="cover">裁切铺满</option></select></label>
                        </div>
                        {page.fit === 'cover' && <div className="grid grid-cols-2 gap-3">{(['cropX', 'cropY'] as const).map((axis) => <label key={axis} className="text-xs">{axis === 'cropX' ? '水平焦点' : '垂直焦点'}<input className="mt-2 w-full" type="range" min={0} max={100} value={page[axis]} onChange={(event) => editPage({ [axis]: Number(event.target.value) })} /></label>)}</div>}
                        <label className="text-xs">字号 · {Math.round(page.fontScale * 100)}%<input className="mt-2 w-full" type="range" min={0.7} max={1.3} step={0.05} value={page.fontScale} onChange={(event) => editPage({ fontScale: Number(event.target.value) })} /></label>
                        <div className="flex gap-5">{(['background', 'foreground', 'accent'] as const).map((key) => <label key={key} className="text-xs">{({ background: '背景', foreground: '正文', accent: '标题' })[key]}<input aria-label={`统一${key}配色`} className="ml-2 h-7 w-9" type="color" value={set.style[key]} onChange={(event) => editSet({ ...set, style: { ...set.style, [key]: event.target.value } })} /></label>)}</div>
                        <div><div className="mb-2 flex items-center justify-between text-xs"><span>画面素材 · 最多选择 4 张</span><button className={button} onClick={() => void upload()}><Upload className="h-3 w-3" />导入图片</button></div>
                            <div className="grid grid-cols-4 gap-2">{set.assets.map((asset, index) => <label key={asset.id} className="cursor-pointer text-[10px]">
                                <img src={assetUrl(asset.id)} alt={`素材 ${index + 1}`} className="aspect-square w-full rounded object-contain bg-surface-secondary" />
                                <input type="checkbox" checked={asset.id === page.backgroundAssetId || (page.productAssetIds.includes(asset.id) && !page.backgroundAssetId)} onChange={(event) => {
                                    if (asset.kind === 'ai') { editPage({ backgroundAssetId: event.target.checked ? asset.id : undefined }); return; }
                                    const ids = event.target.checked ? [...page.productAssetIds.filter((id) => id !== asset.id), asset.id].slice(-4) : page.productAssetIds.filter((id) => id !== asset.id);
                                    if (ids.length) editPage({ productAssetIds: ids, backgroundAssetId: undefined });
                                }} /> {asset.kind === 'ai' ? 'AI 画面' : asset.kind === 'upload' ? '导入图片' : '商品图'} {index + 1}
                            </label>)}</div>
                            {page.backgroundAssetId && <button className={`${button} mt-2`} onClick={() => editPage({ backgroundAssetId: undefined })}>恢复商品原图排版</button>}
                        </div>
                        <label className="text-xs">可选 AI 画面提示词<textarea className={`${control} mt-1`} rows={3} maxLength={6000} value={page.aiPrompt} onChange={(event) => editPage({ aiPrompt: event.target.value })} /></label>
                        <button className={button} disabled={!config?.configured || !page.aiPrompt.trim()} onClick={() => setConfirmAi(true)}><Sparkles className="h-3.5 w-3.5" />生成本页画面（计费）</button>
                        {!config?.configured && <p className="text-xs text-text-tertiary">{config?.reason || '正在检查图片模型配置…'}；原图排版和导出仍可使用。</p>}
                        {page.generation && <p className="whitespace-pre-wrap text-xs text-text-secondary">AI 画面：{({ generating: '生成中', succeeded: '已保存', failed: '失败', interrupted: '已中断，未自动重投' })[page.generation.status]}{page.generation.error ? ` · ${page.generation.error}` : ''}</p>}
                        <hr className="border-border" />
                        <label className="text-xs">发布标题<input className={`${control} mt-1`} value={draft!.finalTitle} onChange={(event) => edit({ ...draft!, finalTitle: event.target.value })} /></label>
                        <label className="text-xs">图文正文<textarea className={`${control} mt-1`} rows={5} value={draft!.body} onChange={(event) => edit({ ...draft!, body: event.target.value })} /></label>
                        <label className="text-xs">话题（每行一个）<textarea className={`${control} mt-1`} rows={2} value={draft!.hashtags.join('\n')} onChange={(event) => edit({ ...draft!, hashtags: event.target.value.split('\n') })} /></label>
                    </fieldset>
</div>;
    const previewPane = <div className="h-full space-y-3 overflow-y-auto bg-surface-secondary p-4"><p className="text-xs text-text-tertiary">本地排版预览{dirty ? ' · 正在保存' : ''}</p>                    <div ref={previewRef} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-surface-secondary">
                        {html ? <iframe title="商品套图页面预览" sandbox="allow-same-origin" srcDoc={html} width={productImageSpec(set).width} height={productImageSpec(set).height} className="absolute left-0 top-0 border-0 origin-top-left" style={{ transform: 'scale(var(--product-preview-scale))', width: productImageSpec(set).width, height: productImageSpec(set).height }} onLoad={(event) => {
                            const frame = event.currentTarget; const parent = frame.parentElement;
                            if (parent) parent.style.setProperty('--product-preview-scale', String(parent.clientWidth / (set ? productImageSpec(set).width : 1440)));
                        }} /> : <div className="flex h-full items-center justify-center text-xs text-text-tertiary">正在生成预览…</div>}
                    </div>
<h2 className="font-semibold">{draft?.finalTitle}</h2><p className="whitespace-pre-wrap text-sm">{draft?.body}</p></div>;
    return <div className="relative h-full min-h-0">{chat ? <CreationWorkbench adapter={{ id: projectPath, changeToken: snapshot?.version, title: draft?.finalTitle || '未命名商品套图', subtitle: '小红书 · 商品套图', status: dirty ? '正在保存…' : '已保存', flush: async () => { await save(); if (dirtyRef.current) throw new Error('当前输入尚未保存'); }, chat, editor: editorPane, preview: previewPane, actions: <>{actions}
            <div className="mr-auto"><h2 className="text-sm font-semibold">商品套图 · {set.pages.length} 张</h2><p className="text-[11px] text-text-tertiary">{productImageSpec(set).aspectRatio} · {productImageSpec(set).width}×{productImageSpec(set).height} PNG · 应用发布上限 18 张 · {dirty ? '有未保存修改' : `版本 ${snapshot?.version || ''}`}</p></div>
            <button className={button} disabled={Boolean(busy)} onClick={() => dirty ? setRefreshConfirm(true) : void refresh()}><RefreshCw className="h-3.5 w-3.5" />刷新</button>
            <button className={button} disabled={Boolean(busy) || !dirty} onClick={() => void perform('save', async () => { await save(); setMessage('已保存'); })}><Save className="h-3.5 w-3.5" />保存</button>
            <button className={button} disabled={Boolean(busy)} onClick={() => void undo()}>撤销</button>
            <PublicationButton source={{ kind: 'image-set', path: projectPath }} />
            <button className={button} disabled={Boolean(busy)} onClick={() => void exportImages('zip')}><Download className="h-3.5 w-3.5" />导出 ZIP</button>
        </>, notice: <>
        {message && <div role="status" className="border-b border-border bg-surface-secondary px-4 py-2 text-xs whitespace-pre-wrap">{message}</div>}
        {busy && <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" />{busy === 'generate' ? '正在生成本页画面，可在任务完成后继续编辑…' : '正在处理…'}</div>}
</> }} /> : <div className="grid h-full grid-cols-2">{editorPane}{previewPane}</div>}
        <ConfirmDialog open={confirmAi} title="确认生成本页 AI 画面" description={`模型：${config?.model || ''}\n页面：${page.title}\n参考图：${page.productAssetIds.length} 张\n仅生成 1 张画面，会消耗模型额度；标题与文案由本地排版叠加。`} confirmLabel="确认生成 1 张" onConfirm={() => { void generate(); }} onCancel={() => setConfirmAi(false)}>
            <div className="mt-3 flex gap-2">{page.productAssetIds.map((id) => <img key={id} src={assetUrl(id)} alt="本次生成参考图" className="h-20 w-20 rounded object-contain bg-surface-secondary" />)}</div>
        </ConfirmDialog>
        <ConfirmDialog open={refreshConfirm} title="刷新当前工程" description="当前有未保存修改。刷新会丢弃这些修改并读取最新工程。" confirmLabel="丢弃修改并刷新" onConfirm={() => { setRefreshConfirm(false); void refresh(true); }} onCancel={() => setRefreshConfirm(false)} />
    </div>;
}
