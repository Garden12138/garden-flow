import path from 'node:path';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { getContentIntelligenceRepository, getConsumerResearchRepository, getSettings, getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { CiId } from '../../shared/contentIntelligence';
import { createBrandWorkspaceStore } from './brandWorkspaceStore';
import { getAllKnowledgeItems } from './knowledgeLoader';
import { startCreationWorkspace, readCreationWorkspace } from './creationWorkspaceStore';
import { createCiSourceAdapter } from './content-intelligence/sourceAdapters';
import { createContentIntelligenceService } from './content-intelligence/service';
import { createConsumerResearchService } from './content-intelligence/researchService';
import { createConsumerResearchModel } from './content-intelligence/researchModel';
import { requestWanderCompletion } from './wanderService';

export function registerContentIntelligenceIpc(): void {
    const sources = createCiSourceAdapter({
        products: async () => (await createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace')).list()).flatMap(group => group.products),
        knowledge: getAllKnowledgeItems,
    });
    const service = createContentIntelligenceService(getContentIntelligenceRepository(), sources, { start: startCreationWorkspace, read: readCreationWorkspace });
    const research = createConsumerResearchService(getConsumerResearchRepository(), sources,
        createConsumerResearchModel(() => (getSettings() || {}) as Record<string, unknown>, requestWanderCompletion));
    const id = (input: unknown) => z.object({ id: CiId }).strict().parse(input).id;
    const handle = (channel: string, operation: (input: unknown) => unknown) => ipcMain.handle(channel, async (_event, input) => {
        const spaceId = getWorkspacePaths().activeSpaceId;
        return runInWorkspaceSpace(spaceId, async () => {
            try { return { success: true, data: await operation(input) }; }
            catch (error) {
                // Never send filesystem errors/paths, raw provider responses or source contents to diagnostics.
                const message = error instanceof z.ZodError ? '输入不符合内容研究契约' : error instanceof Error ? error.message : '内容研究操作失败';
                return { success: false, error: /(?:ENOENT|EACCES|EPERM|[\\/])/.test(message) ? '本地资料读取失败，请确认来源仍可用' : message };
            }
        });
    });
    handle('ci:sources', input => { z.object({}).strict().parse(input); return service.listSources(); });
    handle('ci:source', service.readSource);
    handle('ci:evidence-add', service.addEvidence);
    handle('ci:evidence-source', input => service.evidenceSource(id(input)));
    handle('ci:opportunity-create', service.createOpportunity);
    handle('ci:opportunity-list', service.listOpportunities);
    handle('ci:opportunity-get', input => service.getOpportunity(id(input)));
    handle('ci:opportunity-transition', service.transitionOpportunity);
    handle('ci:work-create', service.createWork);
    handle('ci:work-evidence', input => service.workEvidence(id(input)));
    handle('ci:research-preview', research.preview);
    handle('ci:research-start', research.start);
    handle('ci:research-get', input => research.get(id(input)));
    handle('ci:research-input', input => getConsumerResearchRepository().references(id(input)));
    handle('ci:research-list', input => { z.object({}).strict().parse(input); return research.list(); });
    handle('ci:research-cancel', research.cancel);
}
