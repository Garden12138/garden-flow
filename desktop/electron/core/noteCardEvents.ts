import { BrowserWindow } from 'electron';
import { getWorkspacePaths } from '../db';
export function notifyNoteCardChanged() {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('data:changed', { scope: 'manuscripts', spaceId: getWorkspacePaths().activeSpaceId });
}
