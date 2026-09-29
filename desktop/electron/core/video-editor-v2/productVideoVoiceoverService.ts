import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getSettings } from '../../db';
import {
    DASHSCOPE_MINIMAX_DEFAULT_VOICE_ID,
    isDashScopeMiniMaxSpeechRoute,
    resolveAudioModelRoute,
} from '../../../shared/audioGenerationCapabilities';
import type { VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { productVideoNarrationHash } from '../../../shared/productVideoVoiceoverTimeline';
import { getAbsoluteMediaPath } from '../mediaLibraryStore';
import { getMediaGenerationJobRegistry, type MediaJobProjection } from '../mediaGenerationJobRegistry';
import {
    attachProductVideoVoiceoverAsset,
    getVideoEditorV2Project,
    setProductVideoVoiceoverJob,
} from './videoEditorV2ProjectStore';

export interface ProductVideoVoiceoverConfig {
    configured: boolean;
    model: string;
    voiceId: string;
    reason?: string;
}

const PROCESS_STARTED_AT = Date.now();
const SOURCE = 'product-video-voiceover';
const sceneOperations = new Map<string, Promise<VideoEditorV2Project>>();
const events = new EventEmitter();
let subscribed = false;

function textHash(value: string): string {
    return productVideoNarrationHash(value);
}

function notify(projectId: string): void {
    events.emit('project-updated', projectId);
}

export function onProductVideoVoiceoverUpdated(listener: (projectId: string) => void): () => void {
    events.on('project-updated', listener);
    return () => events.off('project-updated', listener);
}

export function getProductVideoVoiceoverConfig(): ProductVideoVoiceoverConfig {
    const route = resolveAudioModelRoute(getSettings() as unknown as Record<string, unknown>);
    const voiceId = isDashScopeMiniMaxSpeechRoute(route.model, route.baseURL)
        ? DASHSCOPE_MINIMAX_DEFAULT_VOICE_ID
        : 'alloy';
    return {
        configured: Boolean(route.baseURL && route.apiKey),
        model: route.model,
        voiceId,
        reason: route.baseURL && route.apiKey ? undefined : '请先在设置中配置语音服务 Endpoint 和 API Key。',
    };
}

function registry() {
    const current = getMediaGenerationJobRegistry();
    if (!subscribed) {
        subscribed = true;
        current.on('job-updated', (payload: unknown) => {
            if (!payload || typeof payload !== 'object') return;
            const job = payload as MediaJobProjection;
            if (job.source !== SOURCE || !job.projectId) return;
            void reconcileProductVideoVoiceoverProject(job.projectId).catch((error) => {
                console.warn('[ProductVideoVoiceover] job reconciliation failed:', error);
            });
        });
    }
    return current;
}

async function existingJobForRequest(requestId: string): Promise<MediaJobProjection | null> {
    const jobs = await registry().listJobs({ kind: 'audio', source: SOURCE, limit: 300 });
    return jobs.items.find((job) => job.request?.clientRequestId === requestId) || null;
}

async function reconcileSceneJob(project: VideoEditorV2Project, sceneId: string): Promise<void> {
    const scene = project.productVideo?.scenes.find((item) => item.id === sceneId);
    if (!scene?.voiceoverJobId) return;
    const job = await registry().getJob(scene.voiceoverJobId);
    if (!job) {
        if (scene.voiceoverStatus !== 'failed') {
            await setProductVideoVoiceoverJob({
                projectId: project.id, sceneId, status: 'failed', error: '旁白任务记录不存在，请手动重试。', expectedJobId: scene.voiceoverJobId,
            });
            notify(project.id);
        }
        return;
    }
    if (job.status === 'completed') {
        if (scene.voiceoverAttachedJobId === job.jobId) return;
        const artifact = job.artifacts.find((item) => item.kind === 'audio');
        const absolutePath = String(artifact?.absolutePath || (artifact?.relativePath ? getAbsoluteMediaPath(artifact.relativePath) : '')).trim();
        if (!absolutePath) {
            await setProductVideoVoiceoverJob({
                projectId: project.id, sceneId, status: 'failed', error: '语音任务没有返回可用音频。', expectedJobId: job.jobId,
            });
        } else {
            try {
                await attachProductVideoVoiceoverAsset({
                    projectId: project.id,
                    sceneId,
                    absolutePath,
                    source: 'tts',
                    jobId: job.jobId,
                    model: scene.voiceoverModel,
                    voiceId: scene.voiceoverVoiceId,
                    textHash: scene.voiceoverTextHash,
                });
            } catch (error) {
                await setProductVideoVoiceoverJob({
                    projectId: project.id,
                    sceneId,
                    status: 'failed',
                    error: error instanceof Error ? error.message : String(error),
                    expectedJobId: job.jobId,
                });
            }
        }
        notify(project.id);
        return;
    }
    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'dead_lettered') {
        if (scene.voiceoverStatus !== 'failed') {
            await setProductVideoVoiceoverJob({
                projectId: project.id,
                sceneId,
                status: 'failed',
                error: job.attempt?.lastError || '语音生成失败，请手动重试。',
                expectedJobId: job.jobId,
            });
            notify(project.id);
        }
        return;
    }
    if (new Date(job.createdAt).getTime() < PROCESS_STARTED_AT - 1_000) {
        await setProductVideoVoiceoverJob({
            projectId: project.id, sceneId, status: 'failed', error: '应用重启中断了旁白任务；不会自动重新提交，请手动重试。', expectedJobId: job.jobId,
        });
        notify(project.id);
    } else if (scene.voiceoverStatus === 'queued') {
        await setProductVideoVoiceoverJob({ projectId: project.id, sceneId, status: 'generating', expectedJobId: job.jobId });
        notify(project.id);
    }
}

export async function reconcileProductVideoVoiceoverProject(projectId: string): Promise<VideoEditorV2Project | null> {
    const project = await getVideoEditorV2Project(projectId);
    if (!project?.productVideo) return project;
    for (const scene of project.productVideo.scenes) {
        if (scene.voiceoverJobId && scene.voiceoverAttachedJobId !== scene.voiceoverJobId && scene.voiceoverStatus !== 'failed') {
            await reconcileSceneJob(project, scene.id);
        }
    }
    return getVideoEditorV2Project(projectId);
}

async function submitSceneVoiceoverUnlocked(input: {
    projectId: string;
    sceneId: string;
    automatic: boolean;
}): Promise<VideoEditorV2Project> {
    let project = await getVideoEditorV2Project(input.projectId);
    const scene = project?.productVideo?.scenes.find((item) => item.id === input.sceneId);
    if (!project?.productVideo || !scene) throw new Error('商品视频分镜不存在');
    if (input.automatic && !project.productVideo.voiceoverAutoApprovedAt) return project;
    const narrationText = String(scene.narrationText || '').trim();
    if (!narrationText) throw new Error('旁白文案为空，请先编辑文案。');
    const currentHash = textHash(narrationText);
    if (input.automatic && scene.voiceoverAssetId && scene.voiceoverTextHash === currentHash && scene.voiceoverStatus === 'ready') return project;
    if (scene.voiceoverJobId && (scene.voiceoverStatus === 'queued' || scene.voiceoverStatus === 'generating')) return project;
    if (input.automatic && scene.voiceoverStatus !== 'needs-configuration') return project;

    const config = getProductVideoVoiceoverConfig();
    if (!config.configured) {
        project = await setProductVideoVoiceoverJob({
            projectId: project.id, sceneId: scene.id, status: 'needs-configuration', error: config.reason,
        });
        notify(project.id);
        return project;
    }

    const requestId = scene.voiceoverStatus === 'queued' && !scene.voiceoverJobId && scene.voiceoverRequestId
        ? scene.voiceoverRequestId
        : input.automatic
            ? `product-voice-${textHash(`${project.productVideo.proposal.proposalId}:${scene.id}:${currentHash}`)}`
            : `product-voice-${randomUUID()}`;
    project = await setProductVideoVoiceoverJob({
        projectId: project.id,
        sceneId: scene.id,
        status: 'queued',
        requestId,
        resetJobId: true,
        model: config.model,
        voiceId: config.voiceId,
        textHash: currentHash,
    });
    notify(project.id);
    try {
        const prior = await existingJobForRequest(requestId);
        const submitted = prior || await registry().submit('audio', {
            projectId: project.id,
            sceneId: scene.id,
            source: SOURCE,
            queueMode: 'ai_generation',
            clientRequestId: requestId,
            title: `${project.title}-${scene.title}-旁白`,
            input: narrationText,
            model: config.model,
            voiceId: config.voiceId,
            responseFormat: 'mp3',
        });
        if (!submitted.jobId) throw new Error('语音任务未返回任务 ID');
        project = await setProductVideoVoiceoverJob({
            projectId: project.id, sceneId: scene.id, status: 'generating', jobId: submitted.jobId, expectedRequestId: requestId,
        });
        notify(project.id);
        return await reconcileProductVideoVoiceoverProject(project.id) || project;
    } catch (error) {
        project = await setProductVideoVoiceoverJob({
            projectId: project.id,
            sceneId: scene.id,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            expectedRequestId: requestId,
        });
        notify(project.id);
        return project;
    }
}

export function submitProductVideoSceneVoiceover(input: {
    projectId: string;
    sceneId: string;
    automatic?: boolean;
}): Promise<VideoEditorV2Project> {
    const key = `${input.projectId}:${input.sceneId}`;
    const pending = sceneOperations.get(key);
    if (pending) return pending;
    const operation = submitSceneVoiceoverUnlocked({ ...input, automatic: Boolean(input.automatic) });
    sceneOperations.set(key, operation);
    void operation.finally(() => {
        if (sceneOperations.get(key) === operation) sceneOperations.delete(key);
    }).catch(() => undefined);
    return operation;
}

export async function submitApprovedProductVideoVoiceovers(projectId: string): Promise<void> {
    const project = await getVideoEditorV2Project(projectId);
    if (!project?.productVideo) return;
    await Promise.all(project.productVideo.scenes
        .filter((scene) => String(scene.narrationText || '').trim())
        .map((scene) => submitProductVideoSceneVoiceover({ projectId, sceneId: scene.id, automatic: true })));
}
