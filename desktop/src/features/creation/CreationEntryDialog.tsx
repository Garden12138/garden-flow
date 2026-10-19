import { useEffect, useRef, useState } from 'react';
import type { AppIntent } from '../app-shell/types';
import { dispatchAppIntent } from '../app-shell/appIntent';
import { supportsCreation, CREATION_CAPABILITY_LABELS } from '../../../shared/creationWorkspace';
import { PRODUCT_PLATFORM_LABELS, type ProductPlatform } from '../../../shared/productCreationTarget';
import type { SourceRef } from '../../../shared/noteCards';

export function CreationEntryDialog({ intent, onClose }: { intent: Extract<AppIntent, { type: 'creation.prepare' }>; onClose: () => void }) {
    const [platform, setPlatform] = useState<ProductPlatform | ''>(intent.platform && supportsCreation(intent.platform, intent.capability) ? intent.platform : ''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const automaticallyStarted = useRef(false);
    useEffect(() => { if (!automaticallyStarted.current && intent.platform && supportsCreation(intent.platform, intent.capability)) { automaticallyStarted.current = true; void start(); } }, []);
    const requestId = useRef(crypto.randomUUID()); const imported = useRef<SourceRef[]>([]);
    const start = async () => {
        if (!platform || busy) return; setBusy(true); setError('');
        try {
            for (let index = imported.current.length; index < (intent.sourceInputs?.length || 0); index++) {
                const result = await window.ipcRenderer.noteCard.importSource(intent.sourceInputs![index]);
                if (!result.success || !result.result) throw new Error(result.error || '保存来源失败');
                imported.current.push({ id: result.result.id, version: result.result.version, name: result.result.name });
            }
            dispatchAppIntent({ type: 'creation.start', platform, capability: intent.capability, presetId: intent.presetId, sourceRefs: imported.current, productId: intent.productId, sourceSessionId: intent.sourceSessionId, requestId: requestId.current, entry: intent.productId ? 'product' : intent.sourceInputs?.length ? 'document' : 'conversation', brief: intent.brief });
            onClose();
        } catch (reason) { setError(String(reason)); setBusy(false); }
    };
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true" aria-label="选择创作平台"><div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface-primary p-5 text-text-primary"><h2 className="font-semibold">选择平台 · {CREATION_CAPABILITY_LABELS[intent.capability]}</h2><p className="text-sm text-text-secondary">创建可保存作品后，可继续填写、聊天和选择创作方式。</p><div className="flex gap-2">{Object.entries(PRODUCT_PLATFORM_LABELS).filter(([id]) => supportsCreation(id, intent.capability)).map(([id, label]) => <button key={id} className={`rounded-lg border px-3 py-2 text-sm ${platform === id ? 'border-accent-primary' : 'border-border'}`} disabled={busy} onClick={() => setPlatform(id as ProductPlatform)}>{label}</button>)}</div>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<div className="flex justify-end gap-2"><button className="rounded-lg border border-border px-3 py-2 text-sm" disabled={busy} onClick={onClose}>取消</button><button className="rounded-lg bg-accent-primary px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!platform || busy} onClick={() => void start()}>{busy ? '正在保存来源…' : '创建作品'}</button></div></div></div>;
}
