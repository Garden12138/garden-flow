import type { XhsPublishRequestV1 } from './xhsPublisher';

export type PublicationPlatform = 'xiaohongshu' | 'douyin';

export type PlatformPublishJobStatus =
    | 'awaiting_confirmation' | 'queued' | 'preflighting' | 'uploading'
    | 'submitting' | 'submitted_pending_review' | 'published' | 'returning'
    | 'completed' | 'blocked' | 'cancelled' | 'superseded'
    | 'submit_result_unknown' | 'published_reset_failed';

export type PlatformPublishStatus = 'not_submitted' | 'submitted' | 'pending_review' | 'published' | 'unknown';
export type PlatformPublishResetStatus = 'not_started' | 'returning' | 'ready' | 'failed';

export interface PlatformPublishRequestBaseV1 {
    protocolVersion: 1;
    jobId: string;
    sessionId: string;
    revision: number;
    contentDigest: string;
}

export interface DouyinImageCoverFile {
    orientation: 'portrait' | 'landscape';
    path: string;
    sha256: string;
    width: number;
    height: number;
}

export interface DouyinImageCoverSnapshot {
    assetId: string;
    sourceSha256: string;
    crop: 'center';
    files: [DouyinImageCoverFile, DouyinImageCoverFile];
}

export interface DouyinPublishRequestV1 extends PlatformPublishRequestBaseV1 {
    platform: 'douyin';
    versionId: string;
    projectId: string;
    renderId: string;
    mediaAssetId: string;
    mediaPath: string;
    accountId: string;
    accountLabel: string;
    title: string;
    description: string;
    hashtags: string[];
    coverAssetId?: string;
    imageCover?: DouyinImageCoverSnapshot;
}

// The browser instance remains the transport target. Legacy Xiaohongshu
// requests omit platform and retain their original serialized shape.
export type PlatformPublishRequestV1 =
    | (XhsPublishRequestV1 & { platform?: 'xiaohongshu' })
    | DouyinPublishRequestV1;

export type PlatformPublishCommandV1 = {
    platform: 'xiaohongshu';
    phase: 'prepare' | 'submit';
    request: XhsPublishRequestV1;
    jobId?: string;
    contentDigest?: string;
} | {
    platform: 'douyin';
    phase: 'prepare' | 'submit';
    request: DouyinPublishRequestV1;
} | {
    platform: 'douyin';
    phase: 'review-published';
    jobId: string;
    contentDigest: string;
    accountId: string;
    accountLabel: string;
    acknowledgedPublished: true;
};

export interface PlatformPublisherTarget {
    extensionInstanceId: string;
    accountId?: string;
    accountLabel?: string;
}

export interface PlatformPublisherExecutionResult {
    ok: boolean;
    jobId: string;
    publishStatus: PlatformPublishStatus;
    resetStatus: PlatformPublishResetStatus;
    code?: string;
    message?: string;
    publishedAt?: number;
}
