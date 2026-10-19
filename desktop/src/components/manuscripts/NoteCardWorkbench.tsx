import { cardFingerprint } from '../../../shared/cardRenderer';
import { resolveAssetUrl } from '../../utils/pathManager';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CreationWorkbench } from '../../features/workbench/CreationWorkbench';
import { useCreationAutosave } from '../../features/workbench/useCreationAutosave';
import { subscribeDataChanged } from '../../bridge/appEvents';
import { mergeCreationDraft } from '../../../shared/mergeCreationDraft';
import { CARD_LAYOUT_LABELS, CARD_WIDTH, CARD_HEIGHT, PRESET_LABELS, newCardPage, presetConfig, type CreationPreset, type CardBlock, type NoteCardContent, type NoteCardTurn } from '../../../shared/noteCards';
import type { NoteCardResult } from '../../bridge/domains/noteCardBridge';
import type { ChatMessageLinkTarget } from '../MessageItem';
import type { PendingChatMessage } from '../../features/app-shell/types';
import { blockCopy } from '../../../shared/noteCards';

const Chat = lazy(async () => ({ default: (await import('../../pages/Chat')).Chat }));
const control = 'w-full rounded-lg border border-border bg-surface-primary p-2 text-sm text-text-primary';
const button = 'rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-surface-secondary disabled:opacity-40';
function changedPages(before: NoteCardContent, after: NoteCardContent) {
    return [...new Set([...before.imagePages.map(page => page.id), ...after.imagePages.map(page => page.id)])].filter(id => JSON.stringify(before.imagePages.find(page => page.id === id)) !== JSON.stringify(after.imagePages.find(page => page.id === id)));
}
export function NoteCardWorkbench({ target, sessionId, isActive, onClose }: { target: ChatMessageLinkTarget; sessionId: string | null; isActive?: boolean; onClose?: () => void }) {
    const projectPath = target.projectPath || target.localPathCandidate || target.relativePath || target.href;
    const [snapshot, setSnapshot] = useState<NoteCardResult | null>(null); const saved = useRef<NoteCardResult | null>(null);
    const [content, setContent] = useState<NoteCardContent | null>(null); const local = useRef<NoteCardContent | null>(null);
    const [selectedId, select] = useState(''); const [html, setHtml] = useState(''); const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false); const [running, setRunning] = useState(false); const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false); const epoch = useRef(0); const [editEpoch, setEditEpoch] = useState(0);
    const marking = useRef<Promise<void>>(Promise.resolve()); const saving = useRef<Promise<NoteCardResult> | null>(null);
    const [preset, setPreset] = useState<CreationPreset | null>(null); const [pending, setPending] = useState<PendingChatMessage | null>(null);
    const [sources, setSources] = useState<Record<string, { status: string; error?: string; changed?: boolean }>>({});
    const [failures, setFailures] = useState<Array<{ pageId: string; index: number; error: string }>>([]);
    const [aiReview, setAiReview] = useState<{ model: string; configurationKey: string; revision: number; pageId: string; prompt: string } | null>(null);
    const [showExport, setShowExport] = useState(false);
    const [exportedAt, setExportedAt] = useState<number | null>(null);
    const previewBox = useRef<HTMLDivElement | null>(null); const [scale, setScale] = useState(0.2);
    const previewObserver = useRef<ResizeObserver | null>(null);
    const attachPreview = useCallback((node: HTMLDivElement | null) => {
        previewObserver.current?.disconnect(); previewBox.current = node;
        if (!node) return;
        const measure = () => setScale(node.clientWidth / CARD_WIDTH);
        measure(); previewObserver.current = new ResizeObserver(measure); previewObserver.current.observe(node);
    }, []);
    useEffect(() => () => previewObserver.current?.disconnect(), []);
    const apply = useCallback((value: NoteCardResult) => {
        const previous = saved.current;
        const outputs = value.outputs || Object.fromEntries(Object.entries(previous?.outputs || {}).map(([id, output]) => { const before = previous?.content.imagePages.find(page => page.id === id); const after = value.content.imagePages.find(page => page.id === id); return [id, before && after && cardFingerprint(before, previous!.content.creationConfig, {}) === cardFingerprint(after, value.content.creationConfig, {}) ? output : { ...output, state: 'stale' as const }]; }));
        value = { ...value, outputs }; saved.current = value; setSnapshot(value); local.current = value.content; setContent(value.content); dirtyRef.current = false; setDirty(false);
        select(previous => value.content.imagePages.some(page => page.id === previous) ? previous : value.content.imagePages[0]?.id || '');
    }, []);
    const read = useCallback(async () => { const result = await window.ipcRenderer.noteCard.read(projectPath); if (!result.success || !result.result) throw new Error(result.error || '读取作品失败'); return result.result; }, [projectPath]);
    useEffect(() => { let active = true; void read().then(value => { if (active) apply(value); }).catch(reason => { if (active) setNotice(String(reason)); }); return () => { active = false; }; }, [read, apply]);
    useEffect(() => subscribeDataChanged((_event, payload) => {
        if (payload?.scope !== 'manuscripts' || dirtyRef.current || saving.current) return;
        const currentEpoch = epoch.current;
        void read().then(value => { if (!dirtyRef.current && currentEpoch === epoch.current) apply(value); }).catch(reason => setNotice(String(reason)));
    }), [read, apply]);
    const getTurn = async (value: NoteCardResult, policy: NoteCardTurn['policy'] = 'direct') => {
        const result = await window.ipcRenderer.noteCard.turn(value.relativePath, value.content.imagePages.some(page => page.id === selectedId) ? selectedId : undefined, policy);
        if (!result.success || !result.result) throw new Error(result.error || '读取编辑凭据失败');
        if (result.result.expectedRevision !== value.version || result.result.expectedDraftEpoch !== value.runtime.draftEpoch) throw new Error('作品有新修改，请先重试保存');
        return result.result;
    };
    const edit = (next: NoteCardContent) => {
        local.current = next; setContent(next); epoch.current++; setEditEpoch(epoch.current);
        if (!dirtyRef.current && saved.current) {
            const base = saved.current;
            marking.current = getTurn(base).then(turn => window.ipcRenderer.noteCard.mark(turn)).then(result => {
                if (!result.success || !result.result) throw new Error(result.error || '输入保护失败');
                saved.current = result.result; setSnapshot(result.result);
            });
        }
        dirtyRef.current = true; setDirty(true); setNotice('');
    };
    const save = async (): Promise<NoteCardResult> => {
        if (saving.current) return saving.current;
        const operation = (async () => {
            await marking.current;
            if (!saved.current || !local.current) throw new Error('作品尚未加载');
            if (!dirtyRef.current) return saved.current;
            const sequence = epoch.current; const base = saved.current; const next = local.current;
            let result;
            try { result = await window.ipcRenderer.noteCard.save(await getTurn(base), next); }
            catch (error) { setNotice(String(error)); throw error; }
            if (!result.success || !result.result) throw new Error(result.error || '保存失败，输入已保留');
            saved.current = result.result; setSnapshot(result.result);
            if (sequence === epoch.current) apply(result.result);
            return result.result;
        })(); saving.current = operation;
        try { return await operation; } finally { saving.current = null; }
    };
    const flush = async () => { await save(); if (dirtyRef.current) { await save(); if (dirtyRef.current) throw new Error('输入尚未保存，请重试'); } };
    const autoSave = useCreationAutosave(dirty, editEpoch, save);
    useEffect(() => { if (autoSave.error) setNotice(autoSave.error); }, [autoSave.error]);
    const perform = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setNotice(''); try { await operation(); } catch (error) { setNotice(String(error)); } finally { setBusy(false); } };
    const page = content?.imagePages.find(page => page.id === selectedId);
    useEffect(() => {
        if (!snapshot || !page || !content) { setHtml(''); return; }
        let active = true;
        const timer = window.setTimeout(() => { void window.ipcRenderer.noteCard.preview({ path: projectPath, expectedRevision: snapshot.version, pageId: page.id, preview: { page, style: content.creationConfig.style } }).then(result => { if (!active) return; if (result.success && result.result) setHtml(result.result.html); else { setHtml(''); setNotice(result.error || '预览失败'); } }).catch(reason => { if (active) setNotice(String(reason)); }); }, 180);
        return () => { active = false; window.clearTimeout(timer); };
    }, [snapshot?.version, page, content?.creationConfig.style, projectPath]);

    useEffect(() => {
        let active = true;
        for (const ref of content?.creationConfig.sourceRefs || []) void window.ipcRenderer.noteCard.source({ path: projectPath, sourceId: ref.id, limit: 1 }).then(result => { if (active) setSources(previous => ({ ...previous, [ref.id]: result.success ? result.result : { status: 'missing', error: result.error } })); });
        return () => { active = false; };
    }, [snapshot?.version, projectPath]);
    const requestDraft = async (policy: NoteCardTurn['policy'], nextPreset?: CreationPreset) => {
        await flush(); const value = saved.current!;
        if (value.content.creationConfig.inputMode === 'article' && !value.content.creationConfig.sourceRefs.length) throw new Error('请先绑定文章来源');
        for (const ref of value.content.creationConfig.sourceRefs) { const result = await window.ipcRenderer.noteCard.source({ path: projectPath, sourceId: ref.id, limit: 1 }); if (!result.success || !['ready', 'changed'].includes(result.result?.status)) throw new Error(`${ref.name} 尚未成功读取，请重试或更换来源`); }
        const turn = await getTurn(value, policy);
        setPending({ content: policy === 'propose' ? `请把当前作品重新组织为${PRESET_LABELS[nextPreset || value.content.creationConfig.presetId]}，保留原文事实与来源。读取后只提交完整重组候选，让我查看差异并应用。` : '请读取当前作品、选中页面及全部绑定来源，按照当前创作方式和表达设置生成可编辑初稿，保存页面、来源依据和发布文案。', sessionRouting: 'current', taskHints: { workflowKind: 'note-card-edit', noteCardTurn: turn, ...(nextPreset ? { requestedPresetId: nextPreset } : {}) } });
    };
    const patchPage = (patch: Partial<NoteCardContent['imagePages'][number]>) => { if (content && page) edit({ ...content, imagePages: content.imagePages.map(item => item.id === page.id ? { ...item, ...patch, ...(patch.blocks ? { copy: blockCopy(patch.blocks) } : {}) } : item) }); };
    const sourceUpload = async () => {
        await flush();
        const picked = await window.ipcRenderer.chat.pickAttachment() as { success?: boolean; canceled?: boolean; error?: string; attachment?: { absolutePath?: string; name: string } };
        if (picked.canceled) return; if (!picked.success || !picked.attachment?.absolutePath) throw new Error(picked.error || '未选择来源');
        const imported = await window.ipcRenderer.noteCard.importSource({ kind: 'attachment', path: picked.attachment.absolutePath, name: picked.attachment.name });
        if (!imported.success || !imported.result) throw new Error(imported.error || '保存来源失败');
        const source = imported.result; const current = local.current!; edit({ ...current, creationConfig: { ...current.creationConfig, inputMode: 'article', sourceRefs: [...current.creationConfig.sourceRefs, { id: source.id, version: source.version, name: source.name }] } });
        await flush();
    };
    const exportCards = (format: 'png' | 'directory' | 'zip', pageId = selectedId) => perform(async () => {
        await flush(); const result = await window.ipcRenderer.noteCard.export({ path: projectPath, expectedRevision: saved.current!.version, format, pageId });
        if (!result.success || !result.result) throw new Error(result.error || '导出失败'); if (result.result.canceled) return;
        setFailures(result.result.failures);
        if (!result.result.complete) throw new Error(`部分页面未完成，已保留 ${result.result.rendered} 页渲染结果，请查看失败页后重试`);
        setExportedAt(saved.current!.version); apply(await read()); setNotice(`已导出：${result.result.outputPath}`);
    });
    if (!content || !snapshot) return <div role="status" className="p-5 text-sm">{notice || '正在读取卡片作品…'}</div>;
    const setConfig = (patch: Partial<NoteCardContent['creationConfig']>) => edit({ ...content, creationConfig: { ...content.creationConfig, ...patch } });
    const switchPreset = (value: CreationPreset) => {
        if (content.imagePages.some(page => page.title || page.copy || page.blocks?.some(block => block.type === 'image' && block.assetId))) setPreset(value);
        else setConfig(presetConfig(value, content.creationConfig));
    };
    const reorder = (offset: number) => { if (!page) return; const pages = [...content.imagePages]; const index = pages.findIndex(item => item.id === page.id); if (index + offset < 0 || index + offset >= pages.length) return; [pages[index], pages[index + offset]] = [pages[index + offset], pages[index]]; edit({ ...content, imagePages: pages.map((page, index) => ({ ...page, index: index + 1 })) }); };
    const proposal = snapshot.runtime.proposal;
    const proposalFields = proposal ? (['finalTitle', 'body', 'hashtags', 'creationConfig'] as const).filter(key => JSON.stringify(content[key]) !== JSON.stringify(proposal.content[key])) : [];
    const removedPages = proposal ? content.imagePages.filter(page => !proposal.content.imagePages.some(next => next.id === page.id)) : [];
    const editor = <div className="h-full space-y-4 overflow-y-auto p-3">
        <details className="rounded-xl border border-border p-3" open={!content.imagePages.length}>
            <summary className="cursor-pointer text-sm font-medium">创作方式 · {PRESET_LABELS[content.creationConfig.presetId]}</summary>
            <div className="mt-3 space-y-3"><label className="block text-xs">创作方式<select aria-label="创作方式" className={control} value={content.creationConfig.presetId} onChange={event => switchPreset(event.target.value as CreationPreset)}>{Object.entries(PRESET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="block text-xs">内容表达<select aria-label="内容表达" className={control} value={content.creationConfig.expression} onChange={event => setConfig({ expression: event.target.value as 'free' | 'diagram' | 'tutorial' })}><option value="free">普通卡片</option><option value="diagram">知识图解</option><option value="tutorial">步骤教程</option></select></label>
            <p className="text-xs text-text-tertiary">知识图解支持线性流程、对比和清单；复杂关系网络、矩阵和时间线暂不支持。</p>
            <label className="block text-xs">创作要求<textarea aria-label="创作要求" className={control} value={content.creationConfig.brief} onChange={event => setConfig({ brief: event.target.value })} /></label>
            <label className="block text-xs">目标读者<input aria-label="目标读者" className={control} value={content.creationConfig.audience} onChange={event => setConfig({ audience: event.target.value })} /></label>
            <button type="button" className={button} disabled={busy} onClick={() => void perform(sourceUpload)}>添加 / 更换文章来源</button>
            {!content.creationConfig.sourceRefs.length && content.creationConfig.inputMode === 'article' && <p className="text-xs">请先添加文章；也可以切回自由创作手动填写。</p>}
            {content.creationConfig.sourceRefs.map(ref => <div key={ref.id} className="space-y-1 rounded border border-border p-2 text-xs"><strong>{ref.name}</strong><p>{({ ready: '读取成功', empty: '内容为空', unsupported: '格式不支持', failed: '解析失败', missing: '来源缺失', changed: '原文版本变化，作品仍引用已保存版本' } as Record<string, string>)[sources[ref.id]?.status] || '正在读取…'}</p>{sources[ref.id]?.error && <p>{sources[ref.id].error}</p>}<button className={button} onClick={() => void perform(async () => { await flush(); const result = await window.ipcRenderer.noteCard.source({ path: projectPath, sourceId: ref.id, reread: true }); if (!result.success) throw new Error(result.error); const source = result.result; const current = local.current!; edit({ ...current, creationConfig: { ...current.creationConfig, sourceRefs: source.id === ref.id ? current.creationConfig.sourceRefs : [...current.creationConfig.sourceRefs, { id: source.id, version: source.version, name: source.name }] } }); })}>重新读取</button> <button className={button} onClick={() => { const refs = content.creationConfig.sourceRefs.filter(value => value.id !== ref.id); edit({ ...content, creationConfig: { ...content.creationConfig, sourceRefs: refs, inputMode: refs.length ? 'article' : 'manual' }, imagePages: content.imagePages.map(page => ({ ...page, sourceRefs: page.sourceRefs.filter(source => source.id !== ref.id) })) }); }}>移除来源</button></div>)}
            </div>
        </details>
        <label className="block text-xs">作品名称<input aria-label="作品名称" className={control} value={content.finalTitle} onChange={event => edit({ ...content, finalTitle: event.target.value })} /></label>
        <nav aria-label="卡片页面" className="flex flex-wrap gap-2">{content.imagePages.map((item, index) => <button className={`${button} ${item.id === selectedId ? 'border-accent-primary' : ''}`} key={item.id} onClick={() => select(item.id)}>{index + 1} · {item.title || '空白页'}</button>)}<button className={button} disabled={content.imagePages.length >= 20} onClick={() => { const page = newCardPage(content.imagePages.length ? 'text' : 'cover'); page.index = content.imagePages.length + 1; edit({ ...content, imagePages: [...content.imagePages, page] }); select(page.id); }}>＋ 添加页面</button></nav>
        {page && <section className="space-y-3 rounded-xl border border-border p-3"><div className="flex gap-2"><button className={button} onClick={() => reorder(-1)}>上移</button><button className={button} onClick={() => reorder(1)}>下移</button><button className={button} onClick={() => edit({ ...content, imagePages: content.imagePages.filter(item => item.id !== page.id).map((item, index) => ({ ...item, index: index + 1 })) })}>删除页面</button></div>
            <label className="block text-xs">页面模板<select aria-label="页面模板" className={control} value={page.layout || 'legacy'} onChange={event => { const layout = event.target.value as NonNullable<typeof page.layout>; const legacy = snapshot.document.mediaSlots.find(slot => slot.id === page.mediaSlotId)?.assetId; patchPage({ layout, blocks: page.blocks || [{ type: 'text', text: page.copy, emphasis: [] }, ...(legacy ? [{ type: 'image' as const, assetId: legacy, fit: 'contain' as const, x: 50, y: 50 }] : [])] }); }}>{!page.layout && <option value="legacy">旧版图文方案（选择模板后转换）</option>}{Object.entries(CARD_LAYOUT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="block text-xs">页面标题<input aria-label="页面标题" className={control} value={page.title} onChange={event => patchPage({ title: event.target.value })} /></label>
            <label className="block text-xs">AI 配图方案（单独确认）<textarea aria-label="AI 配图方案" className={control} value={page.imagePrompt} onChange={event => patchPage({ imagePrompt: event.target.value })} /></label>
            {!page.blocks ? <label className="block text-xs">页面正文<textarea className={control} value={page.copy} onChange={event => patchPage({ copy: event.target.value })} /></label> : <CardBlocks blocks={page.blocks} onChange={blocks => patchPage({ blocks })} onError={setNotice} />}
            {page.sourceRefs.length > 0 && <p className="text-xs text-text-tertiary">依据：{page.sourceRefs.map(ref => `${ref.name} · ${ref.location}`).join('；')}</p>}
        </section>}
        <details className="rounded-xl border border-border p-3"><summary className="text-sm">视觉样式</summary><div className="mt-3 space-y-2"><select aria-label="视觉样式" className={control} value={content.creationConfig.style.mode} onChange={event => setConfig({ style: { ...content.creationConfig.style, mode: event.target.value as 'text' | 'mixed' } })}><option value="text">简洁文字</option><option value="mixed">图文混排</option></select>{(['background', 'foreground', 'accent'] as const).map(key => <label className="mr-3 inline-flex items-center gap-1 text-xs" key={key}>{({ background: '背景', foreground: '文字', accent: '重点' })[key]}<input aria-label={key} type="color" value={content.creationConfig.style[key]} onChange={event => setConfig({ style: { ...content.creationConfig.style, [key]: event.target.value } })} /></label>)}<label className="block text-xs">字号<input aria-label="字号" type="range" min="0.7" max="1.3" step="0.05" value={content.creationConfig.style.fontScale} onChange={event => setConfig({ style: { ...content.creationConfig.style, fontScale: Number(event.target.value) } })} /></label></div></details>
        <details className="rounded-xl border border-border p-3"><summary className="text-sm">发布文案</summary><textarea aria-label="发布文案" className={`${control} mt-3 min-h-32`} value={content.body} onChange={event => edit({ ...content, body: event.target.value })} /><input aria-label="话题" placeholder="话题，以空格分隔" className={control} value={content.hashtags.join(' ')} onChange={event => edit({ ...content, hashtags: event.target.value.split(/\s+/).filter(Boolean) })} /></details>
    </div>;
    return <CreationWorkbench adapter={{ id: projectPath, title: content.finalTitle || '未命名图文笔记', subtitle: `小红书 · ${PRESET_LABELS[content.creationConfig.presetId]} · 本地排版`, status: dirty ? '待保存' : '已保存', changeToken: snapshot.version, flush,
        chat: sessionId ? <Suspense fallback={<p>正在加载创作对话…</p>}><Chat isActive={isActive} fixedSessionId={sessionId} showClearButton={false} showWelcomeShortcuts={false} showComposerShortcuts={false} fixedSessionContextIndicatorMode="none" keepComposerInputActive contentLayout="wide" allowFileUpload={false} fixedSessionTaskHints={{ workflowKind: 'note-card-edit' }} beforeSend={async () => { await flush(); return { workflowKind: 'note-card-edit', noteCardTurn: await getTurn(saved.current!) }; }} pendingMessage={pending} onMessageConsumed={() => setPending(null)} onPendingMessageError={setNotice} onExecutionStateChange={setRunning} /></Suspense> : <p className="p-3 text-sm">正在恢复作品对话…</p>,
        editor, preview: <div className="h-full overflow-auto p-3"><p className="mb-2 text-xs text-text-tertiary">排版预览 · 1440 × 1920 · {dirty ? '导出待更新' : snapshot.outputs?.[page?.id || '']?.state === 'ready' ? '本页图片有效' : snapshot.outputs?.[page?.id || ''] ? '本页导出待更新' : exportedAt === null ? '尚未导出' : '导出待更新'}</p>{snapshot.outputs?.[page?.id || '']?.previewUrl && <button className={button} onClick={() => setShowExport(value => !value)}>{showExport ? '返回当前排版' : '查看上次导出'}</button>}<div ref={attachPreview} className="relative w-full overflow-hidden" style={{ height: scale * CARD_HEIGHT }}>{showExport && snapshot.outputs?.[page?.id || '']?.previewUrl ? <img alt="上次导出图片" src={resolveAssetUrl(snapshot.outputs[page!.id].previewUrl!)} className="h-full w-full object-contain" /> : html && scale > 0 ? <iframe title="卡片排版预览" sandbox="allow-same-origin" srcDoc={html} className="absolute left-0 top-0 border-0" style={{ width: CARD_WIDTH, height: CARD_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }} /> : <div className="p-5 text-sm">{page ? '正在排版…' : '添加页面开始创作'}</div>}</div></div>,
        actions: <><button className={button} disabled={busy || !page?.imagePrompt.trim()} onClick={() => void perform(async () => { await flush(); const config = await window.ipcRenderer.noteCard.generationConfig(); if (!config.success || !config.result?.configured) throw new Error(config.result?.reason || config.error || '图片模型未配置'); setAiReview({ model: config.result.model, configurationKey: config.result.configurationKey, revision: saved.current!.version, pageId: page!.id, prompt: page!.imagePrompt }); })}>生成配图 · 图片模型</button><button className={button} disabled={busy || running || !sessionId} onClick={() => void perform(() => requestDraft('direct'))}>生成初稿 · 文本模型</button><button className={button} disabled={busy || !snapshot.runtime.undo.length} onClick={() => void perform(async () => { await flush(); const result = await window.ipcRenderer.noteCard.undo(await getTurn(saved.current!)); if (!result.success || !result.result) throw new Error(result.error); apply(result.result); })}>撤销</button>{(['png', 'directory', 'zip'] as const).map(format => <button key={format} className={button} disabled={busy || !content.imagePages.length} onClick={() => void exportCards(format)}>{format === 'png' ? '当前页 PNG' : format === 'directory' ? '整套目录' : 'ZIP'}</button>)}{onClose && <button className={button} onClick={() => void perform(async () => { await flush(); onClose(); })}>返回对话</button>}</>,
        notice: <>{aiReview && <div role="dialog" aria-label="确认 AI 配图" className="border-b border-border p-3 text-xs"><p>模型：{aiReview.model}；当前页 1 张配图，3:4。标题与正文继续由应用排版。</p><p className="my-2 whitespace-pre-wrap">{aiReview.prompt}</p><button className={button} disabled={busy || dirty || snapshot.version !== aiReview.revision} onClick={() => void perform(async () => { const review = aiReview; setAiReview(null); const result = await window.ipcRenderer.noteCard.generate({ path: projectPath, pageId: review.pageId, expectedRevision: review.revision, requestId: crypto.randomUUID(), confirmed: true, reviewedConfigurationKey: review.configurationKey }); if (!result.success || !result.result) throw new Error(result.error || '配图失败'); if (dirtyRef.current) { setNotice('配图已保存到素材库；当前输入已保留，请保存后明确选择图片'); return; } apply(result.result); setNotice(result.result.warning || '配图已绑定，文字仍可编辑'); })}>确认生成 1 张</button> <button className={button} onClick={() => setAiReview(null)}>取消</button></div>}{notice && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">{notice}{dirty && <button className={button} onClick={() => void perform(async () => { const latest = await read(); const rebased = mergeCreationDraft(saved.current!.content, local.current!, latest.content); saved.current = latest; setSnapshot(latest); local.current = rebased; setContent(rebased); marking.current = Promise.resolve(); await flush(); })}>保留输入并重试保存</button>}</div>}{failures.map(failure => <div role="alert" key={failure.pageId} className="px-3 py-1 text-xs text-red-600">第 {failure.index} 页：{failure.error} <button className={button} onClick={() => { select(failure.pageId); void exportCards('png', failure.pageId); }}>单页重试</button></div>)}
        {snapshot.runtime.generations?.filter(item => item.status === 'failed').map(item => <p key={item.requestId} role="status" className="border-b border-border px-3 py-2 text-xs">配图失败：{item.error}；请检查素材后重新确认生成。</p>)}{snapshot.runtime.unapplied.map(item => <details key={item.id} className="border-b border-border p-3 text-xs"><summary>有未应用的 AI 修改：{item.reason}</summary><p className="mt-2">{item.content.finalTitle} · {item.content.imagePages.length} 页；请重新发送要求，基于当前版本重试。</p><ol className="mt-2 max-h-64 space-y-2 overflow-auto">{item.content.imagePages.map(page => <li key={page.id}><strong>{page.title}</strong><p className="whitespace-pre-wrap">{page.copy || blockCopy(page.blocks || [])}</p></li>)}</ol></details>)}
        {preset && <div role="dialog" aria-label="更换创作方式" className="border-b border-border p-3 text-xs"><p>切换为「{PRESET_LABELS[preset]}」；当前 {content.imagePages.length} 页。文章来源将保留。</p><div className="mt-2 flex gap-2"><button className={button} onClick={() => { setConfig(presetConfig(preset, content.creationConfig)); setPreset(null); }}>仅调整后续创作方向</button><button className={button} disabled={running || busy} onClick={() => { const value = preset; setPreset(null); void perform(() => requestDraft('propose', value)); }}>生成重组候选 · 文本模型</button><button className={button} onClick={() => setPreset(null)}>取消</button></div></div>}
        {proposal && <details open className="border-b border-border p-3 text-xs"><summary>重组候选：修改 {changedPages(content, proposal.content).length} 页，{content.imagePages.length} → {proposal.content.imagePages.length} 页</summary><p className="my-2">变更字段：{proposalFields.map(key => ({ finalTitle: '作品标题', body: '发布正文', hashtags: '话题', creationConfig: '创作方式、表达与样式设置' })[key]).join('、') || '仅页面内容'}；页面顺序：{content.imagePages.map(page => page.title || page.id).join(' → ')} → {proposal.content.imagePages.map(page => page.title || page.id).join(' → ')}</p>{removedPages.length > 0 && <p>将移除页面：{removedPages.map(page => page.title || page.id).join('、')}</p>}<p className="my-2">标题：{content.finalTitle} → {proposal.content.finalTitle}；创作方式：{PRESET_LABELS[proposal.content.creationConfig.presetId]}</p><ol className="max-h-64 space-y-2 overflow-auto">{proposal.content.imagePages.map((item, index) => <li key={item.id}>{index + 1}. {item.title}{content.imagePages.some(page => page.id === item.id) && <details><summary>查看原内容</summary><pre className="whitespace-pre-wrap font-sans">{content.imagePages.find(page => page.id === item.id)?.copy}</pre></details>}<pre className="whitespace-pre-wrap font-sans text-text-secondary">{item.copy || blockCopy(item.blocks || [])}</pre></li>)}</ol><div className="mt-2 flex gap-2"><button className={button} disabled={busy || dirty} onClick={() => void perform(async () => { const result = await window.ipcRenderer.noteCard.apply(await getTurn(saved.current!)); if (!result.success || !result.result) throw new Error(result.error); apply(result.result); })}>应用并保留撤销</button><button className={button} onClick={() => void perform(async () => { const result = await window.ipcRenderer.noteCard.dismiss(await getTurn(saved.current!)); if (result.result) apply(result.result); })}>放弃候选</button></div></details>}</>,
    }} />;
}

function CardBlocks({ blocks, onChange, onError }: { blocks: CardBlock[]; onChange: (blocks: CardBlock[]) => void; onError: (value: string) => void }) {
    const update = (index: number, block: CardBlock) => onChange(blocks.map((value, i) => i === index ? block : value));
    const upload = async (index: number, block: CardBlock & { type?: 'image' }) => {
        try { const result = await window.ipcRenderer.media.importFiles<{ success: boolean; canceled?: boolean; error?: string; imported?: Array<{ id: string }> }>({ kind: 'image', multiple: false }); if (result.canceled) return; if (!result.success || !result.imported?.[0]) throw new Error(result.error || '图片导入失败'); update(index, { ...block, assetId: result.imported[0].id }); } catch (error) { onError(String(error)); }
    };
    return <div className="space-y-3">{blocks.map((block, index) => <div key={index} className="space-y-2 rounded border border-border p-2"><div className="flex justify-between text-xs"><span>{{ text: '正文', image: '图片', comparison: '对比', steps: '步骤', checklist: '清单' }[block.type]}</span><div className="flex gap-1"><button className={button} disabled={index === 0} onClick={() => { const next = [...blocks]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>上移</button><button className={button} onClick={() => onChange(blocks.filter((_, i) => i !== index))}>移除</button></div></div>
        {block.type === 'text' && <><textarea aria-label="正文内容" className={`${control} min-h-32`} value={block.text} onChange={event => update(index, { ...block, text: event.target.value })} /><input aria-label="重点标记" className={control} placeholder="重点词句，以 | 分隔" value={block.emphasis.join('|')} onChange={event => update(index, { ...block, emphasis: event.target.value.split('|').filter(Boolean) })} /></>}
        {block.type === 'image' && <><button className={button} onClick={() => void upload(index, block)}>{block.assetId ? '更换图片' : '选择图片'}</button><select aria-label="图片裁切" className={control} value={block.fit} onChange={event => update(index, { ...block, fit: event.target.value as 'contain' | 'cover' })}><option value="contain">完整显示</option><option value="cover">填充裁切</option></select>{(['x', 'y'] as const).map(axis => <label key={axis} className="block text-xs">{axis === 'x' ? '水平位置' : '垂直位置'}<input type="range" min="0" max="100" value={block[axis]} onChange={event => update(index, { ...block, [axis]: Number(event.target.value) })} /></label>)}</>}
        {block.type === 'comparison' && <>{block.columns.map((value, column) => <input key={column} aria-label={`列标题 ${column + 1}`} className={control} value={String(value)} onChange={event => { const columns = [...block.columns] as [string, string]; columns[column] = event.target.value; update(index, { ...block, columns }); }} />)}{block.rows.map((row, rowIndex) => <div key={rowIndex} className="grid grid-cols-3 gap-1">{(['label', 'left', 'right'] as const).map(key => <textarea key={key} aria-label={`对比项 ${rowIndex + 1} ${key}`} className={control} value={row[key]} onChange={event => update(index, { ...block, rows: block.rows.map((value, i) => i === rowIndex ? { ...value, [key]: event.target.value } : value) })} />)}<button className={button} onClick={() => update(index, { ...block, rows: block.rows.filter((_, i) => i !== rowIndex) })}>删除</button></div>)}<button className={button} disabled={block.rows.length >= 20} onClick={() => update(index, { ...block, rows: [...block.rows, { label: '', left: '', right: '' }] })}>添加对比项</button></>}
        {block.type === 'steps' && <>{block.items.map((item, itemIndex) => <div key={item.id} className="space-y-1 rounded border border-border p-2"><input aria-label={`步骤 ${itemIndex + 1} 名称`} className={control} value={item.title} onChange={event => update(index, { ...block, items: block.items.map(value => value.id === item.id ? { ...value, title: event.target.value } : value) })} /><textarea aria-label={`步骤 ${itemIndex + 1} 说明`} className={control} value={item.text} onChange={event => update(index, { ...block, items: block.items.map(value => value.id === item.id ? { ...value, text: event.target.value } : value) })} /><button className={button} onClick={() => { void window.ipcRenderer.media.importFiles<{ imported?: Array<{ id: string }> }>({ kind: 'image', multiple: false }).then(result => { if (result.imported?.[0]) update(index, { ...block, items: block.items.map(value => value.id === item.id ? { ...value, assetId: result.imported![0].id } : value) }); }).catch(reason => onError(String(reason))); }}>{item.assetId ? '更换步骤配图' : '添加步骤配图'}</button> <button className={button} disabled={itemIndex === 0} onClick={() => { const items = [...block.items]; [items[itemIndex - 1], items[itemIndex]] = [items[itemIndex], items[itemIndex - 1]]; update(index, { ...block, items }); }}>上移步骤</button> <button className={button} onClick={() => update(index, { ...block, items: block.items.filter(value => value.id !== item.id) })}>删除步骤</button></div>)}<button className={button} disabled={block.items.length >= 20} onClick={() => update(index, { ...block, items: [...block.items, { id: crypto.randomUUID(), title: '', text: '' }] })}>添加步骤</button></>}
        {block.type === 'checklist' && <><textarea aria-label="清单项" className={`${control} min-h-32`} placeholder="每行一个清单项" value={block.items.join('\n')} onChange={event => update(index, { ...block, items: event.target.value.split('\n') })} /><textarea aria-label="结语" className={control} value={block.closing} onChange={event => update(index, { ...block, closing: event.target.value })} /></>}
    </div>)}<div className="flex flex-wrap gap-1">{(['text', 'image', 'comparison', 'steps', 'checklist'] as const).map(type => <button className={button} key={type} disabled={blocks.length >= 30} onClick={() => { const block: CardBlock = type === 'text' ? { type, text: '', emphasis: [] } : type === 'image' ? { type, assetId: '', fit: 'contain', x: 50, y: 50 } : type === 'comparison' ? { type, columns: ['方案 A', '方案 B'], rows: [] } : type === 'steps' ? { type, items: [] } : { type, items: [], closing: '' }; onChange([...blocks, block]); }}>＋ {{ text: '正文', image: '图片', comparison: '对比', steps: '步骤', checklist: '清单' }[type]}</button>)}</div></div>;
}
