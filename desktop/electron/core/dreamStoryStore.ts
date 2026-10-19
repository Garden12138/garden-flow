import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinRoots } from './localAssetManager';
import { createHash, randomUUID } from 'node:crypto';
import {
    getWorkspacePaths, runInWorkspaceSpace, getStoryProjectOperation, prepareStoryProjectOperation,
    finishStoryProjectOperation, listUnfinishedStoryOperations, getChatSessionByContext, createChatSession,
    updateChatSessionMetadata, getTikTokVideoVersionByProject, insertTikTokVideoVersion, updateTikTokVideoVersion,
} from '../db';
import { DreamEditRequestSchema, DreamRequestSchema, DreamIdSchema, dreamCanonical, DreamContractError, dreamSceneInput, validateDreamDirector,
    type DreamStoryDocument, type DreamRequest, type DreamStoryCandidate, type DreamDirectorPackage } from '../../shared/dreamStory';
import { DreamStoryTargetSchema, DREAM_STORY_SPEC } from '../../shared/contentCreationTarget';
import { reduceDreamStory } from '../../shared/dreamStoryReducer';
import { dreamStoryTimeline } from '../../shared/dreamStoryTimeline';
import { ProductPublicationCopySchema, type ProductPublicationCopy } from '../../shared/productCreationTarget';
import type { VideoEditorV2Project } from '../../shared/videoAutoEdit';
import { createVideoEditorV2Project, getVideoEditorV2Project, saveVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';

const queues = new Map<string, Promise<unknown>>();
export const dreamDigest = (value: unknown): string => createHash('sha256').update(dreamCanonical(value)).digest('hex');
export function dreamLock<T>(spaceId: string, projectId: string, work: () => Promise<T>): Promise<T> {
    const key = spaceId + ':' + projectId;
    const result = (queues.get(key) || Promise.resolve()).then(work, work);
    const settled = result.then(() => undefined, () => undefined); queues.set(key, settled);
    void settled.finally(() => { if (queues.get(key) === settled) queues.delete(key); });
    return result;
}
export async function readDreamStory(projectId: string, spaceId = getWorkspacePaths().activeSpaceId): Promise<VideoEditorV2Project & { dreamStory: DreamStoryDocument }> {
    DreamIdSchema.parse(projectId);
    if (spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('梦境工程不属于当前空间');
    const project = await getVideoEditorV2Project(projectId);
    if (project?.projectKind !== 'dream-story' || ![3, 4].includes(project.version) || !project.dreamStory || ![1, 2].includes(project.dreamStory.schemaVersion) || (project.version === 4) !== (project.dreamStory.schemaVersion === 2) || project.dreamStory.spaceId !== spaceId) throw new Error('当前空间的梦境工程不存在或格式不支持');
    if (project.dreamStory.target) { DreamStoryTargetSchema.parse(project.dreamStory.target); if (project.dreamStory.target.profileVersion !== project.dreamStory.schemaVersion) throw new Error('目标与工程格式不匹配，请创建新版副本'); }
    if (project.dreamStory.director) validateDreamDirector(project.dreamStory.director, project.dreamStory.fragments, project.dreamStory.storyboardAdopted ? project.dreamStory.target : undefined);
    project.timeline = dreamStoryTimeline(project);
    return project as VideoEditorV2Project & { dreamStory: DreamStoryDocument };
}
export function newDreamDocument(spaceId: string): DreamStoryDocument {
    return { schemaVersion: 2, spaceId, revision: randomUUID(), draftEpoch: 0, dirty: false,
        fragments: [{ id: 'fragment_' + randomUUID(), text: '', locked: false }], fidelity: 'preserve-dream', style: '保留梦感',
        stage: 'record', candidates: [], versions: [], media: {}, storyAdopted: false, storyboardAdopted: false,
        musicVolume: 0.15, voiceVolume: 1, undo: [] };
}
export async function createDreamStory(title = '记下一个梦'): Promise<VideoEditorV2Project> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    return runInWorkspaceSpace(spaceId, async () => {
        const project = await createVideoEditorV2Project({ title: String(title).slice(0, 200), projectKind: 'dream-story',
            dreamStory: newDreamDocument(spaceId),
            canvas: { width: DREAM_STORY_SPEC.width, height: DREAM_STORY_SPEC.height, aspectRatio: '9:16', fps: 30 } });
        return project;
    });
}
export function assertDreamRequest(project: VideoEditorV2Project & { dreamStory: DreamStoryDocument }, request: DreamRequest): void {
    const doc = project.dreamStory;
    if (request.spaceId !== doc.spaceId || request.projectId !== project.id || doc.revision !== request.expectedRevision || doc.draftEpoch !== request.expectedDraftEpoch || (request.targetDigest && request.targetDigest !== doc.targetDigest))
        throw new Error('梦境内容或输入已变化，请保存并按当前版本重试');
}
export async function persistDreamProject(project: VideoEditorV2Project & { dreamStory: DreamStoryDocument }): Promise<typeof project> {
    const doc = project.dreamStory;
    if (doc.target) { doc.target = DreamStoryTargetSchema.parse(doc.target); doc.targetDigest = dreamDigest(doc.target); }
    else doc.targetDigest = undefined;
    if (doc.director) {
        validateDreamDirector(doc.director, doc.fragments, doc.storyboardAdopted ? doc.target : undefined);
        if ([...doc.director.characters, ...(doc.director.settings || [])].some(character => character.referenceAssetIds.some(id => !project.assets.some(asset => asset.id === id && asset.kind === 'image')))) throw new Error('角色参考图不属于此工程');
        for (const scene of doc.director.scenes) for (const kind of ['image', 'audio', 'video'] as const) {
            const binding = doc.media[scene.id]?.[kind];
            if (binding && binding.inputDigest !== dreamDigest(dreamSceneInput(doc, scene, kind))) { binding.status = 'stale'; binding.approvedDigest = undefined; }
        }
    }
    project.creationTarget = doc.target;
    project.productVideo = null;
    project.timeline = dreamStoryTimeline(project);
    return await saveVideoEditorV2Project(project) as typeof project;
}
export async function applyDreamEdit(input: unknown): Promise<VideoEditorV2Project & { dreamStory: DreamStoryDocument }> {
    const request = DreamEditRequestSchema.parse(input);
    const spaceId = getWorkspacePaths().activeSpaceId;
    if (request.spaceId !== spaceId) throw new Error('编辑请求不属于当前空间');
    return runInWorkspaceSpace(spaceId, () => dreamLock(spaceId, request.projectId, async () => {
        const project = await readDreamStory(request.projectId, spaceId);
        const digest = dreamDigest(request);
        const prior = getStoryProjectOperation(spaceId, project.id, request.requestId);
        if (prior) {
            if (prior.request_digest !== digest) throw new Error('同一请求 ID 对应不同输入');
            if (prior.state === 'prepared' && project.dreamStory.revision === prior.next_revision) {
                const pending = prior.result_json ? JSON.parse(prior.result_json) : {};
                await syncDreamTikTokVersion(project, pending.publicationCopy ? ProductPublicationCopySchema.parse(pending.publicationCopy) : undefined);
                finishStoryProjectOperation(spaceId, project.id, request.requestId, 'committed', { revision: prior.next_revision });
            }
            else if (prior.state !== 'committed') throw new Error('此操作已中断，请使用新的请求重试');
            return project;
        }
        assertDreamRequest(project, request);
        if (project.version === 3 && request.operations.some(op => op.type === 'reference.bind' || (op.type === 'target.confirm' && op.target.profileVersion === 2))) throw new Error('请创建新版连续性副本，原工程保持不变');
        const next = reduceDreamStory(project.dreamStory, request.operations, 'version_' + randomUUID(), new Date().toISOString());
        if (project.version === 3 && next.director && ([...next.director.characters, ...(next.director.settings || [])].some(owner => owner.referenceCrops !== undefined) || next.director.scenes.some(scene => scene.referenceFraming !== undefined || scene.spatialAnchors !== undefined || scene.imagePromptMode !== undefined || scene.imageReferenceMode !== undefined))) throw new Error('请创建新版连续性副本，原工程保持不变');
        for (const op of request.operations) if (op.type === 'reference.bind') {
            for (const id of op.assetIds) {
                const asset = project.assets.find(item => item.id === id && item.kind === 'image');
                if (!asset) throw new Error('参考图不属于当前工程');
                const real = await fs.realpath(asset.projectPath); if (!isPathWithinRoots(real, [await fs.realpath(project.projectDir)]) || createHash('sha256').update(await fs.readFile(real)).digest('hex') !== asset.hash) throw new Error('参考图文件已变化或越出工程');
                // Assigning an approved frame as a fixed anchor does not invalidate itself.
                for (const scene of next.director?.scenes || []) {
                    const image = next.media[scene.id]?.image;
                    if (request.operations.every(item => item.type === 'reference.bind') && image?.assetId === id && image.status === 'ready' && image.approvedDigest) {
                        image.inputDigest = dreamDigest(dreamSceneInput(next, scene, 'image'));
                        image.approvedDigest = dreamDigest({ inputDigest: image.inputDigest, sha256: image.fileSha256 });
                    }
                }
            }
        }
        const publication = [...request.operations].reverse().find(op => op.type === 'publication.copy');
        const publicationCopy = publication?.type === 'publication.copy' ? { title: publication.title, description: publication.description, hashtags: publication.hashtags } : undefined;
        next.revision = randomUUID(); next.dirty = false;
        const row = { space_id: spaceId, project_id: project.id, request_id: request.requestId, request_digest: digest,
            expected_revision: request.expectedRevision, next_revision: next.revision, state: 'prepared' as const, result_json: publicationCopy ? JSON.stringify({ publicationCopy }) : null, created_at: Date.now() };
        prepareStoryProjectOperation(row);
        const result = await persistDreamProject({ ...project, title: next.director?.title || project.title, dreamStory: next, status: 'draft' });
        await syncDreamTikTokVersion(result, publicationCopy);
        finishStoryProjectOperation(spaceId, project.id, request.requestId, 'committed', { revision: next.revision });
        return result;
    }));
}
export async function markDreamDraft(projectId: string, dirty: boolean): Promise<VideoEditorV2Project> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    return dreamLock(spaceId, projectId, async () => {
        const project = await readDreamStory(projectId);
        project.dreamStory.draftEpoch++; project.dreamStory.dirty = dirty;
        return saveVideoEditorV2Project(project);
    });
}
export async function saveDreamCandidate(turn: DreamRequest, value: unknown, calls = 1): Promise<DreamStoryCandidate> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    if (turn.spaceId !== spaceId) throw new Error('候选不属于当前空间');
    return dreamLock(spaceId, turn.projectId, async () => {
        const project = await readDreamStory(turn.projectId);
        const doc = project.dreamStory;
        if (turn.targetDigest && turn.targetDigest !== doc.targetDigest) throw new Error('目标在规划期间已变化，请基于当前目标重新创作');
        if (!doc.target || (!doc.director && !doc.fragments.some(fragment => fragment.text.trim()))) throw new Error('请保存片段并确认目标后创作');
        const director = validateDreamDirector(value, doc.fragments, doc.target);
        if (doc.target.compositionMode === 'story-hybrid' && (!doc.director || (!doc.candidates.length && !doc.versions.length)) && director.scenes.filter(scene => scene.mediaType === 'video').length !== 2) throw new DreamContractError('混合模式首次方案请推荐两幕视频并说明理由；采用后可手动调整');
        const candidate: DreamStoryCandidate = { id: 'candidate_' + dreamDigest(turn.requestId).slice(0, 32), basedOnRevision: turn.expectedRevision,
            draftEpoch: turn.expectedDraftEpoch, targetDigest: doc.targetDigest!, director, createdAt: new Date().toISOString(), calls };
        const existing = doc.candidates.find(item => item.id === candidate.id);
        if (existing) { if (dreamDigest(existing.director) !== dreamDigest(director)) throw new Error('同一轮候选已保存'); return existing; }
        doc.candidates = [...doc.candidates, candidate].slice(-30);
        await saveVideoEditorV2Project(project);
        return candidate;
    });
}
export async function getDreamSession(projectId: string): Promise<{ sessionId: string; project: VideoEditorV2Project }> {
    const project = await readDreamStory(projectId);
    const contextId = `dream-story:${project.dreamStory.spaceId}:${project.id}`;
    const existing = getChatSessionByContext(contextId, 'dream-story');
    const session = existing || createChatSession('dream_' + dreamDigest(contextId).slice(0, 28), project.title, {});
    let metadata: Record<string, unknown> = {};
    try { const parsed = JSON.parse(session.metadata || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed; } catch { /* Repair the binding while retaining the session and its messages. */ }
    updateChatSessionMetadata(session.id, { ...metadata, contextId, contextType: 'dream-story', isContextBound: true, spaceId: project.dreamStory.spaceId,
        editorBindingKind: 'dream-story', dreamStoryProjectId: project.id, privacyScope: 'project', workflowKind: 'dream-story-edit', executionProfile: 'artifact-authoring' }, { touchUpdatedAt: !existing });
    return { sessionId: session.id, project };
}
export async function syncDreamTikTokVersion(project: VideoEditorV2Project & { dreamStory: DreamStoryDocument }, copy?: ProductPublicationCopy): Promise<void> {
    const doc = project.dreamStory;
    if (!doc.target || !doc.director) return;
    const previous = getTikTokVideoVersionByProject(project.id, doc.spaceId);
    if (previous && previous.source?.kind !== 'dream-story') throw new Error('梦境工程绑定了商品版本');
    const source = { kind: 'dream-story' as const, projectId: project.id, revision: doc.revision, targetDigest: doc.targetDigest! };
    if (!previous) insertTikTokVideoVersion({ id: 'tkver_' + randomUUID(), spaceId: doc.spaceId, sourceProjectId: doc.workId || project.id, projectId: project.id,
        source, title: copy?.title || doc.director.title, description: copy?.description || doc.director.publication.description, hashtags: copy?.hashtags || doc.director.publication.hashtags,
        language: doc.target.language, market: doc.target.market, revision: 1, createdAt: Date.now(), updatedAt: Date.now() });
    else if (previous.source?.kind === 'dream-story' && ((copy && dreamCanonical(copy) !== dreamCanonical({ title: previous.title, description: previous.description, hashtags: previous.hashtags })) || dreamCanonical(previous.source) !== dreamCanonical(source))) {
        const { sourceProductId: _productId, sourceProductUpdatedAt: _productDate, ...common } = previous;
        if (!updateTikTokVideoVersion({ ...common, ...copy, source, revision: previous.revision + 1, updatedAt: Date.now() }, previous.revision)) throw new Error('平台版本已变化');
    }
}
export async function recoverDreamOperations(): Promise<void> {
    for (const row of listUnfinishedStoryOperations()) await runInWorkspaceSpace(row.space_id, async () => {
        const project = await readDreamStory(row.project_id).catch(() => null);
        if (row.result_json && JSON.parse(row.result_json).copiedProjectId) return; // Resume only from an explicit duplicate copy request.
        const committed = project?.dreamStory.revision === row.next_revision;
        const pending = row.result_json ? JSON.parse(row.result_json) : {};
        if (project && committed) await syncDreamTikTokVersion(project, pending.publicationCopy ? ProductPublicationCopySchema.parse(pending.publicationCopy) : undefined);
        finishStoryProjectOperation(row.space_id, row.project_id, row.request_id, committed ? 'committed' : 'interrupted', { revision: project?.dreamStory.revision });
    });
}

export async function copyDreamStoryTarget(input: DreamRequest & { target: unknown }): Promise<VideoEditorV2Project> {
    const { target: _target, ...request } = input; DreamRequestSchema.parse(request);
    const source = await readDreamStory(input.projectId); assertDreamRequest(source, input);
    const target = DreamStoryTargetSchema.parse(input.target);
    if (target.profileVersion !== 2) throw new Error('新副本需要新版制作目标');
    return dreamLock(source.dreamStory.spaceId, source.id, async () => {
        assertDreamRequest(await readDreamStory(source.id), input);
        const prior = getStoryProjectOperation(source.dreamStory.spaceId, source.id, input.requestId);
        const digest = dreamDigest(input);
        if (prior && prior.request_digest !== digest) throw new Error('同一请求ID对应不同副本输入');
        const copiedId = prior?.result_json ? JSON.parse(prior.result_json).copiedProjectId : undefined;
        if (prior?.state === 'committed' && copiedId) return readDreamStory(copiedId);
        const created = copiedId ? await readDreamStory(copiedId) : await createDreamStory(source.title + ' · ' + target.language);
        const next = await readDreamStory(created.id);
        if (!prior) prepareStoryProjectOperation({ space_id: source.dreamStory.spaceId, project_id: source.id, request_id: input.requestId,
            request_digest: digest, expected_revision: source.dreamStory.revision, next_revision: source.dreamStory.revision,
            state: 'prepared', result_json: JSON.stringify({ copiedProjectId: created.id }), created_at: Date.now() });
        const doc = structuredClone(source.dreamStory);
        Object.assign(doc, { revision: randomUUID(), draftEpoch: 0, dirty: false, workId: doc.workId || source.id,
            schemaVersion: 2, target, stage: 'story', storyAdopted: false, storyboardAdopted: false, candidates: [], versions: [], undo: [] });
        for (const binding of Object.values(doc.media)) for (const media of [binding.image, binding.audio, binding.video]) if (media) { media.jobId = undefined; media.approvedDigest = undefined; }
        next.dreamStory = doc;
        for (const asset of source.assets) {
            const real = await fs.realpath(asset.projectPath); if (!isPathWithinRoots(real, [await fs.realpath(source.projectDir)])) throw new Error('来源素材越出工程');
            const relativePath = path.join('assets', asset.id + path.extname(real)); const destination = path.join(next.projectDir, relativePath);
            await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(real, destination);
            next.assets = next.assets.filter(item => item.id !== asset.id);
            next.assets.push({ ...asset, relativePath, projectPath: destination, sourcePath: destination });
        }
        const result = await persistDreamProject(next);
        finishStoryProjectOperation(source.dreamStory.spaceId, source.id, input.requestId, 'committed', { copiedProjectId: next.id });
        return result;
    });
}
