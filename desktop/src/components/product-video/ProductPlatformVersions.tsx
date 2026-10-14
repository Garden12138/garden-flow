import { useEffect, useState } from 'react';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { productTargetLabel, type ProductWorkVariant, type ProductCreationTarget } from '../../../shared/productCreationTarget';
import { ProductCreationSetup } from './ProductCreationSetup';
import { appConfirm } from '../../utils/appDialogs';
import { dispatchAppIntent } from '../../features/app-shell/appIntent';

export function ProductPlatformVersions({ project, disabled }: { project: VideoEditorV2Project; disabled: boolean }) {
    const [variants, setVariants] = useState<ProductWorkVariant[]>([]);
    const [dialog, setDialog] = useState<'copy' | 'bind' | null>(null);
    const [duplicate, setDuplicate] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        void window.ipcRenderer.videoEditorV2.listProductVariants({ projectId: project.id }).then(result => {
            if (active) { if (!result.success) throw new Error(result.error); setVariants(result.variants || []); }
        }).catch(error => { if (active) setError(String(error)); });
        return () => { active = false; };
    }, [project.id, project.updatedAt]);
    const current = variants.find(variant => variant.projectId === project.id);
    const create = async (target: ProductCreationTarget) => {
        const action = dialog;
        setDialog(null); setBusy(true); setError('');
        try {
            const input = { sourceProjectId: project.id, expectedUpdatedAt: project.updatedAt, target, duplicate };
            const result = await (action === 'bind' ? window.ipcRenderer.videoEditorV2.bindProductTarget(input) : window.ipcRenderer.videoEditorV2.createProductVariant(input));
            if (!result.success || !result.project) throw new Error(result.error || '平台版本创建失败');
            dispatchAppIntent({ type: 'video-project.open', projectId: result.project.id });
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    const reviewCopy = async () => {
        if (!await appConfirm('请核对目标语言、字幕、发布文案与话题。确认已在目标平台稿件中查看并保存需要的修改？')) return;
        setBusy(true); setError('');
        try { const result = await window.ipcRenderer.videoEditorV2.reviewProductCopy({ projectId: project.id, expectedUpdatedAt: project.updatedAt, confirmed: true }); if (!result.success) throw new Error(result.error); }
        catch (error) { setError(String(error)); } finally { setBusy(false); }
    };
    const prepareXhs = async () => {
        setBusy(true); setError('');
        try {
            const result = await window.ipcRenderer.videoEditorV2.prepareProductXhs({ projectId: project.id });
            if (!result.success || !result.sessionId) throw new Error(result.error || '小红书发布准备失败');
            dispatchAppIntent({ type: 'gardenflow.open', action: 'open-session', sessionId: result.sessionId });
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    return <div className="shrink-0 border-b border-border bg-white px-4 py-2 text-xs" data-product-platform-versions>
        <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto font-semibold">{current?.resolution === 'conflict' ? '平台关系冲突，请核对' : current?.target ? productTargetLabel(current.target) : project.creationTarget ? productTargetLabel(project.creationTarget) : '尚未绑定目标平台'}</span>
            {variants.filter(variant => variant.projectId !== project.id).map(variant => <button key={variant.projectId} className="rounded-lg border border-border px-2 py-1" onClick={() => dispatchAppIntent({ type: 'video-project.open', projectId: variant.projectId })}>{variant.target ? productTargetLabel(variant.target) : variant.title}</button>)}
            {current?.resolution === 'unbound' && !project.creationTarget && <button disabled={disabled || busy} onClick={() => setDialog('bind')} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">确认此工程目标</button>}
            <button disabled={disabled || busy || current?.resolution === 'conflict'} onClick={() => { setDuplicate(false); setDialog('copy'); }} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">创建其他平台版本</button>
            {current?.target?.platform === 'xiaohongshu' && current.resolution === 'bound' && <button disabled={disabled || busy || project.status !== 'exported'} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40" onClick={() => void prepareXhs()}>准备小红书发布</button>}
        </div>
        {project.workVersion?.copyReviewRequired && <p className="mt-2 text-text-secondary">副本保留了来源文案，请按目标语言核对；TikTok 可使用稿件中的 AI 语言建议。<button disabled={busy || disabled} onClick={() => void reviewCopy()} className="ml-2 underline">已核对目标文案</button></p>}
        {error && <p role="status" className="mt-2 text-red-600">{error}</p>}
        {dialog && <>
            <ProductCreationSetup videoOnly modeLocked confirmLabel={dialog === 'bind' ? '确认绑定目标' : '创建平台版本'} initial={{ contentKind: 'video', ...(dialog === 'bind' && project.canvas.aspectRatio === '16:9' ? { aspectRatio: '16:9' } : {}), compositionMode: project.productVideo?.proposal.compositionMode || 'product-images' }} onSelect={value => void create(value.target)} onCancel={() => setDialog(null)} extraContent={dialog === 'copy' && <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={duplicate} onChange={event => setDuplicate(event.target.checked)} />再复制一版（已有相同目标时也新建）</label>} />
        </>}
    </div>;
}
