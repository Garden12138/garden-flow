import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
    getWorkspacePaths, runInWorkspaceSpace, getProductEditJournal, listProductEditJournal,
    listPendingProductEdits, prepareProductEditJournal, finishProductEditJournal, runProductEditSqlTransaction,
    getProductEditorDraft, updateProductEditorDraft, getDouyinVideoVersionByProject, getTikTokVideoVersionByProject,
    updateDouyinVideoVersion, updateTikTokVideoVersion, listDouyinPublishJobs, listTikTokPublishJobs,
    listXhsPublishJobs, upsertDouyinPublishJob, upsertTikTokPublishJob, upsertXhsPublishJob,
    getChatSession, getChatSessionByFile, getChatSessionByContext, createChatSession, updateChatSessionMetadata,
    type ProductEditJournalRecord,
} from '../db';
import {
    ProductProjectEditorRefSchema, ProductProjectEditorBindingSchema, ProductProjectEditRequestSchema,
    type ProductProjectEditorRef, type ProductProjectEditorBinding, type ProductProjectEditorSnapshot,
    type ProductProjectEditRequest, type ProductProjectEditResult, type ProductProjectEditOperation,
} from '../../shared/productProjectEditor';
import { ProductImageSetSchema, productImageInputKey } from '../../shared/productImageSet';
import { ProductCreationTargetSchema, validateProductPublicationCopy } from '../../shared/productCreationTarget';
import type { VideoEditorV2Project, ProductVideoEditCommand } from '../../shared/videoAutoEdit';
import type { XhsNoteDocument, XhsNoteProjectSnapshot } from '../../shared/xhsNote';
import type { DouyinVideoVersion } from '../../shared/platformVideoVersion';
import type { TikTokVideoVersion } from '../../shared/tiktokVideo';
import { getVideoEditorV2Project, saveVideoEditorV2Project, reduceProductVideoEditCommand, reflowProductTimeline, enqueueProductProjectMutation } from './video-editor-v2/videoEditorV2ProjectStore';
import { videoRenderFingerprint } from './video-editor-v2/videoPublicationPolicy';
import { productVideoNarrationHash } from '../../shared/productVideoVoiceoverTimeline';
import { getXhsNoteProject, saveXhsNoteProjectUnlocked, enqueueXhsMutation, refreshXhsNoteProjectProjection, restoreXhsNoteProjectSnapshot } from './xhsNoteProjectStore';
import { resolveProductWorkVariant } from './productWorkVersionService';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const conflict = (): never => { throw new Error('工程或手动输入已变化；已保留输入，请按最新工程重试'); };
const sessionLocks = new Map<string, Promise<unknown>>();
const verifiedEditorRefs = new Map<string, ProductProjectEditorRef>();
export const productEditorKey = (ref: ProductProjectEditorRef): string => ref.kind === 'video' ? `video:${ref.projectId}` : `image-set:${ref.path}`;
const identity = (binding: ProductProjectEditorBinding): unknown => ({ ...binding, selectedId: undefined,
    workVersion: binding.workVersion ? { ...binding.workVersion, copyReviewRequired: undefined } : undefined });

function undoRecords(binding: ProductProjectEditorBinding): ProductEditJournalRecord[] {
    return listProductEditJournal(binding.spaceId, productEditorKey(binding.project))
        .filter(row => row.state === 'committed' && !row.undo_of).slice(0, 20).filter(row => !row.undone);
}

function retainedLegacyHistory(snapshot: ProductProjectEditorSnapshot, adding = false) {
    const count = listProductEditJournal(snapshot.binding.spaceId, productEditorKey(snapshot.binding.project))
        .filter(row => row.state === 'committed' && !row.undo_of).length;
    return (snapshot.video?.undoStack || []).slice(0, Math.max(0, 20 - count - Number(adding)));
}
function latestUndo(snapshot: ProductProjectEditorSnapshot): { row: ProductEditJournalRecord; legacy: boolean } | null {
    const row = undoRecords(snapshot.binding)[0];
    if (row) return { row, legacy: false };
    const legacy = retainedLegacyHistory(snapshot)[0];
    if (!legacy?.productVideo || !snapshot.video) return null;
    const before = { ...snapshot, video: { ...snapshot.video, timeline: legacy.timeline, productVideo: legacy.productVideo } };
    return { legacy: true, row: { space_id: snapshot.binding.spaceId, project_key: productEditorKey(snapshot.binding.project),
        request_id: `legacy:${legacy.id}`, request_hash: '', state: 'committed', payload_json: JSON.stringify({ before }),
        result_json: null, undo_of: null, undone: 0, created_at: Date.parse(legacy.createdAt) } };
}

async function readSnapshot(ref: ProductProjectEditorRef, selectedId?: string): Promise<ProductProjectEditorSnapshot> {
    ref = ProductProjectEditorRefSchema.parse(ref);
    const requestedRef = ref;
    const spaceId = getWorkspacePaths().activeSpaceId;
    let binding: ProductProjectEditorBinding;
    let video: VideoEditorV2Project | undefined;
    let imageSet: XhsNoteProjectSnapshot | undefined;
    let publicationCopy: ProductProjectEditorSnapshot['publicationCopy'];
    let publicationRevision: string | number | undefined;
    if (ref.kind === 'video') {
        video = await getVideoEditorV2Project(ref.projectId) || undefined;
        if (!video?.productVideo) throw new Error('当前空间的商品视频工程不存在');
        const variant = await resolveProductWorkVariant(video);
        binding = { version: 1, spaceId, project: ref, productId: video.productVideo.productSnapshot.id,
            target: variant.resolution === 'bound' ? variant.target : video.creationTarget ? ProductCreationTargetSchema.parse(video.creationTarget) : undefined,
            workVersion: variant.resolution === 'bound' ? variant.workVersion : video.workVersion, selectedId };
        if (selectedId && !video.productVideo.scenes.some(scene => scene.id === selectedId)) throw new Error('选中分镜不存在');
        const native = getDouyinVideoVersionByProject(video.id, spaceId) || getTikTokVideoVersionByProject(video.id, spaceId);
        if (variant.resolution === 'bound' && native) {
            publicationCopy = { title: native.title, description: native.description, hashtags: native.hashtags };
            publicationRevision = native.revision;
        } else if (variant.resolution === 'bound' && variant.workVersion?.publicationBinding?.platform === 'xiaohongshu') {
            const note = await getXhsNoteProject(variant.workVersion.publicationBinding.notePath);
            publicationCopy = { title: note.document.finalTitle, description: note.document.body, hashtags: note.document.hashtags };
            publicationRevision = note.version;
        }
    } else {
        imageSet = await getXhsNoteProject(ref.path);
        const set = imageSet.document.productImageSet;
        if (!set || set.spaceId !== spaceId) throw new Error('套图不属于当前空间');
        ref = { kind: 'image-set', path: imageSet.relativePath };
        binding = { version: 1, spaceId, project: ref, productId: set.productSnapshot.id,
            target: imageSet.document.creationTarget || set.creationTarget || ProductCreationTargetSchema.parse({ platform: 'xiaohongshu', contentKind: 'image-set', language: 'zh-CN', market: '中国', profileId: 'legacy-xiaohongshu-image-set', profileVersion: 0, allowPaidMedia: false, spec: { width: 1440, height: 1920, aspectRatio: '3:4', format: 'png' } }),
            workVersion: imageSet.document.workVersion || { workId: set.proposalId, versionId: set.proposalId, publicationBinding: { platform: 'xiaohongshu', notePath: imageSet.relativePath } }, selectedId };
        if (selectedId && !set.pages.some(page => page.id === selectedId)) throw new Error('选中页面不存在');
        publicationCopy = { title: imageSet.document.finalTitle, description: imageSet.document.body, hashtags: imageSet.document.hashtags };
    }
    const draft = getProductEditorDraft(spaceId, productEditorKey(binding.project));
    verifiedEditorRefs.set(`${spaceId}:${productEditorKey(requestedRef)}`, binding.project);
    verifiedEditorRefs.set(`${spaceId}:${productEditorKey(binding.project)}`, binding.project);
    const pending = listProductEditJournal(spaceId, productEditorKey(binding.project)).some(row => row.state === 'prepared');
    return { binding, revision: hash({ identity: identity(binding), revision: video?.updatedAt || imageSet?.version, publicationRevision }),
        draftEpoch: draft.epoch, dirty: draft.dirty || pending, undoCount: undoRecords(binding).length + retainedLegacyHistory({ binding, video } as ProductProjectEditorSnapshot).length, video, imageSet, publicationCopy };
}

export async function readProductProjectEditor(ref: ProductProjectEditorRef, selectedId?: string): Promise<ProductProjectEditorSnapshot> {
    return readSnapshot(ref, selectedId);
}

/** A formal .redvideo link opens the same editor as its explicitly bound product engine. */
export async function resolveProductNoteEditor(inputPath: string): Promise<ProductProjectEditorRef | null> {
    const note = await getXhsNoteProject(inputPath);
    if (note.document.productImageSet) return { kind: 'image-set', path: note.relativePath };
    if (note.noteType !== 'video') return null;
    const versionId = note.document.workVersion?.versionId;
    const sourceId = note.document.sourceVideoExport?.projectId;
    if (versionId && sourceId && versionId !== sourceId) throw new Error('平台稿件的工程关系冲突，请核对绑定');
    const id = versionId || sourceId;
    if (!id) return null;
    const project = await getVideoEditorV2Project(id);
    if (!project?.productVideo) return null;
    const variant = await resolveProductWorkVariant(project);
    const binding = variant.workVersion?.publicationBinding;
    if (variant.resolution !== 'bound' || binding?.platform !== 'xiaohongshu' || (await getXhsNoteProject(binding.notePath)).relativePath !== note.relativePath) throw new Error('平台稿件没有唯一、明确的商品工程绑定');
    return { kind: 'video', projectId: project.id };
}
export async function validateProductEditorBinding(binding: ProductProjectEditorBinding): Promise<ProductProjectEditorSnapshot> {
    binding = ProductProjectEditorBindingSchema.parse(binding);
    if (binding.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('编辑会话不属于当前空间');
    const snapshot = await readSnapshot(binding.project, binding.selectedId);
    if (hash(identity(snapshot.binding)) !== hash(identity(binding))) throw new Error('工程、商品或目标绑定已变化，请重新打开工程');
    return snapshot;
}
export async function syncProductEditorDraft(ref: ProductProjectEditorRef, dirty: boolean): Promise<{ epoch: number; dirty: boolean }> {
    ref = ProductProjectEditorRefSchema.parse(ref);
    const spaceId = getWorkspacePaths().activeSpaceId;
    const verified = verifiedEditorRefs.get(`${spaceId}:${productEditorKey(ref)}`);
    // A verified mounted editor marks new input synchronously, before a waiting model can commit.
    if (verified) return updateProductEditorDraft(spaceId, productEditorKey(verified), dirty);
    const snapshot = await readSnapshot(ref);
    return updateProductEditorDraft(snapshot.binding.spaceId, productEditorKey(snapshot.binding.project), dirty);
}

export async function getProductProjectEditorSession(ref: ProductProjectEditorRef, selectedId?: string): Promise<{ sessionId: string; snapshot: ProductProjectEditorSnapshot }> {
    const snapshot = await readSnapshot(ref, selectedId);
    const binding = snapshot.binding;
    const key = `${binding.spaceId}:${productEditorKey(binding.project)}`;
    if (sessionLocks.has(key)) {
        const result = await sessionLocks.get(key) as { sessionId: string; snapshot: ProductProjectEditorSnapshot };
        return { ...result, snapshot };
    }
    const promise = Promise.resolve().then(() => {
        const contextId = `product-project:${key}`;
        const absoluteSession = snapshot.imageSet ? getChatSessionByFile(snapshot.imageSet.projectPath) : null;
        const relativeSession = snapshot.imageSet ? getChatSessionByFile(snapshot.imageSet.relativePath) : null;
        let relativeMetadata: Record<string, unknown> = {};
        try { relativeMetadata = JSON.parse(relativeSession?.metadata || '{}'); } catch { /* Unbound legacy sessions are not reassigned across spaces. */ }
        const existing = absoluteSession || (relativeMetadata.spaceId === binding.spaceId || relativeMetadata.activeXhsNotePath === snapshot.imageSet?.projectPath ? relativeSession : null);
        const session = existing || getChatSessionByContext(contextId, 'product-project')
            || getChatSession(`product_editor_${hash(key).slice(0, 28)}`)
            || createChatSession(`product_editor_${hash(key).slice(0, 28)}`, `编辑 · ${snapshot.video?.title || snapshot.imageSet?.document.finalTitle || '商品作品'}`, {});
        let old: Record<string, unknown> = {};
        try { old = JSON.parse(session.metadata || '{}'); } catch { /* Legacy metadata can be empty. */ }
        updateChatSessionMetadata(session.id, { ...old, spaceId: binding.spaceId, contextId, contextType: 'product-project', isContextBound: true,
            editorBindingKind: 'product-project', productProjectEditorBinding: binding, workflowKind: 'product-project-edit',
            executionProfile: 'artifact-authoring', associatedFilePath: snapshot.imageSet?.projectPath });
        return { sessionId: session.id, snapshot };
    });
    sessionLocks.set(key, promise);
    try { return await promise; } finally { sessionLocks.delete(key); }
}

interface EditTransaction {
    before: ProductProjectEditorSnapshot;
    video?: VideoEditorV2Project;
    document?: XhsNoteDocument;
    noteBefore?: XhsNoteProjectSnapshot;
    noteAfter?: XhsNoteDocument;
    nativeBefore?: DouyinVideoVersion | TikTokVideoVersion;
    nativeAfter?: DouyinVideoVersion | TikTokVideoVersion;
    summary: string[];
}

function applyImageOperation(document: XhsNoteDocument, operation: ProductProjectEditOperation): XhsNoteDocument {
    const set = document.productImageSet!;
    let pages = set.pages;
    if (operation.type === 'page.update') {
        if (!pages.some(page => page.id === operation.pageId)) throw new Error('页面不存在');
        pages = pages.map(page => page.id === operation.pageId ? { ...page, ...operation.changes } : page);
    } else if (operation.type === 'page.add') {
        if (pages.some(page => page.id === operation.page.id)) throw new Error('页面 ID 已存在');
        const index = operation.afterPageId ? pages.findIndex(page => page.id === operation.afterPageId) : pages.length - 1;
        if (index < 0) throw new Error('插入位置不存在');
        pages = [...pages.slice(0, index + 1), operation.page, ...pages.slice(index + 1)];
    } else if (operation.type === 'page.delete') {
        if (!pages.some(page => page.id === operation.pageId)) throw new Error('页面不存在');
        if (pages[0].id === operation.pageId) throw new Error('封面不能删除');
        pages = pages.filter(page => page.id !== operation.pageId);
    } else if (operation.type === 'page.order') {
        if (operation.pageIds.length !== pages.length || new Set(operation.pageIds).size !== pages.length || operation.pageIds.some(id => !pages.some(page => page.id === id))) throw new Error('排序必须包含全部页面且不重复');
        pages = operation.pageIds.map(id => pages.find(page => page.id === id)!);
    } else if (operation.type === 'image.replace') {
        if (operation.pages[0].id !== pages[0].id) throw new Error('封面身份不可替换');
        pages = operation.pages.map(page => ({ ...page, render: pages.find(old => old.id === page.id)?.render, generation: pages.find(old => old.id === page.id)?.generation }));
    } else if (operation.type !== 'image.style') throw new Error('套图不能执行视频操作');
    if (pages[0].id !== set.pages[0].id) throw new Error('封面固定为第一张');
    const style = operation.type === 'image.style' ? { ...set.style, ...operation.style } : operation.type === 'image.replace' ? operation.style : set.style;
    return { ...document, productImageSet: ProductImageSetSchema.parse({ ...set, style, pages }) };
}

async function reduceEdit(before: ProductProjectEditorSnapshot, operations: ProductProjectEditOperation[]): Promise<EditTransaction> {
    const transaction: EditTransaction = { before, video: before.video ? clone(before.video) : undefined,
        document: before.imageSet ? clone(before.imageSet.document) : undefined, summary: [] };
    for (const operation of operations) {
        if (operation.type === 'publication.copy') {
            const copy = { title: operation.title.trim(), description: operation.description, hashtags: operation.hashtags.map(tag => tag.replace(/^#+/, '').trim()).filter(Boolean) };
            if (!copy.title) throw new Error('发布标题不能为空');
            if (['douyin', 'tiktok'].includes(before.binding.target?.platform || '') && !copy.description.trim()) throw new Error('发布正文不能为空');
            if (before.binding.target) validateProductPublicationCopy(before.binding.target, copy);
            if (before.binding.target?.platform === 'tiktok' && copy.hashtags.some(tag => !/^[\p{L}\p{N}_]+$/u.test(tag))) throw new Error('TikTok 话题只支持字母、数字和下划线');
            if (transaction.document) transaction.document = { ...transaction.document, finalTitle: copy.title, body: copy.description, hashtags: copy.hashtags };
            else {
                const variant = await resolveProductWorkVariant(transaction.video!);
                if (variant.resolution !== 'bound' || !variant.workVersion?.publicationBinding) throw new Error('发布文案需要唯一、明确的平台绑定，请先绑定目标平台');
                const native = getDouyinVideoVersionByProject(transaction.video!.id) || getTikTokVideoVersionByProject(transaction.video!.id);
                if (native) {
                    transaction.nativeBefore ||= native;
                    transaction.nativeAfter = { ...native, ...copy, revision: native.revision + 1, updatedAt: Date.now() };
                } else if (variant.workVersion.publicationBinding.platform === 'xiaohongshu') {
                    transaction.noteBefore ||= await getXhsNoteProject(variant.workVersion.publicationBinding.notePath);
                    transaction.noteAfter = { ...transaction.noteBefore.document, finalTitle: copy.title, body: copy.description, hashtags: copy.hashtags };
                }
                transaction.video = { ...transaction.video!, productVideo: { ...transaction.video!.productVideo!, proposal: { ...transaction.video!.productVideo!.proposal, publicationCopy: copy } } };
            }
        } else if (transaction.video) {
            if (operation.type === 'voiceover.asset') {
                const scene = transaction.video.productVideo!.scenes.find(item => item.id === operation.sceneId);
                const asset = transaction.video.assets.find(item => item.id === operation.assetId);
                if (!scene || !asset || asset.kind !== 'audio' || !asset.durationMs) throw new Error('旁白素材不存在或不属于当前工程');
                const root = await fs.realpath(transaction.video.projectDir);
                const file = await fs.realpath(asset.projectPath);
                if (!file.startsWith(root + path.sep)) throw new Error('旁白素材不属于当前工程');
                const textHash = asset.provenance?.narrationTextHash || transaction.video.productVideo!.scenes.find(item => item.voiceoverAssetId === asset.id)?.voiceoverTextHash;
                if (asset.provenance?.kind === 'ai-generated' && !textHash) throw new Error('该配音缺少文字核验信息，请通过工作台确认素材');
                transaction.video = reflowProductTimeline({ ...transaction.video, productVideo: { ...transaction.video.productVideo!, voiceoverAutoApprovedAt: undefined,
                    scenes: transaction.video.productVideo!.scenes.map(item => item.id === operation.sceneId ? { ...item, voiceoverAssetId: asset.id,
                        voiceoverDurationMs: asset.durationMs, voiceoverSource: 'imported', voiceoverStatus: 'ready',
                        voiceoverTextHash: textHash || productVideoNarrationHash(item.narrationText || ''),
                        voiceoverJobId: undefined, voiceoverAttachedJobId: undefined, voiceoverRequestId: undefined, voiceoverError: undefined } : item) } });
            } else if (operation.type === 'audio.volume') {
                if (operation.sceneId && (operation.track !== 'voiceover' || !transaction.video.productVideo!.scenes.some(scene => scene.id === operation.sceneId))) throw new Error('当前镜头旁白音轨不存在');
                if (!transaction.video.timeline.tracks.some(track => track.kind === operation.track && track.clips.some(clip => !operation.sceneId || clip.sceneId === operation.sceneId))) throw new Error('音轨不存在，请先在工作台添加素材');
                transaction.video = { ...transaction.video, timeline: { ...transaction.video.timeline,
                    tracks: transaction.video.timeline.tracks.map(track => track.kind === operation.track ? { ...track,
                        clips: track.clips.map(clip => !operation.sceneId || clip.sceneId === operation.sceneId ? { ...clip, volume: operation.volume } : clip) } : track) } };
            }
            else if (operation.type.startsWith('scene.') || operation.type === 'voiceover.remove' || operation.type === 'music.remove') transaction.video = await reduceProductVideoEditCommand(transaction.video, operation as ProductVideoEditCommand);
            else throw new Error('视频不能执行套图操作');
        } else transaction.document = applyImageOperation(transaction.document!, operation);
        const sceneIndex = 'sceneId' in operation ? before.video?.productVideo?.scenes.findIndex(scene => scene.id === operation.sceneId) : undefined;
        const pageIndex = 'pageId' in operation ? before.imageSet?.document.productImageSet?.pages.findIndex(page => page.id === operation.pageId) : undefined;
        const location = sceneIndex !== undefined ? `镜头 ${sceneIndex + 1}` : pageIndex !== undefined ? `第 ${pageIndex + 1} 页` : '';
        const labels: Record<string, string> = { 'scene.text': '屏幕文字', 'scene.narration-text': '朗读文案（已有配音需核对）',
            'scene.fit': '画面适配', 'scene.motion': '原图动效', 'scene.asset': '素材', 'scene.trim': '来源截取', 'scene.source-volume': '原声音量',
            'scene.delete': '删除', 'scene.reorder': '顺序', 'voiceover.remove': '移除配音', 'voiceover.asset': '替换已有旁白素材', 'music.remove': '移除背景音乐',
            'page.update': '文字、素材或布局', 'page.add': '新增内容页', 'page.delete': '删除内容页', 'page.order': '页面排序',
            'image.style': '统一配色', 'image.replace': '保存页面和样式', 'audio.volume': '音轨音量' };
        transaction.summary.push(operation.type === 'publication.copy' ? `发布文案已保存：${operation.title}`
            : operation.type === 'scene.duration' ? `${location}时长：${(transaction.video!.productVideo!.scenes.find(scene => scene.id === operation.sceneId)!.durationMs / 1000).toFixed(3)} 秒`
            : `${location}${labels[operation.type] || operation.type}${'text' in operation ? `：${operation.text}` : ''}`);
    }
    if (transaction.video) {
        const oldTime = Date.parse(before.video!.updatedAt);
        transaction.video.updatedAt = new Date(Math.max(Date.now(), oldTime + 1)).toISOString();
        if (videoRenderFingerprint(transaction.video) !== videoRenderFingerprint(before.video!)) transaction.video.status = 'ready';
        transaction.video.undoStack = retainedLegacyHistory(before, true);
    }
    return transaction;
}

function invalidateConfirmations(binding: ProductProjectEditorBinding): void {
    const now = Date.now();
    const platformBinding = binding.workVersion?.publicationBinding;
    for (const job of listDouyinPublishJobs(binding.spaceId)) if (binding.project.kind === 'video' && job.projectId === binding.project.projectId && job.publishStatus === 'not_submitted' && ['awaiting_confirmation', 'queued', 'preflighting', 'uploading', 'blocked'].includes(job.status))
        upsertDouyinPublishJob({ ...job, status: 'superseded', errorCode: 'PROJECT_EDITED', errorMessage: '工程已修改，请重新准备发布', updatedAt: now });
    for (const job of listTikTokPublishJobs(binding.spaceId)) if (binding.project.kind === 'video' && job.projectId === binding.project.projectId && job.publishStatus === 'not_submitted' && ['awaiting_confirmation', 'queued', 'preflighting', 'uploading', 'blocked'].includes(job.status))
        upsertTikTokPublishJob({ ...job, status: 'superseded', errorCode: 'PROJECT_EDITED', errorMessage: '工程已修改，请重新准备发布', updatedAt: now });
    const notePath = binding.project.kind === 'image-set' ? binding.project.path : platformBinding?.platform === 'xiaohongshu' ? platformBinding.notePath : undefined;
    const absoluteNotePath = notePath ? path.resolve(getWorkspacePaths().manuscripts, notePath) : undefined;
    for (const job of listXhsPublishJobs()) if (absoluteNotePath && job.projectPath === absoluteNotePath && job.publishStatus === 'not_submitted' && ['awaiting_confirmation', 'queued', 'preflighting', 'uploading', 'blocked'].includes(job.status))
        upsertXhsPublishJob({ ...job, status: 'superseded', errorCode: 'PROJECT_EDITED', errorMessage: '工程已修改，请重新准备发布', updatedAt: now });
}

async function persistFiles(transaction: EditTransaction): Promise<void> {
    const { before } = transaction;
    if (transaction.video) {
        const current = await getVideoEditorV2Project(transaction.video.id);
        if (current?.updatedAt === before.video!.updatedAt) await saveVideoEditorV2Project(transaction.video, transaction.video.updatedAt);
        else if (current?.updatedAt !== transaction.video.updatedAt) conflict();
    }
    if (transaction.document) {
        const current = await getXhsNoteProject(before.imageSet!.relativePath);
        if (current.version === before.imageSet!.version) await saveXhsNoteProjectUnlocked({ path: current.relativePath, document: transaction.document, expectedRevision: current.version, trustedProductImageSetState: true });
        else if (current.version !== before.imageSet!.version + 1 || editableImageHash(current.document) !== editableImageHash(transaction.document)) conflict();
        else await refreshXhsNoteProjectProjection(current.relativePath);
    }
    if (transaction.noteAfter && transaction.noteBefore) {
        const current = await getXhsNoteProject(transaction.noteBefore.relativePath);
        if (current.version === transaction.noteBefore.version) await saveXhsNoteProjectUnlocked({ path: current.relativePath, document: transaction.noteAfter, expectedRevision: current.version });
        else if (current.version !== transaction.noteBefore.version + 1 || hash(copyOf(current.document)) !== hash(copyOf(transaction.noteAfter))) conflict();
        else await refreshXhsNoteProjectProjection(current.relativePath);
    }
}
const copyOf = (document: XhsNoteDocument) => ({ title: document.finalTitle, description: document.body, hashtags: document.hashtags });
const editableImageHash = (document: XhsNoteDocument) => hash({ copy: copyOf(document), style: document.productImageSet?.style, pages: document.productImageSet?.pages.map(({ render, generation, ...page }) => page) });

async function rollbackFiles(transaction: EditTransaction): Promise<void> {
    if (transaction.video && (await getVideoEditorV2Project(transaction.video.id))?.updatedAt === transaction.video.updatedAt) await saveVideoEditorV2Project(transaction.before.video!, transaction.before.video!.updatedAt);
    if (transaction.document) {
        const current = await getXhsNoteProject(transaction.before.imageSet!.relativePath);
        if (current.version === transaction.before.imageSet!.version + 1 && editableImageHash(current.document) === editableImageHash(transaction.document))
            await restoreXhsNoteProjectSnapshot(transaction.before.imageSet!);
    }
    if (transaction.noteAfter && transaction.noteBefore) {
        const current = await getXhsNoteProject(transaction.noteBefore.relativePath);
        if (current.version === transaction.noteBefore.version + 1 && hash(copyOf(current.document)) === hash(copyOf(transaction.noteAfter)))
            await restoreXhsNoteProjectSnapshot(transaction.noteBefore);
    }
}

async function completeTransaction(row: ProductEditJournalRecord): Promise<ProductProjectEditResult> {
    const transaction = JSON.parse(row.payload_json) as EditTransaction;
    let committed = false;
    try {
        await persistFiles(transaction);
        if (getProductEditorDraft(row.space_id, row.project_key).epoch !== transaction.before.draftEpoch) conflict();
        const snapshot = await readSnapshot(transaction.before.binding.project);
        const result: ProductProjectEditResult = { ...snapshot, requestId: row.request_id, summary: transaction.summary,
            expiredOutputIds: transaction.video && videoRenderFingerprint(transaction.video) !== videoRenderFingerprint(transaction.before.video!)
                ? transaction.before.video!.renderOutputs.map(output => output.id)
                : transaction.document ? transaction.document.productImageSet!.pages.filter(page => {
                    const old = transaction.before.imageSet!.document.productImageSet!.pages.find(item => item.id === page.id);
                    return !old || productImageInputKey(transaction.before.imageSet!.document.productImageSet!, old) !== productImageInputKey(transaction.document!.productImageSet!, page);
                }).map(page => page.id) : [],
            staleVoiceSceneIds: transaction.video?.productVideo?.scenes.filter(scene => scene.voiceoverAssetId && scene.voiceoverStatus === 'stale').map(scene => scene.id) || [] };
        if (transaction.nativeAfter) {
            result.revision = hash({ identity: identity(snapshot.binding), revision: snapshot.video!.updatedAt, publicationRevision: transaction.nativeAfter.revision });
            result.publicationCopy = { title: transaction.nativeAfter.title, description: transaction.nativeAfter.description, hashtags: transaction.nativeAfter.hashtags };
        }
        result.dirty = getProductEditorDraft(row.space_id, row.project_key).dirty;
        runProductEditSqlTransaction(() => {
            if (getProductEditorDraft(row.space_id, row.project_key).epoch !== transaction.before.draftEpoch) conflict();
            if (transaction.nativeAfter && transaction.nativeBefore) {
                const platform = transaction.before.binding.target!.platform;
                const current = platform === 'douyin' ? getDouyinVideoVersionByProject(transaction.video!.id) : getTikTokVideoVersionByProject(transaction.video!.id);
                if (current?.revision === transaction.nativeBefore.revision) {
                    const success = platform === 'douyin' ? updateDouyinVideoVersion(transaction.nativeAfter as DouyinVideoVersion, current.revision)
                        : updateTikTokVideoVersion(transaction.nativeAfter as TikTokVideoVersion, current.revision);
                    if (!success) conflict();
                } else if (current?.revision !== transaction.nativeAfter.revision || hash(current) !== hash(transaction.nativeAfter)) conflict();
            }
            invalidateConfirmations(transaction.before.binding);
            finishProductEditJournal(row.space_id, row.project_key, row.request_id, 'committed', result, row.undo_of || undefined);
            result.undoCount = undoRecords(snapshot.binding).length + retainedLegacyHistory(snapshot).length;
            finishProductEditJournal(row.space_id, row.project_key, row.request_id, 'committed', result);
        });
        committed = true;
        // Native revision is committed with the journal, so return the final composite credential.
        const final = { ...result, ...await readSnapshot(transaction.before.binding.project) };
        finishProductEditJournal(row.space_id, row.project_key, row.request_id, 'committed', final);
        return final;
    } catch (error) {
        // A committed SQLite transaction remains authoritative if a later response read fails.
        if (committed) throw error;
        await rollbackFiles(transaction);
        finishProductEditJournal(row.space_id, row.project_key, row.request_id, 'rolled-back', { error: String(error) });
        throw error;
    }
}

async function withEditorLock<T>(binding: ProductProjectEditorBinding, operation: () => Promise<T>): Promise<T> {
    if (binding.project.kind === 'video') return enqueueProductProjectMutation(binding.project.projectId, operation);
    const snapshot = await getXhsNoteProject(binding.project.path);
    return enqueueXhsMutation(snapshot.projectPath, operation);
}

async function commitEdit(request: ProductProjectEditRequest, undoOf?: ProductEditJournalRecord, manual = false, nativeOverride?: { before: DouyinVideoVersion | TikTokVideoVersion; after: DouyinVideoVersion | TikTokVideoVersion }, legacyUndo = false): Promise<ProductProjectEditResult> {
    const key = productEditorKey(request.binding.project);
    const digest = hash({ request, nativeOverride });
    const existing = getProductEditJournal(request.binding.spaceId, key, request.requestId);
    if (existing) {
        if (existing.request_hash !== digest) throw new Error('编辑请求 ID 已用于不同的操作');
        if (existing.state === 'committed') return { ...JSON.parse(existing.result_json!) as ProductProjectEditResult, reused: true };
        if (existing.state === 'prepared') return completeTransaction(existing);
        throw new Error('原编辑事务已回滚，请按最新工程重试');
    }
    const before = await validateProductEditorBinding(request.binding);
    if (before.revision !== request.expectedRevision || before.draftEpoch !== request.expectedDraftEpoch || (!manual && before.dirty)) conflict();
    let transaction: EditTransaction;
    if (undoOf) transaction = await buildUndo(before, JSON.parse(undoOf.payload_json) as EditTransaction);
    else transaction = await reduceEdit(before, request.operations);
    if (legacyUndo && transaction.video) transaction.video.undoStack = retainedLegacyHistory(before).slice(1);
    if (nativeOverride) {
        if (transaction.nativeBefore?.id !== nativeOverride.before.id || transaction.nativeBefore.revision !== nativeOverride.before.revision) conflict();
        transaction.nativeBefore = nativeOverride.before;
        transaction.nativeAfter = nativeOverride.after;
        transaction.summary = ['保存发布文案与设置'];
    }
    // Check again after asynchronous asset validation. No write happens before this point.
    const checked = await validateProductEditorBinding(request.binding);
    if (checked.revision !== before.revision || checked.draftEpoch !== before.draftEpoch || (!manual && checked.dirty)) conflict();
    const row: ProductEditJournalRecord = { space_id: before.binding.spaceId, project_key: key, request_id: request.requestId,
        request_hash: digest, state: 'prepared', payload_json: JSON.stringify(transaction), result_json: null,
        undo_of: undoOf?.request_id || null, undone: 0, created_at: Date.now() };
    prepareProductEditJournal(row);
    const result = await completeTransaction(row);
    if (manual && getProductEditorDraft(before.binding.spaceId, key).epoch === before.draftEpoch) {
        updateProductEditorDraft(before.binding.spaceId, key, false);
        return { ...result, ...await readSnapshot(before.binding.project) };
    }
    return result;
}

export async function applyProductProjectEdit(input: ProductProjectEditRequest, manual = false): Promise<ProductProjectEditResult> {
    const request = ProductProjectEditRequestSchema.parse(input);
    if (request.binding.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('编辑请求不属于当前空间');
    return withEditorLock(request.binding, () => commitEdit(request, undefined, manual));
}

async function buildUndo(current: ProductProjectEditorSnapshot, original: EditTransaction): Promise<EditTransaction> {
    const operations: ProductProjectEditOperation[] = [];
    if (original.before.publicationCopy && hash(original.before.publicationCopy) !== hash(current.publicationCopy)) operations.push({ type: 'publication.copy', ...original.before.publicationCopy });
    if (current.imageSet) {
        const old = original.before.imageSet!.document.productImageSet!;
        operations.push({ type: 'image.replace', style: old.style, pages: old.pages.map(({ render, generation, ...page }) => page) });
        return { ...await reduceEdit(current, operations), summary: ['撤销上一次修改'] };
    }
    const transaction = operations.length ? await reduceEdit(current, operations) : { before: current, video: clone(current.video!), summary: [] };
    if (original.nativeBefore && original.nativeAfter) {
        const live = getDouyinVideoVersionByProject(current.video!.id) || getTikTokVideoVersionByProject(current.video!.id);
        if (!live || live.id !== original.nativeBefore.id) throw new Error('原平台稿件绑定已变化，不能撤销文案');
        transaction.nativeBefore = live;
        transaction.nativeAfter = { ...live, title: original.nativeBefore.title, description: original.nativeBefore.description,
            hashtags: original.nativeBefore.hashtags, revision: live.revision + 1, updatedAt: Date.now(),
            ...('coverAssetId' in original.nativeBefore ? { coverAssetId: original.nativeBefore.coverAssetId } : {}),
            ...('language' in original.nativeBefore ? { publishSettings: original.nativeBefore.publishSettings } : {}) };
    }
    const old = original.before.video!;
    const latest = current.video!;
    const scenes = old.productVideo!.scenes.map(scene => {
        const live = latest.productVideo!.scenes.find(item => item.id === scene.id);
        const restored = { ...scene, generationStatus: live?.generationStatus === 'pending' ? 'not-required' as const : live?.generationStatus || 'not-required' as const };
        if (restored.voiceoverAssetId) restored.voiceoverStatus = restored.voiceoverTextHash === productVideoNarrationHash(restored.narrationText || '')
            ? (restored.voiceoverDurationMs || 0) > restored.durationMs ? 'duration-conflict' : 'ready' : 'stale';
        restored.generationJobId = live?.generationJobId;
        restored.generationInputKey = live?.generationInputKey;
        restored.voiceoverJobId = live?.voiceoverJobId;
        restored.voiceoverRequestId = live?.voiceoverRequestId;
        restored.voiceoverAttachedJobId = live?.voiceoverAttachedJobId;
        if (['queued', 'generating'].includes(restored.voiceoverStatus || '')) restored.voiceoverStatus = restored.voiceoverAssetId ? 'stale' : 'needs-configuration';
        return restored;
    });
    transaction.video = { ...transaction.video!, timeline: clone(old.timeline), productVideo: { ...latest.productVideo!, scenes,
        proposal: transaction.video!.productVideo!.proposal, voiceoverAutoApprovedAt: undefined },
        updatedAt: new Date(Math.max(Date.now(), Date.parse(latest.updatedAt) + 1)).toISOString(), status: 'ready', undoStack: retainedLegacyHistory(current) };
    transaction.summary = ['撤销上一次修改'];
    return transaction;
}

export async function undoProductProjectEdit(input: Omit<ProductProjectEditRequest, 'operations'>): Promise<ProductProjectEditResult> {
    const request = ProductProjectEditRequestSchema.parse({ ...input, operations: [{ type: 'music.remove' }] });
    if (request.binding.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('撤销请求不属于当前空间');
    return withEditorLock(request.binding, async () => {
        const existing = getProductEditJournal(request.binding.spaceId, productEditorKey(request.binding.project), request.requestId);
        if (existing) return commitEdit(request);
        const latest = latestUndo(await validateProductEditorBinding(request.binding));
        if (!latest) throw new Error('没有可撤销的工程修改');
        return commitEdit(request, latest.row, false, undefined, latest.legacy);
    });
}

export async function applyManualProductVideoEdit(input: { projectId: string; command: ProductVideoEditCommand; expectedUpdatedAt?: string }): Promise<VideoEditorV2Project> {
    return enqueueProductProjectMutation(input.projectId, async () => {
        const snapshot = await readSnapshot({ kind: 'video', projectId: input.projectId });
        if (input.expectedUpdatedAt && snapshot.video!.updatedAt !== input.expectedUpdatedAt) conflict();
        const result = await commitEdit(ProductProjectEditRequestSchema.parse({ binding: snapshot.binding, requestId: `manual-${randomUUID()}`, expectedRevision: snapshot.revision,
            expectedDraftEpoch: snapshot.draftEpoch, operations: [input.command] }), undefined, true);
        return result.video!;
    });
}

export async function undoManualProductVideoEdit(projectId: string): Promise<VideoEditorV2Project> {
    return enqueueProductProjectMutation(projectId, async () => {
        const snapshot = await readSnapshot({ kind: 'video', projectId });
        const latest = latestUndo(snapshot);
        if (!latest) throw new Error('没有可撤销的工程修改');
        return (await commitEdit({ binding: snapshot.binding, requestId: `undo-${randomUUID()}`, expectedRevision: snapshot.revision,
            expectedDraftEpoch: snapshot.draftEpoch, operations: [{ type: 'music.remove' }] }, latest.row, true, undefined, latest.legacy)).video!;
    });
}

/** Native panels retain their validation and settings UI, and share the durable edit transaction. */
export async function saveManualProductPublication(before: DouyinVideoVersion | TikTokVideoVersion, after: DouyinVideoVersion | TikTokVideoVersion): Promise<void> {
    const snapshot = await readSnapshot({ kind: 'video', projectId: before.projectId });
    await withEditorLock(snapshot.binding, () => commitEdit({ binding: snapshot.binding, requestId: `publication-${randomUUID()}`,
        expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch,
        operations: [{ type: 'publication.copy', title: after.title, description: after.description, hashtags: after.hashtags }] }, undefined, true, { before, after }));
}

/** Stage local imports/normalization without saving intermediate project states. */
export async function commitPreparedProductVideoEdit(projectId: string, label: string, prepare: (project: VideoEditorV2Project) => Promise<VideoEditorV2Project>): Promise<VideoEditorV2Project> {
    const initial = await readSnapshot({ kind: 'video', projectId });
    return withEditorLock(initial.binding, async () => {
        const before = await validateProductEditorBinding(initial.binding);
        const video = await prepare(clone(before.video!));
        const checked = await validateProductEditorBinding(before.binding);
        if (checked.revision !== before.revision || checked.draftEpoch !== before.draftEpoch) conflict();
        if (video.id !== projectId || hash(video.creationTarget) !== hash(before.video!.creationTarget) || hash(video.workVersion) !== hash(before.video!.workVersion)) throw new Error('工程身份不可更改');
        video.updatedAt = new Date(Math.max(Date.now(), Date.parse(before.video!.updatedAt) + 1)).toISOString();
        if (videoRenderFingerprint(video) !== videoRenderFingerprint(before.video!)) video.status = 'ready';
        video.undoStack = retainedLegacyHistory(before, true);
        const key = productEditorKey(before.binding.project);
        const row: ProductEditJournalRecord = { space_id: before.binding.spaceId, project_key: key, request_id: `manual-${randomUUID()}`, request_hash: hash(video),
            state: 'prepared', payload_json: JSON.stringify({ before, video, summary: [label] } satisfies EditTransaction), result_json: null, undo_of: null, undone: 0, created_at: Date.now() };
        prepareProductEditJournal(row);
        const result = await completeTransaction(row);
        return result.video!;
    });
}

export async function commitPreparedProductImageEdit(inputPath: string, expectedRevision: number, label: string, prepare: (document: XhsNoteDocument) => void): Promise<XhsNoteProjectSnapshot> {
    const initial = await readSnapshot({ kind: 'image-set', path: inputPath });
    return withEditorLock(initial.binding, async () => {
        const before = await validateProductEditorBinding(initial.binding);
        if (before.imageSet!.version !== expectedRevision) conflict();
        const document = clone(before.imageSet!.document);
        prepare(document);
        document.productImageSet = ProductImageSetSchema.parse(document.productImageSet);
        if (hash(document.creationTarget) !== hash(before.imageSet!.document.creationTarget) || hash(document.workVersion) !== hash(before.imageSet!.document.workVersion)) throw new Error('工程身份不可更改');
        const row: ProductEditJournalRecord = { space_id: before.binding.spaceId, project_key: productEditorKey(before.binding.project), request_id: `manual-${randomUUID()}`,
            request_hash: hash(document), state: 'prepared', payload_json: JSON.stringify({ before, document, summary: [label] } satisfies EditTransaction),
            result_json: null, undo_of: null, undone: 0, created_at: Date.now() };
        prepareProductEditJournal(row);
        return (await completeTransaction(row)).imageSet!;
    });
}

export async function saveManualProductImageSet(input: { path: string; document: unknown; expectedRevision?: number }): Promise<XhsNoteProjectSnapshot> {
    const snapshot = await readSnapshot({ kind: 'image-set', path: input.path });
    if (input.expectedRevision === undefined) throw new Error('商品套图保存必须提供 expectedRevision');
    if (snapshot.imageSet!.version !== input.expectedRevision) conflict();
    const old = snapshot.imageSet!.document;
    const requested = { ...old, ...(input.document as XhsNoteDocument) };
    const set = requested.productImageSet;
    if (hash(requested.creationTarget) !== hash(old.creationTarget)) throw new Error('工程平台和规格不可原地更改，请创建独立平台版本');
    if (!set || ['version', 'proposalId', 'spaceId', 'productSnapshot', 'assets', 'generationHistory', 'creationTarget'].some(key => hash((set as Record<string, unknown>)[key]) !== hash((old.productImageSet as unknown as Record<string, unknown>)[key]))
        || hash(requested.workVersion) !== hash(old.workVersion)) throw new Error('商品快照、工程素材和生成记录不可修改');
    for (const page of set.pages) {
        const original = old.productImageSet!.pages.find(item => item.id === page.id);
        if (hash(page.render) !== hash(original?.render) || hash(page.generation) !== hash(original?.generation)) throw new Error('页面生成和导出记录只能通过套图工具修改');
    }
    const operations: ProductProjectEditOperation[] = [{ type: 'image.replace', style: set.style, pages: set.pages.map(({ render, generation, ...page }) => page) }];
    if (hash(copyOf(old)) !== hash(copyOf(requested))) operations.push({ type: 'publication.copy', ...copyOf(requested) });
    // Saving manual input is allowed while dirty, but invalidates every pending conversation credential.
    return (await applyProductProjectEdit({ binding: snapshot.binding, requestId: `manual-${randomUUID()}`, expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch, operations }, true)).imageSet!;
}

export async function saveManualProductVideoNote(input: { path: string; document: unknown; expectedRevision?: number }, ref: Extract<ProductProjectEditorRef, { kind: 'video' }>): Promise<XhsNoteProjectSnapshot> {
    const note = await getXhsNoteProject(input.path);
    if (input.expectedRevision === undefined || note.version !== input.expectedRevision) conflict();
    const requested = { ...note.document, ...(input.document as XhsNoteDocument) };
    const copyKeys = new Set(['finalTitle', 'body', 'hashtags', 'updatedAt', 'revision']);
    if (Object.keys(requested).some(key => !copyKeys.has(key) && hash((requested as unknown as Record<string, unknown>)[key]) !== hash((note.document as unknown as Record<string, unknown>)[key]))) throw new Error('商品视频的镜头、素材和导出记录请通过商品视频工作台修改');
    const snapshot = await readSnapshot(ref);
    await applyProductProjectEdit({ binding: snapshot.binding, requestId: `note-${randomUUID()}`, expectedRevision: snapshot.revision, expectedDraftEpoch: snapshot.draftEpoch,
        operations: [{ type: 'publication.copy', ...copyOf(requested) }] }, true);
    return getXhsNoteProject(input.path);
}

export async function recoverProductProjectEdits(): Promise<void> {
    for (const row of listPendingProductEdits()) {
        await runInWorkspaceSpace(row.space_id, async () => {
            const transaction = JSON.parse(row.payload_json) as EditTransaction;
            await withEditorLock(transaction.before.binding, () => completeTransaction(row)).catch(error => console.error('[ProductEditor] recovered local transaction by rollback', row.request_id, error));
        });
    }
}
