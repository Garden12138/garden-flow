import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkCatalogItem } from '../../../shared/workCatalog';
import { subscribeDataChanged } from '../../bridge/appEvents';

export function useWorkCatalog(isActive = true) {
    const [items, setItems] = useState<WorkCatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [partial, setPartial] = useState(false);
    const epoch = useRef(0);
    const refresh = useCallback(async () => {
        const token = ++epoch.current; setError('');
        try {
            const result = await window.ipcRenderer.workCatalog.list();
            if (token !== epoch.current) return;
            if (!result.success) throw new Error(result.error || '作品目录加载失败');
            setItems(result.items); setPartial(result.partial);
        } catch (reason) { if (token === epoch.current) setError(String(reason)); }
        finally { if (token === epoch.current) setLoading(false); }
    }, []);
    useEffect(() => {
        if (!isActive) return;
        void refresh();
        const clear = () => { epoch.current++; setItems([]); setLoading(true); void refresh(); };
        window.ipcRenderer.spaces.onChanged(clear);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const unsubscribe = subscribeDataChanged((_event, payload) => {
            if (payload?.scope && !['creation-workspaces', 'manuscripts', 'video-editor-v2'].includes(payload.scope)) return;
            clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150);
        });
        return () => { epoch.current++; clearTimeout(timer); unsubscribe(); window.ipcRenderer.spaces.offChanged(clear); };
    }, [isActive, refresh]);
    return { items, loading, error, partial, refresh };
}
