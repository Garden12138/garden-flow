import path from 'node:path';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { getContentIntelligenceRepository, getConsumerResearchRepository, getContentMetricsRepository, getContentExperimentsRepository, getExperimentExplanationRepository, getSettings, getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { CiId } from '../../shared/contentIntelligence';
import { createBrandWorkspaceStore } from './brandWorkspaceStore';
import { getAllKnowledgeItems } from './knowledgeLoader';
import { startCreationWorkspace, readCreationWorkspace, listCreationWorkspaceSummaries, inspectCreationWorkspace, forkCreationWorkspace, creationWorkspaceIdForRequest } from './creationWorkspaceStore';
import { createCiSourceAdapter } from './content-intelligence/sourceAdapters';
import { createContentIntelligenceService } from './content-intelligence/service';
import { createConsumerResearchService } from './content-intelligence/researchService';
import { createConsumerResearchModel } from './content-intelligence/researchModel';
import { requestWanderCompletion } from './wanderService';
import { createContentMetricsService } from './content-intelligence/metricsService';
import { listPublicationJobs } from './unifiedPublisherService';
import { createContentExperimentsService } from './content-intelligence/experimentsService';
import { createExperimentExplanationService } from './content-intelligence/explanationService';
import { createExperimentExplanationModel } from './content-intelligence/explanationModel';
import { createLocalContentCampaignsService } from './content-intelligence/campaignsRuntime';

export function registerContentIntelligenceIpc(): void {
    const sources = createCiSourceAdapter({
        products: async () => (await createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace')).list()).flatMap(group => group.products),
        knowledge: getAllKnowledgeItems,
    });
    const service = createContentIntelligenceService(getContentIntelligenceRepository(), sources, { start: startCreationWorkspace, read: readCreationWorkspace });
    const research = createConsumerResearchService(getConsumerResearchRepository(), sources,
        createConsumerResearchModel(() => (getSettings() || {}) as Record<string, unknown>, requestWanderCompletion));
    const metrics = getContentMetricsRepository();
    const metricService = createContentMetricsService(metrics, { readWork: readCreationWorkspace, jobs: listPublicationJobs, readNativeRevision: async id => (await inspectCreationWorkspace(id)).nativeRevision });
    const experiments = createContentExperimentsService(getContentExperimentsRepository(), { inspect: inspectCreationWorkspace, fork: forkCreationWorkspace, idForRequest: creationWorkspaceIdForRequest });
    const explanations = createExperimentExplanationService(getExperimentExplanationRepository(), createExperimentExplanationModel(() => (getSettings() || {}) as Record<string, unknown>, requestWanderCompletion));
    const campaigns = createLocalContentCampaignsService();
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
    handle('ci:metric-works', input => { z.object({}).strict().parse(input); return listCreationWorkspaceSummaries(); });
    handle('ci:publication-manual', metricService.attachManual);
    handle('ci:publication-external', metricService.attachExternal);
    handle('ci:publication-sync', input => metricService.syncWork(id(input)));
    handle('ci:publication-list', input => { z.object({}).strict().parse(input); return metrics.publications(); });
    handle('ci:metric-preview', metrics.preview);
    handle('ci:metric-import', metrics.importCsv);
    handle('ci:metric-list', input => { z.object({}).strict().parse(input); return metrics.observations(); });
    handle('ci:metric-history', input => metrics.history(id(input)));
    handle('ci:metric-compare', input => {
        const request = z.object({ baselineId: CiId, variantId: CiId, baselineRevision: z.number().int().positive(), variantRevision: z.number().int().positive() }).strict().parse(input);
        return metricService.compare(request.baselineId, request.variantId, request.baselineRevision, request.variantRevision);
    });
    handle('ci:experiment-inspect', input => experiments.inspect(id(input)));
    handle('ci:experiment-create', experiments.create);
    handle('ci:experiment-list', input => { z.object({}).strict().parse(input); return experiments.list(); });
    handle('ci:experiment-detail', input => experiments.detail(id(input)));
    handle('ci:experiment-bind', experiments.bind);
    handle('ci:experiment-transition', experiments.transition);
    handle('ci:experiment-task-create', experiments.createTask);
    handle('ci:experiment-task-start', experiments.startTask);
    handle('ci:experiment-task-review', experiments.reviewTask);
    handle('ci:experiment-task-cancel', experiments.cancelTask);
    handle('ci:experiment-tasks', input => {
        const request = z.object({ experimentId: CiId.optional(), workspaceId: CiId.optional() }).strict().parse(input);
        return experiments.tasks(request.experimentId, request.workspaceId);
    });
    handle('ci:explanation-preview', explanations.preview);
    handle('ci:explanation-start', explanations.start);
    handle('ci:explanation-cancel', explanations.cancel);
    handle('ci:explanation-get', input => explanations.get(id(input)));
    handle('ci:explanation-list', input => explanations.list(id(input)));
    handle('ci:campaign-list', input => { z.object({}).strict().parse(input); return campaigns.list(); });
    handle('ci:campaign-create', campaigns.create);
    handle('ci:campaign-detail', input => campaigns.detail(id(input)));
    handle('ci:campaign-context', input => campaigns.planningContext(id(input)));
    handle('ci:campaign-add', campaigns.add);
    handle('ci:campaign-propose', campaigns.propose);
    handle('ci:campaign-update-item', campaigns.updateItem);
    handle('ci:campaign-order', campaigns.reorder);
    handle('ci:campaign-confirm', campaigns.confirm);
    handle('ci:campaign-archive', campaigns.archive);
    handle('ci:campaign-work', campaigns.createWork);
    handle('ci:campaign-work-context', input => campaigns.forWork(id(input)));
}
