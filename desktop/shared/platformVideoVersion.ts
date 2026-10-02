import type {
    PublicationPlatform,
    PlatformPublishJobStatus,
    PlatformPublishResetStatus,
    PlatformPublishStatus,
    PlatformPublisherTarget,
    DouyinImageCoverSnapshot,
} from './platformPublisher';

export type VideoPublicationPlatform = PublicationPlatform;

export interface DouyinVideoVersion {
    id: string;
    spaceId: string;
    sourceProjectId: string;
    sourceNotePath?: string;
    sourceNoteRevision?: number;
    sourceProductId: string;
    sourceProductUpdatedAt: string;
    projectId: string;
    title: string;
    description: string;
    hashtags: string[];
    coverAssetId?: string;
    revision: number;
    createdAt: number;
    updatedAt: number;
}

export type DouyinPublishJobStatus = PlatformPublishJobStatus;

export interface DouyinPublishJob extends PlatformPublisherTarget {
    id: string;
    platform: 'douyin';
    spaceId: string;
    sessionId: string;
    versionId: string;
    versionRevision: number;
    projectId: string;
    renderId: string;
    mediaAssetId: string;
    mediaPath: string;
    imageCover?: DouyinImageCoverSnapshot;
    contentDigest: string;
    title: string;
    description: string;
    hashtags: string[];
    accountId: string;
    accountLabel: string;
    extensionInstanceId: string;
    status: DouyinPublishJobStatus;
    publishStatus: PlatformPublishStatus;
    resetStatus: PlatformPublishResetStatus;
    errorCode: string;
    errorMessage: string;
    createdAt: number;
    updatedAt: number;
    confirmedAt?: number;
    submittedAt?: number;
    publishedAt?: number;
    completedAt?: number;
    publishedReview?: {
        kind: 'user-verified-published';
        reviewedAt: number;
        accountId: string;
        title: string;
    };
}

export interface DouyinPublishConsentMetadata {
    kind: 'douyin-publish-consent';
    jobId: string;
    status: DouyinPublishJobStatus;
    title: string;
    description: string;
    hashtags: string[];
    revision: number;
    accountLabel: string;
    videoPreviewUrl: string;
    publishStatus: DouyinPublishJob['publishStatus'];
    resetStatus: DouyinPublishJob['resetStatus'];
    errorMessage?: string;
}
