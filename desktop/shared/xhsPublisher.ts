export const XHS_PUBLISH_PROTOCOL_VERSION = 1 as const;
export const XHS_PUBLISHER_EXTENSION_ID = 'jafdjmajegkaabbohedhmmlhogdejkpb';
export const XHS_PUBLISHER_EXTENSION_ORIGIN = `chrome-extension://${XHS_PUBLISHER_EXTENSION_ID}/`;
export const XHS_PUBLISHER_CAPABILITY = 'xiaohongshu.publish.v1' as const;

export type BrowserExtensionKind = 'capture' | 'xhs-publisher';

export type XhsPublishMediaRole = 'cover' | 'image-page' | 'video';

export interface XhsPublishMediaV1 {
    slotId: string;
    role: XhsPublishMediaRole;
    path: string;
    mimeType: string;
    order: number;
}

export interface XhsPublishRequestV1 {
    protocolVersion: typeof XHS_PUBLISH_PROTOCOL_VERSION;
    jobId: string;
    sessionId: string;
    projectPath: string;
    revision: number;
    contentDigest: string;
    noteType: 'image' | 'video';
    title: string;
    body: string;
    hashtags: string[];
    media: XhsPublishMediaV1[];
}

export type XhsPublishJobStatus =
    | 'awaiting_confirmation'
    | 'queued'
    | 'preflighting'
    | 'uploading'
    | 'submitting'
    | 'published'
    | 'returning'
    | 'completed'
    | 'blocked'
    | 'cancelled'
    | 'superseded'
    | 'submit_result_unknown'
    | 'published_reset_failed';

export type XhsPublishStatus = 'not_submitted' | 'submitted' | 'published' | 'unknown';
export type XhsPublishResetStatus = 'not_started' | 'returning' | 'ready' | 'failed';

export interface XhsPublishJob {
    id: string;
    sessionId: string;
    projectPath: string;
    revision: number;
    contentDigest: string;
    noteType: 'image' | 'video';
    title: string;
    body: string;
    hashtags: string[];
    media: XhsPublishMediaV1[];
    extensionInstanceId: string;
    status: XhsPublishJobStatus;
    publishStatus: XhsPublishStatus;
    resetStatus: XhsPublishResetStatus;
    messageId: string;
    errorCode: string;
    errorMessage: string;
    createdAt: number;
    updatedAt: number;
    confirmedAt?: number;
    submittedAt?: number;
    publishedAt?: number;
    completedAt?: number;
}

export interface XhsPublisherBrowserStatus {
    connected: boolean;
    extensionInstanceId: string;
    extensionVersion: string;
    browser: string;
    publishTabCount?: number;
    pageState?: 'ready' | 'draft' | 'login_required' | 'security_challenge' | 'success' | 'unsupported';
    detail?: string;
}

export interface XhsPublisherStatus {
    enabled: boolean;
    boundExtensionInstanceId: string;
    instances: XhsPublisherBrowserStatus[];
    activeJob?: XhsPublishJob;
}

export interface XhsPublisherExecutionResult {
    ok: boolean;
    jobId: string;
    publishStatus: XhsPublishStatus;
    resetStatus: XhsPublishResetStatus;
    code?: string;
    message?: string;
    publishedAt?: number;
}

export type XhsPublishConsentMetadata = {
    kind: 'xhs-publish-consent';
    jobId: string;
    status: XhsPublishJobStatus;
    noteType: 'image' | 'video';
    title: string;
    revision: number;
    mediaCount: number;
    browserLabel: string;
    publishStatus: XhsPublishStatus;
    resetStatus: XhsPublishResetStatus;
    errorMessage?: string;
};

export function isXhsPublishJobStatus(value: unknown): value is XhsPublishJobStatus {
    return [
        'awaiting_confirmation',
        'queued',
        'preflighting',
        'uploading',
        'submitting',
        'published',
        'returning',
        'completed',
        'blocked',
        'cancelled',
        'superseded',
        'submit_result_unknown',
        'published_reset_failed',
    ].includes(String(value));
}

export function isTerminalXhsPublishStatus(status: XhsPublishJobStatus): boolean {
    return ['completed', 'cancelled', 'superseded', 'submit_result_unknown'].includes(status);
}

export function reconcileInterruptedXhsPublishJob(job: XhsPublishJob, now: number): XhsPublishJob | null {
    if (['queued', 'preflighting', 'uploading'].includes(job.status)) {
        return {
            ...job,
            status: 'blocked',
            publishStatus: 'not_submitted',
            errorCode: 'DESKTOP_RESTARTED_PRE_SUBMIT',
            errorMessage: '桌面端在提交前中断，可安全重试',
            updatedAt: now,
        };
    }
    if (job.status === 'submitting') {
        return {
            ...job,
            status: 'submit_result_unknown',
            publishStatus: 'unknown',
            errorCode: 'DESKTOP_RESTARTED_DURING_SUBMIT',
            errorMessage: '提交期间桌面端中断，请先在小红书笔记管理中确认结果',
            updatedAt: now,
        };
    }
    if (job.status === 'published' || job.status === 'returning') {
        return {
            ...job,
            status: 'published_reset_failed',
            publishStatus: 'published',
            resetStatus: 'failed',
            errorCode: 'DESKTOP_RESTARTED_DURING_RETURN',
            errorMessage: '笔记已发布，但发布页恢复被中断，可重试恢复页面',
            updatedAt: now,
        };
    }
    return null;
}

export function xhsPublishRetryMode(job: XhsPublishJob): 'publish' | 'restore' | null {
    if (job.status === 'published_reset_failed' && job.publishStatus === 'published') return 'restore';
    if (job.status === 'blocked' && job.publishStatus === 'not_submitted') return 'publish';
    return null;
}

export function normalizeXhsHashtags(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of values) {
        const normalized = String(item || '').trim().replace(/^#+/, '').replace(/\s+/g, ' ');
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result.slice(0, 30);
}
