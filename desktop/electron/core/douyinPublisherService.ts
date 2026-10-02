import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import {
    getActiveSpaceId, getDouyinPublishJob, getDouyinPublisherBinding, getDouyinVideoVersion,
    getWorkspacePaths, listDouyinPublishJobs, setDouyinPublisherBinding, upsertDouyinPublishJob,
} from '../db';
import { DOUYIN_PUBLISHER_CAPABILITY, DOUYIN_IMAGE_COVER_CAPABILITY } from '../../shared/xhsPublisher';
import type { DouyinPublishJob, DouyinVideoVersion } from '../../shared/platformVideoVersion';
import type { DouyinPublishRequestV1, PlatformPublishCommandV1 } from '../../shared/platformPublisher';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { getAbsoluteMediaPath, listMediaAssets } from './mediaLibraryStore';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import { assertCurrentVideoExport } from './video-editor-v2/videoPublicationPolicy';
import { prepareDouyinImageCover } from './douyinImageCover';

type Candidate = {
    version: DouyinVideoVersion;
    renderId: string;
    mediaAssetId: string;
    mediaPath: string;
    digest: string;
    imageCover?: DouyinPublishRequestV1['imageCover'];
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requestForJob(job: DouyinPublishJob): DouyinPublishRequestV1 {
    return {
        platform: 'douyin', protocolVersion: 1, jobId: job.id, sessionId: job.sessionId,
        versionId: job.versionId, revision: job.versionRevision, projectId: job.projectId,
        renderId: job.renderId, mediaAssetId: job.mediaAssetId, mediaPath: job.mediaPath,
        contentDigest: job.contentDigest, accountId: job.accountId, accountLabel: job.accountLabel,
        title: job.title, description: job.description, hashtags: job.hashtags,
        coverAssetId: job.imageCover?.assetId, imageCover: job.imageCover,
    };
}

async function candidateForVersion(versionId: string): Promise<Candidate> {
    const version = getDouyinVideoVersion(versionId);
    if (!version) throw new Error('抖音版本不存在或不属于当前空间');
    const project = await getVideoEditorV2Project(version.projectId);
    if (!project?.productVideo || project.projectKind !== 'product-video') throw new Error('抖音视频工程不存在');
    if (project.canvas.aspectRatio !== '9:16') throw new Error('抖音版本须使用竖屏 9:16 视频');
    const imageCover = await prepareDouyinImageCover(project, version.coverAssetId);
    assertCurrentVideoExport(project);
    const output = project.renderOutputs[0];
    const asset = (await listMediaAssets(10000)).find((item) => item.id === output.mediaAssetId);
    if (!asset?.relativePath || !String(asset.mimeType || '').startsWith('video/')) throw new Error('当前导出未在资产库找到视频文件');
    const mediaPath = path.resolve(getAbsoluteMediaPath(asset.relativePath));
    if (!isPathWithinRoots(mediaPath, [path.resolve(getWorkspacePaths().media)]) || !(await fs.stat(mediaPath)).isFile()) {
        throw new Error('当前成片路径不合法或文件已丢失');
    }
    if (!version.description.trim()) throw new Error('请先填写抖音发布描述');
    const digest = createHash('sha256').update(JSON.stringify({
        platform: 'douyin', versionId: version.id, revision: version.revision,
        projectId: project.id, renderId: output.id, mediaAssetId: asset.id,
        title: version.title, description: version.description, hashtags: version.hashtags,
        coverAssetId: version.coverAssetId || null,
        imageCover,
    })).digest('hex');
    return { version, renderId: output.id, mediaAssetId: asset.id, mediaPath, digest, imageCover };
}

export class DouyinPublisherService {
    private queue: Promise<void> = Promise.resolve();
    private reconciledSpaces = new Set<string>();
    private preparing = new Map<string, Promise<DouyinPublishJob>>();
    private staging = new Map<string, Promise<DouyinPublishJob>>();

    constructor() {
        this.ensureReconciled();
    }

    private ensureReconciled(): void {
        const spaceId = getActiveSpaceId();
        if (this.reconciledSpaces.has(spaceId)) return;
        this.reconciledSpaces.add(spaceId);
        for (const job of listDouyinPublishJobs()) {
            const now = Date.now();
            if (['queued', 'preflighting', 'uploading'].includes(job.status)) {
                this.save({ ...job, status: 'blocked', publishStatus: 'not_submitted', errorCode: 'DESKTOP_RESTARTED_PRE_SUBMIT', errorMessage: '提交前中断，可复核后重试', updatedAt: now });
            } else if (job.status === 'submitting') {
                this.save({ ...job, status: 'submit_result_unknown', publishStatus: 'unknown', errorCode: 'DESKTOP_RESTARTED_DURING_SUBMIT', errorMessage: '提交期间中断，请先核对抖音作品管理', updatedAt: now });
            } else if (['published', 'returning'].includes(job.status)) {
                this.save({ ...job, status: 'published_reset_failed', publishStatus: 'published', resetStatus: 'failed', errorCode: 'DESKTOP_RESTARTED_DURING_RETURN', errorMessage: '作品已发布，发布页恢复中断', updatedAt: now });
            }
        }
    }

    private save(job: DouyinPublishJob): DouyinPublishJob {
        upsertDouyinPublishJob(job);
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('douyin-publisher:job-changed', job);
        }
        return job;
    }

    getJob(jobId: string): DouyinPublishJob | null { this.ensureReconciled(); return getDouyinPublishJob(jobId); }
    getLatestJob(versionId: string): DouyinPublishJob | null {
        this.ensureReconciled();
        return listDouyinPublishJobs().find((job) => job.versionId === versionId) || null;
    }

    async getStatus(): Promise<{ boundExtensionInstanceId: string; instances: Array<Record<string, unknown>> }> {
        this.ensureReconciled();
        const bridge = getBrowserCaptureBridgeService();
        const instances = (bridge?.getStatus().instances || []).filter((item) =>
            item.extensionKind === 'xhs-publisher' && item.capabilities.includes(DOUYIN_PUBLISHER_CAPABILITY));
        const statuses = await Promise.all(instances.map(async (instance) => {
            try {
                const status = record(await bridge?.invokeBrowserControl('publisher.status', { platform: 'douyin' }, {
                    extensionInstanceId: instance.extensionInstanceId, extensionKind: 'xhs-publisher',
                    requiredCapability: DOUYIN_PUBLISHER_CAPABILITY, timeoutMs: 20_000,
                }));
                return { ...status, extensionInstanceId: instance.extensionInstanceId, browser: instance.browser,
                    imageCoverSupported: instance.capabilities.includes(DOUYIN_IMAGE_COVER_CAPABILITY) };
            } catch (error) {
                return { extensionInstanceId: instance.extensionInstanceId, browser: instance.browser,
                    imageCoverSupported: instance.capabilities.includes(DOUYIN_IMAGE_COVER_CAPABILITY),
                    detail: error instanceof Error ? error.message : String(error), pageState: 'unsupported' };
            }
        }));
        return { boundExtensionInstanceId: getDouyinPublisherBinding(), instances: statuses };
    }

    bindInstance(id: string): string {
        const instance = getBrowserCaptureBridgeService()?.getStatus().instances.find((item) =>
            item.extensionInstanceId === id && item.extensionKind === 'xhs-publisher'
            && item.capabilities.includes(DOUYIN_PUBLISHER_CAPABILITY));
        if (!instance) throw new Error('所选浏览器没有抖音发布能力');
        setDouyinPublisherBinding(id);
        return id;
    }

    private async reconcileReviewedOwnership(instance: Record<string, unknown>, expectedJobId?: string): Promise<void> {
        const ownedJobId = String(instance.ownedJobId || '');
        if (!ownedJobId || ownedJobId === expectedJobId || instance.pageState !== 'ready') return;
        const previous = getDouyinPublishJob(ownedJobId);
        // The plugin may release a discarded, never-submitted draft after checking
        // the blank page itself. Submitted jobs require the durable human review.
        if (previous?.publishStatus === 'not_submitted') return;
        if (!previous || !['completed', 'published_reset_failed'].includes(previous.status)
            || previous.publishStatus !== 'published' || previous.publishedReview?.kind !== 'user-verified-published'
            || previous.publishedReview.accountId !== previous.accountId || previous.publishedReview.title !== previous.title
            || previous.extensionInstanceId !== instance.extensionInstanceId
            || previous.accountId !== instance.accountId || previous.accountLabel !== instance.accountLabel) {
            throw new Error('发布页仍绑定尚未核实或不属于当前空间的旧任务，请先核对原任务');
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) throw new Error('发布浏览器未连接，无法同步已核实发布记录');
        const response = record(await bridge.invokeBrowserControl('publisher.publish', {
            platform: 'douyin', phase: 'review-published', jobId: previous.id,
            contentDigest: previous.contentDigest, accountId: previous.accountId,
            accountLabel: previous.accountLabel, acknowledgedPublished: true,
        } satisfies PlatformPublishCommandV1, {
            extensionInstanceId: previous.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: DOUYIN_PUBLISHER_CAPABILITY, timeoutMs: 30_000,
        }));
        if (response.ok !== true || response.jobId !== previous.id
            || response.publishStatus !== 'published' || response.resetStatus !== 'ready') {
            throw new Error(String(response.message || '已核实发布记录未能与浏览器同步，请核对原任务'));
        }
    }

    async prepare(versionId: string, sessionId: string): Promise<DouyinPublishJob> {
        this.ensureReconciled();
        const key = `${getActiveSpaceId()}:${versionId}`;
        const pending = this.preparing.get(key);
        if (pending) return pending;
        const operation = this.prepareUnlocked(versionId, sessionId);
        this.preparing.set(key, operation);
        try { return await operation; }
        finally { if (this.preparing.get(key) === operation) this.preparing.delete(key); }
    }

    private async prepareUnlocked(versionId: string, sessionId: string): Promise<DouyinPublishJob> {
        const spaceId = getActiveSpaceId();
        const candidate = await candidateForVersion(versionId);
        const binding = getDouyinPublisherBinding();
        if (!binding) throw new Error('请先绑定抖音发布浏览器');
        const status = await this.getStatus();
        const instance = status.instances.find((item) => item.extensionInstanceId === binding);
        if (!instance || instance.pageState !== 'ready') throw new Error(String(instance?.detail || '抖音发布页未就绪'));
        if (candidate.imageCover && instance.imageCoverSupported !== true) throw new Error('请更新发布插件后使用自选图片封面');
        const accountId = String(instance.accountId || '').trim();
        const accountLabel = String(instance.accountLabel || '').trim();
        if (!accountId || !accountLabel) throw new Error('无法可靠识别当前抖音账号，已阻止发布');
        await this.reconcileReviewedOwnership(instance);
        if (getActiveSpaceId() !== spaceId) throw new Error('准备期间空间已切换，请重新打开当前空间的工程');
        if ((await candidateForVersion(versionId)).digest !== candidate.digest) throw new Error('准备期间抖音稿件、成片或封面已更新，请重新准备');
        const older = listDouyinPublishJobs().filter((job) => job.versionId === versionId);
        if (older.some((job) => ['unknown', 'submitted', 'pending_review'].includes(job.publishStatus))) {
            throw new Error('该版本存在尚未核实的提交或审核结果，请先检查抖音作品管理');
        }
        const same = older.find((job) => job.contentDigest === candidate.digest
            && !['cancelled', 'superseded'].includes(job.status));
        if (same) return same;
        for (const job of older.filter((item) => item.status === 'awaiting_confirmation')) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
        }
        const now = Date.now();
        return this.save({
            id: `douyin_publish_${randomUUID()}`, platform: 'douyin', spaceId,
            sessionId: String(sessionId || `video-project:${candidate.version.projectId}`),
            versionId, versionRevision: candidate.version.revision, projectId: candidate.version.projectId,
            renderId: candidate.renderId, mediaAssetId: candidate.mediaAssetId, mediaPath: candidate.mediaPath,
            imageCover: candidate.imageCover,
            contentDigest: candidate.digest, title: candidate.version.title, description: candidate.version.description,
            hashtags: candidate.version.hashtags, accountId, accountLabel, extensionInstanceId: binding,
            status: 'awaiting_confirmation', publishStatus: 'not_submitted', resetStatus: 'not_started',
            errorCode: '', errorMessage: '', createdAt: now, updatedAt: now,
        });
    }

    private async validateConfirmation(jobId: string): Promise<DouyinPublishJob> {
        this.ensureReconciled();
        const job = getDouyinPublishJob(jobId);
        if (!job || !['awaiting_confirmation', 'blocked'].includes(job.status)) throw new Error('发布确认已失效');
        const fresh = await candidateForVersion(job.versionId);
        if (fresh.digest !== job.contentDigest || fresh.renderId !== job.renderId) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
            throw new Error('抖音稿件或成片已更新，请重新准备并确认新版本');
        }
        const status = await this.getStatus();
        const instance = status.instances.find((item) => item.extensionInstanceId === job.extensionInstanceId);
        if (job.imageCover && instance?.imageCoverSupported !== true) throw new Error('发布插件已变化，请更新支持图片封面的插件后重新确认');
        if (!instance || instance.accountId !== job.accountId || instance.accountLabel !== job.accountLabel
            || (instance.pageState !== 'ready' && !(instance.pageState === 'draft' && instance.ownedJobId === job.id))) {
            throw new Error('目标抖音账号或发布页已变化，请重新准备确认');
        }
        await this.reconcileReviewedOwnership(instance, job.id);
        const current = getDouyinPublishJob(jobId);
        if (!current || current.spaceId !== getActiveSpaceId() || !['awaiting_confirmation', 'blocked'].includes(current.status)
            || current.publishStatus !== 'not_submitted') throw new Error('该发布任务已确认或状态已变化');
        const latest = await candidateForVersion(job.versionId);
        if (latest.digest !== job.contentDigest) throw new Error('复核期间稿件或封面已变化，请重新准备');
        return current;
    }

    async stageDraft(jobId: string): Promise<DouyinPublishJob> {
        const key = `${getActiveSpaceId()}:${jobId}`;
        const pending = this.staging.get(key);
        if (pending) return pending;
        const operation = this.stageDraftUnlocked(jobId);
        this.staging.set(key, operation);
        try { return await operation; }
        finally { if (this.staging.get(key) === operation) this.staging.delete(key); }
    }

    private async stageDraftUnlocked(jobId: string): Promise<DouyinPublishJob> {
        const job = await this.validateConfirmation(jobId);
        // Recheck after async validation so a concurrent confirmation wins only once.
        if (!['awaiting_confirmation', 'blocked'].includes(getDouyinPublishJob(jobId)?.status || '')) throw new Error('任务状态已变化');
        this.save({ ...job, status: 'uploading', errorCode: '', errorMessage: '', updatedAt: Date.now() });
        try {
            const bridge = getBrowserCaptureBridgeService();
            if (!bridge) throw new Error('发布浏览器未连接');
            const response = record(await bridge.invokeBrowserControl('publisher.publish', {
                platform: 'douyin', phase: 'prepare', request: requestForJob(job),
            } satisfies PlatformPublishCommandV1, {
                extensionInstanceId: job.extensionInstanceId, extensionKind: 'xhs-publisher',
                requiredCapability: job.imageCover ? DOUYIN_IMAGE_COVER_CAPABILITY : DOUYIN_PUBLISHER_CAPABILITY,
                timeoutMs: 10 * 60_000,
            }));
            if (response.ok !== true || response.prepared !== true || response.publishStatus !== 'not_submitted') {
                return this.save({ ...job, status: 'blocked', errorCode: String(response.code || 'DRAFT_PREPARATION_FAILED'),
                    errorMessage: String(response.message || '页面上传或封面核验失败，未提交'), updatedAt: Date.now() });
            }
            const fresh = await candidateForVersion(job.versionId);
            if (getActiveSpaceId() !== job.spaceId || fresh.digest !== job.contentDigest) {
                return this.save({ ...job, status: 'superseded', errorCode: 'VERSION_CHANGED', errorMessage: '上传期间稿件或封面已变化，未提交', updatedAt: Date.now() });
            }
            return this.save({ ...job, status: 'awaiting_confirmation', errorCode: '', errorMessage: '', updatedAt: Date.now() });
        } catch (error) {
            return this.save({ ...job, status: 'blocked', errorCode: 'DRAFT_PREPARATION_FAILED',
                errorMessage: error instanceof Error ? error.message : String(error), updatedAt: Date.now() });
        }
    }

    async confirm(jobId: string): Promise<DouyinPublishJob> {
        const job = await this.validateConfirmation(jobId);
        if (!['awaiting_confirmation', 'blocked'].includes(getDouyinPublishJob(jobId)?.status || '')) throw new Error('任务状态已变化');
        const queued = this.save({ ...job, status: 'queued', confirmedAt: Date.now(), updatedAt: Date.now(), errorCode: '', errorMessage: '' });
        this.queue = this.queue.then(() => this.execute(queued.id)).catch((error) => console.error('[douyin-publisher]', error));
        return queued;
    }

    cancel(jobId: string): DouyinPublishJob {
        this.ensureReconciled();
        const job = getDouyinPublishJob(jobId);
        if (!job || !['awaiting_confirmation', 'queued', 'blocked'].includes(job.status)) throw new Error('此任务已提交或无法取消');
        return this.save({ ...job, status: 'cancelled', updatedAt: Date.now() });
    }

    async recoverUnpublished(jobId: string, acknowledgedNotPublished: boolean): Promise<DouyinPublishJob> {
        this.ensureReconciled();
        const job = getDouyinPublishJob(jobId);
        if (!job || job.status !== 'submit_result_unknown' || job.publishStatus !== 'unknown'
            || acknowledgedNotPublished !== true) {
            throw new Error('只有人工核实未发布的未知结果可恢复');
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) throw new Error('发布浏览器未连接，无法核验原任务草稿');
        const response = record(await bridge.invokeBrowserControl('publisher.publish', {
            platform: 'douyin', phase: 'recover', jobId: job.id,
            contentDigest: job.contentDigest, accountId: job.accountId,
            accountLabel: job.accountLabel, acknowledgedNotPublished: true,
        }, {
            extensionInstanceId: job.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: DOUYIN_PUBLISHER_CAPABILITY, timeoutMs: 60_000,
        }));
        if (response.ok !== true || response.resetStatus !== 'ready') {
            throw new Error(String(response.message || '旧草稿未能安全恢复，请人工检查页面'));
        }
        return this.save({ ...job, status: 'superseded', publishStatus: 'not_submitted', resetStatus: 'ready',
            errorCode: 'USER_VERIFIED_NOT_PUBLISHED', errorMessage: '已核实未发布，旧任务已关闭，可重新准备', updatedAt: Date.now() });
    }

    async reviewPublished(jobId: string, acknowledgedPublished: boolean): Promise<DouyinPublishJob> {
        this.ensureReconciled();
        const job = getDouyinPublishJob(jobId);
        const awaitingReview = job && ['submit_result_unknown', 'submitted_pending_review'].includes(job.status)
            && ['unknown', 'pending_review'].includes(job.publishStatus);
        const restoringPage = job?.status === 'published_reset_failed' && job.publishStatus === 'published'
            && job.publishedReview?.kind === 'user-verified-published';
        const annotatingCompleted = job?.status === 'completed' && job.publishStatus === 'published'
            && job.resetStatus === 'ready' && !job.publishedReview;
        if (!job || (!awaitingReview && !restoringPage && !annotatingCompleted) || acknowledgedPublished !== true) {
            throw new Error('只有在作品管理核实已发布的待核验任务可记录发布成功');
        }
        const now = Date.now();
        if (annotatingCompleted) {
            return this.save({ ...job, updatedAt: now,
                publishedReview: { kind: 'user-verified-published', reviewedAt: now, accountId: job.accountId, title: job.title } });
        }
        const reviewed = restoringPage ? job : this.save({ ...job, status: 'published_reset_failed', publishStatus: 'published',
            resetStatus: 'failed', publishedAt: now, updatedAt: now,
            publishedReview: { kind: 'user-verified-published', reviewedAt: now, accountId: job.accountId, title: job.title },
            errorCode: 'PUBLISHED_PAGE_NOT_RESTORED', errorMessage: '已人工核实发布；请将原浏览器返回空白视频发布页' });
        try {
            const status = await this.getStatus();
            const instance = status.instances.find((item) => item.extensionInstanceId === job.extensionInstanceId);
            if (instance?.pageState === 'ready' && instance.accountId === job.accountId
                && instance.accountLabel === job.accountLabel) {
                await this.reconcileReviewedOwnership(instance);
                return this.save({ ...reviewed, status: 'completed', resetStatus: 'ready', completedAt: Date.now(),
                    updatedAt: Date.now(), errorCode: '', errorMessage: '' });
            }
        } catch { /* The verified publication remains recorded when the browser is unavailable. */ }
        return reviewed;
    }

    private async execute(jobId: string): Promise<void> {
        let job = getDouyinPublishJob(jobId);
        if (!job || job.status !== 'queued') return;
        if (getActiveSpaceId() !== job.spaceId) {
            this.save({ ...job, status: 'blocked', publishStatus: 'not_submitted', errorCode: 'SPACE_CHANGED', errorMessage: '当前空间已切换，未执行发布', updatedAt: Date.now() });
            return;
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) { this.save({ ...job, status: 'blocked', errorCode: 'BROWSER_DISCONNECTED', errorMessage: '发布浏览器未连接', updatedAt: Date.now() }); return; }
        const request = requestForJob(job);
        const invoke = (phase: 'prepare' | 'submit', timeoutMs: number) => bridge.invokeBrowserControl('publisher.publish', { platform: 'douyin', phase, request } satisfies PlatformPublishCommandV1, {
            extensionInstanceId: job!.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: job!.imageCover ? DOUYIN_IMAGE_COVER_CAPABILITY : DOUYIN_PUBLISHER_CAPABILITY, timeoutMs,
        });
        try {
            const beforeUpload = await candidateForVersion(job.versionId);
            if (getActiveSpaceId() !== job.spaceId || beforeUpload.digest !== job.contentDigest) {
                this.save({ ...job, status: 'superseded', errorCode: 'VERSION_CHANGED', errorMessage: '确认后工程或封面已更新，请重新准备', updatedAt: Date.now() });
                return;
            }
            job = this.save({ ...job, status: 'preflighting', updatedAt: Date.now() });
            const prepared = record(await invoke('prepare', 10 * 60_000));
            job = getDouyinPublishJob(jobId) || job;
            if (job.status === 'cancelled') return;
            if (prepared.ok !== true || prepared.prepared !== true || prepared.publishStatus !== 'not_submitted') {
                this.save({ ...job, status: 'blocked', errorCode: String(prepared.code || 'PREPARE_FAILED'), errorMessage: String(prepared.message || '抖音页面准备失败'), updatedAt: Date.now() });
                return;
            }
            const fresh = await candidateForVersion(job.versionId);
            if (getActiveSpaceId() !== job.spaceId || fresh.digest !== job.contentDigest || fresh.renderId !== job.renderId) {
                this.save({ ...job, status: 'superseded', errorCode: 'VERSION_CHANGED', errorMessage: '准备期间工程已更新，未提交', updatedAt: Date.now() });
                return;
            }
            job = this.save({ ...job, status: 'submitting', publishStatus: 'submitted', submittedAt: Date.now(), updatedAt: Date.now() });
            const response = record(await invoke('submit', 3 * 60_000));
            job = getDouyinPublishJob(jobId) || job;
            if (response.publishStatus === 'not_submitted') {
                this.save({ ...job, status: 'blocked', publishStatus: 'not_submitted', errorCode: String(response.code || 'SUBMIT_REJECTED'), errorMessage: String(response.message || '页面明确拒绝提交'), updatedAt: Date.now() });
            } else if (response.publishStatus === 'published') {
                this.save({ ...job, status: response.resetStatus === 'ready' ? 'completed' : 'published_reset_failed', publishStatus: 'published',
                    resetStatus: response.resetStatus === 'ready' ? 'ready' : 'failed', publishedAt: Date.now(), completedAt: response.resetStatus === 'ready' ? Date.now() : undefined,
                    updatedAt: Date.now(), errorCode: '', errorMessage: '' });
            } else if (response.publishStatus === 'pending_review') {
                this.save({ ...job, status: 'submitted_pending_review', publishStatus: 'pending_review', resetStatus: response.resetStatus === 'ready' ? 'ready' : 'not_started', updatedAt: Date.now(), errorCode: '', errorMessage: '' });
            } else {
                this.save({ ...job, status: 'submit_result_unknown', publishStatus: 'unknown', errorCode: String(response.code || 'SUBMISSION_RESULT_UNKNOWN'), errorMessage: String(response.message || '请在抖音作品管理核实结果'), updatedAt: Date.now() });
            }
        } catch (error) {
            job = getDouyinPublishJob(jobId) || job;
            this.save({ ...job, status: job.status === 'submitting' ? 'submit_result_unknown' : 'blocked',
                publishStatus: job.status === 'submitting' ? 'unknown' : 'not_submitted',
                errorCode: 'BROWSER_EXECUTION_FAILED', errorMessage: error instanceof Error ? error.message : String(error), updatedAt: Date.now() });
        }
    }

    previewUrl(job: DouyinPublishJob): string { return toAppAssetUrl(job.mediaPath); }
}

let service: DouyinPublisherService | null = null;
export function getDouyinPublisherService(): DouyinPublisherService {
    if (!service) service = new DouyinPublisherService();
    return service;
}
