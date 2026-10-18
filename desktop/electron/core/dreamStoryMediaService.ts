import { assertImagePromptBudget, imagePromptBudget } from '../../shared/imagePromptBudget';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { nativeImage } from 'electron';
import { getSettings, getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { DreamIdSchema, DreamRequestSchema, dreamSceneInput, dreamReferenceAssets, type DreamMediaKind, type DreamRequest, type DreamMediaBinding } from '../../shared/dreamStory';
import { resolveAudioModelRoute } from '../../shared/audioGenerationCapabilities';
import { resolveVideoModelRoute, assertVideoGenerationEnabled } from '../../shared/videoGenerationCapabilities';
import { normalizeImageProviderTemplate, getImageProviderCapabilities } from './imageProviderAdapters';
import { resolveDefaultImageEndpoint, resolveDefaultImageModel } from './imageGenerationService';
import { dreamVersion } from '../../shared/dreamStoryReducer';
import { MediaGenerationJobRegistry } from './mediaGenerationJobRegistry';
import { getAbsoluteMediaPath } from './mediaLibraryStore';
import { isPathWithinRoots } from './localAssetManager';
import { prepareImportedVideoAssets } from './video-editor-v2/videoEditorV2ProjectStore';
import { readDreamStory, dreamDigest, dreamLock, assertDreamRequest, persistDreamProject } from './dreamStoryStore';
import { dreamImagePrompt, DREAM_IMAGE_PROMPT_VERSION } from '../../shared/dreamStoryImagePrompt';
import { freezeDreamReference, frozenDreamReferencePath } from './dreamStoryReferences';

export type { DreamMediaBatch } from '../../shared/dreamStory';
import type { DreamMediaBatch } from '../../shared/dreamStory';
const registries = new Map<string, MediaGenerationJobRegistry>();
const running = new Set<string>();
const cancelled = new Set<string>();
const batchQueues: Record<DreamMediaKind, Promise<unknown>> = { image: Promise.resolve(), audio: Promise.resolve(), video: Promise.resolve() };
function registry(spaceId: string, projectId: string): MediaGenerationJobRegistry {
    const key = spaceId + ':' + projectId;
    if (!registries.has(key)) registries.set(key, new MediaGenerationJobRegistry(spaceId, 'media-jobs.json', projectId));
    return registries.get(key)!;
}
async function batches(projectDir: string): Promise<DreamMediaBatch[]> {
    try { return JSON.parse(await fs.readFile(path.join(projectDir, 'private', 'batches.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return []; }
}
async function saveBatches(projectDir: string, items: DreamMediaBatch[]): Promise<void> {
    const file = path.join(projectDir, 'private', 'batches.json'); await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp'; await fs.writeFile(tmp, JSON.stringify(items)); await fs.rename(tmp, file);
}
function route(kind: DreamMediaKind) {
    const settings = getSettings() as unknown as Record<string, unknown>;
    if (kind === 'video') {
        assertVideoGenerationEnabled(settings); const video = resolveVideoModelRoute(settings);
        if (video && settings.video_model && video.model !== settings.video_model) throw new Error('配置的视频模型已失效，请重新选择；不会切换供应商');
        if (!video || !video.capabilities.supportedModes.includes('reference-guided') || !video.capabilities.aspectRatios.includes('9:16') || video.capabilities.maxReferenceImages < 1 || video.capabilities.minReferenceImages > 1) throw new Error('请配置支持单张参考图与9:16的视频模型');
        return { provider: video.capabilities.providerKind, model: video.model, endpoint: video.provider.endpoint, apiKey: video.provider.apiKey, capabilities: video.capabilities };
    }
    if (kind === 'audio') { const audio = resolveAudioModelRoute(settings); return { provider: 'tts', model: audio.model, endpoint: audio.baseURL, apiKey: audio.apiKey }; }
    const provider = String(settings.image_provider || 'openai-compatible');
    const template = normalizeImageProviderTemplate(String(settings.image_provider_template || ''), provider);
    return { provider, providerTemplate: template, model: String(settings.image_model || resolveDefaultImageModel(template)),
        endpoint: String(settings.image_endpoint || settings.api_endpoint || resolveDefaultImageEndpoint(template)), apiKey: String(settings.image_api_key || settings.api_key || '') };
}
export async function previewDreamBatch(input: DreamRequest & { kind: DreamMediaKind; sceneIds: string[] }): Promise<DreamMediaBatch> {
    DreamRequestSchema.parse({ spaceId: input.spaceId, projectId: input.projectId, requestId: input.requestId, expectedRevision: input.expectedRevision, expectedDraftEpoch: input.expectedDraftEpoch });
    if (!['image', 'audio', 'video'].includes(input.kind)) throw new Error('不支持此生成类型');
    return dreamLock(input.spaceId, input.projectId, async () => {
        const project = await readDreamStory(input.projectId, input.spaceId); assertDreamRequest(project, input);
        const doc = project.dreamStory;
        if (doc.dirty || !doc.target || !doc.director || !doc.storyboardAdopted || doc.storySyncRequired || doc.recordReviewRequired) throw new Error('请保存并采用当前故事和分镜');
        if (input.kind === 'audio' && !doc.target.narration) throw new Error('当前为无旁白模式');
        const ids = [...new Set(input.sceneIds)];
        if (!ids.length || ids.length > 8 || ids.some(id => !doc.director!.scenes.some(scene => scene.id === id))) throw new Error('请选择当前作品的分镜');
        const selectedRoute = route(input.kind);
        if (!selectedRoute.apiKey || !selectedRoute.endpoint) throw new Error('请先在设置配置对应媒体供应商，或导入本地素材');
        const referencesByScene: NonNullable<DreamMediaBatch['referencesByScene']> = {};
        const videoSeconds: Record<string, number> = {};
        const imagePromptsByScene: Record<string, string> = {};
        const imagePromptChecks: NonNullable<DreamMediaBatch['imagePromptChecks']> = {};
        for (const id of ids) {
            const scene = doc.director.scenes.find(item => item.id === id)!;
            if (input.kind === 'image' && scene.imageReferenceMode === 'previous' && (doc.schemaVersion !== 2 || scene.continuity !== 'continue' || doc.director.scenes.indexOf(scene) === 0)) throw new Error('仅上一幕参考只能用于延续前一幕的镜头');
            if (input.kind === 'video' && (doc.schemaVersion !== 2 || scene.mediaType !== 'video')) throw new Error('此幕未选择视频模式');
            if (input.kind === 'image' && doc.schemaVersion === 2 && scene.continuity === 'continue') {
                const previous = doc.director.scenes[doc.director.scenes.indexOf(scene) - 1];
                const image = previous && doc.media[previous.id]?.image;
                if (!previous || previous.settingId !== scene.settingId) throw new Error('连续镜头必须沿用前一幕场景；换场请选择切场');
                if (ids.includes(previous.id) || image?.status !== 'ready' || !image.approvedDigest) throw new Error('请先逐幕确认上一幕画面，再预览下一幕；不能预授权未知参考');
            }
            if (input.kind === 'image' && doc.schemaVersion === 2 && scene.imageReferenceMode !== 'previous') {
                const preceding = doc.director.scenes.slice(0, doc.director.scenes.indexOf(scene));
                for (const character of doc.director.characters.filter(item => scene.characterIds.includes(item.id))) if (preceding.some(item => item.characterIds.includes(character.id)) && !character.referenceAssetIds.length) throw new Error('请先确认并指定固定人物参考，再制作后续分镜');
                const setting = doc.director.settings?.find(item => item.id === scene.settingId);
                if (preceding.some(item => item.settingId === scene.settingId) && !setting?.referenceAssetIds.length) throw new Error('请先将已确认画面设为固定场景基准，再制作后续分镜');
            }
            const image = doc.media[id]?.image;
            if (input.kind === 'video' && (image?.status !== 'ready' || !image.approvedDigest)) throw new Error('请先确认此幕关键帧');
            const refs = input.kind === 'audio' ? [] : input.kind === 'video' ? [{ assetId: image!.assetId!, role: 'keyframe:' + id }] : dreamReferenceAssets(doc, scene);
            referencesByScene[id] = [];
            for (const ref of refs) {
                referencesByScene[id].push(await freezeDreamReference(project, ref));
            }
            if (input.kind === 'image') {
                const prompt = dreamImagePrompt(doc, scene, referencesByScene[id].map(ref => ref.role));
                imagePromptsByScene[id] = prompt;
                const budget = imagePromptBudget(selectedRoute.providerTemplate, selectedRoute.model, prompt);
                if (budget) imagePromptChecks[id] = budget;
            }
            if (input.kind === 'image' && refs.length) {
                const selected = route('image'); const capabilities = getImageProviderCapabilities(selected.providerTemplate, selected.provider, selected.model);
                if (!capabilities.supportsReferenceImages || refs.length > capabilities.maxReferenceImages) throw new Error('当前图片模型不支持所需参考图数量，请减少参考或更换模型；不会丢弃参考');
            }
            if (input.kind === 'video') {
                const capabilities = route('video').capabilities!;
                const needed = Math.ceil(Math.max(scene.plannedDurationMs, doc.target.narration ? doc.media[id]?.audio?.durationMs || 0 : 0) / 1000);
                if (doc.target.narration && doc.media[id]?.audio?.status !== 'ready') throw new Error('先完成当前旁白，按实测声音规划视频时长');
                const duration = [...capabilities.durationSeconds].sort((a, b) => a - b).find(value => value >= needed);
                if (!duration) throw new Error(`第 ${doc.director.scenes.indexOf(scene) + 1} 幕需要 ${needed} 秒，超过模型单段上限；请调整时长或重新规划，不自动拆段`);
                videoSeconds[id] = duration;
            }
        }
        const referenceAssetIds = [...new Set(Object.values(referencesByScene).flat().map(item => item.assetId))];
        const batch: DreamMediaBatch = { id: 'batch_' + randomUUID(), projectId: project.id, spaceId: input.spaceId, revision: doc.revision,
            targetDigest: doc.targetDigest!, kind: input.kind, sceneIds: ids, inputDigests: Object.fromEntries(ids.map(id => [id, dreamDigest(dreamSceneInput(doc, doc.director!.scenes.find(scene => scene.id === id)!, input.kind))])),
            routeDigest: dreamDigest(selectedRoute), provider: selectedRoute.provider, model: selectedRoute.model, count: ids.length, maxRequests: ids.length,
            selectionAssetIds: Object.fromEntries(ids.map(id => [id, doc.media[id]?.[input.kind]?.assetId || ''])),
            referencesByScene, imagePromptVersion: input.kind === 'image' ? DREAM_IMAGE_PROMPT_VERSION : undefined,
            imagePromptExtend: input.kind === 'image' ? false : undefined, imagePromptModesByScene: input.kind === 'image' ? Object.fromEntries(ids.map(id => [id, doc.director!.scenes.find(scene => scene.id === id)!.imagePromptMode || 'context'])) : undefined, imageReferenceModesByScene: input.kind === 'image' ? Object.fromEntries(ids.map(id => [id, doc.director!.scenes.find(scene => scene.id === id)!.imageReferenceMode || 'baselines'])) : undefined, imagePromptsByScene: input.kind === 'image' ? imagePromptsByScene : undefined, imagePromptChecks: input.kind === 'image' ? imagePromptChecks : undefined, videoSeconds: input.kind === 'video' ? videoSeconds : undefined, resolution: input.kind === 'video' ? (route('video').capabilities!.resolutions.includes('1080p') ? '1080p' : '720p') : undefined,
            voiceId: input.kind === 'audio' ? doc.target.voiceId : undefined, referenceAssetIds, state: 'preview', jobs: {}, errors: {}, createdAt: Date.now() };
        if (input.kind === 'audio') batch.audioCharacters = ids.reduce((sum, id) => sum + doc.director!.scenes.find(scene => scene.id === id)!.narration.length, 0);
        await saveBatches(project.projectDir, [...await batches(project.projectDir), batch].slice(-100)); return batch;
    });
}
export async function dreamFileSha256(file: string): Promise<string> { return createHash('sha256').update(await fs.readFile(file)).digest('hex'); }
export async function bindDreamMedia(projectId: string, sceneId: string | undefined, kind: DreamMediaKind | 'music' | 'reference', file: string, inputDigest?: string, jobId?: string, expectedSelectionAssetId?: string, expectedRequest?: DreamRequest, referenceOwner?: { kind: 'character' | 'setting'; id: string }, references?: DreamMediaBinding['references']): Promise<void> {
    const spaceId = getWorkspacePaths().activeSpaceId;
    await dreamLock(spaceId, projectId, async () => {
        let project = await readDreamStory(projectId);
        if (expectedRequest) assertDreamRequest(project, expectedRequest);
        const source = await fs.realpath(file); const stat = await fs.stat(source);
        if (!stat.isFile() || !stat.size) throw new Error('媒体文件为空或不可用');
        if (stat.size > 512_000_000) throw new Error('单个导入素材不能超过 512 MB');
        if (kind === 'reference' && project.dreamStory.schemaVersion === 2) { const owner = referenceOwner?.kind === 'character' ? project.dreamStory.director?.characters.find(item => item.id === referenceOwner.id) : project.dreamStory.director?.settings?.find(item => item.id === referenceOwner?.id); if (!owner) throw new Error('请选择有效参考对象'); if (project.dreamStory.director?.scenes.some(scene => scene.locked && (referenceOwner?.kind === 'character' ? scene.characterIds.includes(owner.id) : scene.settingId === owner.id))) throw new Error('请先解锁受影响分镜'); }
        if ((kind === 'image' || kind === 'reference') && nativeImage.createFromBuffer(await fs.readFile(source)).isEmpty()) throw new Error('图片无法解码，请选择有效图片');
        const oldIds = new Set(project.assets.map(asset => asset.id));
        const imported = await prepareImportedVideoAssets(project, [source]);
        const sourceHash = await dreamFileSha256(source);
        const added = imported.assets.find(asset => !oldIds.has(asset.id)) || imported.assets.find(asset => asset.hash === sourceHash || path.resolve(asset.sourcePath) === source || path.resolve(asset.projectPath) === source);
        if (!added || (kind === 'image' || kind === 'reference' ? added.kind !== 'image' : added.kind !== (kind === 'video' ? 'video' : 'audio'))) throw new Error('请选择对应类型的媒体文件');
        if ((kind === 'audio' || kind === 'music' || kind === 'video') && (!added.durationMs || added.durationMs <= 0)) throw new Error('无法探测音频时长');
        if (kind === 'video' && (!added.width || !added.height || Math.abs(added.width / added.height - 9 / 16) > 0.03)) throw new Error('视频素材必须为9:16竖屏');
        added.hash = await dreamFileSha256(added.projectPath); added.title = '梦境素材';
        // Source paths and private prompts stay inside the project; catalog entries contain no dream text.
        project = { ...project, assets: imported.assets };
        const doc = project.dreamStory;
        if (jobId) doc.reconciledMediaJobIds = [...new Set([...(doc.reconciledMediaJobIds || []), jobId])].slice(-2000);
        if (kind === 'music') doc.musicAssetId = added.id;
        else if (kind === 'reference') {
            if (!doc.director) throw new Error('请先采用包含角色设定的导演包');
            const character = referenceOwner?.kind === 'setting' ? doc.director.settings?.find(item => item.id === referenceOwner.id) : doc.director.characters.find(item => item.id === referenceOwner?.id) || (doc.schemaVersion === 1 ? doc.director.characters[0] : undefined);
            if (!character) throw new Error('请选择角色或场景参考对象');
            doc.undo = [...doc.undo, dreamVersion(doc, 'version_' + randomUUID(), '修改参考前', new Date().toISOString())].slice(-20);
            if (!character.referenceAssetIds.includes(added.id) && character.referenceAssetIds.length >= 10) throw new Error('参考图数量已达上限，请先移除参考');
            character.referenceAssetIds = [...new Set([...character.referenceAssetIds, added.id])]; character.revision++; doc.revision = randomUUID();
        } else {
            const scene = doc.director?.scenes.find(item => item.id === sceneId);
            if (!scene) throw new Error('分镜不存在');
            const currentDigest = dreamDigest(dreamSceneInput(doc, scene, kind));
            const selection = doc.media[scene.id]?.[kind];
            const selectionMatches = expectedSelectionAssetId === undefined || (selection?.assetId || '') === expectedSelectionAssetId || selection?.jobId === jobId;
            let referencesMatch = true;
            for (const ref of references || []) { try { await frozenDreamReferencePath(project, ref); } catch { referencesMatch = false; } }
            if ((!inputDigest || currentDigest === inputDigest) && selectionMatches && referencesMatch) {
                doc.media[scene.id] ||= {};
                doc.media[scene.id][kind] = { assetId: added.id, fileSha256: added.hash, inputDigest: inputDigest || currentDigest,
                    jobId, references, status: 'ready', durationMs: kind === 'audio' || kind === 'video' ? added.durationMs : undefined };
            } else { doc.mediaCandidates = [...(doc.mediaCandidates || []), { sceneId: scene.id, kind, assetId: added.id, inputDigest: inputDigest || currentDigest, jobId }].slice(-100); }
        }
        project.status = 'draft'; await persistDreamProject(project);
    });
}
export async function approveDreamImage(input: DreamRequest & { sceneId: string; kind?: 'image' | 'video' }): Promise<void> {
    if (input.kind !== undefined && !['image', 'video'].includes(input.kind)) throw new Error('确认媒体类型无效');
    await dreamLock(input.spaceId, input.projectId, async () => {
        const project = await readDreamStory(input.projectId, input.spaceId); assertDreamRequest(project, input);
        const binding = project.dreamStory.media[input.sceneId]?.[input.kind === 'video' ? 'video' : 'image'];
        const asset = project.assets.find(item => item.id === binding?.assetId);
        const scene = project.dreamStory.director?.scenes.find(item => item.id === input.sceneId);
        if (!scene || !binding || binding.inputDigest !== dreamDigest(dreamSceneInput(project.dreamStory, scene, input.kind === 'video' ? 'video' : 'image')) || binding.status !== 'ready' || !asset || await dreamFileSha256(asset.projectPath) !== binding.fileSha256) throw new Error('画面缺失、已变化或过期');
        if (input.kind === 'video' && scene && (binding.durationMs || 0) + 1 < Math.ceil(Math.max(scene.plannedDurationMs, project.dreamStory.target?.narration ? project.dreamStory.media[scene.id]?.audio?.durationMs || 0 : 0) / 1000 * 30) / 30 * 1000) throw new Error('视频长度不足，请调整分镜或重新规划，不会停帧补足');
        binding.approvedDigest = dreamDigest({ inputDigest: binding.inputDigest, sha256: binding.fileSha256 });
        await persistDreamProject(project);
    });
}
export async function confirmDreamBatch(input: DreamRequest & { batchId: string }): Promise<DreamMediaBatch> {
    DreamIdSchema.parse(input.batchId);
    const spaceId = getWorkspacePaths().activeSpaceId;
    let newlyAuthorized = false;
    const batch = await dreamLock(spaceId, input.projectId, async () => {
        const project = await readDreamStory(input.projectId, input.spaceId);
        const list = await batches(project.projectDir); const batch = list.find(item => item.id === input.batchId);
        if (!batch) throw new Error('批次不存在');
        if (batch.state !== 'preview') return batch;
        assertDreamRequest(project, input);
        if (batch.kind === 'image' && batch.imagePromptVersion !== DREAM_IMAGE_PROMPT_VERSION) throw new Error('图片提示规则已更新，请重新预览批次');
        if (project.dreamStory.dirty || batch.revision !== project.dreamStory.revision || batch.targetDigest !== project.dreamStory.targetDigest || batch.routeDigest !== dreamDigest(route(batch.kind))) throw new Error('批次输入或供应商已变化，请重新预览');
        if (batch.kind === 'image') {
            for (const id of batch.sceneIds) {
                const scene = project.dreamStory.director!.scenes.find(item => item.id === id)!;
                const prompt = dreamImagePrompt(project.dreamStory, scene, batch.referencesByScene?.[id]?.map(ref => ref.role) || []);
                if (batch.imagePromptExtend !== false || batch.imagePromptModesByScene?.[id] !== (scene.imagePromptMode || 'context') || batch.imageReferenceModesByScene?.[id] !== (scene.imageReferenceMode || 'baselines') || batch.imagePromptsByScene?.[id] !== prompt) throw new Error('实际图片指令或改写设置已变化，请重新预览');
                assertImagePromptBudget(route('image').providerTemplate, batch.model, prompt);
            }
        }
        if (batch.sceneIds.some(id => (batch.selectionAssetIds?.[id] || '') !== (project.dreamStory.media[id]?.[batch.kind]?.assetId || ''))) throw new Error('选用素材已变化，请重新预览批次');
        for (const refs of Object.values(batch.referencesByScene || {})) for (const ref of refs) await frozenDreamReferencePath(project, ref);
        if (batch.sceneIds.some(id => batch.inputDigests[id] !== dreamDigest(dreamSceneInput(project.dreamStory, project.dreamStory.director!.scenes.find(scene => scene.id === id)!, batch.kind)))) throw new Error('分镜依赖已变化，请重新预览');
        batch.state = 'accepted'; await saveBatches(project.projectDir, list); newlyAuthorized = true; return batch;
    });
    const key = spaceId + ':' + batch.id;
    if (newlyAuthorized && batch.state === 'accepted' && !running.has(key)) {
        running.add(key);
        // Each kind owns two workers across all batches, including batches from other projects.
        const execute = () => runInWorkspaceSpace(spaceId, () => executeBatch(batch));
        const result = batchQueues[batch.kind].then(execute, execute);
        batchQueues[batch.kind] = result.catch(() => undefined).finally(() => running.delete(key));
    }
    return batch;
}
async function executeBatch(batch: DreamMediaBatch): Promise<void> {
    const projectId = batch.projectId; const spaceId = batch.spaceId;
    const jobs = registry(spaceId, projectId); let cursor = 0;
    const persistBatch = () => dreamLock(spaceId, projectId, async () => { const project = await readDreamStory(projectId); const list = await batches(project.projectDir); const index = list.findIndex(item => item.id === batch.id); if (index >= 0) { if (list[index].state === 'cancelled') batch.state = 'cancelled'; batch.errors = { ...list[index].errors, ...batch.errors }; batch.jobs = { ...list[index].jobs, ...batch.jobs }; list[index] = batch; await saveBatches(project.projectDir, list); } });
    try {
        await Promise.all((batch.kind === 'video' ? [0] : [0, 1]).map(async () => {
            while (cursor < batch.sceneIds.length) {
                if (cancelled.has(spaceId + ':' + batch.id)) break;
                const sceneId = batch.sceneIds[cursor++];
                try {
                    const project = await readDreamStory(projectId); const doc = project.dreamStory;
                    const scene = doc.director!.scenes.find(item => item.id === sceneId)!;
                    if (batch.kind === 'image' && batch.imagePromptVersion !== DREAM_IMAGE_PROMPT_VERSION) throw new Error('图片提示规则已更新，未提交此幕，请重新预览');
                    if (doc.targetDigest !== batch.targetDigest || dreamDigest(dreamSceneInput(doc, scene, batch.kind)) !== batch.inputDigests[sceneId] || dreamDigest(route(batch.kind)) !== batch.routeDigest) throw new Error('输入或供应商已变化，未提交此幕');
                    const clientRequestId = batch.id + '_' + sceneId;
                    const old = (await jobs.listJobs({ limit: 300 })).items.find(job => job.attempt?.idempotencyKey === clientRequestId);
                    if (old) { batch.jobs[sceneId] = old.jobId; await persistBatch(); continue; }
                    const references: string[] = [];
                    for (const ref of batch.referencesByScene?.[sceneId] || []) {
                        const real = await frozenDreamReferencePath(project, ref);
                        const extension = path.extname(real).slice(1).toLowerCase();
                        references.push('data:image/' + (extension === 'jpg' ? 'jpeg' : extension) + ';base64,' + (await fs.readFile(real)).toString('base64'));
                    }
                    const submitted = await jobs.submit(batch.kind, { ...route(batch.kind), projectId, sceneId, source: 'dream-story', clientRequestId,
                        title: batch.kind === 'image' ? '梦境画面' : batch.kind === 'video' ? '梦境视频' : '梦境配音', privacyScope: 'project', count: 1, aspectRatio: '9:16', size: '1024x1536',
                        generationMode: references.length ? 'reference-guided' : 'text-to-image', referenceImages: references,
                        durationSeconds: batch.videoSeconds?.[sceneId], resolution: batch.resolution, generateAudio: false,
                        prompt: batch.kind === 'video' ? scene.videoPrompt : batch.kind === 'image' ? batch.imagePromptsByScene![sceneId] : undefined,
                        promptExtend: batch.kind === 'image' ? batch.imagePromptExtend : undefined,
                        input: batch.kind === 'audio' ? scene.narration : undefined, voiceId: doc.target!.voiceId, responseFormat: 'mp3' });
                    batch.jobs[sceneId] = submitted.jobId; await persistBatch();
                    for (;;) {
                        const job = await jobs.getJob(submitted.jobId);
                        if (!job || ['completed', 'failed', 'cancelled', 'dead_lettered', 'submission_unknown'].includes(job.status)) break;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    await reconcileDreamMedia(projectId);
                } catch (error) { batch.errors[sceneId] = String(error); await persistBatch(); }
            }
        }));
        batch.state = cancelled.has(spaceId + ':' + batch.id) ? 'cancelled' : 'completed';
    } catch { batch.state = 'interrupted'; }
    await persistBatch();
}
export async function cancelDreamBatch(projectId: string, batchId: string): Promise<void> {
    DreamIdSchema.parse(batchId); const project = await readDreamStory(projectId); const spaceId = project.dreamStory.spaceId;
    cancelled.add(spaceId + ':' + batchId);
    const jobIds = await dreamLock(spaceId, projectId, async () => {
        const list = await batches(project.projectDir); const batch = list.find(item => item.id === batchId);
        if (!batch) throw new Error('批次不存在'); batch.state = 'cancelled'; await saveBatches(project.projectDir, list); return Object.values(batch.jobs);
    });
    for (const id of jobIds) await registry(spaceId, projectId).cancelJob(id);
}
export async function reconcileDreamMedia(projectId: string): Promise<{ batches: DreamMediaBatch[] }> {
    const project = await readDreamStory(projectId); const doc = project.dreamStory;
    const jobs = registry(doc.spaceId, projectId);
    const list = await batches(project.projectDir);
    const storedJobs = (await jobs.listJobs({ limit: 300 })).items;
    for (const batch of list) for (const sceneId of batch.sceneIds) if (!batch.jobs[sceneId]) {
        const found = storedJobs.find(job => job.attempt?.idempotencyKey === batch.id + '_' + sceneId);
        if (found) batch.jobs[sceneId] = found.jobId;
    }
    for (const batch of list) for (const [sceneId, jobId] of Object.entries(batch.jobs)) {
        const job = await jobs.getJob(jobId);
        const latestDoc = (await readDreamStory(projectId)).dreamStory;
        if (latestDoc.reconciledMediaJobIds?.includes(jobId)) continue;
        const bound = latestDoc.media[sceneId]?.[batch.kind];
        if (bound?.jobId === jobId && bound.status === 'ready') continue;
        if (job?.status === 'completed') {
            const artifact = job.artifacts.find(item => item.kind === batch.kind);
            const file = artifact?.absolutePath || (artifact?.relativePath ? getAbsoluteMediaPath(artifact.relativePath) : '');
            if (file) {
                const real = await fs.realpath(file);
                if (!isPathWithinRoots(real, [await fs.realpath(getWorkspacePaths().media)])) throw new Error('生成素材不属于当前空间');
                try {
                    await bindDreamMedia(projectId, sceneId, batch.kind, real, batch.inputDigests[sceneId], jobId, batch.selectionAssetIds?.[sceneId] || '', undefined, undefined, batch.referencesByScene?.[sceneId]);
                } catch {
                    const message = '生成素材未通过文件或规格校验；请核对供应商结果或导入有效素材，不会自动重试';
                    await dreamLock(doc.spaceId, projectId, async () => {
                        const current = await readDreamStory(projectId); const selected = current.dreamStory.media[sceneId]?.[batch.kind];
                        current.dreamStory.reconciledMediaJobIds = [...new Set([...(current.dreamStory.reconciledMediaJobIds || []), jobId])].slice(-2000);
                        if (!selected || selected.jobId === jobId || (selected.assetId || '') === (batch.selectionAssetIds?.[sceneId] || '')) {
                            current.dreamStory.media[sceneId] ||= {};
                            current.dreamStory.media[sceneId][batch.kind] = { ...selected, jobId, inputDigest: batch.inputDigests[sceneId], status: 'failed', approvedDigest: undefined, error: message };
                        }
                        await persistDreamProject(current);
                        const all = await batches(current.projectDir); const stored = all.find(item => item.id === batch.id);
                        if (stored) { stored.errors[sceneId] = message; await saveBatches(current.projectDir, all); }
                    });
                }
                continue;
            }
        }
        await dreamLock(doc.spaceId, projectId, async () => {
            const current = await readDreamStory(projectId); const scene = current.dreamStory.director?.scenes.find(item => item.id === sceneId);
            if (!scene || dreamDigest(dreamSceneInput(current.dreamStory, scene, batch.kind)) !== batch.inputDigests[sceneId]) return;
            if (current.dreamStory.reconciledMediaJobIds?.includes(jobId)) return;
            const selected = current.dreamStory.media[sceneId]?.[batch.kind];
            if ((selected?.assetId || '') !== (batch.selectionAssetIds?.[sceneId] || '') && selected?.jobId !== jobId) return;
            current.dreamStory.media[sceneId] ||= {};
            const resultUnknown = job?.status === 'submission_unknown' || (!running.has(doc.spaceId + ':' + batch.id) && job && ['submitting', 'submitted', 'polling', 'downloading', 'persisting', 'binding', 'cancel_requested'].includes(job.status));
            const status: DreamMediaBinding['status'] = resultUnknown ? 'unknown' : job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'dead_lettered' ? 'failed'
                : !running.has(doc.spaceId + ':' + batch.id) ? 'interrupted' : 'generating';
            current.dreamStory.media[sceneId][batch.kind] = { ...selected, jobId, inputDigest: batch.inputDigests[sceneId], status,
                error: status === 'unknown' ? '未取得可信生成回执，结果与费用未知；请先核对供应商，不会自动重试'
                    : status === 'interrupted' ? '任务已中断；请核对现有任务后创建新的重试批次' : undefined };
            await persistDreamProject(current);
        });
    }
    await dreamLock(doc.spaceId, projectId, async () => {
        const latest = await batches(project.projectDir);
        for (const batch of latest) {
            const reconciled = list.find(item => item.id === batch.id); if (reconciled) batch.jobs = { ...batch.jobs, ...reconciled.jobs };
            if (batch.state === 'accepted' && !running.has(doc.spaceId + ':' + batch.id)) batch.state = 'interrupted';
        }
        await saveBatches(project.projectDir, latest);
    });
    return { batches: await batches(project.projectDir) };
}
