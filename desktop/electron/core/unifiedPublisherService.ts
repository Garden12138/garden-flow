import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import {
    getWorkspacePaths, getPublicationJobContext, savePublicationJobContext,
    listXhsPublishJobs, listDouyinPublishJobs, listTikTokPublishJobs, getDouyinVideoVersionByProject, getTikTokVideoVersionByProject,
    getDouyinPublishJob, getTikTokPublishJob, getXhsPublishJob, upsertXhsPublishJob, upsertDouyinPublishJob, upsertTikTokPublishJob,
    listPublicationCompletions, updatePublicationCompletion,
} from '../db';
import { PublicationPrepareSchema, PublicationActionSchema, XHS_ACCOUNT_BOUND_CAPABILITY, PUBLICATION_REVIEW_CAPABILITY,
    type PublicationSource, type PublicationSnapshot, type PublicationJobContext, type PublicationJobView, type PublicationBrowserState } from '../../shared/publication';
import type { PublicationPlatform } from '../../shared/platformPublisher';
import { getXhsPublisherService } from './xhsPublisherService';
import { getDouyinPublisherService } from './douyinPublisherService';
import { getTikTokPublisherService } from './tiktokPublisherService';
import { getBrowserCaptureBridgeService } from './browserCaptureBridgeService';
import { assertProductPublicationTarget } from './productWorkVersionService';
import { getVideoEditorV2Project } from './video-editor-v2/videoEditorV2ProjectStore';
import { getXhsNoteProject } from './xhsNoteProjectStore';
import { readPublicationSource } from './publicationSource';
import { isPathWithinRoots, toAppAssetUrl } from './localAssetManager';
import { assertPublicationButton } from './publicationAuthorization';

const locks = new Map<string, Promise<PublicationJobView>>();
const statusCache = new Map<PublicationPlatform, PublicationBrowserState>();
const serviceFor = (platform: PublicationPlatform) => platform === 'xiaohongshu' ? getXhsPublisherService() : platform === 'douyin' ? getDouyinPublisherService() : getTikTokPublisherService();
const nativeJob = (platform: PublicationPlatform, id: string): any => platform === 'xiaohongshu' ? getXhsPublishJob(id) : platform === 'douyin' ? getDouyinPublishJob(id) : getTikTokPublishJob(id);
export function emitPublicationChanged(): void {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('publication:changed');
}
export function getCachedPublicationStatuses(): PublicationBrowserState[] {
    const connected = getBrowserCaptureBridgeService()?.getStatus().instances || [];
    return (['xiaohongshu', 'douyin', 'tiktok'] as const).map(platform => {
        const cached = statusCache.get(platform) || { platform, boundExtensionInstanceId: '', checkedAt: 0, instances: [] };
        return { ...cached, instances: cached.instances.map(instance => ({ ...instance, connected: connected.some(value => value.extensionInstanceId === instance.extensionInstanceId) })) };
    });
}
export async function refreshPublicationStatuses(): Promise<PublicationBrowserState[]> {
    const transport = getBrowserCaptureBridgeService()?.getStatus().instances || [];
    await Promise.all((['xiaohongshu', 'douyin', 'tiktok'] as const).map(async platform => {
        try {
            const status = await serviceFor(platform).getStatus();
            const instances = status.instances.map((raw: any) => {
                const caps = transport.find(item => item.extensionInstanceId === raw.extensionInstanceId)?.capabilities || [];
                return { extensionInstanceId: String(raw.extensionInstanceId), browser: String(raw.browser || ''), connected: raw.connected !== false,
                    accountId: raw.accountId, accountLabel: raw.accountLabel, pageState: raw.pageState, detail: raw.detail,
                    supported: caps.includes(PUBLICATION_REVIEW_CAPABILITY) && (platform !== 'xiaohongshu' || caps.includes(XHS_ACCOUNT_BOUND_CAPABILITY)) };
            });
            statusCache.set(platform, { platform, boundExtensionInstanceId: status.boundExtensionInstanceId, checkedAt: Date.now(), instances });
        } catch (error) { statusCache.set(platform, { platform, boundExtensionInstanceId: '', checkedAt: Date.now(), instances: [], error: String(error) }); }
    }));
    emitPublicationChanged(); return getCachedPublicationStatuses();
}
export function bindPublicationBrowser(platform: PublicationPlatform, id: string): void {
    serviceFor(platform).bindInstance(id);
    const jobs = platform === 'xiaohongshu' ? listXhsPublishJobs() : platform === 'douyin' ? listDouyinPublishJobs() : listTikTokPublishJobs();
    for (const job of jobs) {
        const context = getPublicationJobContext(platform, job.id);
        if (context?.spaceId === getWorkspacePaths().activeSpaceId && context.extensionInstanceId !== id && job.publishStatus === 'not_submitted' && ['awaiting_confirmation', 'blocked', 'uploading', 'queued', 'preflighting'].includes(job.status)) {
            const changed = { ...job, status: 'superseded' as const, updatedAt: Date.now() };
            if (platform === 'xiaohongshu') upsertXhsPublishJob(changed as any); else if (platform === 'douyin') upsertDouyinPublishJob(changed as any); else upsertTikTokPublishJob(changed as any);
            savePublicationJobContext({ ...context, phase: 'awaiting-upload', uploadReview: undefined });
        }
    }
    statusCache.delete(platform); emitPublicationChanged();
}

export function readPublicationJob(platform: PublicationPlatform, id: string): PublicationJobView {
    let job = nativeJob(platform, id); if (!job) throw new Error('发布任务不存在');
    const context = getPublicationJobContext(platform, id);
    const spaceId = getWorkspacePaths().activeSpaceId;
    if (context ? context.spaceId !== spaceId : platform === 'xiaohongshu' ? !isPathWithinRoots(path.resolve(job.projectPath), [getWorkspacePaths().manuscripts]) : job.spaceId !== spaceId) throw new Error('发布任务不属于当前空间');
    job = serviceFor(platform).getJob(id) || job;
    return { id, platform, source: context?.snapshot.source || (platform === 'xiaohongshu' ? { kind: 'note', path: job.projectPath } : { kind: 'video', projectId: job.projectId }), sessionId: context?.snapshot.sessionId || job.sessionId, title: job.title, body: job.description || job.body || '', hashtags: job.hashtags,
        accountId: context?.accountId || job.accountId, accountLabel: context?.accountLabel || job.accountLabel,
        extensionInstanceId: job.extensionInstanceId, contentDigest: job.contentDigest, status: job.status, publishStatus: job.publishStatus, resetStatus: job.resetStatus,
        phase: context?.phase || 'legacy', media: context?.snapshot.media.map(media => ({ ...media, previewUrl: toAppAssetUrl(media.path) })) || [],
        errorMessage: job.errorMessage || '', createdAt: job.createdAt, updatedAt: job.updatedAt,
        receiptUrl: job.receipt?.url || context?.review?.url, receiptSource: job.receipt?.source || context?.review?.source, context: context || undefined };
}
export function listPublicationJobs(): PublicationJobView[] {
    const result: PublicationJobView[] = [];
    for (const [platform, jobs] of [['xiaohongshu', listXhsPublishJobs()], ['douyin', listDouyinPublishJobs()], ['tiktok', listTikTokPublishJobs()]] as const) {
        for (const job of jobs) try { result.push(readPublicationJob(platform, job.id)); } catch { /* Foreign-space legacy history stays in its original store. */ }
    }
    return result.sort((left, right) => right.createdAt - left.createdAt);
}

export async function preparePublication(input: unknown): Promise<PublicationJobView> {
    const request = PublicationPrepareSchema.parse(input);
    const snapshot = await readPublicationSource(request.source);
    if (snapshot.revision !== request.expectedRevision) throw new Error('工程已更新，请按最新版本重新准备发布');
    if (request.origin === 'completion') {
        const offer = listPublicationCompletions().find(item => item.id === request.promptId);
        if (!offer || offer.state !== 'offered' || offer.semanticDigest !== snapshot.semanticDigest || offer.snapshot.versionId !== snapshot.versionId) throw new Error('完成询问已处理或作品已更新，请使用工程的准备发布按钮');
    }
    const key = `${snapshot.spaceId}:${snapshot.platform}:${snapshot.versionId}:${snapshot.semanticDigest}`;
    const pending = locks.get(key);
    const operation = pending || prepareOnce(snapshot, request.origin);
    if (!pending) locks.set(key, operation); try {
        let view = await operation;
        if (request.origin === 'manual' && view.context?.origin === 'completion' && view.publishStatus === 'not_submitted') {
            savePublicationJobContext({ ...view.context, origin: 'manual' });
            if (view.platform === 'xiaohongshu') { const job = getXhsPublishJob(view.id)!; upsertXhsPublishJob({ ...job, triggerOrigin: 'explicit-request' }); }
            view = readPublicationJob(view.platform, view.id);
        }
        if (view.context?.snapshot.semanticDigest === snapshot.semanticDigest) {
            for (const offer of listPublicationCompletions().filter(item => item.state === 'offered' && item.snapshot.versionId === snapshot.versionId && item.semanticDigest === snapshot.semanticDigest)) updatePublicationCompletion({ ...offer, state: 'handled' });
            emitPublicationChanged();
        }
        return view;
    } finally { locks.delete(key); }
}
async function prepareOnce(snapshot: PublicationSnapshot, origin: 'manual' | 'completion'): Promise<PublicationJobView> {
    const statuses = await refreshPublicationStatuses();
    const platformState = statuses.find(item => item.platform === snapshot.platform)!;
    const target = platformState.instances.find(item => item.extensionInstanceId === platformState.boundExtensionInstanceId);
    if (!target?.connected) throw new Error('请先选择并绑定已连接的发布浏览器');
    if (!target.supported) throw new Error('请更新支持账号绑定和上传回读的发布插件');
    if (!target.accountId || !target.accountLabel) throw new Error('无法可靠识别真实发布账号，已阻止发布');
    if (!['ready', 'draft'].includes(target.pageState || '')) throw new Error(target.detail || '发布页未就绪，请先登录并完成安全验证');
    const reusable = listPublicationJobs().find(item => item.context?.snapshot.versionId === snapshot.versionId
        && item.context.snapshot.revision === snapshot.revision && item.context.snapshot.semanticDigest === snapshot.semanticDigest
        && item.context.accountId === target.accountId && item.context.extensionInstanceId === target.extensionInstanceId
        && item.publishStatus === 'not_submitted' && ['awaiting_confirmation', 'blocked'].includes(item.status));
    if (reusable) return reusable;
    let job: any;
    if (snapshot.platform === 'xiaohongshu') {
        let notePath: string;
        if (snapshot.source.kind === 'video') {
            const project = await getVideoEditorV2Project(snapshot.source.projectId);
            const variant = await assertProductPublicationTarget(project!, 'xiaohongshu');
            const binding = variant.workVersion!.publicationBinding!;
            if (binding.platform !== 'xiaohongshu') throw new Error('缺少小红书正式稿件绑定');
            notePath = binding.notePath;
        } else if (snapshot.source.kind === 'dream-story') throw new Error('梦境首版仅支持 TikTok');
        else notePath = snapshot.source.path;
        job = await getXhsPublisherService().requestPublication(snapshot.sessionId, (await getXhsNoteProject(notePath)).projectPath, origin === 'manual' ? 'explicit-request' : 'artifact-ready');
    } else {
        if (snapshot.source.kind !== 'video' && !(snapshot.platform === 'tiktok' && snapshot.source.kind === 'dream-story')) throw new Error('此平台不支持此作品来源');
        const version = snapshot.platform === 'douyin' ? getDouyinVideoVersionByProject(snapshot.source.projectId) : getTikTokVideoVersionByProject(snapshot.source.projectId);
        if (!version) throw new Error('缺少对应平台的正式稿件');
        job = await (snapshot.platform === 'douyin' ? getDouyinPublisherService() : getTikTokPublisherService()).prepare(version.id, snapshot.sessionId);
    }
    if (job.publishStatus !== 'not_submitted') return readPublicationJob(snapshot.platform, job.id);
    const latest = await readPublicationSource(snapshot.source, false);
    if (latest.revision !== snapshot.revision || latest.semanticDigest !== snapshot.semanticDigest) throw new Error('准备期间工程已更新，未获得上传授权');
    const existing = getPublicationJobContext(snapshot.platform, job.id);
    if (existing && existing.accountId !== target.accountId && existing.phase !== 'awaiting-upload') throw new Error('该任务的目标账号已变化，请重新选择对应账号或创建新确认');
    if (existing?.uploadReview && existing.snapshot.revision === snapshot.revision && existing.extensionInstanceId === target.extensionInstanceId
        && !['cancelled', 'superseded'].includes(job.status) && existing.contentDigest === job.contentDigest) return readPublicationJob(snapshot.platform, job.id);
    // Frozen copies have stable sequence names and distinct paths even for identical pages.
    if (snapshot.platform === 'xiaohongshu' && snapshot.media.every(media => media.role !== 'video')) {
        const directory = path.join(getWorkspacePaths().media, 'publication-staging', job.id); await fs.mkdir(directory, { recursive: true });
        snapshot = { ...snapshot, media: await Promise.all(snapshot.media.map(async media => {
            const file = path.join(directory, `${String(media.order + 1).padStart(2, '0')}-${media.role}.png`);
            await fs.copyFile(media.path, file); return { ...media, path: file };
        })) };
    }
    savePublicationJobContext({ version: 1, platform: snapshot.platform, jobId: job.id, spaceId: snapshot.spaceId, snapshot,
        accountId: target.accountId, accountLabel: target.accountLabel, extensionInstanceId: target.extensionInstanceId,
        contentDigest: job.contentDigest, origin, phase: 'awaiting-upload' });
    emitPublicationChanged(); return readPublicationJob(snapshot.platform, job.id);
}

export async function actOnPublication(input: unknown, action: 'upload' | 'submit' | 'cancel' | 'recover' | 'review' | 'receipt'): Promise<PublicationJobView> {
    const request = PublicationActionSchema.parse(input);
    if (request.coverOnly && (action !== 'upload' || request.platform !== 'tiktok' || request.acknowledged !== true)) throw new Error('封面复核需要明确确认仅修改了 TikTok 封面');
    const view = readPublicationJob(request.platform, request.jobId);
    if (view.contentDigest !== request.expectedDigest) throw new Error('发布确认摘要已变化，请重新核对');
    const service = serviceFor(request.platform);
    if (action === 'upload') {
        assertPublicationButton('upload', view.id);
        if (request.coverOnly === true) {
            await getTikTokPublisherService().stageDraft(view.id, true);
        } else await service.stageDraft(view.id);
    }
    else if (action === 'submit') { assertPublicationButton('submit', view.id); await service.confirm(view.id); }
    else if (action === 'cancel') {
        service.cancel(view.id);
        const context = getPublicationJobContext(request.platform, view.id);
        if (context) savePublicationJobContext({ ...context, phase: 'awaiting-upload', uploadReview: undefined });
    }
    else if (action === 'recover') {
        if (!view.accountId) throw new Error('旧任务未保存真实账号，不能自动恢复草稿；请在原账号人工核实');
        const states = await refreshPublicationStatuses(); const state = states.find(item => item.platform === request.platform)!;
        const instance = state.instances.find(item => item.extensionInstanceId === view.extensionInstanceId);
        if (state.boundExtensionInstanceId !== view.extensionInstanceId || !instance?.connected || !instance.supported || instance.accountId !== view.accountId) throw new Error('原任务账号或浏览器已变化，不能恢复其他草稿');
        await service.recoverUnpublished(view.id, request.acknowledged === true);
    }
    else if (action === 'receipt') {
        if (request.platform !== 'tiktok') throw new Error('此平台尚未提供自动作品回执读取，请人工核实');
        await getTikTokPublisherService().readReceipt(view.id);
    } else {
        if (request.acknowledged !== true) throw new Error('请先在目标账号的作品管理中核实已发布');
        await service.reviewPublished(view.id, true);
        const context = getPublicationJobContext(request.platform, view.id);
        if (context) savePublicationJobContext({ ...context, review: { source: 'user-verified', observedAt: Date.now(), published: true } });
    }
    emitPublicationChanged(); return readPublicationJob(request.platform, view.id);
}
