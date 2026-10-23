import { z } from 'zod';
import { CiId, CiDigest } from './contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';
import { PublicationPlatformSchema } from './publication.ts';
import { CreationCapabilitySchema } from './creationWorkspace.ts';

const Timestamp = z.number().int().nonnegative().max(8640000000000000);
const Text = z.string().trim().min(1).max(2000);
export const MetricTimeZoneSchema = z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, '时间区无效');
export const MetricWindowSchema = z.object({
    startAt: Timestamp, endAt: Timestamp, timeZone: MetricTimeZoneSchema,
    alignment: z.enum(['calendar', 'post-age']),
    ageStartMs: z.number().int().nonnegative().max(8640000000000000).optional(),
    ageEndMs: z.number().int().positive().max(8640000000000000).optional(),
}).strict().superRefine((value, context) => {
    if (value.endAt <= value.startAt) context.addIssue({ code: 'custom', message: '观察窗口结束时间须晚于开始时间' });
    if (value.alignment === 'post-age') {
        if (value.ageStartMs === undefined || value.ageEndMs === undefined || value.ageEndMs <= value.ageStartMs
            || value.ageEndMs - value.ageStartMs !== value.endAt - value.startAt) {
            context.addIssue({ code: 'custom', message: '发布后时龄须与观察窗口时长一致' });
        }
    } else if (value.ageStartMs !== undefined || value.ageEndMs !== undefined) context.addIssue({ code: 'custom', message: '日历窗口不能含发布后时龄' });
});
export const MetricDefinitionSchema = z.object({ key: CiId, definition: Text, unit: z.enum(['count', 'seconds', 'ratio']) }).strict();
export const MetricInputSchema = z.object({
    publicationLinkId: CiId, metric: MetricDefinitionSchema, window: MetricWindowSchema,
    value: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    confounders: z.array(z.string().trim().min(1).max(500)).max(20), sourceNote: Text,
    observedAt: Timestamp.optional(), // Legacy observations remain unknown rather than inheriting their import time.
}).strict().superRefine((value, context) => {
    if (value.metric.unit === 'count' && !Number.isSafeInteger(value.value)) context.addIssue({ code: 'custom', message: '计数须为安全整数' });
    if (value.metric.unit === 'ratio' && value.value > 1) context.addIssue({ code: 'custom', message: '比例须在 0–1 之间' });
});
export const PublicationLinkSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, workspaceId: CiId, workspaceRevision: CiId,
    platform: PublicationPlatformSchema, accountAlias: z.string().trim().min(1).max(100),
    externalWorkId: CiId.optional(), url: z.string().url().max(2000).optional(),
    origin: z.enum(['manual', 'submission', 'receipt']), status: z.enum(['declared-published', 'submitted', 'published']),
    sourceNote: Text, jobId: CiId.optional(), nativeRevision: z.string().min(1).max(240).optional(),
    contentDigest: CiDigest.optional(), observedAt: Timestamp, createdAt: Timestamp,
}).strict();
export const ManualPublicationLinkSchema = z.object({
    requestId: CiId, workspaceId: CiId, expectedRevision: CiId, platform: PublicationPlatformSchema,
    accountAlias: z.string().trim().min(1).max(100), externalWorkId: CiId,
    url: z.string().url().max(2000).optional(), sourceNote: Text, observedAt: Timestamp,
}).strict();
export const MetricObservationSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, revision: z.number().int().positive(),
    input: MetricInputSchema, importDigest: CiDigest, recordedAt: Timestamp,
}).strict();
const RequiredMetricCsvFields = ['publicationLinkId', 'metric', 'definition', 'unit', 'value', 'start', 'end', 'timeZone', 'alignment', 'ageStartHours', 'ageEndHours', 'confounders', 'sourceNote'] as const;
export const MetricCsvFields = [...RequiredMetricCsvFields, 'observedAt'] as const;
export const MetricCsvMappingSchema = z.object(Object.fromEntries(RequiredMetricCsvFields.map(field => [field, z.string().trim().min(1).max(160)])) as Record<typeof RequiredMetricCsvFields[number], z.ZodString>)
    .extend({ observedAt: z.string().trim().max(160).transform(value => value || undefined).optional() }).strict();
export const MetricCsvPreviewSchema = z.object({ csv: z.string().min(1).max(1000000), mapping: MetricCsvMappingSchema }).strict();
export const MetricCsvImportSchema = MetricCsvPreviewSchema.extend({ requestId: CiId, previewDigest: CiDigest, confirmed: z.literal(true), reviseConflicts: z.boolean() }).strict();
export type PublicationLink = z.infer<typeof PublicationLinkSchema>;
export type MetricInput = z.infer<typeof MetricInputSchema>;
export type MetricObservation = z.infer<typeof MetricObservationSchema>;
export interface MetricImportRow {
    row: number; status: 'new' | 'duplicate' | 'conflict' | 'error';
    input?: MetricInput; observationId?: string; expectedRevision?: number; error?: string;
}
export interface MetricImportPreview { digest: string; rows: MetricImportRow[]; headers: string[]; }
export interface MetricComparison {
    comparable: boolean; reasons: string[]; baseline: number | null; variant: number | null;
    difference: number | null; relativeChange: number | null; confounders: string[];
    interpretation: 'insufficient' | 'observational';
}
export const MetricWorkSummarySchema = z.object({
    id: CiId, revision: CiId, draftEpoch: z.number().int().nonnegative(), platform: PublicationPlatformSchema,
    capability: CreationCapabilitySchema, updatedAt: z.string().datetime({ offset: true }), title: z.string().max(200),
}).strict();
export type MetricWorkSummary = z.infer<typeof MetricWorkSummarySchema>;
