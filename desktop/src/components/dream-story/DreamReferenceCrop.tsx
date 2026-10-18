import { useState } from 'react';
import type { DreamReferenceCrop } from '../../../shared/dreamStory';
import { DreamReferenceCropSchema } from '../../../shared/dreamStory';
import type { MediaAssetRecord } from '../../../shared/videoAutoEdit';
import { resolveAssetUrl } from '../../utils/pathManager';

export function DreamReferenceThumbnail({ asset, crop, alt }: { asset: MediaAssetRecord; crop?: DreamReferenceCrop; alt: string }) {
    const [size, setSize] = useState({ width: asset.width || 1, height: asset.height || 1 });
    const measure = (image: HTMLImageElement) => { if (image.naturalWidth && image.naturalHeight && (size.width !== image.naturalWidth || size.height !== image.naturalHeight)) setSize({ width: image.naturalWidth, height: image.naturalHeight }); };
    if (!crop) return <img className="h-24 w-16 rounded object-contain" src={resolveAssetUrl(asset.projectPath)} onLoad={event => measure(event.currentTarget)} alt={alt} />;
    const aspect = (size.width * crop.width) / (size.height * crop.height);
    return <div className="relative shrink-0 overflow-hidden rounded" style={{ width: Math.min(240, 96 * aspect), height: Math.min(96, 240 / aspect) }} role="img" aria-label={alt}>
        <img alt="" src={resolveAssetUrl(asset.projectPath)} onLoad={event => measure(event.currentTarget)} className="absolute max-w-none" style={{ width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-crop.x * 100 / crop.width}%`, top: `${-crop.y * 100 / crop.height}%` }} />
    </div>;
}
export function DreamReferenceCropEditor({ asset, crop, disabled, label, onSave }: { asset: MediaAssetRecord; crop?: DreamReferenceCrop; disabled: boolean; label: string; onSave: (crop?: DreamReferenceCrop) => void }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DreamReferenceCrop>(crop || { x: 0, y: 0, width: 1, height: 1 });
    const valid = DreamReferenceCropSchema.safeParse(draft).success && (!asset.width || Math.round(draft.width * asset.width) >= 32) && (!asset.height || Math.round(draft.height * asset.height) >= 32);
    return <div className="text-xs"><button disabled={disabled} onClick={() => { setDraft(crop || { x: 0, y: 0, width: 1, height: 1 }); setOpen(!open); }}>裁切此参考</button>
        {open && <section className="mt-2 space-y-2 rounded border border-border bg-surface-primary p-3" aria-label={`${label}参考裁切`}>
            <p>仅本地裁切，不调用模型。人物参考保留头部与服装；场景参考可避开人物和临时道具。改变参考会使依赖它的画面过期。</p>
            {valid && <DreamReferenceThumbnail asset={asset} crop={draft} alt={`${label}裁切预览`} />}
            <div className="grid grid-cols-2 gap-2">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: '左侧', y: '顶部', width: '宽度', height: '高度' })[key]} %<input aria-label={`${label}裁切${key}`} type="number" min={0} max={100} step={1} className="w-full rounded border border-border bg-surface-primary p-1" value={Math.round(draft[key] * 10000) / 100} onChange={event => setDraft(old => ({ ...old, [key]: Number(event.target.value) / 100 }))} /></label>)}</div>
            {!valid && <p className="text-red-600">裁切需在原图内，且至少32×32像素。</p>}
            <button disabled={disabled || !valid} className="rounded border border-border px-2 py-1" onClick={() => { onSave(draft); setOpen(false); }}>保存参考裁切</button>
            <button disabled={disabled} className="ml-2" onClick={() => { onSave(undefined); setOpen(false); }}>恢复整图</button><button className="ml-2" onClick={() => setOpen(false)}>取消</button>
        </section>}
    </div>;
}
