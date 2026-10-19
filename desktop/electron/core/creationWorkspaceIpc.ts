import { ipcMain, BrowserWindow } from 'electron';
import { getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { CreationTurnSchema } from '../../shared/creationWorkspace';
import { startCreationWorkspace, readCreationWorkspace, saveCreationWorkspace, markCreationDraft, materializeCreationWorkspace, undoCreationWorkspace, forkCreationWorkspace, creationProductSources, onCreationWorkspaceChanged } from './creationWorkspaceStore';
export function registerCreationWorkspaceIpc(): void {
    const handle = (channel: string, operation: (input: any) => Promise<unknown>) => ipcMain.handle(channel, async (_event, input) => {
        const spaceId = getWorkspacePaths().activeSpaceId;
        try { return await runInWorkspaceSpace(spaceId, async () => ({ success: true, workspace: await operation(input || {}) })); }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    });
    const id = (input: { workspaceId: string }) => CreationTurnSchema.shape.workspaceId.parse(input.workspaceId);
    handle('creation-workspace:start', startCreationWorkspace);
    handle('creation-workspace:read', input => readCreationWorkspace(id(input)));
    handle('creation-workspace:save', saveCreationWorkspace);
    handle('creation-workspace:draft', input => markCreationDraft(id(input)));
    handle('creation-workspace:undo', undoCreationWorkspace);
    handle('creation-workspace:materialize', materializeCreationWorkspace);
    handle('creation-workspace:fork', input => forkCreationWorkspace(id(input), input.selection));
    ipcMain.handle('creation-workspace:sources', async (_event, input) => {
        const spaceId = getWorkspacePaths().activeSpaceId;
        try { return await runInWorkspaceSpace(spaceId, async () => ({ success: true, product: await creationProductSources(id(input)) })); }
        catch (error) { return { success: false, error: String(error) }; }
    });
    onCreationWorkspaceChanged(record => {
        for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) {
            window.webContents.send('data:changed', { scope: 'creation-workspaces', entityId: record.id, spaceId: record.spaceId });
            window.webContents.send('data:changed', { scope: 'chat-sessions', entityId: record.sessionId, spaceId: record.spaceId });
        }
    });
}
