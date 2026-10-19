import { z } from 'zod';
import { getSettings, getWorkspacePaths, runInWorkspaceSpace } from '../db';
import { readNoteCard, noteCardMutation, noteCardTurn } from './noteCardEditor';
import { enqueueXhsMutation, saveXhsNoteProjectUnlocked } from './xhsNoteProjectStore';
import { createHash } from 'node:crypto';
import { resolveDefaultImageModel } from './imageGenerationService';
import { resolveDefaultImageEndpoint } from './imageGenerationService';
import { getImageProviderCapabilities, normalizeImageProviderTemplate } from './imageProviderAdapters';
import { MediaGenerationJobRegistry } from './mediaGenerationJobRegistry';
import type { NoteCardRuntime } from '../../shared/noteCards';

export function getNoteCardGenerationConfig() {
    const settings = getSettings() as unknown as Record<string, unknown>; const provider = String(settings.image_provider || 'openai-compatible');
    const template = normalizeImageProviderTemplate(String(settings.image_provider_template || ''), provider);
    const model = String(settings.image_model || resolveDefaultImageModel(template));
    const configurationKey = createHash('sha256').update(JSON.stringify({ provider, template, model, endpoint: settings.image_endpoint || settings.api_endpoint, key: settings.image_api_key || settings.api_key })).digest('hex');
    const supported = getImageProviderCapabilities(template, provider).supportedModes.includes('text-to-image');
    return { model, configurationKey, configured: supported && Boolean(settings.image_api_key || settings.api_key), reason: !supported ? '当前模型不支持文字生成配图' : !settings.image_api_key && !settings.api_key ? '请先配置图片模型' : undefined };
}
const requests = new Map<string, Promise<unknown>>();
async function runtimeChange(inputPath: string, change: (runtime: NoteCardRuntime) => void) {
    const current = await readNoteCard(inputPath);
    return enqueueXhsMutation(current.projectPath, async () => { const value = await readNoteCard(inputPath); const runtime = structuredClone(value.runtime); change(runtime); return saveXhsNoteProjectUnlocked({ path: value.relativePath, document: { cardRuntime: runtime }, expectedRevision: value.version, trustedNoteCardState: true }); });
}
export function generateNoteCardImage(input: unknown): Promise<unknown> {
    const request = z.object({ path: z.string().min(1), pageId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), requestId: z.string().min(1), confirmed: z.literal(true), reviewedConfigurationKey: z.string().min(1) }).strict().parse(input);
    const spaceId = getWorkspacePaths().activeSpaceId; const key = `${spaceId}:${request.path}:${request.pageId}`;
    if (requests.has(key)) throw new Error('本页配图正在生成，请等待完成');
    const operation = runInWorkspaceSpace(spaceId, async () => {
        const current = await readNoteCard(request.path);
        const receipt = current.runtime.generations?.find(item => item.requestId === request.requestId);
        if (receipt) return { ...current, generation: receipt };
        if (current.version !== request.expectedRevision) throw new Error('作品已变化，请重新确认生成方案');
        const page = current.content.imagePages.find(page => page.id === request.pageId);
        if (!page?.imagePrompt.trim()) throw new Error('请先填写当前页的配图方案');
        const config = getNoteCardGenerationConfig();
        if (!config.configured || config.configurationKey !== request.reviewedConfigurationKey) throw new Error(config.reason || '图片模型配置已变化，请重新确认');
        const settings = getSettings() as unknown as Record<string, unknown>;
        const provider = String(settings.image_provider || 'openai-compatible');
        const providerTemplate = normalizeImageProviderTemplate(String(settings.image_provider_template || ''), provider);
        const endpoint = String(settings.image_endpoint || ((providerTemplate === 'openai-images' || providerTemplate === 'openai-chat-completions-image') ? settings.api_endpoint : '') || resolveDefaultImageEndpoint(providerTemplate));
        await runtimeChange(request.path, runtime => { runtime.generations = [...(runtime.generations || []), { requestId: request.requestId, pageId: page.id, status: 'generating' as const }].slice(-50); });
        const registry = new MediaGenerationJobRegistry(spaceId, 'note-card-image-jobs.json');
        try {
            const submitted = await registry.submit('image', { model: config.model, provider, providerTemplate, endpoint, apiKey: String(settings.image_api_key || settings.api_key), prompt: `${page.imagePrompt}\n只生成独立配图，不生成标题、正文、步骤文字或水印。`, generationMode: 'text-to-image', count: 1, aspectRatio: '3:4', size: '1440x1920', manuscriptPath: current.relativePath, clientRequestId: request.requestId, source: 'note-card' });
            await runtimeChange(request.path, runtime => { runtime.generations!.find(item => item.requestId === request.requestId)!.jobId = submitted.jobId; });
            const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
                const check = async () => { const job = await registry.getJob(submitted.jobId); if (!job || ['failed', 'cancelled', 'dead_lettered'].includes(job.status)) { registry.off('job-updated', listener); reject(new Error(job?.attempt?.lastError || '配图生成失败')); } else if (job.status === 'completed') { registry.off('job-updated', listener); resolve(job.result || {}); } };
                const listener = () => { void check().catch(reject); }; registry.on('job-updated', listener); listener();
            });
            const asset = (result.assets as Array<{ id?: string }> | undefined)?.[0]; if (!asset?.id) throw new Error('生成服务未返回图片');
            await runtimeChange(request.path, runtime => { Object.assign(runtime.generations!.find(item => item.requestId === request.requestId)!, { status: 'succeeded', assetId: asset.id }); });
            const latest = await readNoteCard(request.path);
            const latestPage = latest.content.imagePages.find(item => item.id === page.id);
            if (latest.runtime.draftEpoch !== current.runtime.draftEpoch || JSON.stringify(latestPage) !== JSON.stringify(page) || JSON.stringify(latest.content.creationConfig) !== JSON.stringify(current.content.creationConfig)) return { ...latest, warning: '生成期间页面或输入已修改；图片已保留在素材库，请明确选择后使用' };
            const blocks = [...(latestPage?.blocks || [{ type: 'text' as const, text: page.copy, emphasis: [] }]), { type: 'image' as const, assetId: asset.id, fit: 'contain' as const, x: 50, y: 50 }];
            return noteCardMutation(await noteCardTurn(request.path), 'save', { ...latest.content, imagePages: latest.content.imagePages.map(item => item.id === page.id ? { ...item, layout: item.layout || 'split', blocks } : item) });
        } catch (error) { await runtimeChange(request.path, runtime => { Object.assign(runtime.generations!.find(item => item.requestId === request.requestId)!, { status: 'failed', error: String(error) }); }); throw error; }
    });
    requests.set(key, operation); void operation.finally(() => requests.delete(key)).catch(() => undefined); return operation;
}

export async function recoverNoteCardGeneration(inputPath: string) {
    const snapshot = await readNoteCard(inputPath);
    const interrupted = (snapshot.runtime.generations || []).filter(item => item.status === 'generating' && ![...requests.keys()].some(key => key.startsWith(getWorkspacePaths().activeSpaceId + ':') && key.endsWith(':' + item.pageId)));
    if (interrupted.length) await runtimeChange(inputPath, runtime => { for (const item of runtime.generations || []) if (interrupted.some(value => value.requestId === item.requestId)) { item.status = 'failed'; item.error = '上次生成中断；已保留任务记录，请检查素材库后手动重试，系统未重新提交请求'; } });
    return readNoteCard(inputPath);
}
