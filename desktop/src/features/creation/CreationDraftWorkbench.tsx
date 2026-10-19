import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CreationWorkspace, CreationDraft, CreationTurn } from '../../../shared/creationWorkspace';
import { CREATION_CAPABILITY_LABELS } from '../../../shared/creationWorkspace';
import { PRODUCT_PLATFORM_LABELS } from '../../../shared/productCreationTarget';
import { CreationWorkbench } from '../workbench/CreationWorkbench';
import { useCreationAutosave } from '../workbench/useCreationAutosave';
import { subscribeDataChanged } from '../../bridge/appEvents';
import { resolveAssetUrl } from '../../utils/pathManager';
import { VideoRemixSourcePicker } from '../../components/product-video/VideoRemixSourcePicker';
import type { ProductVideoClipReference } from '../../../shared/productVideoRemix';
const Chat = lazy(async () => ({ default: (await import('../../pages/Chat')).Chat }));
const field = 'mt-1 w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary';
const button = 'rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-secondary disabled:opacity-40';
type ProductReference = { id: string; name: string; updatedAt: string; assets: Array<{ id: string; name?: string; previewUrl?: string; absolutePath?: string; path?: string }> };
export function CreationDraftWorkbench({ initial, onMaterialized }: { initial: CreationWorkspace; onMaterialized: () => Promise<void> }) {
    const [workspace, setWorkspace] = useState(initial); const state = useRef(initial);
    const [draft, setDraft] = useState(initial.draft); const draftRef = useRef(draft);
    const [epoch, setEpoch] = useState(0); const localEpoch = useRef(0); const dirty = useRef(false);
    const marks = useRef<Promise<unknown>>(Promise.resolve()); const saving = useRef<Promise<void> | null>(null);
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [changed, setChanged] = useState(false);
    const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
    const [product, setProduct] = useState<ProductReference | null>(null);
    const [clips, setClips] = useState<ProductVideoClipReference[]>([]); const [picker, setPicker] = useState(false);
    const [selectedId, setSelectedId] = useState('');
    const imageSet = initial.capability === 'product-image-set'; const remix = initial.capability === 'product-remix';
    const accept = (value: CreationWorkspace) => { state.current = value; setWorkspace(value); };
    const turn = (): CreationTurn => ({ workspaceId: initial.id, spaceId: initial.spaceId, requestId: crypto.randomUUID(), expectedRevision: state.current.revision, expectedDraftEpoch: state.current.draftEpoch, selectedId: selectedId || undefined });
    const change = (value: CreationDraft) => {
        dirty.current = true; localEpoch.current++; draftRef.current = value; setDraft(value); setEpoch(localEpoch.current);
        marks.current = marks.current.then(async () => { const result = await window.ipcRenderer.creationWorkspace.markDraft(initial.id); if (!result.success || !result.workspace) throw new Error(result.error || '同步输入失败'); state.current = { ...state.current, draftEpoch: result.workspace.draftEpoch }; });
        void marks.current.catch(reason => setError(String(reason)));
    };
    const save = useCallback(async () => {
        if (saving.current) return saving.current;
        const operation = (async () => {
            await marks.current; if (!dirty.current) return;
            const editing = localEpoch.current;
            const result = await window.ipcRenderer.creationWorkspace.save({ ...turn(), draft: draftRef.current });
            if (!result.success || !result.workspace) throw new Error(result.error || '保存失败，输入已保留');
            accept(result.workspace); if (editing === localEpoch.current) dirty.current = false;
            setEpoch(localEpoch.current); setError('');
        })(); saving.current = operation;
        try { await operation; } finally { saving.current = null; }
    }, [initial.id, selectedId]);
    const autosave = useCreationAutosave(dirty.current, epoch, save);
    useEffect(() => {
        let active = true;
        void window.ipcRenderer.brandWorkspace.list<{ products?: Array<{ id: string; name: string }>; catalog?: { products?: Array<{ id: string; name: string }> }; brands?: Array<{ products?: Array<{ product: { id: string; name: string } }> }> }>().then(result => { if (active) setProducts(result.products || result.catalog?.products || result.brands?.flatMap(brand => (brand.products || []).map(bundle => bundle.product)) || []); }).catch(reason => { if (active) setError(String(reason)); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        let active = true; setProduct(null);
        if (draft.productId) void window.ipcRenderer.brandWorkspace.getProductCreativeReference<{ success: boolean; reference?: ProductReference; product?: ProductReference }>({ id: draft.productId }).then(result => { if (active) setProduct(result.reference || result.product || null); }).catch(reason => { if (active) setError(String(reason)); });
        return () => { active = false; };
    }, [draft.productId]);
    useEffect(() => { if (remix && workspace.draft.sourceAssetIds.length) void window.ipcRenderer.creationWorkspace.sources<{ product?: { clips?: ProductVideoClipReference[] } }>(initial.id).then(result => setClips(result.product?.clips || [])); }, [initial.id, workspace.draft.sourceAssetIds.join(',')]);
    useEffect(() => subscribeDataChanged((_event, payload) => {
        if (payload?.scope !== 'creation-workspaces' || payload.entityId !== initial.id || dirty.current || saving.current) return;
        void window.ipcRenderer.creationWorkspace.read(initial.id).then(result => {
            if (!result.success || !result.workspace || result.workspace.revision === state.current.revision || dirty.current) return;
            accept(result.workspace); draftRef.current = result.workspace.draft; setDraft(result.workspace.draft); setChanged(true);
        });
    }), [initial.id]);
    useEffect(() => { if (!changed) return; const timer = window.setTimeout(() => setChanged(false), 2200); return () => window.clearTimeout(timer); }, [changed]);
    const act = async (operation: () => Promise<void>) => { setBusy(true); try { await operation(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };
    const beforeSend = async () => { await save(); if (dirty.current) throw new Error('保存期间出现新输入，请再次发送'); return { workflowKind: 'creation-workspace', creationWorkspaceTurn: turn() }; };
    const updateScene = (id: string, patch: Partial<CreationDraft['scenes'][number]>) => change({ ...draftRef.current, scenes: draftRef.current.scenes.map(scene => scene.id === id ? { ...scene, ...patch } : scene) });
    const updatePage = (id: string, patch: Partial<CreationDraft['pages'][number]>) => change({ ...draftRef.current, pages: draftRef.current.pages.map(page => page.id === id ? { ...page, ...patch } : page) });
    const selected = imageSet ? draft.pages.find(page => page.id === selectedId) || draft.pages[0] : draft.scenes.find(scene => scene.id === selectedId) || draft.scenes[0];
    const sourceId = selected && (imageSet ? (selected as CreationDraft['pages'][number]).assetIds[0] : (selected as CreationDraft['scenes'][number]).assetId);
    const asset = product?.assets.find(item => item.id === sourceId); const clip = clips.find(item => item.assetId === sourceId);
    const editor = <div className={`h-full space-y-5 overflow-y-auto p-4 transition-colors ${changed ? 'bg-accent-primary/5' : ''}`}>
        <section className="space-y-3"><h2 className="text-sm font-semibold">基础信息</h2><label className="block text-xs">作品标题<input aria-label="作品标题" className={field} value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} /></label>
            <label className="block text-xs">主商品<select aria-label="主商品" className={field} value={draft.productId} onChange={event => change({ ...draft, productId: event.target.value })}><option value="">选择商品</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block text-xs">画幅<select aria-label="画幅" className={field} value={draft.aspectRatio} onChange={event => change({ ...draft, aspectRatio: event.target.value as CreationDraft['aspectRatio'] })}>{(imageSet ? ['3:4'] : initial.platform === 'xiaohongshu' ? ['9:16', '16:9'] : ['9:16']).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="block text-xs">创作要求<textarea className={field} rows={3} value={draft.brief} onChange={event => change({ ...draft, brief: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs">语言<input className={field} value={draft.language} onChange={event => change({ ...draft, language: event.target.value })} /></label><label className="text-xs">市场<input className={field} value={draft.market} onChange={event => change({ ...draft, market: event.target.value })} /></label></div>
        </section>
        <section className="space-y-3"><h2 className="text-sm font-semibold">发布文案</h2><textarea aria-label="发布正文" className={field} rows={4} value={draft.body} onChange={event => change({ ...draft, body: event.target.value })} /><label className="block text-xs">话题<input className={field} value={draft.hashtags.join(' ')} onChange={event => change({ ...draft, hashtags: event.target.value.split(/\s+/u).filter(Boolean) })} /></label></section>
        <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{imageSet ? '页面' : '分镜与素材'}</h2><button type="button" className={button} disabled={busy || (imageSet ? draft.pages.length >= 20 : draft.scenes.length >= 8)} onClick={() => {
            const id = 'item_' + crypto.randomUUID(); setSelectedId(id);
            if (imageSet) change({ ...draft, pages: [...draft.pages, { id, title: '', copy: '', assetIds: [], layout: draft.pages.length ? 'split' : 'cover' }] });
            else change({ ...draft, scenes: [...draft.scenes, { id, title: '', visual: '', text: '', narration: '', durationMs: 5000, assetId: '', sourceStartMs: 0, sourceVolume: 1 }] });
        }}>添加{imageSet ? '页面' : '镜头'}</button></div>
        {remix && <button type="button" className={button} onClick={() => setPicker(true)}>选择已有视频</button>}
        {(imageSet ? draft.pages : draft.scenes).map((item, index) => <section key={item.id} className={`space-y-2 rounded-xl border p-3 ${selected?.id === item.id ? 'border-accent-primary/60' : 'border-border'}`} onFocus={() => setSelectedId(item.id)}>
            <div className="flex items-center justify-between text-xs"><button type="button" onClick={() => setSelectedId(item.id)}>{imageSet ? index ? `第 ${index + 1} 页` : '封面' : `镜头 ${index + 1}`}</button><button type="button" onClick={() => change(imageSet ? { ...draft, pages: draft.pages.filter(page => page.id !== item.id) } : { ...draft, scenes: draft.scenes.filter(scene => scene.id !== item.id) })}>删除</button></div>
            <input aria-label={`${imageSet ? '页面' : '镜头'}标题 ${index + 1}`} className={field} value={item.title} onChange={event => imageSet ? updatePage(item.id, { title: event.target.value }) : updateScene(item.id, { title: event.target.value })} placeholder="标题" />
            {'copy' in item ? <textarea className={field} value={item.copy} onChange={event => updatePage(item.id, { copy: event.target.value })} placeholder="页面文案" /> : <><textarea className={field} value={item.text} onChange={event => updateScene(item.id, { text: event.target.value })} placeholder="屏幕文字" /><textarea className={field} value={item.visual} onChange={event => updateScene(item.id, { visual: event.target.value })} placeholder="画面说明" />{!remix && <label className="block text-xs">画面方式<select className={field} value={item.mediaMode || 'product-asset'} onChange={event => updateScene(item.id, { mediaMode: event.target.value as 'product-asset' | 'ai-motion' })}><option value="product-asset">原图运镜</option><option value="ai-motion">AI 视频（生成前另行确认）</option></select></label>}<textarea className={field} value={item.narration} onChange={event => updateScene(item.id, { narration: event.target.value })} placeholder="旁白文案，配音需单独确认" /><label className="block text-xs">时长（秒）<input className={field} type="number" min="0.5" max="30" step="0.1" value={item.durationMs / 1000} onChange={event => updateScene(item.id, { durationMs: Math.round(Number(event.target.value) * 1000) })} /></label>{remix && <label className="block text-xs">截取起点（秒）<input className={field} type="number" min="0" step="0.1" value={item.sourceStartMs / 1000} onChange={event => updateScene(item.id, { sourceStartMs: Math.round(Number(event.target.value) * 1000) })} /></label>}</>}
            <select aria-label={`素材 ${index + 1}`} className={field} value={'assetIds' in item ? item.assetIds[0] || '' : item.assetId} onChange={event => imageSet ? updatePage(item.id, { assetIds: event.target.value ? [event.target.value] : [] }) : updateScene(item.id, { assetId: event.target.value })}><option value="">选择素材</option>{(remix ? clips.map(value => ({ id: value.assetId, name: value.title || value.assetId })) : product?.assets || []).map(value => <option key={value.id} value={value.id}>{value.name || value.id}</option>)}</select>
        </section>)}
        {!(imageSet ? draft.pages.length : draft.scenes.length) && <p className="text-xs text-text-tertiary">添加第一{imageSet ? '页' : '个镜头'}，或在左侧描述希望创作的内容。</p>}
        </section>
    </div>;
    return <><CreationWorkbench adapter={{ id: initial.id, changeToken: workspace.revision, title: draft.title || '未命名' + CREATION_CAPABILITY_LABELS[initial.capability], subtitle: `${PRODUCT_PLATFORM_LABELS[initial.platform]} · ${CREATION_CAPABILITY_LABELS[initial.capability]}`, status: dirty.current ? '正在保存…' : '已保存',
        flush: async () => { await save(); if (dirty.current) throw new Error('当前输入尚未保存，请重试'); },
        actions: <><button className={button} disabled={busy || !workspace.undo.length} onClick={() => void act(async () => { await save(); const result = await window.ipcRenderer.creationWorkspace.undo(turn()); if (!result.success || !result.workspace) throw new Error(result.error); accept(result.workspace); draftRef.current = result.workspace.draft; setDraft(result.workspace.draft); })}>撤销</button><button className={button} disabled={busy} onClick={() => void act(async () => { await save(); if (dirty.current) throw new Error('请等待当前输入保存'); const result = await window.ipcRenderer.creationWorkspace.materialize(turn()); if (!result.success) throw new Error(result.error); await onMaterialized(); })}>继续制作</button></>,
        notice: <>{workspace.unapplied?.length ? <details className="border-b border-border px-3 py-2 text-xs text-amber-700"><summary>有 {workspace.unapplied.length} 份对话修改未应用，已保留当前输入</summary>{workspace.unapplied.map(item => <div className="mt-2 space-y-1" key={item.id}><strong>{item.draft.title}</strong><p className="whitespace-pre-wrap">{item.draft.body}</p><p>{item.draft.scenes.length} 个镜头 · {item.draft.pages.length} 个页面；可在对话中要求基于最新作品重新处理。</p></div>)}</details> : null}{(error || autosave.error) && <p role="alert" className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-red-600">{error || autosave.error}<button className={button} onClick={() => void act(save)}>重试保存</button></p>}{changed && <p role="status" className="px-3 py-2 text-xs text-accent-primary">对话修改已同步，可撤销</p>}</>,
        chat: <Suspense fallback={<p className="p-4">加载创作对话…</p>}><Chat fixedSessionId={initial.sessionId} beforeSend={beforeSend} fixedSessionTaskHints={{ workflowKind: 'creation-workspace' }} isActive showClearButton={false} showWelcomeShortcuts={false} showComposerShortcuts={false} fixedSessionContextIndicatorMode="none" keepComposerInputActive contentLayout="wide" placeholder="描述你的想法，文案与编排会同步到作品编辑…" /></Suspense>, editor,
        preview: <div className="h-full overflow-y-auto bg-surface-secondary p-4"><p className="mb-3 text-xs text-text-tertiary">本地编排预览 · 媒体生成需单独确认</p><div className="overflow-hidden rounded-xl border border-border bg-surface-primary"><div className="relative flex items-center justify-center bg-surface-secondary" style={{ aspectRatio: draft.aspectRatio.replace(':', '/') }}>{remix && clip ? <video src={resolveAssetUrl(clip.previewUrl)} controls className="h-full w-full object-contain" /> : asset ? <img src={resolveAssetUrl(asset.previewUrl || asset.absolutePath || asset.path)} alt="当前页面素材" className="h-full w-full object-contain" /> : <span className="text-xs text-text-tertiary">{selected ? '选择素材后预览画面' : '作品预览将在这里显示'}</span>}{selected && <div className="pointer-events-none absolute inset-x-4 bottom-6 rounded bg-surface-primary/90 p-3 text-sm">{selected.title}{'copy' in selected ? <p>{selected.copy}</p> : <p>{(selected as CreationDraft['scenes'][number]).text}</p>}</div>}</div><div className="space-y-3 p-4"><h2 className="font-semibold">{draft.title || '作品标题'}</h2><p className="whitespace-pre-wrap text-sm">{draft.body}</p><p className="text-xs text-accent-primary">{draft.hashtags.map(tag => '#' + tag).join(' ')}</p></div></div></div>,
    }} />{picker && <VideoRemixSourcePicker onCancel={() => setPicker(false)} onSelect={values => { setClips(values); change({ ...draftRef.current, sourceAssetIds: values.map(value => value.assetId) }); setPicker(false); }} />}</>;
}
