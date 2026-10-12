import { useEffect, useState } from 'react';
import { Film, Loader2, Upload, X } from 'lucide-react';
import type { ProductVideoClipReference } from '../../../shared/productVideoRemix';
import { resolveAssetUrl } from '../../utils/pathManager';

type VideoItem = { id: string; title?: string; mimeType?: string; previewUrl?: string; absolutePath?: string; exists?: boolean };

export function VideoRemixSourcePicker({ onSelect, onCancel }: { onSelect: (clips: ProductVideoClipReference[]) => void; onCancel: () => void }) {
    const [items, setItems] = useState<VideoItem[]>([]);
    const [ids, setIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        void window.ipcRenderer.media.list<{ assets?: VideoItem[] }>({ limit: 1000 }).then((result) => {
            if (active) setItems((result.assets || []).filter((asset) => asset.mimeType?.startsWith('video/') && asset.exists !== false));
        }).catch((error) => { if (active) setError(String(error)); });
        return () => { active = false; };
    }, []);
    const prepare = async (assetIds?: string[]) => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const result = await window.ipcRenderer.videoEditorV2.selectRemixSources<{ success?: boolean; canceled?: boolean; error?: string; clips?: ProductVideoClipReference[] }>(assetIds ? { assetIds } : {});
            if (result.canceled) return;
            if (!result.success || !result.clips?.length) throw new Error(result.error || '未取得可用视频');
            onSelect(result.clips);
        } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="选择混剪视频">
        <section className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-primary shadow-2xl">
            <header className="flex items-center gap-2 border-b border-border px-5 py-4"><Film className="h-4 w-4" /><h2 className="mr-auto text-sm font-semibold">选择已有视频进行混剪</h2><button onClick={onCancel} disabled={busy} aria-label="关闭来源选择"><X className="h-4 w-4" /></button></header>
            <p className="px-5 pt-4 text-xs text-text-tertiary">从当前空间媒体选择，或导入本地自有视频，最多 8 个。下一步读取真实时长并规划截取，确认方案后创建工程；不会自动生成付费媒体。</p>
            {error && <p role="status" className="px-5 pt-3 text-xs text-red-600">{error}</p>}
            <div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">
                {items.map((item) => <label key={item.id} className={`overflow-hidden rounded-xl border p-2 ${ids.includes(item.id) ? 'border-accent-primary' : 'border-border'}`}>
                    <video src={resolveAssetUrl(item.previewUrl || item.absolutePath)} controls muted preload="metadata" className="aspect-video w-full rounded-lg bg-black object-contain" aria-label={`${item.title || '视频'} 预览`} />
                    <span className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={ids.includes(item.id)} disabled={busy || (!ids.includes(item.id) && ids.length >= 8)} onChange={(event) => setIds(event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} /><span className="truncate">{item.title || '未命名视频'}</span></span>
                </label>)}
                {!items.length && <p className="col-span-full py-8 text-center text-xs text-text-tertiary">当前空间还没有视频，可先导入本地片段。</p>}
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-4 text-xs">
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 disabled:opacity-40" disabled={busy} onClick={() => void prepare()}><Upload className="h-3.5 w-3.5" />导入本地视频</button>
                <span className="mr-auto text-text-tertiary">已选择 {ids.length}/8</span>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                <button className="rounded-lg border border-border px-3 py-2" disabled={busy} onClick={onCancel}>取消</button>
                <button className="rounded-lg bg-accent-primary px-3 py-2 font-semibold text-white disabled:opacity-40" disabled={busy || !ids.length} onClick={() => void prepare(ids)}>使用所选视频</button>
            </footer>
        </section>
    </div>;
}
