import { createReadStream } from 'node:fs';
import { nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getWorkspacePaths, assertProductEditsSettled, getDouyinVideoVersionByProject, getTikTokVideoVersionByProject, getChatSessionByFile, createChatSession } from '../db';
import { PublicationSourceSchema, XHS_IMAGE_PUBLISH_LIMIT, type PublicationSource, type PublicationSnapshot, type PublicationMedia } from '../../shared/publication';
import { xhsTitleValidationError } from '../../shared/xhsPublisher';
import { productImageInputKey, productImageSlotId, productImageSpec } from '../../shared/productImageSet';
import { getXhsNoteProject } from './xhsNoteProjectStore';
import { getProductProjectEditorSession, readProductProjectEditor, resolveProductNoteEditor } from './productProjectEditorService';
import { assertProductPublicationTarget } from './productWorkVersionService';
import { assertCurrentVideoExport } from './video-editor-v2/videoPublicationPolicy';
import { assertXhsSourceExportCurrent } from './xhsVideoPublishSource';
import { getAbsoluteMediaPath, listMediaAssets } from './mediaLibraryStore';
import { isPathWithinRoots } from './localAssetManager';
import { validateTikTokPublishSettings } from '../../shared/tiktokVideo';

export const publicationHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function publicationFileSha256(file: string): Promise<string> {
    const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex');
}
async function mediaFile(slotId: string, assetId: string, role: PublicationMedia['role'], order: number, requiredPng?: { width: number; height: number }): Promise<PublicationMedia> {
    const asset = (await listMediaAssets(10000)).find(item => item.id === assetId);
    if (!asset?.relativePath) throw new Error(`第 ${order + 1} 个发布媒体未入库`);
    const file = await fs.realpath(getAbsoluteMediaPath(asset.relativePath));
    if (!isPathWithinRoots(file, [await fs.realpath(getWorkspacePaths().media)])) throw new Error('发布素材不属于当前空间');
    const stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size) throw new Error(`第 ${order + 1} 个发布媒体损坏`);
    const result: PublicationMedia = { slotId, assetId, role, order, path: file, mimeType: asset.mimeType || '', sha256: await publicationFileSha256(file) };
    if (requiredPng) {
        const bytes = await fs.readFile(file);
        if (asset.mimeType !== 'image/png' || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`第 ${order + 1} 页 PNG 损坏`);
        if (nativeImage.createFromBuffer(bytes).isEmpty()) throw new Error(`第 ${order + 1} 页 PNG 无法解码`);
        result.width = bytes.readUInt32BE(16); result.height = bytes.readUInt32BE(20);
        if (result.width !== requiredPng.width || result.height !== requiredPng.height) throw new Error(`第 ${order + 1} 页尺寸与工程规格不符`);
    }
    if (role === 'video' && !result.mimeType.startsWith('video/')) throw new Error('成片不是视频素材');
    return result;
}

/** Read only authoritative engineering data. Paths, render times and cache IDs are excluded from completion identity. */
export async function readPublicationSource(input: PublicationSource, includeSession = true, requireSettings = true): Promise<PublicationSnapshot> {
    const source = PublicationSourceSchema.parse(input);
    if (source.kind === 'dream-story') return (await import('./dreamStoryPublicationSource')).readDreamPublicationSource(source.projectId, includeSession, requireSettings);
    const spaceId = getWorkspacePaths().activeSpaceId;
    let snapshot: PublicationSnapshot;
    let extra: unknown;
    let draftEpoch: number | undefined;
    if (source.kind === 'video') {
        const editor = await readProductProjectEditor(source);
        draftEpoch = editor.draftEpoch;
        if (editor.dirty) throw new Error('请先保存当前工程输入再准备发布');
        const project = editor.video!;
        if (!editor.binding.target) throw new Error('工程缺少唯一目标绑定，请先明确平台');
        const variant = await assertProductPublicationTarget(project, editor.binding.target!.platform);
        assertCurrentVideoExport(project);
        const platform = variant.target!.platform;
        const native = platform === 'douyin' ? getDouyinVideoVersionByProject(project.id) : platform === 'tiktok' ? getTikTokVideoVersionByProject(project.id) : null;
        const settings = platform === 'tiktok' && (requireSettings || (native as any)?.publishSettings) ? validateTikTokPublishSettings((native as any)?.publishSettings) : undefined;
        if (!editor.publicationCopy?.title.trim() || !editor.publicationCopy.description.trim()) throw new Error('请先填写发布标题和正文');
        const output = project.renderOutputs[0];
        const media = [await mediaFile('final-video', output.mediaAssetId!, 'video', 0)];
        if (platform === 'xiaohongshu') {
            const binding = variant.workVersion!.publicationBinding!;
            if (binding.platform !== 'xiaohongshu') throw new Error('小红书稿件绑定冲突');
            const note = await getXhsNoteProject(binding.notePath);
            if (!note.document.sourceVideoExport || note.document.sourceVideoExport.mediaAssetId !== output.mediaAssetId) throw new Error('小红书正式稿件未绑定最新成片，请重新导出');
            await assertXhsSourceExportCurrent(note.document.sourceVideoExport);
            const cover = note.document.mediaSlots.find(slot => slot.role === 'cover' && slot.status === 'ready' && slot.assetId);
            if (cover?.assetId) media.push(await mediaFile(cover.id, cover.assetId, 'cover', media.length));
        }
        if (platform === 'douyin' && native && 'coverAssetId' in native && native.coverAssetId) {
            const cover = project.assets.find(asset => asset.id === native.coverAssetId);
            if (!cover || !isPathWithinRoots(await fs.realpath(cover.projectPath), [await fs.realpath(project.projectDir)])) throw new Error('封面不属于当前工程');
            extra = createHash('sha256').update(await fs.readFile(cover.projectPath)).digest('hex');
        }
        const session = includeSession ? await getProductProjectEditorSession(source) : null;
        snapshot = { spaceId, source, platform, versionId: project.id, workId: variant.workVersion!.workId,
            revision: editor.revision, semanticDigest: '', target: variant.target, sessionId: session?.sessionId || '',
            title: editor.publicationCopy.title, body: editor.publicationCopy.description, hashtags: editor.publicationCopy.hashtags, media, settings };
    } else {
        const note = await getXhsNoteProject(source.path);
        if (source.kind === 'note' && !note.document.productImageSet) { const ref = await resolveProductNoteEditor(note.relativePath); if (ref) return readPublicationSource(ref, includeSession, requireSettings); }
        if (note.document.productImageSet) {
            const editor = await readProductProjectEditor({ kind: 'image-set', path: note.relativePath });
            draftEpoch = editor.draftEpoch;
            if (editor.dirty) throw new Error('请先保存当前套图输入再准备发布');
            const set = note.document.productImageSet;
            if (set.spaceId !== spaceId || editor.binding.target?.platform !== 'xiaohongshu' || editor.binding.target.contentKind !== 'image-set') throw new Error('套图平台或空间绑定不明确');
            assertProductEditsSettled('image-set:' + note.relativePath);
            if (requireSettings && set.pages.length > XHS_IMAGE_PUBLISH_LIMIT) throw new Error(`应用发布限制为 ${XHS_IMAGE_PUBLISH_LIMIT} 张；当前 ${set.pages.length} 张，请减少页面后重新导出。工程仍可编辑和导出`);
            if (set.pages[0]?.role !== 'cover') throw new Error('封面必须是第一张');
            const media: PublicationMedia[] = [];
            for (const [index, page] of set.pages.entries()) {
                const slot = note.document.mediaSlots.find(item => item.id === productImageSlotId(page));
                if (page.render?.inputKey !== productImageInputKey(set, page) || !slot || slot.status !== 'ready' || slot.assetId !== page.render.assetId) throw new Error(`第 ${index + 1} 页缺失或过期，请重新导出整套图片`);
                media.push(await mediaFile(slot.id, page.render.assetId, page.role === 'cover' ? 'cover' : 'image-page', index, productImageSpec(set)));
            }
            const session = includeSession ? await getProductProjectEditorSession({ kind: 'image-set', path: note.relativePath }) : null;
            snapshot = { spaceId, source: { kind: 'image-set', path: note.relativePath }, platform: 'xiaohongshu', versionId: editor.binding.workVersion!.versionId,
                workId: editor.binding.workVersion!.workId, revision: editor.revision, semanticDigest: '', target: editor.binding.target,
                sessionId: session?.sessionId || '', title: note.document.finalTitle, body: note.document.body, hashtags: note.document.hashtags, media };
        } else {
            if (note.document.sourceVideoExport) await assertXhsSourceExportCurrent(note.document.sourceVideoExport);
            if (note.document.generationStatus !== 'generated') throw new Error('稿件媒体尚未全部完成');
            const slots = note.document.mediaSlots.filter(slot => slot.status === 'ready' && slot.assetId && ['cover', 'image-page', 'video'].includes(slot.role));
            slots.sort((left, right) => (left.role === 'cover' ? -1 : right.role === 'cover' ? 1 : (note.document.imagePages.findIndex(page => page.mediaSlotId === left.id) - note.document.imagePages.findIndex(page => page.mediaSlotId === right.id))));
            if (slots.filter(slot => slot.role !== 'video').length > XHS_IMAGE_PUBLISH_LIMIT) throw new Error('应用图片发布限制为 18 张，请减少图片后重新准备');
            const media = await Promise.all(slots.map((slot, index) => mediaFile(slot.id, slot.assetId!, slot.role as PublicationMedia['role'], index)));
            let sessionId = getChatSessionByFile(note.projectPath)?.id || '';
            if (!sessionId && includeSession) sessionId = createChatSession(`publication-note-${publicationHash(note.projectPath).slice(0, 20)}`, note.document.finalTitle, { spaceId, associatedFilePath: note.projectPath }).id;
            snapshot = { spaceId, source: { kind: 'note', path: note.relativePath }, platform: 'xiaohongshu', versionId: note.relativePath, workId: note.relativePath,
                revision: String(note.version), semanticDigest: '', sessionId, title: note.document.finalTitle, body: note.document.body, hashtags: note.document.hashtags, media };
        }
    }
    if (!snapshot.title.trim() || !snapshot.body.trim() || !snapshot.media.length) throw new Error('发布标题、正文或媒体不完整');
    if (snapshot.platform === 'xiaohongshu') {
        const error = xhsTitleValidationError(snapshot.title); if (error) throw new Error(error);
    }
    snapshot.semanticDigest = publicationHash({ spaceId, versionId: snapshot.versionId, platform: snapshot.platform,
        target: snapshot.target, title: snapshot.title, body: snapshot.body, hashtags: snapshot.hashtags, settings: snapshot.settings, extra,
        media: snapshot.media.map(({ sha256, role, order, width, height, mimeType }) => ({ sha256, role, order, width, height, mimeType })) });
    // Detect new inputs or saves during filesystem hashing without overriding them.
    if (snapshot.source.kind !== 'note') {
        const latest = await readProductProjectEditor(snapshot.source as any);
        if (latest.dirty || latest.revision !== snapshot.revision || latest.draftEpoch !== draftEpoch) throw new Error('工程或输入已变化，请保存后重新准备发布');
    }
    return snapshot;
}
