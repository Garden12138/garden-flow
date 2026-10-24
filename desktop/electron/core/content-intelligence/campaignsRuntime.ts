import path from 'node:path';
import { getContentCampaignsRepository, getContentIntelligenceRepository, getContentMetricsRepository, getWorkspacePaths, listPublicationCompletions } from '../../db';
import { CampaignProductResourcesSchema } from '../../../shared/contentCampaigns';
import { createBrandWorkspaceStore } from '../brandWorkspaceStore';
import { getAllKnowledgeItems } from '../knowledgeLoader';
import { startCreationWorkspace, readCreationWorkspace, inspectCreationWorkspace } from '../creationWorkspaceStore';
import { listPublicationJobs } from '../unifiedPublisherService';
import { createCiSourceAdapter } from './sourceAdapters';
import { createContentIntelligenceService } from './service';
import { createContentCampaignsService } from './campaignsService';

export function createLocalContentCampaignsService() {
    const products = () => createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace'));
    const sources = createCiSourceAdapter({ products: async () => (await products().list()).flatMap(group => group.products), knowledge: getAllKnowledgeItems });
    const intelligence = createContentIntelligenceService(getContentIntelligenceRepository(), sources, { start: startCreationWorkspace, read: readCreationWorkspace });
    return createContentCampaignsService(getContentCampaignsRepository(), intelligence, getContentMetricsRepository(), {
        read: async id => (await inspectCreationWorkspace(id)).workspace, completions: listPublicationCompletions, jobs: listPublicationJobs,
        resources: async ids => Promise.all(ids.map(async id => {
            const product = await products().getProductCreativeReference(id);
            return CampaignProductResourcesSchema.parse({ id: product.id, name: product.name, version: product.productVersion,
                facts: product.facts.slice(0, 60), catalogAssets: product.assets.slice(0, 80).map(asset => ({ id: asset.id, role: asset.role })),
                catalogAssetCount: product.assets.length, partial: product.facts.length > 60 || product.assets.length > 80, availability: 'catalog-only-not-file-verified' });
        })),
    });
}
