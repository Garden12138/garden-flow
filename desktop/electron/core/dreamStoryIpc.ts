import fs from 'node:fs/promises';
import { isPathWithinRoots } from './localAssetManager';
import { ipcMain, dialog } from 'electron';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { DreamIdSchema } from '../../shared/dreamStory';
import { createDreamStory, readDreamStory, applyDreamEdit, markDreamDraft, getDreamSession, recoverDreamOperations,
    assertDreamRequest, copyDreamStoryTarget } from './dreamStoryStore';
import { previewDreamBatch, confirmDreamBatch, reconcileDreamMedia, bindDreamMedia, approveDreamImage, cancelDreamBatch } from './dreamStoryMediaService';
import { renderDreamStory } from './dreamStoryRenderService';
import { previewDreamImport, confirmDreamImport, exportDreamStory } from './dreamStoryTransferService';
import { listVideoEditorV2Projects } from './video-editor-v2/videoEditorV2ProjectStore';

export function registerDreamStoryIpc(): void {
    const handle = (channel: string, work: (payload: any, event: Electron.IpcMainInvokeEvent) => Promise<Record<string, unknown>>) => ipcMain.handle(channel, async (_event, payload) => {
        const spaceId = getWorkspacePaths().activeSpaceId;
        try { return await runInWorkspaceSpace(spaceId, async () => ({ success: true, ...await work(payload || {}, _event) })); }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    });
    handle('dream-story:create', async () => ({ project: await createDreamStory() }));
    handle('dream-story:read', async input => ({ project: await readDreamStory(input.projectId) }));
    handle('dream-story:list', async () => ({ projects: (await listVideoEditorV2Projects()).filter(project => project.projectKind === 'dream-story') }));
    handle('dream-story:edit', async input => ({ project: await applyDreamEdit(input) }));
    handle('dream-story:draft', async input => { DreamIdSchema.parse(input.projectId); if (typeof input.dirty !== 'boolean') throw new Error('草稿状态无效'); return { project: await markDreamDraft(input.projectId, input.dirty) }; });
    handle('dream-story:session', async input => getDreamSession(input.projectId));
    handle('dream-story:batch-preview', async input => ({ batch: await previewDreamBatch(input) }));
    handle('dream-story:batch-confirm', async input => ({ batch: await confirmDreamBatch(input) }));
    handle('dream-story:batch-cancel', async input => { await cancelDreamBatch(input.projectId, input.batchId); return { project: await readDreamStory(input.projectId) }; });
    handle('dream-story:media-status', async input => ({ ...await reconcileDreamMedia(input.projectId), project: await readDreamStory(input.projectId) }));
    handle('dream-story:image-approve', async input => { await approveDreamImage(input); return { project: await readDreamStory(input.projectId) }; });
    handle('dream-story:media-import', async input => {
        const project = await readDreamStory(input.projectId); assertDreamRequest(project, input);
        if (!['image', 'audio', 'video', 'music', 'reference'].includes(input.kind)) throw new Error('媒体类型无效');
        if (input.referenceOwner && (!['character', 'setting'].includes(input.referenceOwner.kind) || !DreamIdSchema.safeParse(input.referenceOwner.id).success)) throw new Error('参考对象无效');
        const existing = input.assetId ? project.assets.find(asset => asset.id === DreamIdSchema.parse(input.assetId) && asset.kind === input.kind) : undefined;
        if (existing && !isPathWithinRoots(await fs.realpath(existing.projectPath), [await fs.realpath(project.projectDir)])) throw new Error('候选素材越出当前工程');
        if (input.assetId && !existing) throw new Error('候选素材不属于当前工程或类型不符');
        const pick = existing ? { canceled: false, filePaths: [existing.projectPath] } : await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: input.kind === 'image' || input.kind === 'reference' ? '图片' : input.kind === 'video' ? '视频' : '音频', extensions: input.kind === 'image' || input.kind === 'reference' ? ['png', 'jpg', 'jpeg', 'webp'] : input.kind === 'video' ? ['mp4', 'mov', 'webm'] : ['mp3', 'wav', 'm4a', 'aac', 'ogg'] }] });
        if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
        assertDreamRequest(await readDreamStory(project.id), input);
        await bindDreamMedia(project.id, input.sceneId, input.kind, pick.filePaths[0], undefined, undefined, undefined, input, input.referenceOwner); return { project: await readDreamStory(project.id) };
    });
    handle('dream-story:render', async (input, event) => { if (typeof input.preview !== 'boolean') throw new Error('请选择预览或正式导出'); return renderDreamStory(input, progress => { if (!event.sender.isDestroyed()) event.sender.send('dream-story:render-progress', progress); }); });
    handle('dream-story:export', async input => {
        const project = await readDreamStory(input.projectId); assertDreamRequest(project, input);
        const extensions: Record<string, string> = { json: 'json', markdown: 'md', srt: 'srt', mp4: 'mp4', share: 'zip', backup: 'zip' };
        const ext = extensions[input.format]; if (!ext) throw new Error('导出格式无效');
        const chosen = await dialog.showSaveDialog({ defaultPath: 'dream-story.' + ext, filters: [{ name: '梦境作品', extensions: [ext] }] });
        if (chosen.canceled || !chosen.filePath) return { canceled: true };
        assertDreamRequest(await readDreamStory(project.id), input);
        await exportDreamStory(project.id, chosen.filePath, input.format, input.includePrivate === true); return { outputPath: chosen.filePath };
    });
    handle('dream-story:import-preview', async () => {
        const pick = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '旧导演包 JSON', extensions: ['json'] }] });
        if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
        return { importPreview: await previewDreamImport(pick.filePaths[0]) };
    });
    handle('dream-story:import-confirm', async input => ({ project: await confirmDreamImport(DreamIdSchema.parse(input.id)) }));
    handle('dream-story:copy-target', async input => ({ project: await copyDreamStoryTarget(input) }));
    void recoverDreamOperations().catch(error => console.warn('[DreamStory] recovery failed', error instanceof Error ? error.message : 'unknown'));
}
