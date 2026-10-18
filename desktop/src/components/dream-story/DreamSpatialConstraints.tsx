import type { DreamScene } from '../../../shared/dreamStory';

type Spatial = Pick<DreamScene, 'referenceFraming' | 'spatialAnchors'>;
export function DreamSpatialConstraints({ sceneId, value, disabled, onChange }: { sceneId: string; value: Spatial; disabled: boolean; onChange: (value: Spatial) => void }) {
    const anchors = value.spatialAnchors || [];
    const edit = (index: number, patch: Partial<NonNullable<DreamScene['spatialAnchors']>[number]>) => onChange({ ...value, spatialAnchors: anchors.map((anchor, i) => i === index ? { ...anchor, ...patch } : anchor) });
    return <details className="rounded border border-border p-2 text-xs"><summary>机位与空间约束</summary><div className="mt-2 space-y-2">
        <label>参考构图 <select aria-label={`${sceneId}参考构图`} disabled={disabled} value={value.referenceFraming || 'preserve-layout'} className="rounded border border-border bg-surface-primary p-1" onChange={event => onChange({ ...value, referenceFraming: event.target.value as Spatial['referenceFraming'] })}><option value="preserve-layout">沿用空间布局</option><option value="new-shot">换机位，保留物件原位置</option></select></label>
        <p>约束物件数量、原位置及当前状态，避免原物件留在背景、前景又多出一份。模型结果仍需逐幕核对。</p>
        {anchors.map((anchor, index) => <div key={anchor.id} className="grid gap-2 rounded border border-border p-2 sm:grid-cols-2">
            <label>物件<input aria-label={`${sceneId}物件${index + 1}`} className="w-full rounded border border-border bg-surface-primary p-1" disabled={disabled} value={anchor.object} maxLength={300} onChange={event => edit(index, { object: event.target.value })} /></label>
            <label>数量<input aria-label={`${sceneId}数量${index + 1}`} type="number" min={1} max={20} className="w-full rounded border border-border bg-surface-primary p-1" disabled={disabled} value={anchor.count} onChange={event => edit(index, { count: Number(event.target.value) })} /></label>
            <label>原位置<input aria-label={`${sceneId}位置${index + 1}`} className="w-full rounded border border-border bg-surface-primary p-1" disabled={disabled} value={anchor.location} maxLength={1000} onChange={event => edit(index, { location: event.target.value })} /></label>
            <label>本幕状态<input aria-label={`${sceneId}状态${index + 1}`} className="w-full rounded border border-border bg-surface-primary p-1" disabled={disabled} value={anchor.state} maxLength={1000} onChange={event => edit(index, { state: event.target.value })} /></label>
            <button disabled={disabled} onClick={() => onChange({ ...value, spatialAnchors: anchors.filter((_, i) => i !== index) })}>移除此约束</button>
        </div>)}
        <button disabled={disabled || anchors.length >= 12} onClick={() => onChange({ ...value, spatialAnchors: [...anchors, { id: 'anchor_' + crypto.randomUUID(), object: '关键物件', count: 1, location: '原场景中的指定位置', state: '本幕所需状态' }] })}>增加空间约束</button>
    </div></details>;
}
