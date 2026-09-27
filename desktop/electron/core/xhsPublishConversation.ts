import { sameXhsPublishMedia, type XhsPublishJob } from '../../shared/xhsPublisher.ts';

export type XhsPublishReplyClassification = {
    intent: 'prepare' | 'confirm' | 'reject' | 'modify' | 'recover' | 'resume' | 'status' | 'unrelated' | 'unclear';
    confidence: number;
    publicationRequested: boolean;
    acknowledgedNotPublished: boolean;
};

export function parseXhsPublishReply(value: Record<string, unknown> | null): XhsPublishReplyClassification {
    const intent = value?.intent;
    return {
        intent: intent === 'prepare' || intent === 'confirm' || intent === 'reject' || intent === 'modify' || intent === 'recover'
            || intent === 'resume' || intent === 'status' || intent === 'unrelated' ? intent : 'unclear',
        confidence: typeof value?.confidence === 'number' && Number.isFinite(value.confidence)
            ? Math.max(0, Math.min(1, value.confidence)) : 0,
        // An edit must never authorize submission of copy not yet reviewed.
        publicationRequested: intent === 'confirm' && value?.publicationRequested === true,
        acknowledgedNotPublished: value?.acknowledgedNotPublished === true,
    };
}

// Scope selection is structural, never inferred from words in a user message.
export function selectXhsConversationJob(jobs: XhsPublishJob[], sessionId: string, projectPath?: string): XhsPublishJob | null {
    const candidates = jobs.filter((job) => job.sessionId === sessionId && (!projectPath || job.projectPath === projectPath));
    if (new Set(candidates.map((job) => job.projectPath)).size !== 1) return null;
    return candidates.sort((left, right) => right.revision - left.revision || right.createdAt - left.createdAt)[0] || null;
}

export function canAmendXhsDraft(previous: XhsPublishJob, next: XhsPublishJob, browserId: string): boolean {
    return previous.id !== next.id && previous.sessionId === next.sessionId && previous.projectPath === next.projectPath
        && previous.noteType === next.noteType && previous.extensionInstanceId === browserId
        && sameXhsPublishMedia(previous.media, next.media)
        && (previous.publishStatus === 'not_submitted' && ['blocked', 'superseded', 'cancelled'].includes(previous.status)
            || previous.status === 'superseded' && previous.errorCode === 'USER_VERIFIED_NOT_PUBLISHED');
}
