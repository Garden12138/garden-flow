import path from 'node:path';
import { notifyNoteCardChanged } from './noteCardEvents';
import { generateNoteCardImage, getNoteCardGenerationConfig, recoverNoteCardGeneration } from './noteCardGeneration';
import { dialog, ipcMain } from 'electron';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { z } from 'zod';
import { noteCardMutation, noteCardTurn, readNoteCard } from './noteCardEditor';
import { importCreationSource, readCreationSource } from './creationSources';
import { readNoteCardOutputs, previewNoteCard, exportNoteCards, CardRenderRequestSchema } from './noteCardRenderService';

export function registerNoteCardIpc() {
    const handle = (name: string, operation: (input: any) => Promise<unknown>, mutate = false) => ipcMain.handle(`note-card:${name}`, async (_event, input) => {
        const spaceId = getWorkspacePaths().activeSpaceId;
        try { return await runInWorkspaceSpace(spaceId, async () => { const result = await operation(input || {}); if (mutate) notifyNoteCardChanged(); return { success: true, result }; }); }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    });
    handle('read', async input => { const target = z.string().min(1).max(2000).parse(input.path); await recoverNoteCardGeneration(target); return readNoteCardOutputs(target); });
    handle('turn', input => noteCardTurn(input.path, input.selectedId, input.policy));
    handle('save', input => noteCardMutation(input.turn, 'save', input.content), true);
    for (const operation of ['undo', 'mark', 'apply', 'dismiss'] as const) handle(operation, input => noteCardMutation(input.turn, operation), true);
    handle('import-source', importCreationSource);
    handle('source', async input => {
        const snapshot = await readNoteCard(input.path); const ref = snapshot.content.creationConfig.sourceRefs.find(ref => ref.id === input.sourceId);
        if (!ref) throw new Error('来源未绑定到当前作品');
        return readCreationSource(ref, { reread: Boolean(input.reread), offset: input.offset, limit: input.limit });
    });
    handle('preview', previewNoteCard);
    handle('generation-config', async () => getNoteCardGenerationConfig());
    handle('generate', generateNoteCardImage, true);
    handle('export', async input => {
        const request = CardRenderRequestSchema.parse(input); if (!request.format) throw new Error('缺少导出格式');
        let outputPath: string;
        if (request.format === 'directory') { const selected = await dialog.showOpenDialog({ title: '选择卡片导出目录', properties: ['openDirectory', 'createDirectory'] }); if (selected.canceled) return { canceled: true }; outputPath = path.join(selected.filePaths[0], '卡片-' + Date.now()); }
        else { const selected = await dialog.showSaveDialog({ title: '导出卡片', defaultPath: request.format === 'zip' ? '卡片.zip' : '卡片.png', filters: [{ name: request.format, extensions: [request.format] }] }); if (selected.canceled || !selected.filePath) return { canceled: true }; outputPath = selected.filePath; }
        return exportNoteCards({ ...request, outputPath });
    });
}
