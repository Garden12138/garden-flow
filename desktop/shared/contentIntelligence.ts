import { z } from 'zod';
import { CreationCapabilitySchema, supportsCreation } from './creationWorkspace.ts';
import { ProductPlatformSchema } from './productCreationTarget.ts';
import { CreationPresetSchema } from './noteCards.ts';
import { WorkspaceSpaceIdSchema } from './workspaceSpace.ts';

export const CiId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const CiDigest = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.number().int().nonnegative().max(8640000000000000);
const Text = z.string().trim().min(1).max(4000);
export const SourceIdentitySchema = z.object({
    kind: z.enum(['product', 'social', 'document']),
    namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,240}$/),
}).strict();
export const SourceCoverageSchema = z.object({
    captured: z.number().int().nonnegative(), requested: z.number().int().nonnegative().optional(),
    partial: z.boolean(), issues: z.array(z.string().max(500)).max(40),
}).strict();
export const SourceSnapshotSchema = z.object({
    source: SourceIdentitySchema, version: CiDigest, title: z.string().max(500),
    capturedAt: Timestamp.optional(), sourceUrl: z.string().url().max(2000).optional(),
    coverage: SourceCoverageSchema,
    segments: z.array(z.object({ key: z.string().min(1).max(300), text: z.string().max(100000),
        kind: z.enum(['comment', 'fact', 'text']), }).strict()).max(1000),
}).strict().superRefine((value, context) => {
    if (new Set(value.segments.map(segment => segment.key)).size !== value.segments.length) context.addIssue({ code: 'custom', message: '来源定位重复' });
    if (value.segments.reduce((total, segment) => total + segment.text.length, 0) > 500000) context.addIssue({ code: 'custom', message: '来源过大，请缩小范围' });
});
export const EvidenceLocatorSchema = z.object({
    key: z.string().min(1).max(300), start: z.number().int().nonnegative(), end: z.number().int().positive(),
}).strict().refine(value => value.end > value.start && value.end - value.start <= 2000, '引用范围不合法');
export const ContentEvidenceSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, source: SourceIdentitySchema, sourceVersion: CiDigest,
    locator: EvidenceLocatorSchema, excerpt: z.string().min(1).max(2000),
    validity: z.enum(['verified', 'stale', 'missing', 'unverifiable']),
    coverage: SourceCoverageSchema, createdAt: Timestamp,
}).strict();
export const EvidenceRelationSchema = z.object({ id: CiId, relation: z.enum(['supports', 'contradicts', 'context']) }).strict();
export const OpportunityStatusSchema = z.enum(['proposed', 'accepted', 'needs_evidence', 'dismissed', 'archived']);
export const CreateOpportunitySchema = z.object({
    requestId: CiId, title: Text, problem: Text, audience: Text, angle: Text,
    evidence: z.array(EvidenceRelationSchema).max(100).default([]),
}).strict();
export const OpportunitySchema = CreateOpportunitySchema.omit({ requestId: true }).extend({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, status: OpportunityStatusSchema, revision: z.number().int().positive(),
    basis: z.enum(['evidence', 'hypothesis']), createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export const TransitionOpportunitySchema = z.object({
    id: CiId, requestId: CiId, expectedRevision: z.number().int().positive(), to: OpportunityStatusSchema,
}).strict();
export function canTransitionOpportunity(from: OpportunityStatus, to: OpportunityStatus): boolean {
    const transitions: Record<OpportunityStatus, OpportunityStatus[]> = {
        proposed: ['accepted', 'needs_evidence', 'dismissed', 'archived'],
        accepted: ['proposed', 'needs_evidence', 'dismissed', 'archived'],
        needs_evidence: ['proposed', 'accepted', 'dismissed', 'archived'],
        dismissed: ['proposed', 'needs_evidence', 'archived'], archived: ['proposed'],
    };
    return transitions[from].includes(to);
}
export const CiListSchema = z.object({
    status: OpportunityStatusSchema.optional(), after: CiId.optional(), limit: z.number().int().min(1).max(100).default(30),
}).strict();
export const AddEvidenceSchema = z.object({
    source: SourceIdentitySchema, version: CiDigest, locator: EvidenceLocatorSchema, excerpt: z.string().min(1).max(2000),
}).strict();
export const CreateOpportunityWorkSchema = z.object({
    opportunityId: CiId, requestId: CiId, expectedRevision: z.number().int().positive(),
    selection: z.object({ platform: ProductPlatformSchema, capability: CreationCapabilitySchema, presetId: CreationPresetSchema.optional(), productId: CiId.optional() }).strict()
        .refine(value => supportsCreation(value.platform, value.capability), '当前平台不支持此创作方式'),
}).strict();
export const WorkLinkSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, opportunityId: CiId, workspaceId: CiId, requestId: CiId, createdAt: Timestamp,
}).strict();
export const InsightSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, runId: CiId, category: Text, statement: Text,
    evidence: z.array(EvidenceRelationSchema).max(100), uncertainties: z.array(Text).max(30),
    reviewState: z.enum(['needs_evidence', 'verified']), createdAt: Timestamp,
}).strict();
export const AnalysisRunSchema = z.object({
    id: CiId, spaceId: WorkspaceSpaceIdSchema, requestId: CiId, sourceDigest: CiDigest,
    status: z.enum(['queued', 'running', 'interrupted', 'partial', 'succeeded', 'failed', 'cancelled']),
    coverage: SourceCoverageSchema, createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export type SourceIdentity = z.infer<typeof SourceIdentitySchema>;
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
export type SourceCoverage = z.infer<typeof SourceCoverageSchema>;
export type ContentEvidence = z.infer<typeof ContentEvidenceSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;
export type WorkLink = z.infer<typeof WorkLinkSchema>;
export interface OpportunityDetail { opportunity: Opportunity; evidence: ContentEvidence[]; }
export interface EvidenceSourceView { evidence: ContentEvidence; snapshot: SourceSnapshot; current?: SourceSnapshot; }
export type CiResult<T> = { success: true; data: T } | { success: false; error: string };
