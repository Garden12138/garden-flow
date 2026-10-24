import { flushCreationBeforeNavigate } from '../workbench/creationNavigation';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CreationWorkspace, CreationCapability } from '../../../shared/creationWorkspace';
import { CREATION_CAPABILITY_LABELS, supportsCreation } from '../../../shared/creationWorkspace';
import { PRODUCT_PLATFORM_LABELS, type ProductPlatform } from '../../../shared/productCreationTarget';
import { dispatchAppIntent } from '../app-shell/appIntent';
import { subscribeDataChanged } from '../../bridge/appEvents';
import { CreationDraftWorkbench } from './CreationDraftWorkbench';
import { ContentEvidencePanel } from './ContentEvidencePanel';
import { ExperimentTaskContextPanel } from './ExperimentTaskContextPanel';
import { CampaignContextPanel } from './CampaignContextPanel';
const VideoWorkbench = lazy(async () => ({ default: (await import('../../pages/VideoProjectWorkbench')).VideoProjectWorkbench }));
const NoteWorkbench = lazy(async () => ({ default: (await import('../../components/manuscripts/ManuscriptEditorHost')).ManuscriptEditorHost }));
export function CreationWorkspaceHost({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
    const [workspace, setWorkspace] = useState<CreationWorkspace | null>(null);
    const [error, setError] = useState(''); const [switching, setSwitching] = useState(false);
    const [platform, setPlatform] = useState<ProductPlatform>('xiaohongshu');
    const [capability, setCapability] = useState<CreationCapability>('note-image');
    const epoch = useRef(0);
    const load = useCallback(async () => {
        const request = ++epoch.current;
        const result = await window.ipcRenderer.creationWorkspace.read(workspaceId);
        if (request !== epoch.current) return;
        if (!result.success || !result.workspace) { setError(result.error || '读取创作失败'); return; }
        setWorkspace(result.workspace);
    }, [workspaceId]);
    useEffect(() => { setWorkspace(null); void load(); return subscribeDataChanged((_event, payload) => { if (payload?.scope === 'creation-workspaces' && payload.entityId === workspaceId) void load(); }); }, [load, workspaceId]);
    useEffect(() => { if (workspace) { setPlatform(workspace.platform); setCapability(workspace.capability); } }, [workspace?.id]);
    const fork = async () => {
        setSwitching(true); setError('');
        try {
            await flushCreationBeforeNavigate();
            const result = await window.ipcRenderer.creationWorkspace.fork(workspaceId, { platform, capability });
            if (!result.success || !result.workspace) throw new Error(result.error || '创建版本失败');
            dispatchAppIntent({ type: 'creation.open', workspaceId: result.workspace.id });
        } catch (reason) { setError(String(reason)); } finally { setSwitching(false); }
    };
    if (!workspace) return <div className="space-y-3 p-6 text-sm"><p>{error || '正在读取创作工作台…'}</p>{error && <button type="button" onClick={onClose}>返回对话</button>}</div>;
    return <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-primary px-3 py-2 text-xs text-text-secondary">
            <span>{PRODUCT_PLATFORM_LABELS[workspace.platform]} · {CREATION_CAPABILITY_LABELS[workspace.capability]}</span>
            {workspace.sourceId && <button type="button" className="underline" onClick={() => dispatchAppIntent({ type: 'creation.open', workspaceId: workspace.sourceId! })}>来源作品</button>}
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2"><select aria-label="新版本平台" className="rounded border border-border bg-surface-primary p-1" value={platform} onChange={event => { const value = event.target.value as ProductPlatform; setPlatform(value); if (!supportsCreation(value, capability)) setCapability('product-video'); }}>{Object.entries(PRODUCT_PLATFORM_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                <select aria-label="新版本创作能力" className="rounded border border-border bg-surface-primary p-1" value={capability} onChange={event => setCapability(event.target.value as CreationCapability)}>{Object.entries(CREATION_CAPABILITY_LABELS).filter(([id]) => supportsCreation(platform, id as CreationCapability)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                <button type="button" disabled={switching} onClick={() => void fork()} className="rounded border border-border px-2 py-1 disabled:opacity-40">另建版本</button><button type="button" onClick={() => void flushCreationBeforeNavigate().then(onClose).catch(reason => setError(String(reason)))} className="rounded border border-border px-2 py-1">返回对话</button></div>
        </div>
        {error && <p role="alert" className="px-3 py-2 text-xs text-red-600">{error}</p>}
        <ContentEvidencePanel workspaceId={workspaceId} />
        <ExperimentTaskContextPanel workspaceId={workspaceId} />
        <CampaignContextPanel workspaceId={workspaceId} />
        <div className="min-h-0 flex-1"><Suspense fallback={<p className="p-4">加载作品…</p>}>{workspace.native?.kind === 'video' ? <VideoWorkbench projectId={workspace.native.projectId} onClose={onClose} /> : workspace.native?.kind === 'note' ? <NoteWorkbench filePath={workspace.native.path} isActive onClose={onClose} /> : <CreationDraftWorkbench key={workspace.id} initial={workspace} onMaterialized={load} />}</Suspense></div>
    </div>;
}
