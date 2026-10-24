import { z } from 'zod';
import { CiId, CiDigest } from './contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';
import { ResearchModelSchema, ResearchStartSchema, ResearchCancelSchema } from './consumerResearch.ts';
import { MetricInputSchema } from './contentExperiments.ts';
import { ExperimentTaskChangeSchema, ExperimentVariableSchema } from './contentExperimentPlans.ts';

const Text = z.string().trim().min(1).max(2000);
const Role = z.enum(['baseline', 'variant']);
export const ExplanationFactSchema = z.object({ role: Role, id: CiId, revision: z.number().int().positive(), value: z.number().finite().nonnegative(), unit: z.enum(['count', 'seconds', 'ratio']) }).strict();
export const ExplanationComparisonSchema = z.object({
    comparable: z.boolean(), interpretation: z.enum(['insufficient', 'observational']), reasons: z.array(Text).max(50),
    baseline: z.number().finite().nullable(), variant: z.number().finite().nullable(), difference: z.number().finite().nullable(), relativeChange: z.number().finite().nullable(), confounders: z.array(Text).max(50),
}).strict();
const Observation = MetricInputSchema.innerType().omit({ publicationLinkId: true, sourceNote: true });
export const ExplanationInputSchema = z.object({
    experimentId: CiId, experimentRevision: z.number().int().positive(), title: z.string().max(200), hypothesis: Text,
    variable: ExperimentVariableSchema, limitations: z.array(Text).max(20), observationRevisionsChanged: z.boolean(),
    arms: z.array(z.object({ role: Role, title: z.string().max(200), engineeringVersionKnown: z.boolean(),
        fact: ExplanationFactSchema, observation: Observation }).strict()).length(2), comparison: ExplanationComparisonSchema,
}).strict();
// Only these exact numbers and references can be treated as observations. Free text is always an unverified proposal.
export const ExperimentExplanationProposalSchema = z.object({
    basisDigest: CiDigest, facts: z.array(ExplanationFactSchema).length(2), comparison: ExplanationComparisonSchema,
    considerations: z.array(Text).max(10), suggestions: z.array(ExperimentTaskChangeSchema).max(3),
}).strict();
export const PreviewExperimentExplanationSchema = z.object({ requestId: CiId, experimentId: CiId, expectedRevision: z.number().int().positive() }).strict();
export const ExplanationRunSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, requestId: CiId, revision: z.number().int().positive(),
    input: ExplanationInputSchema, basisDigest: CiDigest, inputCharacters: z.number().int().positive().max(60000), model: ResearchModelSchema.nullable(),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']), calls: z.number().int().min(0).max(1),
    proposal: ExperimentExplanationProposalSchema.optional(),
    errorCode: z.enum(['MODEL_FAILED', 'INVALID_OUTPUT', 'SOURCE_CHANGED', 'INTERRUPTED']).optional(),
    createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const StartExperimentExplanationSchema = ResearchStartSchema;
export const CancelExperimentExplanationSchema = ResearchCancelSchema;
export type ExplanationInput = z.infer<typeof ExplanationInputSchema>;
export type ExplanationRun = z.infer<typeof ExplanationRunSchema>;
export type ExperimentExplanationProposal = z.infer<typeof ExperimentExplanationProposalSchema>;
