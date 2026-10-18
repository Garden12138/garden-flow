import type { ImagePromptBudget } from './imagePromptBudget.ts';
import { z } from 'zod';
import { DreamStoryTargetSchema, type DreamStoryTarget } from './contentCreationTarget.ts';

export const DREAM_STORY_TEXT_MAX_REQUESTS = 3;
export const DreamIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value), '标识符不可使用保留对象属性');
export type DreamMediaKind = 'image' | 'audio' | 'video';
const Text = z.string().trim().min(1).max(12000);
export const DreamReferenceCropSchema = z.object({ x: z.number().min(0).lt(1), y: z.number().min(0).lt(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine(value => value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001, '裁切区域不能超出原图');
export type DreamReferenceCrop = z.infer<typeof DreamReferenceCropSchema>;
export interface DreamImageReference { assetId: string; role: string; crop?: DreamReferenceCrop; }
export interface DreamFrozenReference extends DreamImageReference { sha256: string; contentSha256?: string; previewRelativePath?: string; }
export const DreamFragmentSchema = z.object({ id: DreamIdSchema, text: Text, locked: z.boolean().default(false) }).strict();
export const DreamCharacterSchema = z.object({ id: DreamIdSchema, description: Text,
    wardrobe: z.string().max(2000).optional(), props: z.string().max(2000).optional(),
    revision: z.number().int().positive().default(1), referenceAssetIds: z.array(DreamIdSchema).max(10).default([]), referenceCrops: z.record(DreamIdSchema, DreamReferenceCropSchema).optional() }).strict();
export const DreamSettingSchema = z.object({ id: DreamIdSchema, description: Text, referenceAssetIds: z.array(DreamIdSchema).max(10).default([]), referenceCrops: z.record(DreamIdSchema, DreamReferenceCropSchema).optional(), revision: z.number().int().positive().default(1) }).strict();
export const DreamSceneSchema = z.object({
    id: DreamIdSchema, fragmentIds: z.array(DreamIdSchema).max(100).default([]), characterIds: z.array(DreamIdSchema).max(20).default([]),
    settingId: DreamIdSchema.optional(), continuity: z.enum(['continue', 'cut']).optional(),
    referenceFraming: z.enum(['preserve-layout', 'new-shot']).optional(),
    spatialAnchors: z.array(z.object({ id: DreamIdSchema, object: z.string().trim().min(1).max(300), count: z.number().int().min(1).max(20), location: z.string().trim().min(1).max(1000), state: z.string().trim().min(1).max(1000) }).strict()).max(12).optional(),
    mediaType: z.enum(['image', 'video']).optional(), videoPrompt: z.string().max(12000).optional(), videoReason: z.string().max(2000).optional(),
    visual: Text, narration: z.string().max(12000), imagePrompt: Text,
    imagePromptMode: z.enum(['context', 'scene']).optional(),
    imageReferenceMode: z.enum(['baselines', 'previous']).optional(),
    plannedDurationMs: z.number().int().min(1000).max(90000),
    motion: z.enum(['static', 'slow-zoom-in', 'slow-zoom-out', 'pan-left', 'pan-right']).default('slow-zoom-in'),
    locked: z.boolean().default(false),
}).strict();
export const DreamDirectorPackageSchema = z.object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]), settings: z.array(DreamSettingSchema).max(20).optional(), title: z.string().trim().min(1).max(200), language: z.string().min(2).max(35),
    story: Text, emotionalArc: z.array(Text).min(1).max(12),
    preservedFragmentIds: z.array(DreamIdSchema).max(100), creativeAdditions: z.array(Text).max(100),
    visualStyle: Text, characters: z.array(DreamCharacterSchema).max(20), scenes: z.array(DreamSceneSchema).length(8),
    publication: z.object({ description: z.string().max(4000), hashtags: z.array(z.string().max(80)).max(30) }).strict(),
}).strict().superRefine((value, context) => {
    for (const key of ['scenes', 'characters'] as const) if (new Set(value[key].map(item => item.id)).size !== value[key].length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${key} ID 重复` });
    if (value.settings && new Set(value.settings.map(item => item.id)).size !== value.settings.length) context.addIssue({ code: z.ZodIssueCode.custom, message: '场景 ID 重复' });
    if (value.schemaVersion === 2 && value.scenes.some((scene, index) => !scene.settingId || !value.settings?.some(setting => setting.id === scene.settingId) || !scene.continuity || !scene.mediaType || (index === 0 && scene.continuity !== 'cut') || (scene.mediaType === 'video' && (!scene.videoPrompt?.trim() || !scene.videoReason?.trim())))) context.addIssue({ code: z.ZodIssueCode.custom, message: '新版分镜需要场景、连续关系、媒体类型和视频动作描述；第一幕必须切场' });
    if (value.schemaVersion === 2 && value.scenes.some((scene, index) => scene.continuity === 'continue' && scene.settingId !== value.scenes[index - 1]?.settingId)) context.addIssue({ code: z.ZodIssueCode.custom, message: '连续镜头只能沿用前幕场景，换场请选择cut' });
    for (const owner of [...value.characters, ...(value.settings || [])]) {
        if (Object.keys(owner.referenceCrops || {}).some(id => !owner.referenceAssetIds.includes(id))) context.addIssue({ code: z.ZodIssueCode.custom, message: '裁切只能绑定已选择的参考图' });
    }
    for (const scene of value.scenes) if (new Set(scene.spatialAnchors?.map(anchor => anchor.id)).size !== (scene.spatialAnchors?.length || 0)) context.addIssue({ code: z.ZodIssueCode.custom, message: '空间约束 ID 重复' });
    if (value.scenes.some((scene, index) => scene.imageReferenceMode === 'previous' && (index === 0 || scene.continuity !== 'continue'))) context.addIssue({ code: z.ZodIssueCode.custom, message: '仅上一幕参考只能用于延续前一幕的镜头' });
    const ids = new Set(value.characters.map(item => item.id));
    if (value.scenes.some(scene => scene.characterIds.some(id => !ids.has(id)))) context.addIssue({ code: z.ZodIssueCode.custom, message: '角色引用不存在' });
});
export type DreamDirectorPackage = z.infer<typeof DreamDirectorPackageSchema>;
export type DreamScene = z.infer<typeof DreamSceneSchema>;
export type DreamFragment = z.infer<typeof DreamFragmentSchema>;
export interface DreamMediaBinding {
    assetId?: string; inputDigest: string; jobId?: string; fileSha256?: string; approvedDigest?: string;
    references?: DreamFrozenReference[];
    status: 'queued' | 'generating' | 'ready' | 'stale' | 'failed' | 'interrupted' | 'unknown'; error?: string; durationMs?: number;
}
export interface DreamStoryVersion {
    id: string; createdAt: string; label: string; director?: DreamDirectorPackage;
    target?: DreamStoryTarget; fragments: DreamFragment[];
    media?: DreamStoryDocument['media']; musicAssetId?: string; musicVolume?: number; voiceVolume?: number;
    captions?: DreamStoryDocument['captions']; style?: string; dreamDate?: string; emotion?: string;
    storyAdopted?: boolean; storyboardAdopted?: boolean; stage?: DreamStoryDocument['stage'];
}
export interface DreamStoryCandidate {
    id: string; basedOnRevision: string; draftEpoch: number; targetDigest: string;
    director: DreamDirectorPackage; createdAt: string; calls: number; adoptedAt?: string;
}
export interface DreamStoryDocument {
    schemaVersion: 1 | 2; spaceId: string; workId?: string; revision: string; draftEpoch: number; dirty: boolean;
    fragments: DreamFragment[]; dreamDate?: string; emotion?: string; fidelity: 'preserve-dream' | 'adapt-freely';
    style: string; target?: DreamStoryTarget; targetDigest?: string;
    stage: 'record' | 'story' | 'storyboard' | 'media' | 'export' | 'publish';
    director?: DreamDirectorPackage; candidates: DreamStoryCandidate[]; versions: DreamStoryVersion[];
    storyAdopted: boolean; storyboardAdopted: boolean; recordReviewRequired?: boolean; storySyncRequired?: boolean;
    media: Record<string, { image?: DreamMediaBinding; audio?: DreamMediaBinding; video?: DreamMediaBinding }>;
    mediaCandidates?: Array<{ sceneId: string; kind: DreamMediaKind; assetId: string; inputDigest: string; jobId?: string }>;
    reconciledMediaJobIds?: string[];
    musicAssetId?: string; musicVolume: number; voiceVolume: number;
    captions?: Array<{ sceneId: string; text: string; startMs: number; endMs: number }>;
    undo: DreamStoryVersion[]; provenance?: { kind: 'legacy-director-package'; digest: string };
}
export const DreamEditOperationSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('record.save'), fragments: z.array(DreamFragmentSchema).min(1).max(100), dreamDate: z.string().max(40).optional(), emotion: z.string().max(1000).optional(), style: z.string().max(2000).optional() }).strict(),
    z.object({ type: z.literal('target.confirm'), target: DreamStoryTargetSchema }).strict(),
    z.object({ type: z.literal('story.update'), story: Text }).strict(),
    z.object({ type: z.literal('director.update'), title: z.string().trim().min(1).max(200).optional(), visualStyle: Text.optional(), characters: z.array(DreamCharacterSchema).max(20).optional(), settings: z.array(DreamSettingSchema).max(20).optional() }).strict(),
    z.object({ type: z.literal('publication.copy'), title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(4000), hashtags: z.array(z.string().regex(/^[\p{L}\p{N}_]+$/u).max(80)).max(30) }).strict(),
    z.object({ type: z.literal('scene.update'), sceneId: DreamIdSchema, changes: DreamSceneSchema.omit({ id: true }).partial().strict() }).strict(),
    z.object({ type: z.literal('reference.bind'), ownerKind: z.enum(['character', 'setting']), ownerId: DreamIdSchema, assetIds: z.array(DreamIdSchema).max(10), crops: z.record(DreamIdSchema, DreamReferenceCropSchema).optional() }).strict(),
    z.object({ type: z.literal('scene.order'), sceneIds: z.array(DreamIdSchema).length(8) }).strict(),
    z.object({ type: z.literal('candidate.adopt'), candidateId: DreamIdSchema }).strict(),
    z.object({ type: z.literal('story.adopt') }).strict(),
    z.object({ type: z.literal('storyboard.adopt') }).strict(),
    z.object({ type: z.literal('version.restore'), versionId: DreamIdSchema }).strict(),
    z.object({ type: z.literal('undo') }).strict(),
    z.object({ type: z.literal('mix.update'), musicVolume: z.number().min(0).max(1), voiceVolume: z.number().min(0).max(1) }).strict(),
    z.object({ type: z.literal('music.remove') }).strict(),
    z.object({ type: z.literal('captions.update'), captions: z.array(z.object({ sceneId: DreamIdSchema, text: z.string().max(2000), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict()).max(1000) }).strict(),
]);
export type DreamEditOperation = z.infer<typeof DreamEditOperationSchema>;
export const DreamRequestSchema = z.object({ spaceId: DreamIdSchema, projectId: DreamIdSchema, requestId: DreamIdSchema,
    expectedRevision: z.string().min(1).max(160), expectedDraftEpoch: z.number().int().nonnegative(), targetDigest: z.string().max(160).optional() }).strict();
export const DreamEditRequestSchema = DreamRequestSchema.extend({ operations: z.array(DreamEditOperationSchema).min(1).max(40) });
export type DreamRequest = z.infer<typeof DreamRequestSchema>;
export type DreamEditRequest = z.infer<typeof DreamEditRequestSchema>;
export type DreamStoryContext = DreamRequest & { workflowKind: 'dream-story-create' | 'dream-story-edit'; targetDigest: string; selectedSceneId?: string };
export class DreamContractError extends Error {}

export function validateDreamDirector(value: unknown, fragments: DreamFragment[], target?: DreamStoryTarget): DreamDirectorPackage {
    const director = DreamDirectorPackageSchema.parse(value);
    const ids = new Set(fragments.map(item => item.id));
    if ([...director.preservedFragmentIds, ...director.scenes.flatMap(scene => scene.fragmentIds)].some(id => !ids.has(id))) throw new DreamContractError('原始片段引用不存在');
    if (fragments.some(fragment => fragment.locked && !director.preservedFragmentIds.includes(fragment.id))) throw new DreamContractError('导演包遗漏锁定意象');
    if (target && director.language !== target.language) throw new DreamContractError('导演包语言与已确认目标不一致');
    if (target?.narration && director.scenes.some(scene => !scene.narration.trim())) throw new DreamContractError('有声模式需要逐幕旁白');
    if (target?.profileVersion === 2) {
        if (director.schemaVersion !== 2) throw new DreamContractError('请由导演适配新版连续性分镜');
        if (target.compositionMode === 'story-keyframes' && director.scenes.some(scene => scene.mediaType !== 'image')) throw new DreamContractError('全图片模式需要八幕图片');
        if (target.compositionMode === 'story-video' && director.scenes.some(scene => scene.mediaType !== 'video')) throw new DreamContractError('全视频模式需要八幕视频');
    }
    if (target) { const duration = director.scenes.reduce((sum, scene) => sum + scene.plannedDurationMs, 0);
        if (duration < 60000 || duration > 90000) throw new DreamContractError('八幕计划总时长需要在 60–90 秒内'); }
    return director;
}

/** Stable, canonical input serialization; hashing belongs to the main process. */
export function dreamCanonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(dreamCanonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + dreamCanonical(v)).join(',') + '}';
    return JSON.stringify(value) ?? 'null';
}

export function dreamReferenceAssets(document: DreamStoryDocument, scene: DreamScene): DreamImageReference[] {
    const director = document.director;
    if (!director) return [];
    if (scene.imageReferenceMode === 'previous') {
        const previous = director.scenes[director.scenes.findIndex(item => item.id === scene.id) - 1];
        const image = previous && document.media[previous.id]?.image;
        return scene.continuity === 'continue' && image?.assetId ? [{ assetId: image.assetId, role: 'previous:' + previous.id }] : [];
    }
    const refs: DreamImageReference[] = director.characters.filter(item => scene.characterIds.includes(item.id)).flatMap(item => item.referenceAssetIds.map(assetId => ({ assetId, role: 'character:' + item.id, crop: item.referenceCrops?.[assetId] })));
    const setting = director.settings?.find(item => item.id === scene.settingId);
    refs.push(...(setting?.referenceAssetIds || []).map(assetId => ({ assetId, role: 'setting:' + setting!.id, crop: setting!.referenceCrops?.[assetId] })));
    const index = director.scenes.findIndex(item => item.id === scene.id);
    const previous = director.scenes[index - 1];
    if (document.schemaVersion === 2 && scene.continuity === 'continue' && previous) {
        const image = document.media[previous.id]?.image;
        if (image?.assetId) refs.push({ assetId: image.assetId, role: 'previous:' + previous.id });
    }
    const merged = new Map<string, DreamImageReference>();
    for (const ref of refs) { const key = ref.assetId + ':' + dreamCanonical(ref.crop || null); const previousRef = merged.get(key); merged.set(key, { ...ref, role: previousRef ? previousRef.role + ',' + ref.role : ref.role }); }
    return [...merged.values()];
}
export function dreamSceneInput(document: DreamStoryDocument, scene: DreamScene, kind: DreamMediaKind): unknown {
    const target = document.target;
    if (kind === 'audio') return { narration: scene.narration, language: target?.language, voiceId: target?.voiceId };
    if (kind === 'video') return { keyframe: document.media[scene.id]?.image, prompt: scene.videoPrompt, mediaType: scene.mediaType,
        durationMs: Math.max(scene.plannedDurationMs, target?.narration ? document.media[scene.id]?.audio?.durationMs || 0 : 0), spec: target?.spec };
    const previous = document.director?.scenes[(document.director?.scenes.findIndex(item => item.id === scene.id) || 0) - 1];
    return { visual: scene.visual, prompt: scene.imagePrompt, ...(scene.imagePromptMode ? { imagePromptMode: scene.imagePromptMode } : {}), ...(scene.imageReferenceMode ? { imageReferenceMode: scene.imageReferenceMode } : {}), style: document.director?.visualStyle,
        characters: document.director?.characters.filter(item => scene.characterIds.includes(item.id)), spec: target?.spec,
        ...(document.schemaVersion === 2 ? { setting: document.director?.settings?.find(item => item.id === scene.settingId), continuity: scene.continuity, referenceFraming: scene.referenceFraming, spatialAnchors: scene.spatialAnchors,
            references: dreamReferenceAssets(document, scene), previous: scene.continuity === 'continue' && previous ? document.media[previous.id]?.image : undefined } : {}) };
}

export interface DreamMediaBatch {
    id: string; projectId: string; spaceId: string; revision: string; targetDigest: string; kind: DreamMediaKind;
    sceneIds: string[]; inputDigests: Record<string, string>; routeDigest: string; provider: string; model: string;
    selectionAssetIds?: Record<string, string>;
    referencesByScene?: Record<string, DreamFrozenReference[]>;
    imagePromptVersion?: number; imagePromptExtend?: false;
    imagePromptModesByScene?: Record<string, 'context' | 'scene'>;
    imageReferenceModesByScene?: Record<string, 'baselines' | 'previous'>;
    imagePromptsByScene?: Record<string, string>; imagePromptChecks?: Record<string, ImagePromptBudget>;
    videoSeconds?: Record<string, number>; resolution?: '720p' | '1080p';
    count: number; maxRequests: number; audioCharacters?: number; voiceId?: string; referenceAssetIds: string[]; state: 'preview' | 'accepted' | 'completed' | 'interrupted' | 'cancelled';
    jobs: Record<string, string>; errors: Record<string, string>; createdAt: number;
}
