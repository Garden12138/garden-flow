import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { BrowserWindow } from 'electron';
import {
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
import { fetchLlmWithRetry } from './llmFetchRetry';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { isPathWithinRoots } from './localAssetManager';
import { getAbsoluteMediaPath } from './mediaLibraryStore';
import { getXhsNoteProject } from './xhsNoteProjectStore';
import { normalizeApiBaseUrl, safeUrlJoin } from './urlUtils';
import { XHS_AUTO_PUBLISH_TASK_ID } from './builtinAutomationTasks';
import { isXhsMediaCompatible, type XhsNoteProjectSnapshot } from '../../shared/xhsNote';
import {
    XHS_PUBLISHER_CAPABILITY,
    XHS_PUBLISH_PROTOCOL_VERSION,
    isTerminalXhsPublishStatus,
    normalizeXhsHashtags,
    reconcileInterruptedXhsPublishJob,
    xhsPublishRetryMode,
    type XhsPublishConsentMetadata,
    type XhsPublishJob,
    type XhsPublishJobStatus,
    type XhsPublishMediaV1,
    type XhsPublishRequestV1,
    type XhsPublisherBrowserStatus,
    type XhsPublisherExecutionResult,
    type XhsPublisherStatus,
} from '../../shared/xhsPublisher';

type PublishReplyIntent = 'confirm' | 'reject' | 'modify' | 'unrelated' | 'unclear';

type PublishReplyClassification = {
    intent: PublishReplyIntent;
    confidence: number;
};

type PublisherLlmConfig = {
    apiKey: string;
    baseURL: string;
    model: string;
};

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

function readJsonObject(text: string): Record<string, unknown> | null {
    const candidates = [String(text || '').trim()];
    const fenced = candidates[0].match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.unshift(fenced[1].trim());
    for (const candidate of candidates) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            if (isRecord(parsed)) return parsed;
        } catch {
            // Try the next representation.
        }
    }
    return null;
}

function responseTextFromChatCompletion(raw: string): string {
    const parsed = readJsonObject(raw);
    if (!parsed || !Array.isArray(parsed.choices)) return '';
    const first = parsed.choices[0];
    if (!isRecord(first) || !isRecord(first.message)) return '';
    return String(first.message.content || '').trim();
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
    const publishStatus = ['not_submitted', 'submitted', 'published', 'unknown'].includes(String(value.publishStatus))
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

    constructor() {
        super();
        this.reconcileInterruptedJobs();
    }

    private reconcileInterruptedJobs(): void {
        for (const job of listXhsPublishJobs(ACTIVE_JOB_STATUSES)) {
            const reconciled = reconcileInterruptedXhsPublishJob(job, Date.now());
            if (reconciled) this.save(reconciled);
        }
    }

    private emitChanged(job: XhsPublishJob): void {
        this.emit('changed', job);
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('xhs-publisher:job-changed', job);
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

    getJob(jobId: string): XhsPublishJob | null {
        return getXhsPublishJob(String(jobId || '').trim());
    }

    private async buildCandidate(sessionId: string, projectPath: string): Promise<Candidate> {
        const snapshot = await getXhsNoteProject(projectPath);
        const document = snapshot.document;
        if (document.generationStatus !== 'generated') {
            throw Object.assign(new Error('笔记媒体尚未全部制作完成'), { code: 'ARTIFACT_NOT_READY' });
        }
        const title = document.finalTitle.trim();
        const body = document.body.trim();
        if (!title || !body) {
            throw Object.assign(new Error('标题或正文为空，暂不能发布'), { code: 'ARTIFACT_NOT_READY' });
        }

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
            if (seenPaths.has(absolutePath)) continue;
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
        const contentDigest = createHash('sha256').update(JSON.stringify({
            projectPath: snapshot.projectPath,
            revision: snapshot.version,
            title,
            body,
            hashtags,
            media: media.map((item) => ({ ...item, path: path.normalize(item.path) })),
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
        if (!sessionId || !projectPath || !await this.automationEnabled()) return null;
        let candidate: Candidate;
        try {
            candidate = await this.buildCandidate(sessionId, projectPath);
        } catch (error) {
            const { code } = errorShape(error);
            if (code === 'ARTIFACT_NOT_READY') return null;
            throw error;
        }
        const existing = findXhsPublishJobByCandidate(candidate.projectPath, candidate.revision, candidate.contentDigest);
        if (existing) return existing;
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
                detail: detail.detail ? String(detail.detail) : undefined,
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

    async confirm(jobId: string): Promise<XhsPublishJob> {
        let job = getXhsPublishJob(jobId);
        if (!job) throw new Error('发布任务不存在');
        if (job.status !== 'awaiting_confirmation' && job.status !== 'blocked') {
            throw new Error('当前发布任务不能确认');
        }
        const fresh = await this.buildCandidate(job.sessionId, job.projectPath);
        if (fresh.revision !== job.revision || fresh.contentDigest !== job.contentDigest) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
            await this.considerCompletedArtifact(job.sessionId, job.projectPath);
            throw new Error('笔记内容已变化，已为新版本重新发起确认');
        }
        const stillEnabled = await this.automationEnabled();
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
        if (job.status === 'blocked') void this.discardPreparedPage(cancelled);
        return cancelled;
    }

    cancelPendingJobs(): number {
        let cancelled = 0;
        for (const job of listXhsPublishJobs(['awaiting_confirmation', 'queued', 'preflighting', 'uploading', 'blocked'])) {
            const cancelledJob = this.save({ ...job, status: 'cancelled', updatedAt: Date.now() });
            if (job.status === 'blocked') void this.discardPreparedPage(cancelledJob);
            cancelled += 1;
        }
        return cancelled;
    }

    async retry(jobId: string): Promise<XhsPublishJob> {
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

    private async executePublish(jobId: string): Promise<void> {
        const job = getXhsPublishJob(jobId);
        if (!job || job.status !== 'queued') return;
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) {
            this.block(job, 'DESKTOP_BRIDGE_UNAVAILABLE', '浏览器桥接未启动');
            return;
        }
        const fresh = await this.buildCandidate(job.sessionId, job.projectPath).catch(() => null);
        if (!fresh || fresh.contentDigest !== job.contentDigest || fresh.revision !== job.revision) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
            await this.considerCompletedArtifact(job.sessionId, job.projectPath);
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
            media: current.media,
        };
        try {
            current = this.save({ ...current, status: 'uploading', updatedAt: Date.now() });
            const prepareRaw = await bridge.invokeBrowserControl('publisher.publish', {
                phase: 'prepare',
                request: request as unknown as Record<string, unknown>,
            }, {
                extensionInstanceId: current.extensionInstanceId,
                extensionKind: 'xhs-publisher',
                requiredCapability: XHS_PUBLISHER_CAPABILITY,
                timeoutMs: 10 * 60_000,
            });
            const prepareResult = statusResultFromUnknown(prepareRaw, current.id);
            current = getXhsPublishJob(current.id) || current;
            if (this.applyExecutionResult(current, prepareResult)) return;
            if (!isRecord(prepareRaw) || prepareRaw.prepared !== true || !prepareResult.ok) {
                this.block(current, prepareResult.code || 'PUBLISH_PREPARE_FAILED', prepareResult.message || '发布内容准备失败');
                return;
            }

            if (current.status === 'cancelled' || !await this.automationEnabled()) {
                if (current.status !== 'cancelled') {
                    current = this.save({ ...current, status: 'cancelled', updatedAt: Date.now() });
                }
                await this.discardPreparedPage(current);
                return;
            }

            const latest = await this.buildCandidate(current.sessionId, current.projectPath).catch(() => null);
            if (!latest || latest.revision !== current.revision || latest.contentDigest !== current.contentDigest) {
                this.save({ ...current, status: 'superseded', updatedAt: Date.now() });
                await this.discardPreparedPage(current);
                await this.considerCompletedArtifact(current.sessionId, current.projectPath);
                return;
            }

            const stillEnabled = await this.automationEnabled();
            current = getXhsPublishJob(current.id) || current;
            if (current.status === 'cancelled' || !stillEnabled) {
                if (current.status !== 'cancelled') {
                    current = this.save({ ...current, status: 'cancelled', updatedAt: Date.now() });
                }
                await this.discardPreparedPage(current);
                return;
            }

            current = this.save({
                ...current,
                status: 'submitting',
                publishStatus: 'submitted',
                submittedAt: Date.now(),
                updatedAt: Date.now(),
            });
            const submitRaw = await bridge.invokeBrowserControl('publisher.publish', {
                phase: 'submit',
                jobId: current.id,
                contentDigest: current.contentDigest,
                request: request as unknown as Record<string, unknown>,
            }, {
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

    private async discardPreparedPage(job: XhsPublishJob): Promise<void> {
        await getBrowserCaptureBridgeService()?.invokeBrowserControl('publisher.publish', {
            phase: 'discard',
            jobId: job.id,
            contentDigest: job.contentDigest,
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
            const raw = await getBrowserCaptureBridgeService()?.invokeBrowserControl('publisher.restore', { jobId }, {
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

    async handlePendingChatReply(
        sessionId: string,
        content: string,
        llm: PublisherLlmConfig,
    ): Promise<{ handled: boolean; response?: string }> {
        const pending = listXhsPublishJobs(['awaiting_confirmation'])
            .filter((job) => job.sessionId === sessionId)
            .sort((left, right) => right.createdAt - left.createdAt)[0];
        if (!pending) return { handled: false };
        const classification = await this.classifyReply(content, pending, llm);
        if (classification.intent === 'confirm' && classification.confidence >= 0.8) {
            await this.confirm(pending.id);
            return { handled: true, response: '已确认，发布任务已进入队列。我会在对话中更新发布结果。' };
        }
        if (classification.intent === 'reject' && classification.confidence >= 0.8) {
            this.cancel(pending.id);
            return { handled: true, response: '已取消这次发布，当前版本不会发送到小红书。' };
        }
        if (classification.intent === 'modify') {
            this.save({ ...pending, status: 'superseded', updatedAt: Date.now() });
            return { handled: false };
        }
        if (classification.intent === 'unrelated') return { handled: false };
        return { handled: true, response: '我没有识别到明确的纯发布确认。请点击“确认发布”，或只回复是否发布；如果需要修改内容，请直接说明修改要求。' };
    }

    private async classifyReply(
        content: string,
        job: XhsPublishJob,
        llm: PublisherLlmConfig,
    ): Promise<PublishReplyClassification> {
        if (!llm.apiKey || !llm.baseURL || !llm.model) return { intent: 'unclear', confidence: 0 };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        try {
            const response = await fetchLlmWithRetry(safeUrlJoin(normalizeApiBaseUrl(llm.baseURL), '/chat/completions'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
                body: JSON.stringify({
                    model: llm.model,
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    messages: [
                        {
                            role: 'system',
                            content: [
                                'Classify the user reply to a pending Xiaohongshu publish consent.',
                                'Return JSON only: {"intent":"confirm|reject|modify|unrelated|unclear","confidence":0..1}.',
                                'confirm is allowed only when the reply is a pure affirmative with no content changes or extra request.',
                                'Any requested title/body/media/tag change is modify, even if the reply also says yes.',
                            ].join('\n'),
                        },
                        {
                            role: 'user',
                            content: JSON.stringify({ pendingTitle: job.title, pendingRevision: job.revision, reply: content }),
                        },
                    ],
                }),
                signal: controller.signal,
            }, { maxAttempts: 1 });
            if (!response.ok) return { intent: 'unclear', confidence: 0 };
            const raw = await response.text();
            const parsed = readJsonObject(responseTextFromChatCompletion(raw));
            const intent = String(parsed?.intent || 'unclear');
            if (!['confirm', 'reject', 'modify', 'unrelated', 'unclear'].includes(intent)) {
                return { intent: 'unclear', confidence: 0 };
            }
            const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence) || 0));
            return { intent: intent as PublishReplyIntent, confidence };
        } catch {
            return { intent: 'unclear', confidence: 0 };
        } finally {
            clearTimeout(timer);
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
