import { z } from 'zod';
import { ProductProjectEditorRefSchema } from './productProjectEditor.ts';
import type { ProductCreationTarget } from './productCreationTarget';
import type { PublicationPlatform, PlatformPublishJobStatus, PlatformPublishStatus, PlatformPublishResetStatus } from './platformPublisher';
import type { TikTokPublishSettings } from './tiktokVideo';

export const PublicationPlatformSchema = z.enum(['xiaohongshu', 'douyin', 'tiktok']);
export const PublicationSourceSchema = z.union([ProductProjectEditorRefSchema, z.object({ kind: z.literal('note'), path: z.string().min(1).max(2000) }).strict()]);
export type PublicationSource = z.infer<typeof PublicationSourceSchema>;
export const PublicationPrepareSchema = z.object({ source: PublicationSourceSchema, expectedRevision: z.string().min(1), origin: z.enum(['manual', 'completion']).default('manual'), promptId: z.string().min(1).optional() }).strict();
export const PublicationActionSchema = z.object({ platform: PublicationPlatformSchema, jobId: z.string().min(1).max(160), expectedDigest: z.string().min(1), acknowledged: z.boolean().optional() }).strict();
export interface PublicationMedia {
    slotId: string; assetId: string; role: 'cover' | 'image-page' | 'video'; path: string; mimeType: string;
    sha256: string; order: number; width?: number; height?: number;
}
export interface PublicationSnapshot {
    spaceId: string; source: PublicationSource; platform: PublicationPlatform; versionId: string; workId: string;
    revision: string; semanticDigest: string; target?: ProductCreationTarget; sessionId: string;
    title: string; body: string; hashtags: string[]; media: PublicationMedia[]; settings?: TikTokPublishSettings;
}
export interface PublicationUploadReview {
    jobId: string; contentDigest: string; accountId: string; extensionInstanceId: string; checkedAt: number;
    pageFingerprint: string; mediaCount: number;
    pageSettings?: { visibilityLabel: string; original?: boolean; allowCopy?: boolean; scheduled?: boolean };
}
export interface PublicationJobContext {
    version: 1; platform: PublicationPlatform; jobId: string; spaceId: string; snapshot: PublicationSnapshot;
    accountId: string; accountLabel: string; extensionInstanceId: string; contentDigest: string;
    origin: 'manual' | 'completion'; phase: 'awaiting-upload' | 'awaiting-submit'; uploadReview?: PublicationUploadReview;
    review?: { source: 'user-verified'; observedAt: number; published: boolean; url?: string };
}
export interface PublicationJobView {
    id: string; platform: PublicationPlatform; source?: PublicationSource; sessionId: string;
    title: string; body: string; hashtags: string[]; accountId?: string; accountLabel?: string; extensionInstanceId: string;
    contentDigest: string; status: PlatformPublishJobStatus; publishStatus: PlatformPublishStatus; resetStatus: PlatformPublishResetStatus;
    phase: 'awaiting-upload' | 'awaiting-submit' | 'legacy'; media: Array<PublicationMedia & { previewUrl: string }>;
    errorMessage: string; createdAt: number; updatedAt: number; receiptUrl?: string; receiptSource?: string; context?: PublicationJobContext;
}
export interface PublicationBrowserState {
    platform: PublicationPlatform; boundExtensionInstanceId: string; checkedAt: number; error?: string;
    instances: Array<{ extensionInstanceId: string; browser: string; connected: boolean; accountId?: string; accountLabel?: string; pageState?: string; detail?: string; supported: boolean }>;
}
export interface PublicationCompletion {
    id: string; spaceId: string; source: PublicationSource; semanticDigest: string; snapshot: PublicationSnapshot;
    state: 'pending' | 'offered' | 'handled' | 'dismissed' | 'cancelled' | 'skipped'; messageId: string; createdAt: number;
}
export const XHS_ACCOUNT_BOUND_CAPABILITY = 'xiaohongshu.account-bound.v1';
export const PUBLICATION_REVIEW_CAPABILITY = 'publisher.upload-review.v1';
export const XHS_IMAGE_PUBLISH_LIMIT = 18;
