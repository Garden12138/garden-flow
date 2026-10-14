import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ProductProjectEditorRef, ProductProjectEditorSnapshot } from '../../../shared/productProjectEditor';
import { subscribeDataChanged } from '../../bridge/appEvents';

export interface ProductEditorController {
    sessionId: string | null;
    snapshot: ProductProjectEditorSnapshot | null;
    error: string;
    markDirty: () => void;
    settleDraft: () => Promise<void>;
    registerFlush: (name: string, flush: () => Promise<unknown>) => () => void;
    select: (id?: string) => void;
    beforeSend: () => Promise<Record<string, unknown>>;
}
export const ProductEditorContext = createContext<ProductEditorController | null>(null);
export const useProductEditorContext = () => useContext(ProductEditorContext);

/** Each controller stays bound to its mounted project, including asynchronous sends. */
export function useProductEditor(project: ProductProjectEditorRef | null): ProductEditorController {
    const key = JSON.stringify(project);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<ProductProjectEditorSnapshot | null>(null);
    const [error, setError] = useState('');
    const selected = useRef<string | undefined>(undefined);
    const flushers = useRef(new Map<string, () => Promise<unknown>>());
    const pending = useRef<Promise<void>>(Promise.resolve());
    const dirty = useRef(false);
    const localEpoch = useRef(0);
    const alive = useRef(true);
    const draftError = useRef('');
    const boundProject = useMemo(() => project, [key]);
    useEffect(() => {
        alive.current = true;
        setSessionId(null); setSnapshot(null); setError('');
        if (!boundProject) return;
        let active = true;
        void (async () => {
            const result = await window.ipcRenderer.videoEditorV2.getProductEditorSession({ project: boundProject });
            if (!result.success || !result.sessionId || !result.snapshot) throw new Error(result.error || '初始化编辑会话失败');
            if (!active) return;
            setSessionId(result.sessionId); setSnapshot(result.snapshot);
            // A cold start has no recovered unsaved input. Never clear an input made during initialization.
            if (!dirty.current) {
                const cleared = await window.ipcRenderer.videoEditorV2.syncProductEditorDraft({ project: boundProject, dirty: false });
                if (!cleared.success) throw new Error(cleared.error || '同步草稿失败');
            }
        })().catch(reason => { if (active) setError(String(reason)); });
        return () => { active = false; alive.current = false; };
    }, [boundProject]);
    useEffect(() => {
        if (!boundProject) return;
        let active = true;
        const dispose = subscribeDataChanged((_event, payload) => {
            const matches = boundProject.kind === 'video' ? payload?.scope === 'video-editor-v2' && payload.entityId === boundProject.projectId
                : payload?.scope === 'manuscripts';
            if (matches) void window.ipcRenderer.videoEditorV2.getProductEditorSession({ project: boundProject }).then(result => {
                if (active && result.success && result.snapshot) setSnapshot(result.snapshot);
            });
        });
        return () => { active = false; dispose(); };
    }, [boundProject]);

    const markDirty = useCallback(() => {
        if (!boundProject) return;
        dirty.current = true;
        localEpoch.current++;
        pending.current = pending.current.then(async () => {
            const result = await window.ipcRenderer.videoEditorV2.syncProductEditorDraft({ project: boundProject, dirty: true });
            if (!result.success) throw new Error(result.error || '同步输入状态失败');
        }).catch(reason => { draftError.current = String(reason); setError(String(reason)); });
    }, [boundProject]);
    const settleDraft = useCallback(async () => {
        await pending.current;
        if (draftError.current) throw new Error(draftError.current);
    }, []);
    const beforeSend = useCallback(async () => {
        if (!boundProject) throw new Error('没有绑定工程');
        const sendingEpoch = localEpoch.current;
        await settleDraft();
        if (sendingEpoch !== localEpoch.current) throw new Error('保存期间出现新输入，已保留草稿，请重新发送');
        const ordered = [...flushers.current.entries()].sort(([left], [right]) => Number(right === 'video-scenes') - Number(left === 'video-scenes'));
        for (const [, flush] of ordered) await flush();
        await settleDraft();
        if (sendingEpoch !== localEpoch.current) throw new Error('保存期间出现新输入，已保留草稿，请重新发送');
        if (!alive.current) throw new Error('工程已关闭；消息未发送');
        const cleared = await window.ipcRenderer.videoEditorV2.syncProductEditorDraft({ project: boundProject, dirty: false });
        if (!cleared.success) throw new Error(cleared.error || '同步保存状态失败');
        dirty.current = false;
        const result = await window.ipcRenderer.videoEditorV2.readProductEditor({ project: boundProject, selectedId: selected.current });
        if (!result.success || !result.snapshot || result.snapshot.dirty) throw new Error(result.error || '请先保存当前输入');
        if (sendingEpoch !== localEpoch.current || !alive.current) throw new Error('工程或输入已变化，已保留草稿，请重新发送');
        setSnapshot(result.snapshot);
        return { workflowKind: 'product-project-edit', productProjectEditorTurn: { binding: result.snapshot.binding, requestId: crypto.randomUUID(),
            expectedRevision: result.snapshot.revision, expectedDraftEpoch: result.snapshot.draftEpoch } };
    }, [boundProject, settleDraft]);
    const registerFlush = useCallback((name: string, flush: () => Promise<unknown>) => {
        flushers.current.set(name, flush);
        return () => { if (flushers.current.get(name) === flush) flushers.current.delete(name); };
    }, []);
    return { sessionId, snapshot, error, markDirty, settleDraft, registerFlush, select: id => { selected.current = id; }, beforeSend };
}
