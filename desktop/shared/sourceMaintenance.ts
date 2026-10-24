import { z } from 'zod';
import { CiId, CiDigest, SourceIdentitySchema, type SourceSnapshot, type SourceIdentity } from './contentIntelligence.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';
import { CreationCapabilitySchema } from './creationWorkspace.ts';
import { ProductPlatformSchema } from './productCreationTarget.ts';

export const CheckSourceMaintenanceSchema = z.object({ requestId: CiId, source: SourceIdentitySchema, previousVersion: CiDigest }).strict();
export const MaintenanceSourcesQuerySchema = z.object({ afterRowId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
export const SourceFieldChangeSchema = z.object({
    kind: z.enum(['segment', 'metadata']), key: z.string().min(1).max(300), change: z.enum(['added', 'removed', 'changed']),
    previous: z.string().max(100000).nullable(), current: z.string().max(100000).nullable(),
    previousKind: z.enum(['comment', 'fact', 'text']).optional(), currentKind: z.enum(['comment', 'fact', 'text']).optional(),
}).strict();
export const MaintenanceWorkReferenceSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, revision: CiId, draftEpoch: z.number().int().nonnegative(),
    sourceId: CiId.optional(), productId: z.string().max(160), title: z.string().max(200),
    platform: ProductPlatformSchema, capability: CreationCapabilitySchema,
}).strict();
export const MaintenanceScanCoverageSchema = z.object({
    scope: z.literal('registered-creation-workspaces-and-ci-links'), totalWorkspaceRecords: z.number().int().nonnegative(),
    scannedWorkspaces: z.number().int().nonnegative(), excludedWorkspaces: z.number().int().nonnegative(),
    completeWithinScope: z.boolean(), unversionedSameProductWorkspaces: z.number().int().nonnegative(),
    legacyUnregisteredProjects: z.literal('not-enumerated'),
}).strict();
export const SourceMaintenanceImpactSchema = z.object({
    id: CiId, kind: z.enum(['evidence', 'opportunity', 'workspace']), targetId: CiId, title: z.string().max(500), versionDigest: CiDigest,
    reason: z.enum(['source-version', 'linked-opportunity', 'direct-work', 'inherited-work']),
    evidenceIds: z.array(CiId).max(100), opportunityIds: z.array(CiId).max(100),
    viaWorkspaceId: CiId.optional(), availability: z.enum(['available', 'missing', 'unreadable']).optional(),
    quoteStatus: z.enum(['matches-current-location', 'differs-current-location', 'source-unavailable']).optional(),
    targetRevision: z.string().max(240).optional(),
}).strict().superRefine((value, context) => {
    if (value.kind === 'workspace' && !value.availability) context.addIssue({ code: 'custom', message: '工程影响须注明实际可读取状态' });
    if (value.kind === 'evidence' && !value.quoteStatus) context.addIssue({ code: 'custom', message: '证据影响须注明当前定位情况' });
});
export const SourceMaintenanceReportSchema = z.object({
    version: z.literal(1), id: CiId, spaceId: WorkspaceSpaceIdSchema, source: SourceIdentitySchema, sourceTitle: z.string().max(500),
    previousVersion: CiDigest, currentVersion: CiDigest.optional(), currentAvailability: z.enum(['available', 'missing']),
    fields: z.array(SourceFieldChangeSchema).max(2004), impacts: z.array(SourceMaintenanceImpactSchema).max(2000),
    coverage: MaintenanceScanCoverageSchema, graphDigest: CiDigest, createdAt: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
    if ((value.currentAvailability === 'available') !== Boolean(value.currentVersion)) context.addIssue({ code: 'custom', message: '当前来源可用性与版本不一致' });
    if (new Set(value.impacts.map(item => item.id)).size !== value.impacts.length) context.addIssue({ code: 'custom', message: '影响项重复' });
});
export const MaintenanceDecisionActionSchema = z.enum(['keep-historical', 'collect-evidence', 'edit-manually']);
export const RecordMaintenanceDecisionSchema = z.object({
    requestId: CiId, reportId: CiId, impactId: CiId, impactVersion: CiDigest, expectedDecisionRevision: z.number().int().nonnegative(),
    action: MaintenanceDecisionActionSchema, note: z.string().trim().min(1).max(2000), confirmed: z.literal(true),
}).strict();
export const MaintenanceDecisionSchema = RecordMaintenanceDecisionSchema.omit({ expectedDecisionRevision: true, confirmed: true }).extend({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, revision: z.number().int().positive(), impact: SourceMaintenanceImpactSchema, createdAt: z.number().int().nonnegative(),
}).strict();
export type SourceMaintenanceImpact = z.infer<typeof SourceMaintenanceImpactSchema>;
export type SourceMaintenanceReport = z.infer<typeof SourceMaintenanceReportSchema>;
export type MaintenanceDecision = z.infer<typeof MaintenanceDecisionSchema>;
export type MaintenanceWorkReference = z.infer<typeof MaintenanceWorkReferenceSchema>;
export type MaintenanceScanCoverage = z.infer<typeof MaintenanceScanCoverageSchema>;
export interface MaintenanceDetail {
    report: SourceMaintenanceReport; previous: SourceSnapshot; current: SourceSnapshot | null;
    decisions: MaintenanceDecision[]; pending: number;
}
export interface MaintenanceCheckResult { changed: boolean; detail: MaintenanceDetail | null; source: SourceIdentity; previousVersion: string; currentVersion?: string; currentAvailability: 'available' | 'missing'; }
export interface MaintenanceSourceOption { rowId: number; source: SourceIdentity; version: string; title: string; capturedAt?: number; }
export interface MaintenanceReportSummary { id: string; source: SourceIdentity; sourceTitle: string; previousVersion: string; currentVersion?: string; createdAt: number; impacts: number; }
