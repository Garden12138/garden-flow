import { requirePublicationAction, recordPublicationUpload, validatePublicationContext } from './publicationExecutionPolicy';
import { readPublicationSource } from './publicationSource';
import { getPublicationJobContext, getWorkspacePaths as publicationPaths } from '../db';
import { XHS_ACCOUNT_BOUND_CAPABILITY } from '../../shared/publication';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { BrowserWindow } from 'electron';
import {
    assertProductEditsSettled, getProductEditorPublicationRevision,
    addChatMessage,
    findXhsPublishJobByCandidate,
    getXhsPublishJob,
    getXhsPublisherBinding,
    getWorkspacePaths,
    listXhsPublishJobs,
    setXhsPublisherBinding,
    updateChatMessage,
    upsertXhsPublishJob,
} from '../db';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { getAbsoluteMediaPath } from './mediaLibraryStore';
import { getXhsNoteProject, saveXhsNoteProject } from './xhsNoteProjectStore';
import { assertXhsSourceExportCurrent } from './xhsVideoPublishSource';
import { XHS_AUTO_PUBLISH_TASK_ID } from './builtinAutomationTasks';
import { canAmendXhsDraft, parseXhsPublishReply, selectXhsConversationJob, type XhsPublishReplyClassification } from './xhsPublishConversation';
import type { IntentRoute } from './ai/types';
import type { PlatformPublishCommandV1 } from '../../shared/platformPublisher';
import { isXhsMediaCompatible, type XhsNoteProjectSnapshot } from '../../shared/xhsNote';
import {
    XHS_PUBLISHER_CAPABILITY,
    XHS_PUBLISH_PROTOCOL_VERSION,
    isTerminalXhsPublishStatus,
    normalizeXhsHashtags,
    reconcileInterruptedXhsPublishJob,
    xhsPublishRetryMode,
    canExecuteXhsPublication,
    xhsTitleValidationError,
    xhsSubmissionNeedsReview,
    hasXhsUnpublishedReview,
    sameXhsPublishMedia,
    type XhsPublishConsentMetadata,
    type XhsPublishJob,
    type XhsPublishJobStatus,
    type XhsPublishMediaV1,
    type XhsPublishRequestV1,
    type XhsDraftAmendmentV1,
    type XhsPublisherBrowserStatus,
    type XhsPublisherExecutionResult,
    type XhsPublisherStatus,
} from '../../shared/xhsPublisher';

type Candidate = Omit<XhsPublishJob, 'id' | 'messageId' | 'status' | 'publishStatus' | 'resetStatus' | 'errorCode' | 'errorMessage' | 'createdAt' | 'updatedAt' | 'extensionInstanceId'>;

const ACTIVE_JOB_STATUSES: XhsPublishJobStatus[] = [
    'awaiting_confirmation',
    'queued',
    'preflighting',
    'uploading',
    'submitting',
    'published',
    'returning',
    'blocked',
    'published_reset_failed',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorShape(error: unknown): { code: string; message: string } {
    const record = isRecord(error) ? error : {};
    return {
        code: String(record.code || 'XHS_PUBLISH_FAILED'),
        message: error instanceof Error ? error.message : String(record.message || error || '发布失败'),
    };
}

function publisherBrowserLabel(job: XhsPublishJob): string {
    if (!job.extensionInstanceId) return '尚未绑定发布浏览器';
    const instance = getBrowserCaptureBridgeService()?.getStatus().instances
        .find((item) => item.extensionInstanceId === job.extensionInstanceId && item.extensionKind === 'xhs-publisher');
    const suffix = job.extensionInstanceId.slice(-8);
    return `${instance?.browser || '发布浏览器'} · ${suffix}`;
}

function consentMetadata(job: XhsPublishJob): XhsPublishConsentMetadata {
    return {
        kind: 'xhs-publish-consent',
        jobId: job.id,
        status: job.status,
        noteType: job.noteType,
        title: job.title,
        revision: job.revision,
        mediaCount: job.media.length,
        browserLabel: publisherBrowserLabel(job),
        publishStatus: job.publishStatus,
        resetStatus: job.resetStatus,
        errorMessage: job.errorMessage || undefined,
        body: job.body,
        hashtags: job.hashtags,
        videoPreviewUrl: job.media.find((media) => media.role === 'video')?.path
            ? toAppAssetUrl(job.media.find((media) => media.role === 'video')!.path) : undefined,
        noteUri: `manuscripts://${path.relative(getWorkspacePaths().manuscripts, job.projectPath).replace(/\\/g, '/')}`,
        projectPath: job.projectPath,
        requiresButtonConfirmation: false,
    };
}

function contentForConsent(job: XhsPublishJob): string {
    const typeLabel = job.noteType === 'video' ? '视频笔记' : '图片笔记';
    return `《${job.title}》已经制作完成。是否将当前第 ${job.revision} 版${typeLabel}发布到小红书？`;
}

function statusResultFromUnknown(value: unknown, jobId: string): XhsPublisherExecutionResult {
    if (!isRecord(value)) {
        return {
            ok: false,
            jobId,
            publishStatus: 'not_submitted',
            resetStatus: 'not_started',
            code: 'INVALID_PUBLISHER_RESPONSE',
            message: '发布插件返回了无法识别的结果',
        };
    }
    const publishStatus = ['not_submitted', 'submitted', 'pending_review', 'published', 'unknown'].includes(String(value.publishStatus))
        ? value.publishStatus as XhsPublisherExecutionResult['publishStatus']
        : 'unknown';
    const resetStatus = ['not_started', 'returning', 'ready', 'failed'].includes(String(value.resetStatus))
        ? value.resetStatus as XhsPublisherExecutionResult['resetStatus']
        : 'not_started';
    return {
        ok: value.ok === true,
        jobId: String(value.jobId || jobId),
        publishStatus,
        resetStatus,
        code: value.code ? String(value.code) : undefined,
        message: value.message ? String(value.message) : undefined,
        publishedAt: Number.isFinite(Number(value.publishedAt)) ? Number(value.publishedAt) : undefined,
    };
}

export class XhsPublisherService extends EventEmitter {
    private queue: Promise<void> = Promise.resolve();
    private recoveringJobs = new Set<string>();
    private reconciledSpaces = new Set<string>();

    constructor() {
        super();
        this.reconcileInterruptedJobs();
    }

    private reconcileInterruptedJobs(): void {
        const spaceId = getWorkspacePaths().activeSpaceId; if (this.reconciledSpaces.has(spaceId)) return; this.reconciledSpaces.add(spaceId);
        for (const job of listXhsPublishJobs(ACTIVE_JOB_STATUSES)) {
            if (!isPathWithinRoots(path.resolve(job.projectPath), [getWorkspacePaths().manuscripts])) continue;
            const reconciled = reconcileInterruptedXhsPublishJob(job, Date.now());
            if (reconciled) this.save(reconciled);
        }
    }

    private emitChanged(job: XhsPublishJob): void {
        this.emit('changed', job);
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) { window.webContents.send('xhs-publisher:job-changed', job); window.webContents.send('publication:changed'); }
        }
    }

    private save(job: XhsPublishJob): XhsPublishJob {
        upsertXhsPublishJob(job);
        updateChatMessage(job.messageId, {
            content: contentForConsent(job),
            metadata: JSON.stringify({ xhsPublishConsent: consentMetadata(job) }),
        });
        this.emitChanged(job);
        return job;
    }

    private async automationEnabled(): Promise<boolean> {
        const { getGardenFlowBackgroundRunner } = await import('./gardenflowBackgroundRunner');
        const tasks = await getGardenFlowBackgroundRunner().listBuiltinTasks();
        return tasks.some((task) => task.id === XHS_AUTO_PUBLISH_TASK_ID && task.enabled);
    }

    private async publicationEnabled(job: XhsPublishJob): Promise<boolean> {
        // Explicit requests are independent of the background runner/config.
        return canExecuteXhsPublication(job, false) || await this.automationEnabled();
    }

    getJob(jobId: string): XhsPublishJob | null {
        this.reconcileInterruptedJobs();
        const job = getXhsPublishJob(jobId);
        if (!job) return null;
        const context = getPublicationJobContext('xiaohongshu', jobId);
        if (context ? context.spaceId !== getWorkspacePaths().activeSpaceId : !isPathWithinRoots(path.resolve(job.projectPath), [getWorkspacePaths().manuscripts])) return null;
        return job;
    }

    private async buildCandidate(sessionId: string, projectPath: string): Promise<Candidate> {
        const snapshot = await getXhsNoteProject(projectPath);
        const document = snapshot.document;
        if (document.productImageSet) await readPublicationSource({ kind: 'image-set', path: snapshot.relativePath }, false);
        if (document.creationTarget && (document.creationTarget.platform !== 'xiaohongshu' || !['video', 'image-set'].includes(document.creationTarget.contentKind) || document.workVersion?.publicationBinding?.platform !== 'xiaohongshu')) throw new Error('当前平台稿件绑定不支持小红书发布准备');
        if (document.sourceVideoExport) {
            await assertXhsSourceExportCurrent(document.sourceVideoExport);
            if (document.mediaSlots.find((slot) => slot.id === 'final-video')?.assetId !== document.sourceVideoExport.mediaAssetId) {
                throw new Error('发布稿件的视频与工程成片不一致，请重新准备发布');
            }
        }
        if (document.generationStatus !== 'generated') {
            throw Object.assign(new Error('笔记媒体尚未全部制作完成'), { code: 'ARTIFACT_NOT_READY' });
        }
        const title = document.finalTitle.trim();
        const body = document.body.trim();
        if (!title || !body) {
            throw Object.assign(new Error('标题或正文为空，暂不能发布'), { code: 'ARTIFACT_NOT_READY' });
        }
        const titleError = xhsTitleValidationError(title);
        if (titleError) throw Object.assign(new Error(titleError), { code: 'TITLE_TOO_LONG' });

        const mediaRoot = path.resolve(getWorkspacePaths().media);
        const pageOrder = new Map(document.imagePages.map((page) => [page.mediaSlotId, page.index]));
        const selectedSlots = document.noteType === 'video'
            ? document.mediaSlots.filter((slot) => slot.id === 'final-video' || slot.role === 'cover')
            : document.mediaSlots.filter((slot) => slot.role === 'cover' || slot.role === 'image-page');
        const sortedSlots = [...selectedSlots].sort((left, right) => {
            if (document.noteType === 'video') {
                if (left.role === 'video') return -1;
                if (right.role === 'video') return 1;
            }
            if (left.role === 'cover') return -1;
            if (right.role === 'cover') return 1;
            return (pageOrder.get(left.id) || 0) - (pageOrder.get(right.id) || 0);
        });
        const media: XhsPublishMediaV1[] = [];
        const seenPaths = new Set<string>();
        for (const slot of sortedSlots) {
            if (slot.status !== 'ready' || !slot.sourcePath) {
                if (slot.role === 'cover' && document.noteType === 'video') continue;
                throw Object.assign(new Error(`媒体“${slot.label}”尚未就绪`), { code: 'ARTIFACT_NOT_READY' });
            }
            const absolutePath = path.resolve(getAbsoluteMediaPath(slot.sourcePath));
            if (!isPathWithinRoots(absolutePath, [mediaRoot]) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
                throw Object.assign(new Error(`媒体文件不存在或超出工作区：${slot.label}`), { code: 'MEDIA_PATH_NOT_ALLOWED' });
            }
            if (!isXhsMediaCompatible(slot.role, slot.mimeType, absolutePath)) {
                throw Object.assign(new Error(`媒体格式与槽位不匹配：${slot.label}`), { code: 'MEDIA_TYPE_MISMATCH' });
            }
            if (!document.productImageSet && seenPaths.has(absolutePath)) continue;
            seenPaths.add(absolutePath);
            media.push({
                slotId: slot.id,
                role: slot.role,
                path: absolutePath,
                mimeType: String(slot.mimeType || ''),
                order: media.length,
            });
        }
        const hasRequiredMedia = document.noteType === 'video'
            ? media.some((item) => item.role === 'video')
            : media.some((item) => item.role === 'cover' || item.role === 'image-page');
        if (!hasRequiredMedia) {
            throw Object.assign(new Error('没有可发布的最终媒体'), { code: 'ARTIFACT_NOT_READY' });
        }
        const hashtags = normalizeXhsHashtags(document.hashtags);
        const mediaHashes: string[] = [];
        for (const item of media) {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(item.path)) hash.update(chunk);
            mediaHashes.push(hash.digest('hex'));
        }
        const contentDigest = createHash('sha256').update(JSON.stringify({
            projectPath: snapshot.projectPath,
            revision: snapshot.version,
            title,
            body,
            hashtags,
            media: media.map((item) => ({ ...item, path: path.normalize(item.path) })),
            mediaHashes,
            sourceVideoExport: document.sourceVideoExport,
            ...(document.sourceVideoExport && getProductEditorPublicationRevision(document.sourceVideoExport.projectId) ? { editorRevision: getProductEditorPublicationRevision(document.sourceVideoExport.projectId) } : {}),
            ...(document.creationTarget ? { creationTarget: document.creationTarget } : {}),
        })).digest('hex');
        return {
            sessionId,
            projectPath: snapshot.projectPath,
            revision: snapshot.version,
            contentDigest,
            noteType: snapshot.noteType,
            title,
            body,
            hashtags,
            media,
        };
    }

    async considerCompletedArtifact(sessionId: string, projectPath: string): Promise<XhsPublishJob | null> {
        if (!sessionId || !projectPath) return null;
        const note = await getXhsNoteProject(projectPath);
        if (note.document.productImageSet || note.document.sourceVideoExport) return null;
        const { recordCompletedPublication } = await import('./publicationCompletionService');
        await recordCompletedPublication({ kind: 'note', path: projectPath });
        return null;
    }

    async requestPublication(sessionId: string, projectPath: string, triggerOrigin: 'artifact-ready' | 'explicit-request'): Promise<XhsPublishJob> {
        if (!sessionId || !projectPath) throw new Error('发布请求缺少会话或稿件');
        const candidate = await this.buildCandidate(sessionId, projectPath);
        // Preserve pre-fingerprint published/unknown receipts. A digest-format
        // upgrade must not make an already submitted note look unpublished.
        const submitted = listXhsPublishJobs().find((job) => job.projectPath === candidate.projectPath
            && job.revision === candidate.revision && job.publishStatus !== 'not_submitted'
            && !(job.status === 'superseded' && job.errorCode === 'USER_VERIFIED_NOT_PUBLISHED'));
        let existing = submitted || listXhsPublishJobs().find(job => job.projectPath === candidate.projectPath && job.revision === candidate.revision && job.contentDigest === candidate.contentDigest && job.sessionId === sessionId) || findXhsPublishJobByCandidate(candidate.projectPath, candidate.revision, candidate.contentDigest);
        if (existing?.sessionId !== sessionId && existing) {
            if (existing.publishStatus !== 'not_submitted') return existing;
            this.save({ ...existing, status: 'superseded', updatedAt: Date.now() });
            return this.save({ ...existing, triggerOrigin, extensionInstanceId: getXhsPublisherBinding(), status: 'awaiting_confirmation', confirmedAt: undefined, updatedAt: Date.now() });
        }
        if (existing) {
            if (existing.status === 'superseded' && existing.publishStatus === 'unknown' && existing.errorCode === 'USER_VERIFIED_NOT_PUBLISHED') {
                // Resume after a restart between resolving the old receipt and
                // creating the new revision. Never reuse the cached unknown job ID.
                const note = await getXhsNoteProject(candidate.projectPath);
                await saveXhsNoteProject({ path: note.projectPath, noteType: note.noteType, document: note.document, expectedRevision: note.version });
                return this.requestPublication(sessionId, candidate.projectPath, triggerOrigin);
            }
            const reusable = ['cancelled', 'superseded'].includes(existing.status) && existing.publishStatus === 'not_submitted';
            return this.save({
                ...existing,
                triggerOrigin: triggerOrigin === 'explicit-request' ? triggerOrigin : existing.triggerOrigin,
                ...(reusable ? { extensionInstanceId: getXhsPublisherBinding(), status: 'awaiting_confirmation' as const, confirmedAt: undefined, errorCode: '', errorMessage: '' } : {}),
                updatedAt: Date.now(),
            });
        }
        for (const stale of listXhsPublishJobs(['awaiting_confirmation'])) {
            if (stale.projectPath === candidate.projectPath && stale.contentDigest !== candidate.contentDigest) {
                this.save({ ...stale, status: 'superseded', updatedAt: Date.now() });
            }
        }
        const now = Date.now();
        const id = `xhs_publish_${randomUUID()}`;
        const messageId = `msg_xhs_publish_${randomUUID()}`;
        const job: XhsPublishJob = {
            ...candidate,
            triggerOrigin,
            id,
            messageId,
            extensionInstanceId: getXhsPublisherBinding(),
            status: 'awaiting_confirmation',
            publishStatus: 'not_submitted',
            resetStatus: 'not_started',
            errorCode: '',
            errorMessage: '',
            createdAt: now,
            updatedAt: now,
        };
        upsertXhsPublishJob(job);
        addChatMessage({
            id: messageId,
            session_id: sessionId,
            role: 'assistant',
            content: contentForConsent(job),
            metadata: JSON.stringify({ xhsPublishConsent: consentMetadata(job) }),
        });
        this.emitChanged(job);
        return job;
    }

    async getStatus(): Promise<XhsPublisherStatus> {
        const bridge = getBrowserCaptureBridgeService();
        const publisherInstances = (bridge?.getStatus().instances || [])
            .filter((instance) => instance.extensionKind === 'xhs-publisher');
        const statuses: XhsPublisherBrowserStatus[] = [];
        for (const instance of publisherInstances) {
            let detail: Record<string, unknown> = {};
            try {
                const value = await bridge?.invokeBrowserControl('publisher.status', {}, {
                    extensionInstanceId: instance.extensionInstanceId,
                    extensionKind: 'xhs-publisher',
                    requiredCapability: XHS_PUBLISHER_CAPABILITY,
                    timeoutMs: 8_000,
                });
                detail = isRecord(value) ? value : {};
            } catch (error) {
                detail = { detail: error instanceof Error ? error.message : String(error) };
            }
            statuses.push({
                connected: true,
                extensionInstanceId: instance.extensionInstanceId,
                extensionVersion: instance.extensionVersion,
                browser: instance.browser,
                publishTabCount: Number.isFinite(Number(detail.publishTabCount)) ? Number(detail.publishTabCount) : undefined,
                pageState: ['ready', 'draft', 'login_required', 'security_challenge', 'success', 'unsupported'].includes(String(detail.pageState))
                    ? detail.pageState as XhsPublisherBrowserStatus['pageState']
                    : undefined,
                publishTarget: ['image', 'video'].includes(String(detail.publishTarget))
                    ? detail.publishTarget as XhsPublisherBrowserStatus['publishTarget']
                    : undefined,
                detail: detail.detail ? String(detail.detail) : undefined,
                accountId: typeof detail.accountId === 'string' ? detail.accountId : undefined,
                accountLabel: typeof detail.accountLabel === 'string' ? detail.accountLabel : undefined,
                ownedJobId: typeof detail.ownedJobId === 'string' ? detail.ownedJobId : undefined,
            });
        }
        return {
            enabled: await this.automationEnabled(),
            boundExtensionInstanceId: getXhsPublisherBinding(),
            instances: statuses,
            activeJob: listXhsPublishJobs(ACTIVE_JOB_STATUSES).find((job) => !isTerminalXhsPublishStatus(job.status)),
        };
    }

    bindInstance(extensionInstanceId: string): XhsPublisherStatus['boundExtensionInstanceId'] {
        const id = String(extensionInstanceId || '').trim();
        const instance = getBrowserCaptureBridgeService()?.getStatus().instances
            .find((item) => item.extensionInstanceId === id && item.extensionKind === 'xhs-publisher');
        if (!instance) throw new Error('所选发布插件实例未连接');
        setXhsPublisherBinding(id);
        return id;
    }

    private staging = new Map<string, Promise<XhsPublishJob>>();
    async stageDraft(jobId: string): Promise<XhsPublishJob> {
        const existing = this.staging.get(jobId); if (existing) return existing;
        const operation = this.stageDraftUnlocked(jobId); this.staging.set(jobId, operation);
        try { return await operation; } finally { this.staging.delete(jobId); }
    }
    private async stageDraftUnlocked(jobId: string): Promise<XhsPublishJob> {
        const context = await requirePublicationAction('xiaohongshu', jobId, 'upload');
        let current = getXhsPublishJob(jobId);
        if (!current || current.publishStatus !== 'not_submitted' || !['awaiting_confirmation', 'blocked'].includes(current.status)) throw new Error('上传确认已失效');
        const fresh = await this.buildCandidate(current.sessionId, current.projectPath);
        if (fresh.contentDigest !== current.contentDigest) throw new Error('稿件已变化，请重新准备发布');
        const bridge = getBrowserCaptureBridgeService(); if (!bridge) throw new Error('发布浏览器未连接');
        current = this.save({ ...current, status: 'uploading', updatedAt: Date.now() });
        const request: XhsPublishRequestV1 = { protocolVersion: 1, jobId: current.id, sessionId: current.sessionId,
            projectPath: current.projectPath, revision: current.revision, contentDigest: current.contentDigest,
            noteType: current.noteType, title: current.title, body: current.body, hashtags: current.hashtags,
            ...publicationRequestContext(current.id) };
        try {
            await this.waitForPublisherConnection(current.extensionInstanceId);
            const response = await bridge.invokeBrowserControl('publisher.publish', { platform: 'xiaohongshu', phase: 'prepare', request } satisfies PlatformPublishCommandV1,
                { extensionInstanceId: current.extensionInstanceId, extensionKind: 'xhs-publisher', requiredCapability: XHS_ACCOUNT_BOUND_CAPABILITY, timeoutMs: 10 * 60_000 });
            const latest = await this.buildCandidate(current.sessionId, current.projectPath);
            const live = getXhsPublishJob(jobId);
            if (live?.status === 'superseded' || live?.status === 'cancelled' || latest.contentDigest !== current.contentDigest) throw new Error('上传期间工程已修改，未提交');
            await validatePublicationContext('xiaohongshu', jobId, 'upload');
            recordPublicationUpload(context, response);
            return this.save({ ...current, status: 'awaiting_confirmation', errorCode: '', errorMessage: '', updatedAt: Date.now() });
        } catch (error) { const live = getXhsPublishJob(jobId) || current; return ['cancelled', 'superseded'].includes(live.status) ? live : this.block(live, 'UPLOAD_REVIEW_FAILED', String(error)); }
    }

    async confirm(jobId: string, signal?: AbortSignal): Promise<XhsPublishJob> {
        await requirePublicationAction('xiaohongshu', jobId, 'submit');
        let job = getXhsPublishJob(jobId);
        if (!job) throw new Error('发布任务不存在');
        if (job.status !== 'awaiting_confirmation' && job.status !== 'blocked') {
            throw new Error('当前发布任务不能确认');
        }
        if (listXhsPublishJobs().some((item) => item.projectPath === job!.projectPath && xhsSubmissionNeedsReview(item))) {
            throw new Error('该稿件旧版本的提交结果尚未核实。请先检查小红书笔记管理，再在对话中明确告知“已核实未发布”；不能直接重发');
        }
        if (this.recoveringJobs.size) throw new Error('正在恢复发布页，请完成后重新确认');
        const fresh = await this.buildCandidate(job.sessionId, job.projectPath);
        if (fresh.revision !== job.revision || fresh.contentDigest !== job.contentDigest) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
            await this.requestPublication(job.sessionId, job.projectPath, job.triggerOrigin || 'artifact-ready');
            throw new Error('笔记内容已变化，已为新版本重新发起确认');
        }
        const stillEnabled = await this.publicationEnabled(job);
        job = getXhsPublishJob(jobId) || job;
        if (!stillEnabled || job.status === 'cancelled') {
            if (job.status !== 'cancelled') this.save({ ...job, status: 'cancelled', updatedAt: Date.now() });
            throw new Error('小红书自动发布已关闭，当前任务不会提交');
        }
        if (job.status !== 'awaiting_confirmation' && job.status !== 'blocked') {
            throw new Error('当前发布任务不能确认');
        }
        const binding = getXhsPublisherBinding();
        if (!binding) throw new Error('请先绑定专用发布浏览器');
        await this.waitForPublisherConnection(binding, signal);
        if (signal?.aborted) throw new Error('当前执行已停止，未提交发布');
        const queued = this.save({
            ...job,
            extensionInstanceId: binding,
            status: 'queued',
            confirmedAt: Date.now(),
            errorCode: '',
            errorMessage: '',
            updatedAt: Date.now(),
        });
        this.queue = this.queue.then(() => this.executePublish(queued.id)).catch((error) => {
            console.error('[xhs-publisher] queue failed', error);
        });
        return queued;
    }

    cancel(jobId: string): XhsPublishJob {
        const job = getXhsPublishJob(jobId);
        if (!job) throw new Error('发布任务不存在');
        if (['submitting', 'published', 'returning', 'completed', 'published_reset_failed', 'submit_result_unknown'].includes(job.status)) {
            throw new Error('发布已经提交，不能再取消');
        }
        const cancelled = this.save({ ...job, status: 'cancelled', updatedAt: Date.now() });
        return cancelled;
    }

    cancelPendingJobs(): number {
        let cancelled = 0;
        for (const job of listXhsPublishJobs(['awaiting_confirmation', 'queued', 'preflighting', 'uploading', 'blocked'])) {
            if (job.triggerOrigin === 'explicit-request') continue;
            const cancelledJob = this.save({ ...job, status: 'cancelled', updatedAt: Date.now() });
            cancelled += 1;
        }
        return cancelled;
    }

    async retry(jobId: string): Promise<XhsPublishJob> {
        const retryJob = getXhsPublishJob(jobId);
        if (retryJob?.publishStatus === 'not_submitted') throw new Error('请在发布面板重新点击上传核对，再最终确认');
        const job = getXhsPublishJob(jobId);
        if (!job) throw new Error('发布任务不存在');
        const retryMode = xhsPublishRetryMode(job);
        if (retryMode === 'restore') {
            this.queue = this.queue.then(() => this.executeRestore(job.id)).catch((error) => {
                console.error('[xhs-publisher] restore queue failed', error);
            });
            return this.save({ ...job, status: 'returning', resetStatus: 'returning', updatedAt: Date.now() });
        }
        if (retryMode !== 'publish') {
            throw new Error('该任务不能安全重试发布');
        }
        return await this.confirm(job.id);
    }

    // Review and copy amendment are separate from submission. Preserve the
    // historical unknown receipt and the uploaded media, not an empty page.
    async recoverUnpublished(jobId: string, acknowledgedNotPublished: boolean, signal?: AbortSignal): Promise<XhsPublishJob> {
        if (acknowledgedNotPublished !== true) throw new Error('请先在小红书笔记管理核实未发布，并明确确认');
        let job = getXhsPublishJob(jobId);
        if (!job || job.status !== 'submit_result_unknown' || job.publishStatus !== 'unknown') throw new Error('只有结果未知的任务可使用人工核验恢复');
        job = this.recordUnpublishedReview(job);
        if (this.recoveringJobs.size || listXhsPublishJobs().some((item) => ['queued', 'preflighting', 'uploading', 'submitting', 'returning'].includes(item.status))) {
            throw new Error('有发布或恢复操作正在执行，请稍后再试');
        }
        this.recoveringJobs.add(job.id);
        try {
            if (!job.extensionInstanceId || job.extensionInstanceId !== getXhsPublisherBinding()) throw new Error('旧任务与当前绑定浏览器不一致，未更新或提交；请选择原发布浏览器');
            await this.waitForPublisherConnection(job.extensionInstanceId, signal);
            // Check the latest copy/export before touching the browser page.
            await this.buildCandidate(job.sessionId, job.projectPath);
            const note = await getXhsNoteProject(job.projectPath);
            if (note.version === job.revision) {
                // A fresh revision avoids reusing the plugin's cached unknown result.
                await saveXhsNoteProject({ path: note.projectPath, noteType: note.noteType, document: note.document, expectedRevision: note.version });
            }
            const latest = await this.requestPublication(job.sessionId, job.projectPath, 'explicit-request');
            await this.amendOwnedDraft(job, latest, true, signal);
            this.save({ ...job, status: 'superseded', errorCode: 'USER_VERIFIED_NOT_PUBLISHED', errorMessage: '用户已在笔记管理核实未发布；旧提交结果记录保留，当前发布页文案已更新，可在对话中重新发布', updatedAt: Date.now() });
            if (latest.status === 'blocked' && latest.publishStatus === 'not_submitted') {
                return this.save({ ...latest, status: 'awaiting_confirmation', confirmedAt: undefined, errorCode: '', errorMessage: '', updatedAt: Date.now() });
            }
            return latest;
        } finally {
            this.recoveringJobs.delete(job.id);
        }
    }

    private recordUnpublishedReview(job: XhsPublishJob): XhsPublishJob {
        if (!xhsSubmissionNeedsReview(job) || job.publishStatus !== 'unknown') throw new Error('当前任务不接受未发布核实，不能覆盖已有提交或成功回执');
        if (hasXhsUnpublishedReview(job)) return job;
        return this.save({ ...job, unpublishedReview: { kind: 'user-verified-not-published', sessionId: job.sessionId, reviewedAt: Date.now() }, updatedAt: Date.now() });
    }

    private async waitForPublisherConnection(extensionInstanceId: string, signal?: AbortSignal): Promise<void> {
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) throw Object.assign(new Error('浏览器桥接未启动，未更新发布页或提交'), { code: 'BROWSER_INSTANCE_UNAVAILABLE' });
        await bridge.waitForExtensionInstance({ extensionInstanceId, extensionKind: 'xhs-publisher', requiredCapability: XHS_PUBLISHER_CAPABILITY, signal });
    }

    private async amendOwnedDraft(previous: XhsPublishJob, next: XhsPublishJob, acknowledgedNotPublished = false, signal?: AbortSignal): Promise<void> {
        if (next.publishStatus !== 'not_submitted') throw new Error('当前版本已有提交记录，不能覆盖或重发');
        if (previous.sessionId !== next.sessionId || previous.projectPath !== next.projectPath || previous.noteType !== next.noteType
            || !sameXhsPublishMedia(previous.media, next.media) || !previous.extensionInstanceId
            || previous.extensionInstanceId !== getXhsPublisherBinding()) {
            throw new Error('旧任务的浏览器、稿件或媒体已变化，不能原地覆盖；请明确选择正确的发布任务');
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) throw new Error('浏览器桥接未启动，未修改发布页');
        await this.waitForPublisherConnection(previous.extensionInstanceId, signal);
        const amendment: XhsDraftAmendmentV1 = {
            phase: 'amend', acknowledgedNotPublished,
            ...(next.triggerOrigin === 'explicit-request' ? { copyPolicy: 'replace-confirmed-copy' as const } : {}),
            previous: { jobId: previous.id, contentDigest: previous.contentDigest, sessionId: previous.sessionId,
                projectPath: previous.projectPath, noteType: previous.noteType, title: previous.title, body: previous.body,
                hashtags: previous.hashtags, media: previous.media },
            request: { protocolVersion: XHS_PUBLISH_PROTOCOL_VERSION, jobId: next.id, sessionId: next.sessionId,
                projectPath: next.projectPath, revision: next.revision, contentDigest: next.contentDigest,
                noteType: next.noteType, title: next.title, body: next.body, hashtags: next.hashtags, media: next.media },
        };
        const raw = await bridge.invokeBrowserControl('publisher.publish', amendment as unknown as Record<string, unknown>,
            { extensionInstanceId: previous.extensionInstanceId, extensionKind: 'xhs-publisher', requiredCapability: XHS_PUBLISHER_CAPABILITY, timeoutMs: 30_000 });
        if (!isRecord(raw) || raw.ok !== true || (raw.prepared !== true && raw.empty !== true)) {
            throw Object.assign(new Error(isRecord(raw) && typeof raw.message === 'string' ? raw.message : '未能核验当前任务发布页，未覆盖文案'),
                { code: isRecord(raw) && typeof raw.code === 'string' ? raw.code : 'DRAFT_AMEND_FAILED' });
        }
    }

    async refreshPreparedDraft(_next: XhsPublishJob): Promise<string | undefined> {
        return '本地文案已保存。请打开准备发布面板；上传与最终提交分别需要按钮确认。';
    }

    private async executePublish(jobId: string): Promise<void> {
        const job = getXhsPublishJob(jobId);
        if (!job || job.status !== 'queued') return;
        if (listXhsPublishJobs().some((item) => item.projectPath === job.projectPath && xhsSubmissionNeedsReview(item))) {
            this.block(job, 'PRIOR_SUBMISSION_UNRESOLVED', '旧版本提交结果尚未核实，请先检查笔记管理，再在对话中确认未发布');
            return;
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) {
            this.block(job, 'DESKTOP_BRIDGE_UNAVAILABLE', '浏览器桥接未启动');
            return;
        }
        const fresh = await this.buildCandidate(job.sessionId, job.projectPath).catch(() => null);
        if (!fresh || fresh.contentDigest !== job.contentDigest || fresh.revision !== job.revision) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
            await this.requestPublication(job.sessionId, job.projectPath, job.triggerOrigin || 'artifact-ready');
            return;
        }
        let current = this.save({ ...job, status: 'preflighting', updatedAt: Date.now() });
        const request: XhsPublishRequestV1 = {
            protocolVersion: XHS_PUBLISH_PROTOCOL_VERSION,
            jobId: current.id,
            sessionId: current.sessionId,
            projectPath: current.projectPath,
            revision: current.revision,
            contentDigest: current.contentDigest,
            noteType: current.noteType,
            title: current.title,
            body: current.body,
            hashtags: current.hashtags,
            ...publicationRequestContext(current.id),
        };
        try {
            await this.waitForPublisherConnection(current.extensionInstanceId);
            await validatePublicationContext('xiaohongshu', current.id, 'submit');
            const live = getXhsPublishJob(current.id);
            if (!live || ['cancelled', 'superseded'].includes(live.status)) return;
            const beforeSubmitNote = await getXhsNoteProject(current.projectPath);
            if (beforeSubmitNote.document.sourceVideoExport) assertProductEditsSettled('video:' + beforeSubmitNote.document.sourceVideoExport.projectId);
            current = this.save({
                ...current,
                status: 'submitting',
                publishStatus: 'submitted',
                submittedAt: Date.now(),
                updatedAt: Date.now(),
            });
            const submitRaw = await bridge.invokeBrowserControl('publisher.publish', {
                platform: 'xiaohongshu',
                phase: 'submit',
                jobId: current.id,
                contentDigest: current.contentDigest,
                request,
            } satisfies PlatformPublishCommandV1, {
                extensionInstanceId: current.extensionInstanceId,
                extensionKind: 'xhs-publisher',
                requiredCapability: XHS_PUBLISHER_CAPABILITY,
                timeoutMs: 3 * 60_000,
            });
            const submitResult = statusResultFromUnknown(submitRaw, current.id);
            current = getXhsPublishJob(current.id) || current;
            if (this.applyExecutionResult(current, submitResult)) return;
            if (submitResult.publishStatus === 'not_submitted') {
                this.block(current, submitResult.code || 'PUBLISH_BLOCKED', submitResult.message || '提交前页面校验未通过');
                return;
            }
            this.applyUnknownResult(current, submitResult.code, submitResult.message);
        } catch (error) {
            const failure = errorShape(error);
            current = getXhsPublishJob(current.id) || current;
            if (current.status === 'submitting' || current.publishStatus === 'submitted') {
                this.applyUnknownResult(current, failure.code, '提交阶段连接中断，无法判断是否已发布，请人工检查笔记管理页');
            } else {
                this.block(current, failure.code, failure.message);
            }
        }
    }

    async reviewPublished(jobId: string, acknowledged: boolean): Promise<XhsPublishJob> {
        const job = getXhsPublishJob(jobId);
        if (!job || !acknowledged || !['unknown', 'pending_review', 'published'].includes(job.publishStatus)) throw new Error('请先在目标账号核实这次任务已发布');
        const context = getPublicationJobContext('xiaohongshu', jobId);
        if (context && context.spaceId !== getWorkspacePaths().activeSpaceId) throw new Error('任务不属于当前空间');
        return this.save({ ...job, status: job.resetStatus === 'ready' ? 'completed' : 'published_reset_failed', publishStatus: 'published',
            resetStatus: job.resetStatus === 'ready' ? 'ready' : 'failed', publishedAt: job.publishedAt || Date.now(), updatedAt: Date.now(),
            errorCode: '', errorMessage: job.resetStatus === 'ready' ? '' : '已人工核实发布；发布页尚未恢复' });
    }

    private async discardPreparedPage(job: XhsPublishJob): Promise<void> {
        await getBrowserCaptureBridgeService()?.invokeBrowserControl('publisher.publish', {
            phase: 'discard',
            jobId: job.id,
            contentDigest: job.contentDigest,
            noteType: job.noteType,
            request: { jobId: job.id, contentDigest: job.contentDigest, title: job.title, body: job.body, hashtags: job.hashtags, noteType: job.noteType },
        }, {
            extensionInstanceId: job.extensionInstanceId,
            extensionKind: 'xhs-publisher',
            requiredCapability: XHS_PUBLISHER_CAPABILITY,
            timeoutMs: 30_000,
        }).catch(() => undefined);
    }

    private async executeRestore(jobId: string): Promise<void> {
        const job = getXhsPublishJob(jobId);
        if (!job || job.publishStatus !== 'published') return;
        try {
            const raw = await getBrowserCaptureBridgeService()?.invokeBrowserControl('publisher.restore', {
                jobId,
                noteType: job.noteType,
            }, {
                extensionInstanceId: job.extensionInstanceId,
                extensionKind: 'xhs-publisher',
                requiredCapability: XHS_PUBLISHER_CAPABILITY,
                timeoutMs: 60_000,
            });
            const result = statusResultFromUnknown(raw, jobId);
            if (result.resetStatus === 'ready') {
                this.save({
                    ...job,
                    status: 'completed',
                    resetStatus: 'ready',
                    completedAt: Date.now(),
                    errorCode: '',
                    errorMessage: '',
                    updatedAt: Date.now(),
                });
                return;
            }
            this.save({
                ...job,
                status: 'published_reset_failed',
                resetStatus: 'failed',
                errorCode: result.code || 'PUBLISH_PAGE_RESET_FAILED',
                errorMessage: result.message || '仍未能恢复发布页',
                updatedAt: Date.now(),
            });
        } catch (error) {
            const failure = errorShape(error);
            this.save({
                ...job,
                status: 'published_reset_failed',
                resetStatus: 'failed',
                errorCode: failure.code,
                errorMessage: failure.message,
                updatedAt: Date.now(),
            });
        }
    }

    private applyExecutionResult(job: XhsPublishJob, result: XhsPublisherExecutionResult): boolean {
        if (result.publishStatus === 'published' && result.resetStatus === 'ready') {
            this.save({
                ...job,
                status: 'completed',
                publishStatus: 'published',
                resetStatus: 'ready',
                publishedAt: result.publishedAt || Date.now(),
                completedAt: Date.now(),
                errorCode: '',
                errorMessage: '',
                updatedAt: Date.now(),
            });
            return true;
        }
        if (result.publishStatus === 'published') {
            this.save({
                ...job,
                status: 'published_reset_failed',
                publishStatus: 'published',
                resetStatus: 'failed',
                publishedAt: result.publishedAt || Date.now(),
                errorCode: result.code || 'PUBLISH_PAGE_RESET_FAILED',
                errorMessage: result.message || '笔记已发布，但未能恢复为空白发布页',
                updatedAt: Date.now(),
            });
            return true;
        }
        if (result.publishStatus === 'pending_review') {
            this.save({ ...job, status: 'submitted_pending_review', publishStatus: 'pending_review', resetStatus: result.resetStatus, updatedAt: Date.now(), errorCode: result.code || '', errorMessage: result.message || '' });
            return true;
        }
        if (result.publishStatus === 'submitted' || result.publishStatus === 'unknown') {
            this.applyUnknownResult(job, result.code, result.message);
            return true;
        }
        return false;
    }

    private applyUnknownResult(job: XhsPublishJob, code?: string, message?: string): XhsPublishJob {
        return this.save({
            ...job,
            status: 'submit_result_unknown',
            publishStatus: 'unknown',
            resetStatus: 'not_started',
            submittedAt: job.submittedAt || Date.now(),
            errorCode: code || 'SUBMIT_RESULT_UNKNOWN',
            errorMessage: message || '无法确认发布结果，请人工检查笔记管理页',
            updatedAt: Date.now(),
        });
    }

    private block(job: XhsPublishJob, code: string, message: string): XhsPublishJob {
        return this.save({
            ...job,
            status: 'blocked',
            publishStatus: 'not_submitted',
            resetStatus: 'not_started',
            errorCode: code,
            errorMessage: message,
            updatedAt: Date.now(),
        });
    }

    getConversationContext(sessionId: string, projectPath?: string): Record<string, unknown> | undefined {
        const pending = selectXhsConversationJob(listXhsPublishJobs(), sessionId, projectPath);
        if (!pending) return undefined;
        return { jobId: pending.id, projectPath: pending.projectPath, revision: pending.revision,
            title: pending.title, status: pending.status, publishStatus: pending.publishStatus,
            unresolved: listXhsPublishJobs().filter(job => job.projectPath === pending.projectPath && xhsSubmissionNeedsReview(job))
                .map(job => ({ jobId: job.id, revision: job.revision, publishStatus: job.publishStatus, userVerifiedNotPublished: hasXhsUnpublishedReview(job) })) };
    }

    // The single intent router owns semantics. This service only validates and
    // executes its typed, current-turn action against trusted persisted jobs.
    async handleRoutedConversationAction(sessionId: string, route: IntentRoute, interactive: boolean, projectPath?: string, signal?: AbortSignal): Promise<{
        handled: boolean; response?: string; failed?: boolean; job?: XhsPublishJob; runtimeMetadata?: Record<string, unknown>;
    }> {
        if (route.workflowKind !== 'xhs-publish') return { handled: false };
        if (!interactive) return route.xhsPublishAction?.publicationRequested
            ? { handled: true, failed: true, response: '发布当前版本需要前台用户明确授权，后台任务不会提交。' }
            : { handled: false };
        if (signal?.aborted) return { handled: true, failed: true, response: '当前执行已停止，未提交发布。' };
        if (route.routingFailure) {
            const diagnosis = route.routingDiagnostic;
            const reasons: Record<NonNullable<IntentRoute['routingFailure']>, string> = {
                timeout: `发布动作识别的模型响应超时（每次请求最多 ${Math.round((diagnosis?.timeoutMs || 90000) / 1000)} 秒），不是你的指令不明确。可以稍后重试；持续超时请检查当前模型和代理连接。`,
                cancelled: '发布动作识别已停止。',
                'http-error': `发布动作识别的模型服务返回 HTTP ${diagnosis?.httpStatus || '错误'}。请检查当前模型服务、代理和账户配置后重试。`,
                'network-error': '发布动作识别的模型连接失败。请检查当前模型或代理网络连接后重试。',
                unavailable: '发布动作识别缺少可用模型配置。请检查当前模型配置后重试。',
                'invalid-output': '模型未返回有效的发布动作识别结果。可以重试；持续失败请检查当前模型的结构化输出支持。',
                'request-failed': '发布动作识别请求失败。请检查当前模型连接后重试。',
            };
            return { handled: true, failed: true, response: `${reasons[route.routingFailure]}未修改稿件或提交发布。` };
        }
        return this.handleConversationAction(sessionId, route.xhsPublishAction || parseXhsPublishReply(null), projectPath, signal);
    }

    async handleConversationAction(
        sessionId: string,
        classification: XhsPublishReplyClassification,
        projectPath?: string,
        signal?: AbortSignal,
    ): Promise<{ handled: boolean; response?: string; failed?: boolean; job?: XhsPublishJob; runtimeMetadata?: Record<string, unknown> }> {
        if (['confirm', 'resume', 'recover'].includes(classification.intent)) return { handled: true,
            response: '请打开当前作品的准备发布面板，分别点击“上传到页面供核对”和“最终确认发布”。本轮对话未上传或提交。' };
        if (classification.intent === 'unrelated') return { handled: false };
        if (classification.confidence < 0.8 || classification.intent === 'unclear') {
            return { handled: true, failed: true, response: '本轮发布动作未能可靠识别，未修改稿件或提交发布。请明确说明是修改文案、核实未发布，还是发布当前版本；若仍失败请检查模型连接。' };
        }
        const pending = selectXhsConversationJob(listXhsPublishJobs(), sessionId, projectPath);
        if (!pending) {
            if (classification.intent === 'prepare') return { handled: false };
            return { handled: true, failed: true, response: '没有唯一可绑定的当前发布任务，请先准备稿件或明确选择稿件；未提交发布。' };
        }
        const context = this.getConversationContext(sessionId, pending.projectPath);
        const runtimeMetadata = { workflowKind: 'xhs-publish', activeXhsNotePath: pending.projectPath, xhsPublishContext: context };
        try {
            if (['queued', 'preflighting', 'uploading', 'submitting', 'returning'].includes(pending.status)
                && (classification.intent === 'confirm' || classification.intent === 'recover' || classification.acknowledgedNotPublished)) {
                return { handled: true, response: pending.status === 'submitting'
                    ? '当前版本正在执行发布点击并等待平台反馈，不会重复点击；此时无需核实旧任务，请等待本次结果。'
                    : '当前发布任务正在执行，不会重复入队；请等待本次结果。' };
            }
            const unresolved = listXhsPublishJobs().filter((job) => job.projectPath === pending.projectPath && xhsSubmissionNeedsReview(job));
            if (classification.acknowledgedNotPublished && unresolved.length) {
                if (unresolved.length !== 1 || unresolved[0].sessionId !== sessionId) {
                    return { handled: true, failed: true, response: '未找到唯一属于当前会话的未知提交任务，不能把核实结论应用到其他任务；未提交发布。' };
                }
                unresolved[0] = this.recordUnpublishedReview(unresolved[0]);
            }
            if (classification.intent === 'modify' || classification.intent === 'resume' || classification.intent === 'prepare') {
                return { handled: false, runtimeMetadata: { ...runtimeMetadata, xhsPublishContext: this.getConversationContext(sessionId, pending.projectPath) } };
            }
            if (classification.intent === 'status') {
                const reviewRecorded = unresolved.length === 1 && unresolved[0].sessionId === sessionId && hasXhsUnpublishedReview(unresolved[0]);
                const priorReview = unresolved.some(job => job.id !== pending.id);
                const unknownStatus = reviewRecorded ? '平台提交回执仍未知；你核实未发布的记录已保存，发布页尚待安全恢复，无需重复核实' : '提交结果未知，需先在笔记管理核实';
                return { handled: true, response: `当前第 ${pending.revision} 版标题：${pending.title}\n发布状态：${pending.publishStatus === 'unknown' ? unknownStatus : pending.publishStatus === 'published' ? '已确认发布成功' : pending.publishStatus === 'submitted' ? '正在提交，请勿重复发布' : '当前版本尚未提交'}。${priorReview ? `\n旧版本${reviewRecorded ? unknownStatus : '提交结果仍未知，不能视为未发布，需先核实'}。` : ''}${pending.errorMessage ? `\n${pending.errorMessage}` : ''}\n可以直接在对话中提出文案修改；无需寻找旧卡片。` };
            }
            if (classification.intent === 'reject') {
                this.cancel(pending.id);
                return { handled: true, response: '已取消这次发布，当前版本不会发送到小红书。' };
            }
            let latest = pending;
            if (latest.publishStatus === 'published' && classification.intent === 'recover') {
                if (latest.status === 'published_reset_failed') {
                    await this.retry(latest.id);
                    return { handled: true, response: '该版本已发布，只恢复发布页，不会再次发帖。' };
                }
                return { handled: true, response: '该版本已有发布成功记录，无需未发布恢复，不会重复发帖。' };
            }
            if (unresolved.length) {
                if (unresolved.length !== 1 || unresolved[0].sessionId !== sessionId || !hasXhsUnpublishedReview(unresolved[0])) {
                    const subject = unresolved.some((job) => job.id !== pending.id) ? '旧版本' : `当前第 ${pending.revision} 版这次`;
                    return { handled: true, failed: true, response: `${subject}提交结果尚未核实，暂不重发。${pending.errorMessage ? `${pending.errorMessage}。` : ''}请先检查小红书笔记管理；若确认这次没有发布，请在这里明确告诉我“已核实未发布”。视频和修改后的稿件都会保留。` };
                }
                latest = await this.recoverUnpublished(unresolved[0].id, true, signal);
            }
            if (classification.intent === 'recover' && !unresolved.length) {
                return { handled: true, response: '当前没有待人工核实的未知提交任务；稿件保留，尚未再次提交，可继续修改或明确要求发布当前版本。' };
            }
            if (classification.intent === 'confirm' && classification.publicationRequested) {
                if (latest.publishStatus === 'published') return { handled: true, response: '当前版本已有发布成功记录，不会重复提交。' };
                if (['queued', 'preflighting', 'uploading', 'submitting', 'returning'].includes(latest.status)) {
                    return { handled: true, response: '当前发布任务正在执行，不会重复入队。' };
                }
                if (['cancelled', 'superseded'].includes(latest.status)) latest = await this.requestPublication(sessionId, latest.projectPath, 'explicit-request');
                if (latest.triggerOrigin !== 'explicit-request') {
                    latest = this.save({ ...latest, triggerOrigin: 'explicit-request', updatedAt: Date.now() });
                }
                if (signal?.aborted) return { handled: true, failed: true, response: '当前执行已停止，未提交发布。核实记录和稿件保留。' };
                const queued = await this.confirm(latest.id, signal);
                return { handled: true, job: queued, response: `已按你的明确发布要求，将第 ${queued.revision} 版《${queued.title}》加入发布队列；会在对话中更新结果。尚未收到成功回执，不代表已经发布。` };
            }
            return { handled: true, response: `当前第 ${latest.revision} 版标题：${latest.title}。文案和已上传视频保留，尚未再次提交。需要发布时可直接说“重新发布当前版本”；也可以继续提出修改。` };
        } catch (error) {
            const reviewSaved = listXhsPublishJobs().some(job => job.sessionId === sessionId && job.projectPath === pending.projectPath && xhsSubmissionNeedsReview(job) && hasXhsUnpublishedReview(job));
            const failure = errorShape(error);
            const current = selectXhsConversationJob(listXhsPublishJobs(), sessionId, pending.projectPath);
            if (failure.code !== 'BROWSER_WAIT_CANCELLED' && current?.publishStatus === 'not_submitted'
                && ['awaiting_confirmation', 'blocked'].includes(current.status)) {
                this.block(current, failure.code, failure.message);
            }
            if (failure.code === 'BROWSER_INSTANCE_UNAVAILABLE' || failure.code === 'BROWSER_WAIT_CANCELLED') {
                return { handled: true, failed: true, response: `${failure.message}。${reviewSaved ? '最新文案及已核实未发布的记录保留，无需再修改标题或重复核实。' : '最新文案保留。'}` };
            }
            return { handled: true, failed: true, response: `未提交新的发布：${failure.message}。${reviewSaved ? '你已核实未发布的记录已保存；页面问题解决后可直接要求重新发布，无需重复核实。' : ''}` };
        }
    }
}

let service: XhsPublisherService | null = null;

export function getXhsPublisherService(): XhsPublisherService {
    if (!service) service = new XhsPublisherService();
    return service;
}

export function xhsPublishSnapshotMatchesJob(snapshot: XhsNoteProjectSnapshot, job: XhsPublishJob): boolean {
    return snapshot.projectPath === job.projectPath && snapshot.version === job.revision;
}

function publicationRequestContext(jobId: string) {
    const context = getPublicationJobContext('xiaohongshu', jobId);
    if (!context || context.spaceId !== publicationPaths().activeSpaceId) throw new Error('缺少当前空间账号核验，请重新准备发布');
    return { accountId: context.accountId, accountLabel: context.accountLabel, confirmationVersion: 2 as const,
        uploadPageFingerprint: context.uploadReview?.pageFingerprint,
        mediaSha256: context.snapshot.media.map(media => media.sha256),
        media: context.snapshot.media.map(({ slotId, role, path, mimeType, order }) => ({ slotId, role, path, mimeType, order })) };
}
