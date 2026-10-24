import { z } from 'zod';
import { CiId, CiDigest } from './contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';
import { MetricDefinitionSchema, MetricWorkSummarySchema, type MetricComparison } from './contentExperiments.ts';
import { supportsCreation } from './creationWorkspace.ts';

const Text = z.string().trim().min(1).max(2000);
const Timestamp = z.number().int().nonnegative().max(8640000000000000);
export const ExperimentWorkInputSchema = z.object({ workspaceId: CiId, revision: CiId, draftEpoch: z.number().int().nonnegative(), contentVersion: CiDigest }).strict();
export const ExperimentWorkSchema = ExperimentWorkInputSchema.extend({
    title: z.string().max(200), platform: MetricWorkSummarySchema.shape.platform, capability: MetricWorkSummarySchema.shape.capability,
    nativeRevision: z.string().min(1).max(240).optional(),
}).strict().refine(value => supportsCreation(value.platform, value.capability), '当前平台不支持此内容形式');
export const ExperimentVariableKindSchema = z.enum(['title', 'cover', 'opening', 'body', 'cta', 'timing', 'format', 'other']);
export const ExperimentVariableSchema = z.object({
    kind: ExperimentVariableKindSchema, name: z.string().trim().min(1).max(200), baselineTreatment: Text, variantTreatment: Text,
}).strict().refine(value => value.baselineTreatment !== value.variantTreatment, '对照和变体的单变量处理须不同');
export const CreateExperimentSchema = z.object({
    requestId: CiId, title: z.string().trim().min(1).max(200), hypothesis: Text,
    baseline: ExperimentWorkInputSchema, variant: ExperimentWorkInputSchema, variable: ExperimentVariableSchema,
    metric: MetricDefinitionSchema, limitations: z.array(Text).max(20), singleVariableAcknowledged: z.literal(true),
}).strict().refine(value => value.baseline.workspaceId !== value.variant.workspaceId, '对照和变体须为不同工程');
export const ExperimentObservationRefSchema = z.object({ id: CiId, revision: z.number().int().positive() }).strict();
export const ExperimentObservationsSchema = z.object({ baseline: ExperimentObservationRefSchema, variant: ExperimentObservationRefSchema }).strict();
export const ExperimentStatusSchema = z.enum(['draft', 'collecting', 'completed', 'archived']);
export const ContentExperimentSchema = z.object({
    version: z.literal(1), id: CiId, spaceId: WorkspaceSpaceIdSchema, requestId: CiId, revision: z.number().int().positive(),
    status: ExperimentStatusSchema, title: z.string().trim().min(1).max(200), hypothesis: Text,
    baseline: ExperimentWorkSchema, variant: ExperimentWorkSchema, variable: ExperimentVariableSchema,
    metric: MetricDefinitionSchema, limitations: z.array(Text).max(20), singleVariableAcknowledged: z.literal(true),
    observations: ExperimentObservationsSchema.optional(), createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export const BindExperimentObservationsSchema = z.object({
    id: CiId, requestId: CiId, expectedRevision: z.number().int().positive(), observations: ExperimentObservationsSchema,
}).strict();
export const TransitionExperimentSchema = z.object({ id: CiId, requestId: CiId, expectedRevision: z.number().int().positive(), to: ExperimentStatusSchema }).strict();
export const ExperimentTaskChangeSchema = z.object({
    kind: ExperimentVariableKindSchema.exclude(['format']), name: z.string().trim().min(1).max(200), before: Text, after: Text, rationale: Text,
    preserve: z.array(Text).min(1).max(20),
}).strict().refine(value => value.before !== value.after, '下一轮单变量修改前后须不同');
export const CreateExperimentTaskSchema = z.object({
    requestId: CiId, experimentId: CiId, expectedRevision: z.number().int().positive(), sourceRole: z.enum(['baseline', 'variant']),
    source: ExperimentWorkInputSchema, change: ExperimentTaskChangeSchema,
}).strict();
export const ExperimentTaskSchema = z.object({
    version: z.literal(1), id: CiId, spaceId: WorkspaceSpaceIdSchema, requestId: CiId, revision: z.number().int().positive(),
    experimentId: CiId, experimentRevision: z.number().int().positive(), sourceRole: z.enum(['baseline', 'variant']),
    source: ExperimentWorkSchema, change: ExperimentTaskChangeSchema,
    basis: z.object({ hypothesis: Text, metric: MetricDefinitionSchema, observations: ExperimentObservationsSchema.optional(), limitations: z.array(Text).max(20) }).strict(),
    creationRequestId: CiId, targetWorkspaceId: CiId, workspaceId: CiId.optional(),
    state: z.enum(['ready', 'copying', 'ready_to_edit', 'needs_review', 'cancelled']),
    errorCode: z.enum(['SOURCE_CHANGED', 'COPY_FAILED', 'INTERRUPTED', 'INCOMPLETE_COPY']).optional(),
    completionOrigin: z.enum(['guarded-copy', 'manual-review']).optional(), createdAt: Timestamp, updatedAt: Timestamp,
}).strict().superRefine((value, context) => {
    if (value.state === 'ready_to_edit' && (!value.workspaceId || !value.completionOrigin)) context.addIssue({ code: 'custom', message: '已复制任务须指向已核对的真实工程' });
    if (value.state === 'needs_review' && !value.errorCode) context.addIssue({ code: 'custom', message: '待复核任务须记录原因' });
});
export const StartExperimentTaskSchema = z.object({ id: CiId, expectedRevision: z.number().int().positive(), confirmed: z.literal(true) }).strict();
export const CancelExperimentTaskSchema = z.object({ id: CiId, expectedRevision: z.number().int().positive() }).strict();
export const ReviewExperimentTaskSchema = StartExperimentTaskSchema.extend({ workspaceId: CiId }).strict();
export type ExperimentWork = z.infer<typeof ExperimentWorkSchema>;
export type ContentExperiment = z.infer<typeof ContentExperimentSchema>;
export type ExperimentTask = z.infer<typeof ExperimentTaskSchema>;
export interface ContentExperimentDetail {
    experiment: ContentExperiment; comparison: MetricComparison | null;
    observationRevisionsChanged: boolean; tasks: ExperimentTask[];
}
