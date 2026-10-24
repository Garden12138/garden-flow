import { dreamReferenceAssets, type DreamScene, type DreamImageReference } from './dreamStory.ts';
import type { VideoEditorV2Project } from './videoAutoEdit.ts';

export interface DreamContinuityFinding {
    code: 'previous-not-confirmed' | 'character-baseline-missing' | 'setting-baseline-missing' | 'reference-not-registered' | 'spatial-declaration-changed';
    sceneId: string; relatedSceneId?: string; ownerId?: string; message: string;
}
export interface DreamSpatialChange {
    id: string; previous: NonNullable<DreamScene['spatialAnchors']>[number] | null;
    current: NonNullable<DreamScene['spatialAnchors']>[number] | null;
}
export interface DreamContinuityShot {
    sceneId: string; index: number; visual: string; settingId?: string; characterIds: string[];
    transition: 'continue' | 'cut' | 'legacy-unrecorded'; referenceMode: 'baselines' | 'previous';
    references: DreamImageReference[]; spatialChanges: DreamSpatialChange[];
    predecessor?: { sceneId: string; confirmation: 'registered-confirmed' | 'not-confirmed' };
}
export interface DreamContinuityReport {
    projectId: string; spaceId: string; revision: string; schemaVersion: 1 | 2;
    state: 'not-planned' | 'needs-review' | 'no-structural-finding';
    fileIntegrity: 'not-checked'; visualConsistency: 'not-checked';
    shots: DreamContinuityShot[]; findings: DreamContinuityFinding[];
}

/** Read-only metadata review. Generation authorization and actual reference-file checks remain in the existing main-process service. */
export function reviewDreamContinuity(project: Pick<VideoEditorV2Project, 'id' | 'dreamStory' | 'assets'>): DreamContinuityReport | null {
    const doc = project.dreamStory; if (!doc) return null;
    const report: DreamContinuityReport = { projectId: project.id, spaceId: doc.spaceId, revision: doc.revision, schemaVersion: doc.schemaVersion,
        state: 'not-planned', fileIntegrity: 'not-checked', visualConsistency: 'not-checked', shots: [], findings: [] };
    const director = doc.director; if (!director) return report;
    const imageIds = new Set(project.assets.filter(asset => asset.kind === 'image').map(asset => asset.id));
    for (const [index, scene] of director.scenes.entries()) {
        const previous = director.scenes[index - 1]; const preceding = director.scenes.slice(0, index);
        const shot: DreamContinuityShot = { sceneId: scene.id, index, visual: scene.visual, settingId: scene.settingId, characterIds: [...scene.characterIds],
            transition: doc.schemaVersion === 1 ? 'legacy-unrecorded' : scene.continuity || 'cut', referenceMode: scene.imageReferenceMode || 'baselines',
            references: dreamReferenceAssets(doc, scene), spatialChanges: [] };
        const add = (finding: Omit<DreamContinuityFinding, 'sceneId'>) => report.findings.push({ sceneId: scene.id, ...finding });
        if (doc.schemaVersion === 2) {
            if (scene.continuity === 'continue' && previous) {
                const image = doc.media[previous.id]?.image;
                const confirmed = Boolean(image?.assetId && image.status === 'ready' && image.approvedDigest);
                shot.predecessor = { sceneId: previous.id, confirmation: confirmed ? 'registered-confirmed' : 'not-confirmed' };
                if (!confirmed) add({ code: 'previous-not-confirmed', relatedSceneId: previous.id, message: '前一幕画面尚未登记为已确认，请先逐幕核对；不能预授权尚未产生的参考。' });
                const before = new Map((previous.spatialAnchors || []).map(anchor => [anchor.id, anchor])); const after = new Map((scene.spatialAnchors || []).map(anchor => [anchor.id, anchor]));
                for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
                    const a = before.get(id); const b = after.get(id);
                    if (a && b && a.object === b.object && a.count === b.count && a.location === b.location && a.state === b.state) continue;
                    shot.spatialChanges.push({ id, previous: a ? { ...a } : null, current: b ? { ...b } : null });
                }
                if (shot.spatialChanges.length) add({ code: 'spatial-declaration-changed', relatedSceneId: previous.id, message: '本幕空间约束与前幕登记不同。请核对是否为有意的剧情推进；这不表示画面存在错误。' });
            }
            if (scene.imageReferenceMode !== 'previous') {
                for (const character of director.characters.filter(item => scene.characterIds.includes(item.id))) {
                    if (preceding.some(item => item.characterIds.includes(character.id)) && !character.referenceAssetIds.length) add({ code: 'character-baseline-missing', ownerId: character.id, message: `重复出现的人物 ${character.id} 尚未指定固定参考。` });
                }
                const setting = director.settings?.find(item => item.id === scene.settingId);
                if (preceding.some(item => item.settingId === scene.settingId) && !setting?.referenceAssetIds.length) add({ code: 'setting-baseline-missing', ownerId: scene.settingId, message: '重复出现的场景尚未指定固定参考。' });
            }
        }
        for (const reference of shot.references) if (!imageIds.has(reference.assetId)) add({ code: 'reference-not-registered', ownerId: reference.assetId, message: '本幕引用的图片不在当前工程已登记图片中，请核对参考归属。' });
        report.shots.push(shot);
    }
    report.state = report.findings.length ? 'needs-review' : 'no-structural-finding'; return report;
}
