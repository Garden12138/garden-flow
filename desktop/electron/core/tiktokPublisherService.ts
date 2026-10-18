import { requirePublicationAction, recordPublicationUpload, validatePublicationContext } from './publicationExecutionPolicy';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import {
    assertProductEditsSettled, getProductEditorPublicationRevision, getActiveSpaceId, getTikTokPublishJob, getTikTokPublisherBinding, getTikTokVideoVersion,
    getWorkspacePaths, listTikTokPublishJobs, setTikTokPublisherBinding, upsertTikTokPublishJob,
} from '../db';
import { TIKTOK_PUBLISHER_CAPABILITY } from '../../shared/xhsPublisher';
import type { TikTokPublishJob, TikTokVideoVersion, TikTokPostReceipt } from '../../shared/tiktokVideo';
import { validateTikTokPublishSettings } from '../../shared/tiktokVideo';
import type { TikTokPublishRequestV1, PlatformPublishCommandV1 } from '../../shared/platformPublisher';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { getAbsoluteMediaPath, listMediaAssets } from './mediaLibraryStore';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import { assertCurrentVideoExport } from './video-editor-v2/videoPublicationPolicy';
import { createReadStream } from 'node:fs';

type Candidate = {
    version: TikTokVideoVersion;
    renderId: string;
    mediaAssetId: string;
    mediaPath: string;
    digest: string;
    mediaSha256: string;
    mediaSize: number;
    mediaDurationMs?: number;
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateTikTokPostReceipt(value: unknown, job: TikTokPublishJob): TikTokPostReceipt {
    const receipt = record(value);
    let url: URL;
    try { url = new URL(String(receipt.url || '')); } catch { throw new Error('TikTok 作品回执地址无效'); }
    const caption = [job.description, job.hashtags.map(tag => '#' + tag).join(' ')].filter(Boolean).join('\n');
    const canonical = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim();
    if (receipt.source !== 'tiktok-studio-posts' || url.origin !== 'https://www.tiktok.com'
        || url.username || url.password || url.search || url.hash
        || !/^\d{10,30}$/.test(String(receipt.videoId || ''))
        || url.pathname !== '/@' + job.accountId + '/video/' + receipt.videoId
        || receipt.accountId !== job.accountId || receipt.visibility !== job.publishSettings.visibility
        || typeof receipt.caption !== 'string' || receipt.caption.length > 4000 || canonical(receipt.caption) !== canonical(caption)
        || typeof receipt.durationText !== 'string' || !/^\d{2,3}:[0-5]\d$/.test(receipt.durationText)
        || typeof receipt.publishedLabel !== 'string' || !/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/.test(receipt.publishedLabel)
        || typeof receipt.observedAt !== 'number' || !Number.isFinite(receipt.observedAt)
        || receipt.observedAt < Date.now() - 60_000 || receipt.observedAt > Date.now() + 5_000
        || (job.receipt && job.receipt.url !== url.href)) throw new Error('TikTok 作品回执与原任务不一致，请在 Posts 核对');
    const [minutes, seconds] = receipt.durationText.split(':').map(Number);
    if (job.mediaDurationMs && Math.abs((minutes * 60 + seconds) * 1000 - job.mediaDurationMs) > 1000) throw new Error('TikTok 作品时长与原成片不一致');
    return { source: 'tiktok-studio-posts', videoId: String(receipt.videoId), url: url.href,
        accountId: job.accountId, caption: receipt.caption, visibility: job.publishSettings.visibility,
        durationText: receipt.durationText, publishedLabel: receipt.publishedLabel, observedAt: receipt.observedAt };
}

function requestForJob(job: TikTokPublishJob): TikTokPublishRequestV1 {
    return {
        platform: 'tiktok', protocolVersion: 1, confirmationVersion: 2, jobId: job.id, sessionId: job.sessionId,
        versionId: job.versionId, revision: job.versionRevision, projectId: job.projectId,
        renderId: job.renderId, mediaAssetId: job.mediaAssetId, mediaPath: job.mediaPath,
        contentDigest: job.contentDigest, accountId: job.accountId, accountLabel: job.accountLabel,
        title: job.title, description: job.description, hashtags: job.hashtags,
        language: job.language, market: job.market, publishSettings: job.publishSettings,
        mediaSha256: job.mediaSha256, mediaSize: job.mediaSize, mediaDurationMs: job.mediaDurationMs,
    };
}

import { assertProductPublicationTarget } from './productWorkVersionService';
import { productTargetKey, TIKTOK_MAX_MEDIA_BYTES } from '../../shared/productCreationTarget';

async function candidateForVersion(versionId: string): Promise<Candidate> {
    const spaceId = getActiveSpaceId();
    const workspace = getWorkspacePaths().media;
    const version = getTikTokVideoVersion(versionId);
    if (!version) throw new Error('TikTok版本不存在或不属于当前空间');
    assertProductEditsSettled('video:' + version.projectId);
    const project = await getVideoEditorV2Project(version.projectId);
    if (!project) throw new Error('TikTok视频工程不存在');
    let creationTargetKey: string | undefined;
    let output = project.renderOutputs[0];
    if (project.projectKind === 'dream-story') {
        const { currentDreamExport } = await import('./dreamStoryRenderService');
        const checked = await currentDreamExport(project.id);
        if (version.source?.kind !== 'dream-story' || version.source.revision !== checked.project.dreamStory.revision || version.source.targetDigest !== checked.project.dreamStory.targetDigest) throw new Error('梦境来源或目标版本已变化');
        output = checked.output; creationTargetKey = checked.project.dreamStory.targetDigest;
    } else {
        if (!project.productVideo || project.projectKind !== 'product-video') throw new Error('TikTok视频工程不存在');
        const variant = await assertProductPublicationTarget(project, 'tiktok');
        creationTargetKey = project.creationTarget?.profileVersion ? productTargetKey(variant.target) : undefined;
        assertCurrentVideoExport(project);
    }
    if (project.canvas.aspectRatio !== '9:16') throw new Error('TikTok版本须使用竖屏 9:16 视频');
    const publishSettings = validateTikTokPublishSettings(version.publishSettings);
    if (project.productVideo?.scenes.some(scene => scene.voiceoverAssetId && ['stale', 'failed', 'duration-conflict'].includes(scene.voiceoverStatus || ''))) {
        throw new Error('旁白与当前文字或时长不一致，请重新生成或移除后再导出');
    }
    const asset = (await listMediaAssets(10000)).find((item) => item.id === output.mediaAssetId);
    if (!asset?.relativePath || !String(asset.mimeType || '').startsWith('video/')) throw new Error('当前导出未在资产库找到视频文件');
    const mediaRoot = await fs.realpath(getWorkspacePaths().media);
    const mediaPath = await fs.realpath(path.resolve(getAbsoluteMediaPath(asset.relativePath)));
    if (!isPathWithinRoots(mediaPath, [mediaRoot]) || !(await fs.stat(mediaPath)).isFile()) {
        throw new Error('当前成片路径不合法或文件已丢失');
    }
    const mediaSize = (await fs.stat(mediaPath)).size;
    if (path.extname(mediaPath).toLowerCase() !== '.mp4' || mediaSize <= 0 || mediaSize >= TIKTOK_MAX_MEDIA_BYTES) throw new Error('TikTok 成片须为有效的 MP4 文件');
    const mediaHash = createHash('sha256');
    for await (const chunk of createReadStream(mediaPath)) mediaHash.update(chunk);
    const mediaSha256 = mediaHash.digest('hex');
    if (!version.description.trim()) throw new Error('请先填写TikTok发布描述');
    if ([version.description, version.hashtags.map(tag => '#' + tag).join(' ')].filter(Boolean).join('\n').length > 4000) throw new Error('TikTok 文案与话题合计最多 4000 字符');
    if (spaceId !== getActiveSpaceId() || workspace !== getWorkspacePaths().media
        || getTikTokVideoVersion(versionId)?.revision !== version.revision) throw new Error('复核期间工作空间或稿件已变化');
    const digest = createHash('sha256').update(JSON.stringify({
        platform: 'tiktok', versionId: version.id, revision: version.revision,
        ...(getProductEditorPublicationRevision(project.id) ? { editorRevision: getProductEditorPublicationRevision(project.id) } : {}),
        ...(creationTargetKey ? { creationTargetKey } : {}),
        projectId: project.id, renderId: output.id, mediaAssetId: asset.id,
        title: version.title, description: version.description, hashtags: version.hashtags,
        language: version.language, market: version.market, publishSettings,
        mediaSha256, mediaSize,
    })).digest('hex');
    return { version, renderId: output.id, mediaAssetId: asset.id, mediaPath, digest, mediaSha256, mediaSize, mediaDurationMs: output.durationMs };
}

async function assertUploadSnapshot(job: TikTokPublishJob): Promise<void> {
    const workspace = getWorkspacePaths().media;
    const mediaRoot = await fs.realpath(workspace);
    const file = await fs.realpath(job.mediaPath);
    const stat = await fs.stat(file);
    if (!isPathWithinRoots(file, [mediaRoot]) || !stat.isFile() || stat.size !== job.mediaSize) throw new Error('待上传成片已变化，请重新准备');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== job.mediaSha256 || getActiveSpaceId() !== job.spaceId || getWorkspacePaths().media !== workspace) throw new Error('待上传成片或工作空间已变化，请重新准备');
}

export class TikTokPublisherService {
    private queue: Promise<void> = Promise.resolve();
    private reconciledSpaces = new Set<string>();
    private preparing = new Map<string, Promise<TikTokPublishJob>>();
    private staging = new Map<string, Promise<TikTokPublishJob>>();

    constructor() {
        this.ensureReconciled();
    }

    private ensureReconciled(): void {
        const spaceId = getActiveSpaceId();
        if (this.reconciledSpaces.has(spaceId)) return;
        this.reconciledSpaces.add(spaceId);
        for (const job of listTikTokPublishJobs()) {
            const now = Date.now();
            if (['queued', 'preflighting', 'uploading'].includes(job.status)) {
                this.save({ ...job, status: 'blocked', publishStatus: 'not_submitted', errorCode: 'DESKTOP_RESTARTED_PRE_SUBMIT', errorMessage: '提交前中断，可复核后重试', updatedAt: now });
            } else if (job.status === 'submitting') {
                this.save({ ...job, status: 'submit_result_unknown', publishStatus: 'unknown', errorCode: 'DESKTOP_RESTARTED_DURING_SUBMIT', errorMessage: '提交期间中断，请先核对TikTok作品管理', updatedAt: now });
            } else if (['published', 'returning'].includes(job.status)) {
                this.save({ ...job, status: 'published_reset_failed', publishStatus: 'published', resetStatus: 'failed', errorCode: 'DESKTOP_RESTARTED_DURING_RETURN', errorMessage: '作品已发布，发布页恢复中断', updatedAt: now });
            }
        }
    }

    private save(job: TikTokPublishJob): TikTokPublishJob {
        upsertTikTokPublishJob(job);
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) { window.webContents.send('tiktok-publisher:job-changed', job); window.webContents.send('publication:changed'); }
        }
        return job;
    }

    getJob(jobId: string): TikTokPublishJob | null { this.ensureReconciled(); return getTikTokPublishJob(jobId); }
    getLatestJob(versionId: string): TikTokPublishJob | null {
        this.ensureReconciled();
        return listTikTokPublishJobs().find((job) => job.versionId === versionId) || null;
    }

    async getStatus(): Promise<{ boundExtensionInstanceId: string; instances: Array<Record<string, unknown>> }> {
        this.ensureReconciled();
        const bridge = getBrowserCaptureBridgeService();
        const instances = (bridge?.getStatus().instances || []).filter((item) =>
            item.extensionKind === 'xhs-publisher' && item.capabilities.includes(TIKTOK_PUBLISHER_CAPABILITY));
        const statuses = await Promise.all(instances.map(async (instance) => {
            try {
                const status = record(await bridge?.invokeBrowserControl('publisher.status', { platform: 'tiktok' }, {
                    extensionInstanceId: instance.extensionInstanceId, extensionKind: 'xhs-publisher',
                    requiredCapability: TIKTOK_PUBLISHER_CAPABILITY, timeoutMs: 20_000,
                }));
                return { ...status, extensionInstanceId: instance.extensionInstanceId, browser: instance.browser,
                    tiktokSupported: true };
            } catch (error) {
                return { extensionInstanceId: instance.extensionInstanceId, browser: instance.browser,
                    tiktokSupported: true,
                    detail: error instanceof Error ? error.message : String(error), pageState: 'unsupported' };
            }
        }));
        return { boundExtensionInstanceId: getTikTokPublisherBinding(), instances: statuses };
    }

    bindInstance(id: string): string {
        const instance = getBrowserCaptureBridgeService()?.getStatus().instances.find((item) =>
            item.extensionInstanceId === id && item.extensionKind === 'xhs-publisher'
            && item.capabilities.includes(TIKTOK_PUBLISHER_CAPABILITY));
        if (!instance) throw new Error('所选浏览器没有TikTok发布能力');
        setTikTokPublisherBinding(id);
        return id;
    }

    private async reconcileReviewedOwnership(instance: Record<string, unknown>, expectedJobId?: string): Promise<void> {
        const ownedJobId = String(instance.ownedJobId || '');
        if (!ownedJobId || ownedJobId === expectedJobId || instance.pageState !== 'ready') return;
        const previous = getTikTokPublishJob(ownedJobId);
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
            platform: 'tiktok', phase: 'review-published', jobId: previous.id,
            contentDigest: previous.contentDigest, accountId: previous.accountId,
            accountLabel: previous.accountLabel, acknowledgedPublished: true,
        } satisfies PlatformPublishCommandV1, {
            extensionInstanceId: previous.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: TIKTOK_PUBLISHER_CAPABILITY, timeoutMs: 30_000,
        }));
        if (response.ok !== true || response.jobId !== previous.id || response.contentDigest !== previous.contentDigest
            || response.publishStatus !== 'published' || response.resetStatus !== 'ready') {
            throw new Error(String(response.message || '已核实发布记录未能与浏览器同步，请核对原任务'));
        }
    }

    async prepare(versionId: string, sessionId: string): Promise<TikTokPublishJob> {
        this.ensureReconciled();
        const key = `${getActiveSpaceId()}:${versionId}`;
        const pending = this.preparing.get(key);
        if (pending) return pending;
        const operation = this.prepareUnlocked(versionId, sessionId);
        this.preparing.set(key, operation);
        try { return await operation; }
        finally { if (this.preparing.get(key) === operation) this.preparing.delete(key); }
    }

    private async prepareUnlocked(versionId: string, sessionId: string): Promise<TikTokPublishJob> {
        const spaceId = getActiveSpaceId();
        const candidate = await candidateForVersion(versionId);
        const binding = getTikTokPublisherBinding();
        if (!binding) throw new Error('请先绑定TikTok发布浏览器');
        const status = await this.getStatus();
        const instance = status.instances.find((item) => item.extensionInstanceId === binding);
        if (!instance || instance.pageState !== 'ready') throw new Error(String(instance?.detail || 'TikTok发布页未就绪'));
        const accountId = String(instance.accountId || '').trim();
        const accountLabel = String(instance.accountLabel || '').trim();
        if (!/^[A-Za-z0-9_.]{1,100}$/.test(accountId) || accountLabel !== '@' + accountId) throw new Error('无法可靠识别当前TikTok账号，已阻止发布');
        await this.reconcileReviewedOwnership(instance);
        if (getActiveSpaceId() !== spaceId) throw new Error('准备期间空间已切换，请重新打开当前空间的工程');
        if ((await candidateForVersion(versionId)).digest !== candidate.digest) throw new Error('准备期间TikTok稿件、成片或发布设置已更新，请重新准备');
        const older = listTikTokPublishJobs().filter((job) => job.versionId === versionId);
        if (older.some((job) => ['unknown', 'submitted', 'pending_review'].includes(job.publishStatus))) {
            throw new Error('该版本存在尚未核实的提交或审核结果，请先检查TikTok作品管理');
        }
        const same = older.find((job) => job.contentDigest === candidate.digest
            && !['cancelled', 'superseded'].includes(job.status));
        if (same) return same;
        for (const job of older.filter((item) => item.status === 'awaiting_confirmation')) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
        }
        const now = Date.now();
        const jobId = 'tiktok_publish_' + randomUUID();
        const uploadDir = path.join(getWorkspacePaths().media, 'tiktok-publish', jobId);
        const uploadPath = path.join(uploadDir, jobId + '_' + candidate.mediaSha256.slice(0, 16) + '.mp4');
        await fs.mkdir(uploadDir, { recursive: true });
        try {
            await fs.copyFile(candidate.mediaPath, uploadPath);
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(uploadPath)) hash.update(chunk);
            if (hash.digest('hex') !== candidate.mediaSha256 || getActiveSpaceId() !== spaceId
                || (await candidateForVersion(versionId)).digest !== candidate.digest) throw new Error('准备期间成片或空间已变化，请重新准备');
        } catch (error) {
            await fs.rm(uploadDir, { recursive: true, force: true });
            throw error;
        }
        return this.save({
            id: jobId, platform: 'tiktok', spaceId,
            sessionId: String(sessionId || `video-project:${candidate.version.projectId}`),
            versionId, versionRevision: candidate.version.revision, projectId: candidate.version.projectId,
            renderId: candidate.renderId, mediaAssetId: candidate.mediaAssetId, mediaPath: uploadPath,
            language: candidate.version.language, market: candidate.version.market,
            publishSettings: validateTikTokPublishSettings(candidate.version.publishSettings),
            mediaSha256: candidate.mediaSha256, mediaSize: candidate.mediaSize,
            mediaDurationMs: candidate.mediaDurationMs,
            contentDigest: candidate.digest, title: candidate.version.title, description: candidate.version.description,
            hashtags: candidate.version.hashtags, accountId, accountLabel, extensionInstanceId: binding,
            status: 'awaiting_confirmation', publishStatus: 'not_submitted', resetStatus: 'not_started',
            errorCode: '', errorMessage: '', createdAt: now, updatedAt: now,
        });
    }

    private async validateConfirmation(jobId: string): Promise<TikTokPublishJob> {
        this.ensureReconciled();
        const job = getTikTokPublishJob(jobId);
        if (!job || !['awaiting_confirmation', 'blocked'].includes(job.status)) throw new Error('发布确认已失效');
        const fresh = await candidateForVersion(job.versionId);
        await assertUploadSnapshot(job);
        if (fresh.digest !== job.contentDigest || fresh.renderId !== job.renderId) {
            this.save({ ...job, status: 'superseded', updatedAt: Date.now() });
            throw new Error('TikTok稿件或成片已更新，请重新准备并确认新版本');
        }
        const status = await this.getStatus();
        const instance = status.instances.find((item) => item.extensionInstanceId === job.extensionInstanceId);
        if (!instance || instance.accountId !== job.accountId || instance.accountLabel !== job.accountLabel
            || (instance.pageState !== 'ready' && !(instance.pageState === 'draft' && instance.ownedJobId === job.id))) {
            throw new Error('目标TikTok账号或发布页已变化，请重新准备确认');
        }
        await this.reconcileReviewedOwnership(instance, job.id);
        const current = getTikTokPublishJob(jobId);
        if (!current || current.spaceId !== getActiveSpaceId() || !['awaiting_confirmation', 'blocked'].includes(current.status)
            || current.publishStatus !== 'not_submitted') throw new Error('该发布任务已确认或状态已变化');
        const latest = await candidateForVersion(job.versionId);
        if (latest.digest !== job.contentDigest) throw new Error('复核期间稿件或发布设置已变化，请重新准备');
        return current;
    }

    async stageDraft(jobId: string, reviewCoverOnly = false): Promise<TikTokPublishJob> {
        const key = `${getActiveSpaceId()}:${jobId}`;
        const pending = this.staging.get(key);
        if (pending) return pending;
        const operation = this.stageDraftUnlocked(jobId, reviewCoverOnly);
        this.staging.set(key, operation);
        try { return await operation; }
        finally { if (this.staging.get(key) === operation) this.staging.delete(key); }
    }

    private async stageDraftUnlocked(jobId: string, reviewCoverOnly: boolean): Promise<TikTokPublishJob> {
        const context = await requirePublicationAction('tiktok', jobId, 'upload');
        if (reviewCoverOnly && (context.phase !== 'awaiting-submit' || !context.uploadReview)) throw new Error('请先完成原视频上传核对，再复核手动封面');
        const job = await this.validateConfirmation(jobId);
        // Recheck after async validation so a concurrent confirmation wins only once.
        if (!['awaiting_confirmation', 'blocked'].includes(getTikTokPublishJob(jobId)?.status || '')) throw new Error('任务状态已变化');
        this.save({ ...job, status: 'uploading', errorCode: '', errorMessage: '', updatedAt: Date.now() });
        try {
            const bridge = getBrowserCaptureBridgeService();
            if (!bridge) throw new Error('发布浏览器未连接');
            const command: PlatformPublishCommandV1 = reviewCoverOnly
                ? { platform: 'tiktok', phase: 'review-cover', request: requestForJob(job), acknowledgedCoverOnly: true }
                : { platform: 'tiktok', phase: 'prepare', request: requestForJob(job) };
            const response = record(await bridge.invokeBrowserControl('publisher.publish', command, {
                extensionInstanceId: job.extensionInstanceId, extensionKind: 'xhs-publisher',
                requiredCapability: TIKTOK_PUBLISHER_CAPABILITY,
                timeoutMs: 10 * 60_000,
            }));
            if (response.jobId !== job.id || response.contentDigest !== job.contentDigest
                || response.ok !== true || response.prepared !== true || response.publishStatus !== 'not_submitted') {
                return this.save({ ...job, status: 'blocked', errorCode: String(response.code || 'DRAFT_PREPARATION_FAILED'),
                    errorMessage: String(response.message || '页面上传或设置核验失败，未提交'), updatedAt: Date.now() });
            }
            const fresh = await candidateForVersion(job.versionId);
            if (getActiveSpaceId() !== job.spaceId || fresh.digest !== job.contentDigest) {
                return this.save({ ...job, status: 'superseded', errorCode: 'VERSION_CHANGED', errorMessage: '上传期间稿件或发布设置已变化，未提交', updatedAt: Date.now() });
            }
            await assertUploadSnapshot(job);
            const live = this.getJob(job.id);
            if (!live || ['cancelled', 'superseded'].includes(live.status)) return live || job;
            await validatePublicationContext('tiktok', jobId, 'upload');
            recordPublicationUpload(context, response);
            return this.save({ ...job, status: 'awaiting_confirmation', errorCode: '', errorMessage: '', updatedAt: Date.now() });
        } catch (error) {
            const live = this.getJob(job.id);
            if (live && ['cancelled', 'superseded'].includes(live.status)) return live;
            return this.save({ ...job, status: 'blocked', errorCode: 'DRAFT_PREPARATION_FAILED',
                errorMessage: error instanceof Error ? error.message : String(error), updatedAt: Date.now() });
        }
    }

    async confirm(jobId: string): Promise<TikTokPublishJob> {
        await requirePublicationAction('tiktok', jobId, 'submit');
        const job = await this.validateConfirmation(jobId);
        if (!['awaiting_confirmation', 'blocked'].includes(getTikTokPublishJob(jobId)?.status || '')) throw new Error('任务状态已变化');
        const queued = this.save({ ...job, status: 'queued', confirmedAt: Date.now(), updatedAt: Date.now(), errorCode: '', errorMessage: '' });
        this.queue = this.queue.then(() => this.execute(queued.id)).catch((error) => console.error('[tiktok-publisher]', error));
        return queued;
    }

    cancel(jobId: string): TikTokPublishJob {
        this.ensureReconciled();
        const job = getTikTokPublishJob(jobId);
        if (!job || !['awaiting_confirmation', 'queued', 'uploading', 'blocked'].includes(job.status)) throw new Error('此任务已提交或无法取消');
        return this.save({ ...job, status: 'cancelled', updatedAt: Date.now() });
    }

    async recoverUnpublished(jobId: string, acknowledgedNotPublished: boolean): Promise<TikTokPublishJob> {
        this.ensureReconciled();
        const job = getTikTokPublishJob(jobId);
        if (!job || job.status !== 'submit_result_unknown' || job.publishStatus !== 'unknown'
            || acknowledgedNotPublished !== true) {
            throw new Error('只有人工核实未发布的未知结果可恢复');
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) throw new Error('发布浏览器未连接，无法核验原任务草稿');
        const response = record(await bridge.invokeBrowserControl('publisher.publish', {
            platform: 'tiktok', phase: 'recover', jobId: job.id,
            contentDigest: job.contentDigest, accountId: job.accountId,
            accountLabel: job.accountLabel, acknowledgedNotPublished: true,
        }, {
            extensionInstanceId: job.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: TIKTOK_PUBLISHER_CAPABILITY, timeoutMs: 60_000,
        }));
        if (response.jobId !== job.id || response.contentDigest !== job.contentDigest
            || response.ok !== true || response.resetStatus !== 'ready') {
            throw new Error(String(response.message || '旧草稿未能安全恢复，请人工检查页面'));
        }
        return this.save({ ...job, status: 'superseded', publishStatus: 'not_submitted', resetStatus: 'ready',
            errorCode: 'USER_VERIFIED_NOT_PUBLISHED', errorMessage: '已核实未发布，旧任务已关闭，可重新准备', updatedAt: Date.now() });
    }

    async reviewPublished(jobId: string, acknowledgedPublished: boolean): Promise<TikTokPublishJob> {
        this.ensureReconciled();
        const job = getTikTokPublishJob(jobId);
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

    async readReceipt(jobId: string): Promise<TikTokPublishJob> {
        this.ensureReconciled();
        const job = getTikTokPublishJob(jobId);
        if (!job || job.publishStatus !== 'published') throw new Error('请先核实原任务已经发布，再读取作品回执');
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) throw new Error('发布浏览器未连接');
        const response = record(await bridge.invokeBrowserControl('publisher.publish', {
            platform: 'tiktok', phase: 'read-receipt', request: requestForJob(job),
        } satisfies PlatformPublishCommandV1, { extensionInstanceId: job.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: TIKTOK_PUBLISHER_CAPABILITY, timeoutMs: 30_000 }));
        const current = getTikTokPublishJob(jobId);
        if (getActiveSpaceId() !== job.spaceId || !current || current.contentDigest !== job.contentDigest || current.publishStatus !== 'published') throw new Error('读取期间空间或原任务已变化');
        if (response.ok !== true || response.jobId !== job.id || response.contentDigest !== job.contentDigest || response.publishStatus !== 'published') throw new Error(String(response.message || '作品回执读取失败，请重新加载发布插件并检查 Posts 页面'));
        // Old jobs did not save a duration. Only use the exact original export,
        // rather than a newer edit's scene duration, when enriching their receipt.
        const project = job.mediaDurationMs ? null : await getVideoEditorV2Project(job.projectId);
        const duration = job.mediaDurationMs || project?.renderOutputs.find(output => output.id === job.renderId)?.durationMs;
        const receipt = validateTikTokPostReceipt(response.receipt, { ...job, mediaDurationMs: duration });
        if (listTikTokPublishJobs().some(other => other.id !== job.id && other.receipt?.url === receipt.url)) throw new Error('该作品回执已经属于另一个发布任务，请人工核对');
        const latest = getTikTokPublishJob(jobId);
        if (getActiveSpaceId() !== job.spaceId || !latest || latest.contentDigest !== job.contentDigest || latest.publishStatus !== 'published') throw new Error('读取期间空间或原任务已变化');
        return this.save({ ...latest, receipt, mediaDurationMs: duration, updatedAt: Date.now() });
    }

    private async execute(jobId: string): Promise<void> {
        let job = getTikTokPublishJob(jobId);
        if (!job || job.status !== 'queued') return;
        if (getActiveSpaceId() !== job.spaceId) {
            this.save({ ...job, status: 'blocked', publishStatus: 'not_submitted', errorCode: 'SPACE_CHANGED', errorMessage: '当前空间已切换，未执行发布', updatedAt: Date.now() });
            return;
        }
        const bridge = getBrowserCaptureBridgeService();
        if (!bridge) { this.save({ ...job, status: 'blocked', errorCode: 'BROWSER_DISCONNECTED', errorMessage: '发布浏览器未连接', updatedAt: Date.now() }); return; }
        const request = requestForJob(job);
        const invoke = (phase: 'prepare' | 'submit', timeoutMs: number) => bridge.invokeBrowserControl('publisher.publish', { platform: 'tiktok', phase, request } satisfies PlatformPublishCommandV1, {
            extensionInstanceId: job!.extensionInstanceId, extensionKind: 'xhs-publisher',
            requiredCapability: TIKTOK_PUBLISHER_CAPABILITY, timeoutMs,
        });
        try {
            const beforeUpload = await candidateForVersion(job.versionId);
            if (getActiveSpaceId() !== job.spaceId || beforeUpload.digest !== job.contentDigest) {
                this.save({ ...job, status: 'superseded', errorCode: 'VERSION_CHANGED', errorMessage: '确认后工程或发布设置已更新，请重新准备', updatedAt: Date.now() });
                return;
            }
            await assertUploadSnapshot(job);
            job = this.save({ ...job, status: 'preflighting', updatedAt: Date.now() });
            const fresh = await candidateForVersion(job.versionId);
            if (getActiveSpaceId() !== job.spaceId || fresh.digest !== job.contentDigest || fresh.renderId !== job.renderId) {
                this.save({ ...job, status: 'superseded', errorCode: 'VERSION_CHANGED', errorMessage: '准备期间工程已更新，未提交', updatedAt: Date.now() });
                return;
            }
            await assertUploadSnapshot(job);
            const currentBeforeSubmit = getTikTokPublishJob(job.id);
            if (!currentBeforeSubmit || currentBeforeSubmit.status === 'superseded' || currentBeforeSubmit.status === 'cancelled') return;
            await validatePublicationContext('tiktok', job.id, 'submit');
            assertProductEditsSettled('video:' + job.projectId, job.spaceId);
            job = this.save({ ...job, status: 'submitting', publishStatus: 'submitted', submittedAt: Date.now(), updatedAt: Date.now() });
            const response = record(await invoke('submit', 3 * 60_000));
            job = getTikTokPublishJob(jobId) || job;
            if (response.jobId !== job.id || response.contentDigest !== job.contentDigest) {
                this.save({ ...job, status: 'submit_result_unknown', publishStatus: 'unknown',
                    errorCode: 'RECEIPT_MISMATCH', errorMessage: '返回的任务标识不一致，请人工核对 TikTok Posts', updatedAt: Date.now() });
            } else if (response.publishStatus === 'not_submitted') {
                this.save({ ...job, status: 'blocked', publishStatus: 'not_submitted', errorCode: String(response.code || 'SUBMIT_REJECTED'), errorMessage: String(response.message || '页面明确拒绝提交'), updatedAt: Date.now() });
            } else if (response.publishStatus === 'published') {
                this.save({ ...job, status: response.resetStatus === 'ready' ? 'completed' : 'published_reset_failed', publishStatus: 'published',
                    resetStatus: response.resetStatus === 'ready' ? 'ready' : 'failed', publishedAt: Date.now(), completedAt: response.resetStatus === 'ready' ? Date.now() : undefined,
                    updatedAt: Date.now(), errorCode: '', errorMessage: '' });
            } else if (response.publishStatus === 'pending_review') {
                this.save({ ...job, status: 'submitted_pending_review', publishStatus: 'pending_review', resetStatus: response.resetStatus === 'ready' ? 'ready' : 'not_started', updatedAt: Date.now(), errorCode: '', errorMessage: '' });
            } else {
                this.save({ ...job, status: 'submit_result_unknown', publishStatus: 'unknown', errorCode: String(response.code || 'SUBMISSION_RESULT_UNKNOWN'), errorMessage: String(response.message || '请在TikTok作品管理核实结果'), updatedAt: Date.now() });
            }
        } catch (error) {
            job = getTikTokPublishJob(jobId) || job;
            this.save({ ...job, status: job.status === 'submitting' ? 'submit_result_unknown' : 'blocked',
                publishStatus: job.status === 'submitting' ? 'unknown' : 'not_submitted',
                errorCode: 'BROWSER_EXECUTION_FAILED', errorMessage: error instanceof Error ? error.message : String(error), updatedAt: Date.now() });
        }
    }

    previewUrl(job: TikTokPublishJob): string { return toAppAssetUrl(job.mediaPath); }
}

let service: TikTokPublisherService | null = null;
export function getTikTokPublisherService(): TikTokPublisherService {
    if (!service) service = new TikTokPublisherService();
    return service;
}
