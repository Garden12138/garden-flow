import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import type { DreamEditOperation } from '../../../shared/dreamStory';
import { DreamReferenceCropEditor, DreamReferenceThumbnail } from './DreamReferenceCrop';

export function DreamContinuityPanel({ project, disabled, onEdit, onImport, onTrial }: {
    project: VideoEditorV2Project; disabled: boolean; onEdit: (operations: DreamEditOperation[]) => void;
    onImport: (owner: { kind: 'character' | 'setting'; id: string }) => void; onTrial: () => void;
}) {
    const doc = project.dreamStory!;
    if (doc.schemaVersion !== 2 || !doc.director) return null;
    const owners = [...doc.director.characters.map(item => ({ ...item, kind: 'character' as const })), ...(doc.director.settings || []).map(item => ({ ...item, kind: 'setting' as const }))];
    const approvedIds = new Set(Object.values(doc.media).filter(item => item.image?.status === 'ready' && item.image.approvedDigest).map(item => item.image!.assetId));
    return <section aria-label="连续性参考" className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold">人物与场景基准</h3>
        <p className="text-xs text-text-tertiary">固定参考贯穿后续分镜；连续镜头还会沿用上一幕已确认画面。切场只保留人物与画风，不继承旧背景。参考约束不能保证人物绝对一致。</p>
        <button className="rounded border border-border px-3 py-2 text-xs" disabled={disabled} onClick={onTrial}>先试一幕，确认后可设为基准（先核对调用）</button>
        {owners.map(owner => <div key={owner.kind + owner.id} className="space-y-2 rounded border border-border p-3 text-xs">
            <strong>{owner.kind === 'character' ? '人物' : '场景'} · {owner.id}</strong><p>{owner.description}</p>
            <div className="flex flex-wrap gap-3">{owner.referenceAssetIds.map(id => { const asset = project.assets.find(item => item.id === id); return <figure key={id} className="max-w-sm space-y-1">{asset && <><DreamReferenceThumbnail asset={asset} crop={owner.referenceCrops?.[id]} alt={`${owner.id}参考`} /><DreamReferenceCropEditor asset={asset} crop={owner.referenceCrops?.[id]} disabled={disabled} label={owner.id} onSave={crop => { const crops = { ...owner.referenceCrops }; if (crop) crops[id] = crop; else delete crops[id]; onEdit([{ type: 'reference.bind', ownerKind: owner.kind, ownerId: owner.id, assetIds: owner.referenceAssetIds, crops }]); }} /></>}<button disabled={disabled} onClick={() => onEdit([{ type: 'reference.bind', ownerKind: owner.kind, ownerId: owner.id, assetIds: owner.referenceAssetIds.filter(value => value !== id) }])}>移除参考</button></figure>; })}</div>
            <button disabled={disabled} className="rounded border border-border px-3 py-2" onClick={() => onImport({ kind: owner.kind, id: owner.id })}>导入此{owner.kind === 'character' ? '人物' : '场景'}参考</button>
            <select aria-label={`${owner.id}采用已确认画面为参考`} disabled={disabled} className="ml-2 rounded border border-border bg-surface-primary p-2" value="" onChange={event => { if (event.target.value) onEdit([{ type: 'reference.bind', ownerKind: owner.kind, ownerId: owner.id, assetIds: [...new Set([...owner.referenceAssetIds, event.target.value])] }]); }}><option value="">采用已确认画面为基准…</option>{project.assets.filter(item => approvedIds.has(item.id) && !owner.referenceAssetIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{doc.director!.scenes.findIndex(scene => doc.media[scene.id]?.image?.assetId === item.id) + 1} 幕已确认画面</option>)}</select>
        </div>)}
        {!owners.length && <p className="text-xs">请先由导演补齐角色与场景设定并采用新版分镜。</p>}
    </section>;
}
