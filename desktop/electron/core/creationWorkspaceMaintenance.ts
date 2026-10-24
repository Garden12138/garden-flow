import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { MaintenanceWorkReferenceSchema, type MaintenanceWorkReference } from '../../shared/sourceMaintenance.ts';
import { WorkspaceSpaceIdSchema } from '../../shared/workspaceSpace.ts';
import { supportsCreation } from '../../shared/creationWorkspace.ts';

export interface MaintenanceWorkspaceScan {
    spaceId: string; works: MaintenanceWorkReference[]; excludedIds: string[];
    totalWorkspaceRecords: number; excludedWorkspaces: number;
}
// Separate from the bounded work picker: a maintenance check must not silently truncate or hide unreadable records.
export async function scanCreationWorkspaceReferences(directory: string, space: string): Promise<MaintenanceWorkspaceScan> {
    const spaceId = WorkspaceSpaceIdSchema.parse(space);
    const result: MaintenanceWorkspaceScan = { spaceId, works: [], excludedIds: [], totalWorkspaceRecords: 0, excludedWorkspaces: 0 };
    try {
        const directoryStat = await fs.lstat(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('工程索引目录不是普通目录，无法安全扫描');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result; throw error; }
    const entries = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > 5000) throw new Error('工程索引超过5000条，未执行不完整的来源复核');
    result.totalWorkspaceRecords = entries.length;
    for (const entry of entries) {
        const id = /^[a-zA-Z0-9_-]{1,160}\.json$/.test(entry.name) ? entry.name.slice(0, -5) : undefined;
        let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
        try {
            if (!id || !entry.isFile()) throw new Error('非普通工程记录');
            handle = await fs.open(path.join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('工程索引记录过大或不可读');
            const value = JSON.parse(await handle.readFile('utf8'));
            if (value.version !== 1 || value.id !== id || value.spaceId !== spaceId) throw new Error('工程索引身份不一致');
            const reference = MaintenanceWorkReferenceSchema.parse({ id, spaceId, revision: value.revision, draftEpoch: value.draftEpoch,
                ...(value.sourceId === undefined ? {} : { sourceId: value.sourceId }), productId: value.draft?.productId, title: value.draft?.title,
                platform: value.platform, capability: value.capability });
            if (!supportsCreation(reference.platform, reference.capability)) throw new Error('工程索引目标不支持');
            result.works.push(reference);
        } catch {
            result.excludedWorkspaces++; if (id) result.excludedIds.push(id);
        } finally { await handle?.close(); }
    }
    return result;
}
