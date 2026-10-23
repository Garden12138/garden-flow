import { z } from 'zod';
import { CiId, CiDigest, SourceCoverageSchema, SourceIdentitySchema, OpportunityScoreSchema, ResearchOpportunityMetadataSchema } from './contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';
import { CreationCapabilitySchema } from './creationWorkspace.ts';

const Text = z.string().trim().min(1).max(2000);
export const ResearchScopeSchema = z.object({
    sources: z.array(z.object({ source: SourceIdentitySchema, version: CiDigest }).strict()).min(1).max(20),
    maxComments: z.number().int().min(0).max(200).default(100),
    completeOnly: z.boolean().default(false), goal: z.string().max(1000).default(''),
}).strict();
export const PreviewResearchSchema = z.object({ requestId: CiId, scope: ResearchScopeSchema }).strict();
export const ResearchReferenceSchema = z.object({
    id: CiId, source: SourceIdentitySchema, version: CiDigest, key: z.string().min(1).max(300),
    kind: z.enum(['comment', 'fact', 'text']), text: z.string().min(1).max(2000),
}).strict();
export const ResearchModelSchema = z.object({
    sourceId: z.string().max(160), name: z.string().min(1).max(200), host: z.string().min(1).max(300), fingerprint: CiDigest,
}).strict();
export const ResearchStatusSchema = z.enum(['queued', 'running', 'interrupted', 'partial', 'succeeded', 'failed', 'cancelled']);
const QuoteSchema = z.object({ refId: CiId, quote: Text }).strict();
// Uses WanderCommentInsight field names; the model supplies semantic proposals only.
export const ConsumerProposalSchema = z.object({
    comment_insight: z.object({ questions: z.array(Text).max(20), pain_points: z.array(Text).max(20), objections: z.array(Text).max(20), demand_signals: z.array(Text).max(20), opportunity: z.string().max(2000) }).strict(),
    insights: z.array(z.object({
        category: z.enum(['question', 'usage_obstacle', 'objection', 'demand_signal', 'content_angle']), statement: Text,
        supportRefs: z.array(QuoteSchema).max(20), counterRefs: z.array(QuoteSchema).max(20), uncertainties: z.array(Text).max(20),
    }).strict()).max(10),
    opportunities: z.array(z.object({
        insightIndex: z.number().int().nonnegative(), title: Text, problem: Text, audience: Text, angle: Text,
        suggestedFormats: z.array(CreationCapabilitySchema.exclude(['dream-story'])).max(5), missingEvidence: z.array(Text).max(20),
        scores: z.object({ evidence: OpportunityScoreSchema, fit: OpportunityScoreSchema, feasibility: OpportunityScoreSchema, business: OpportunityScoreSchema, freshness: OpportunityScoreSchema }).strict(),
    }).strict()).max(10),
}).strict();
export const ResearchRunSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, requestId: CiId, sourceDigest: CiDigest, scope: ResearchScopeSchema,
    model: ResearchModelSchema.nullable(), status: ResearchStatusSchema, revision: z.number().int().positive(),
    coverage: SourceCoverageSchema, sourceCount: z.number().int().nonnegative(), referenceCount: z.number().int().nonnegative(),
    commentCount: z.number().int().nonnegative(), inputCharacters: z.number().int().nonnegative(),
    opportunityIds: z.array(CiId).max(10), issues: z.array(Text).max(100), calls: z.number().int().min(0).max(1),
    errorCode: z.enum(['MODEL_NOT_CONFIGURED', 'MODEL_FAILED', 'INVALID_OUTPUT', 'SOURCE_CHANGED', 'INTERRUPTED']).optional(),
    createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const ResearchStartSchema = z.object({ id: CiId, expectedRevision: z.number().int().positive(), consent: z.literal(true), modelFingerprint: CiDigest }).strict();
export { ResearchOpportunityMetadataSchema };
export type ResearchScope = z.infer<typeof ResearchScopeSchema>;
export type ResearchRun = z.infer<typeof ResearchRunSchema>;
export type ResearchReference = z.infer<typeof ResearchReferenceSchema>;
export type ResearchModel = z.infer<typeof ResearchModelSchema>;
export type ConsumerProposal = z.infer<typeof ConsumerProposalSchema>;
