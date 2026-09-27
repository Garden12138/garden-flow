import type { XhsNoteDocument, XhsNoteProjectSnapshot } from '../../shared/xhsNote.ts';
import type { XhsPublishJob } from '../../shared/xhsPublisher.ts';
import { normalizeXhsHashtags, xhsTitleValidationError } from '../../shared/xhsPublisher.ts';

export interface XhsPublishSource {
    projectId?: string;
    assetId: string;
    title: string;
    durationSeconds: number;
    aspectRatio: string;
    productFacts?: unknown;
    sourceVideoExport?: XhsNoteDocument['sourceVideoExport'];
    existingCopy?: { title: string; body: string; hashtags: string[] };
    notePath?: string;
}

export interface XhsPublishPreparationDependencies {
    readSource: (input: { sessionId: string; projectId?: string; assetId?: string; notePath?: string }) => Promise<XhsPublishSource>;
    getNote: (notePath: string) => Promise<XhsNoteProjectSnapshot>;
    saveNote: (input: { path: string; noteType: 'video'; document: unknown; expectedRevision?: number }) => Promise<XhsNoteProjectSnapshot>;
    bindMedia: (input: { path: string; slotId: string; assetId: string; expectedRevision: number }) => Promise<XhsNoteProjectSnapshot>;
    requestConsent: (sessionId: string, notePath: string) => Promise<XhsPublishJob>;
}

export type XhsPublishPreparationInput = {
    operation: 'inspect' | 'prepare';
    projectId?: string;
    assetId?: string;
    notePath?: string;
    title?: string;
    body?: string;
    hashtags?: string[];
};

export async function prepareXhsPublication(sessionId: string, input: XhsPublishPreparationInput, deps: XhsPublishPreparationDependencies) {
    if (!sessionId) throw new Error('发布请求缺少当前会话');
    const source = await deps.readSource({ sessionId, projectId: input.projectId, assetId: input.assetId, notePath: input.notePath });
    if (input.operation === 'inspect') return { kind: 'xhs-publish-source' as const, source };
    const title = String(input.title || '').trim();
    const body = String(input.body || '').trim();
    if (!title || !body) throw new Error('请先准备发布标题和正文');
    const titleError = xhsTitleValidationError(title);
    if (titleError) throw Object.assign(new Error(titleError), { code: 'TITLE_TOO_LONG' });
    // Stable source identity reuses the same structured note, never a random draft.
    const notePath = input.notePath || source.notePath || `xiaohongshu/video-${source.projectId || source.assetId}.redvideo`;
    const hashtags = normalizeXhsHashtags(input.hashtags || []);
    let current: XhsNoteProjectSnapshot | undefined;
    try {
        current = await deps.getNote(notePath);
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('缺少 note.json')) throw error;
    }
    const finalVideo = current?.document.mediaSlots.find((slot) => slot.id === 'final-video');
    const sameSource = finalVideo?.assetId === source.assetId
        && current?.document.sourceVideoExport?.renderFingerprint === source.sourceVideoExport?.renderFingerprint;
    const sameCopy = current?.document.finalTitle === title && current.document.body === body
        && JSON.stringify(current.document.hashtags) === JSON.stringify(hashtags);
    let note = current;
    if (!note || !sameSource || !sameCopy || note.document.generationStatus !== 'generated') {
        note = await deps.saveNote({
            path: notePath,
            noteType: 'video',
            expectedRevision: current?.version,
            document: {
                finalTitle: title,
                body,
                hashtags,
                durationSeconds: source.durationSeconds,
                aspectRatio: source.aspectRatio,
                generationStatus: 'ready',
                sourceVideoExport: source.sourceVideoExport,
            },
        });
        note = await deps.bindMedia({ path: note.projectPath, slotId: 'final-video', assetId: source.assetId, expectedRevision: note.version });
    }
    const job = await deps.requestConsent(sessionId, note.projectPath);
    return { kind: 'xhs-publish-prepared' as const, source, note, job };
}

export function selectPublishProjectId(ids: string[], explicitId?: string): string {
    if (explicitId) return explicitId;
    const candidates = [...new Set(ids.filter(Boolean))];
    if (candidates.length !== 1) {
        throw new Error(candidates.length > 1
            ? `当前会话有多个视频工程，请明确要发布哪个：${candidates.join('、')}`
            : '当前会话没有绑定视频工程，请选择资产库视频或指定工程');
    }
    return candidates[0];
}
