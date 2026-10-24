import { z } from 'zod';
import { CiId } from './contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';
import { CreationCapabilitySchema, supportsCreation } from './creationWorkspace.ts';
import { ProductPlatformSchema } from './productCreationTarget.ts';

const Text = z.string().trim().min(1).max(2000);
const Revision = z.number().int().positive();
export const CampaignOpportunityRefSchema = z.object({ id: CiId, revision: Revision }).strict();
export const CampaignRoleSchema = z.enum(['awareness', 'education', 'objection', 'demonstration', 'conversion-support']);
export const CAMPAIGN_ROLE_LABELS = { awareness: '认知', education: '教育', objection: '顾虑解答', demonstration: '演示', 'conversion-support': '购买前支持' } as const;
export const CampaignTargetSchema = z.object({ platform: ProductPlatformSchema, capability: CreationCapabilitySchema.exclude(['dream-story']) }).strict()
    .refine(value => supportsCreation(value.platform, value.capability), '当前平台不支持此内容形式');
export const CampaignCandidateSchema = z.object({
    role: CampaignRoleSchema, title: z.string().trim().min(1).max(200), why: Text,
    opportunity: CampaignOpportunityRefSchema, evidenceRefs: z.array(CiId).min(1).max(20), target: CampaignTargetSchema,
    assetNeeds: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();
export const CampaignItemSchema = CampaignCandidateSchema.extend({
    id: CiId, revision: Revision, origin: z.enum(['manual', 'agent']),
    dependencies: z.array(CiId).max(7), creationRequestId: CiId,
    state: z.enum(['planned', 'creating', 'needs_review', 'linked']), workspaceId: CiId.optional(),
    errorCode: z.enum(['INTERRUPTED', 'CREATE_FAILED']).optional(),
}).strict();
export const ContentCampaignSchema = z.object({
    version: z.literal(1), id: CiId, spaceId: WorkspaceSpaceIdSchema, requestId: CiId, revision: Revision,
    title: z.string().trim().min(1).max(200), goal: Text, audience: Text, productId: CiId.optional(),
    platforms: z.array(ProductPlatformSchema).min(1).max(3), opportunities: z.array(CampaignOpportunityRefSchema).min(1).max(10),
    limitations: z.array(Text).max(20), items: z.array(CampaignItemSchema).max(8), planVersion: Revision,
    confirmedPlanVersion: Revision.optional(), status: z.enum(['active', 'archived']),
    createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
    const seen = new Set<string>();
    for (const item of value.items) {
        if (seen.has(item.id) || item.dependencies.some(id => !seen.has(id))) context.addIssue({ code: 'custom', message: '内容项身份重复或依赖顺序无效' });
        if (item.state === 'linked' && !item.workspaceId) context.addIssue({ code: 'custom', message: '已关联项缺少工程' });
        seen.add(item.id);
    }
});
export const CreateCampaignSchema = z.object({
    requestId: CiId, title: z.string().trim().min(1).max(200), goal: Text, audience: Text, productId: CiId.optional(),
    platforms: z.array(ProductPlatformSchema).min(1).max(3), opportunities: z.array(CampaignOpportunityRefSchema).min(1).max(10), limitations: z.array(Text).max(20),
}).strict();
export const CampaignMutationSchema = z.object({ id: CiId, requestId: CiId, expectedRevision: Revision }).strict();
export const AddCampaignItemSchema = CampaignMutationSchema.extend({ item: CampaignCandidateSchema, dependencies: z.array(CiId).max(7) }).strict();
export const UpdateCampaignItemSchema = AddCampaignItemSchema.extend({ itemId: CiId }).strict();
export const ProposeCampaignItemsSchema = CampaignMutationSchema.extend({
    items: z.array(CampaignCandidateSchema.extend({ dependsOn: z.array(z.number().int().nonnegative().max(7)).max(7) }).strict()).min(3).max(8),
}).strict().superRefine((value, context) => {
    if (new Set(value.items.map(item => item.role)).size < 3) context.addIssue({ code: 'custom', message: '成组提议须至少承担三种不同角色' });
    value.items.forEach((item, index) => { if (item.dependsOn.some(prior => prior >= index)) context.addIssue({ code: 'custom', message: '依赖只能指向本组前面的条目' }); });
});
export const ReorderCampaignSchema = CampaignMutationSchema.extend({ itemIds: z.array(CiId).max(8) }).strict();
export const ArchiveCampaignSchema = CampaignMutationSchema.extend({ archived: z.boolean() }).strict();
export const ConfirmCampaignSchema = CampaignMutationSchema.extend({ confirmed: z.literal(true) }).strict();
export const CreateCampaignWorkSchema = z.object({ id: CiId, itemId: CiId, expectedItemRevision: Revision, confirmed: z.literal(true) }).strict();
export type ContentCampaign = z.infer<typeof ContentCampaignSchema>;
export type CampaignItem = z.infer<typeof CampaignItemSchema>;
export type CampaignCandidate = z.infer<typeof CampaignCandidateSchema>;
export interface CampaignWorkStatus {
    itemId: string; workspaceId?: string; availability: 'not-created' | 'available' | 'missing';
    title?: string; revision?: string; draftEpoch?: number; exportedVersions: number; publicationLinks: number; observations: number;
    publicationStates: { declared: number; submitted: number; published: number };
    publicationStatesPartial: boolean;
}
export interface CampaignDetail { campaign: ContentCampaign; works: CampaignWorkStatus[]; }
