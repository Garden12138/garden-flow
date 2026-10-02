import path from 'node:path';
import { getSettings, getWorkspacePaths } from '../../db';
import { resolveProductVideoMotionCapability } from '../../../shared/productVideoCapability';
import type { ProductVideoProposal } from '../../../shared/videoAutoEdit';
import { ProductVideoComposeParamsSchema, type ProductVideoComposeParams } from '../../../shared/productVideoProposal';
import { createBrandWorkspaceStore } from '../brandWorkspaceStore';
import {
    attachGeneratedProductVideoScene,
    createProductVideoProject,
    findProductVideoProjectByProposalId,
    getVideoEditorV2Project,
    setProductVideoSceneGenerationState,
} from '../video-editor-v2/videoEditorV2ProjectStore';
import {
    DeclarativeTool,
    ToolKind,
    type ToolConfirmationDetails,
    type ToolResult,
    createErrorResult,
    ToolErrorType,
} from '../toolRegistry';
import { VideoGenerateTool } from './mediaGenerationTools';
import { getProductVideoVoiceoverConfig, submitApprovedProductVideoVoiceovers } from '../video-editor-v2/productVideoVoiceoverService';

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function generatedVideoPath(result: ToolResult): { absolutePath: string; generationJobId?: string } | null {
    const data = record(result.data);
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const asset = record(assets[0]);
    const absolutePath = String(asset.absolutePath || '').trim();
    if (!result.success || !absolutePath) return null;
    return { absolutePath, generationJobId: String(asset.id || '').trim() || undefined };
}

export class ProductVideoComposeTool extends DeclarativeTool<typeof ProductVideoComposeParamsSchema> {
    readonly name = 'product_video_compose';
    readonly displayName = 'Compose Product Video';
    readonly description = 'Create an editable product-video project from an approved storyboard. The user must approve the storyboard before any project or AI clip is created.';
    readonly kind = ToolKind.Execute;
    readonly parameterSchema = ProductVideoComposeParamsSchema;
    readonly requiresConfirmation = true;

    getDescription(params: ProductVideoComposeParams): string {
        return `确认 ${params.productName} 的 ${params.scenes.length} 镜头商品视频分镜`;
    }

    getConfirmationDetails(params: ProductVideoComposeParams): ToolConfirmationDetails {
        const voiceover = getProductVideoVoiceoverConfig();
        const voiceoverEnabled = params.voiceoverEnabled !== false;
        const voiceoverCount = voiceoverEnabled ? params.scenes.filter((scene) => String(scene.overlayText || '').trim()).length : 0;
        const sceneLines = params.scenes.map((scene, index) => (
            `${index + 1}. ${scene.title} · ${(scene.durationMs / 1000).toFixed(1)}s · ${scene.source === 'ai-motion' ? 'AI 动效' : '原始素材'}${scene.overlayText ? ` · ${voiceoverEnabled ? '旁白' : '文字'}：${scene.overlayText}` : ''}`
        ));
        return {
            type: 'info',
            title: `确认商品视频分镜 · ${params.productName}`,
            description: [
                `${params.canvas.width}×${params.canvas.height} · ${params.canvas.fps}fps · ${(params.durationMs / 1000).toFixed(1)}s`,
                `AI 动效镜头：${params.scenes.filter((scene) => scene.source === 'ai-motion').length}`,
                `旁白任务：${voiceover.configured ? voiceoverCount : 0} 段（${!voiceoverEnabled ? '已关闭自动旁白，保留画面文字' : voiceover.configured ? `${voiceover.model} · ${voiceover.voiceId}` : '语音服务未配置，工程仍可创建'}）`,
                '',
                ...sceneLines,
            ].join('\n'),
            impact: params.scenes.some((scene) => scene.source === 'ai-motion') || (voiceover.configured && voiceoverCount > 0)
                ? '确认后会复制商品素材、创建可编辑工程，并提交已选的 AI 动效或旁白任务，消耗模型额度。'
                : '确认后会复制商品素材、创建可编辑工程，不会自动提交视频或旁白生成任务。',
            requiresUserAcknowledgement: true,
        };
    }

    async execute(params: ProductVideoComposeParams, signal: AbortSignal): Promise<ToolResult> {
        try {
            const existing = await findProductVideoProjectByProposalId(params.proposalId);
            if (signal.aborted) return createErrorResult('Product video composition cancelled.', ToolErrorType.CANCELLED);
            let proposal = params as ProductVideoProposal;
            let project = existing ? await getVideoEditorV2Project(existing.id) : null;
            let sourcePathMap = new Map<string, string>();
            let reused = Boolean(existing);

            if (project) {
                if (project.status !== 'generating' || !project.productVideo) {
                    if (project.productVideo?.voiceoverAutoApprovedAt) {
                        await submitApprovedProductVideoVoiceovers(project.id).catch((error) => {
                            console.error('[ProductVideoCompose] voiceover submission failed:', error);
                        });
                    }
                    return this.successResult(project.id, project.title, project.status, true, params.proposalId);
                }
                proposal = project.productVideo.proposal;
                sourcePathMap = new Map(project.assets
                    .filter((asset) => asset.provenance?.kind === 'brand-product' && asset.provenance.sourceAssetId)
                    .map((asset) => [String(asset.provenance?.sourceAssetId), asset.projectPath]));
            } else {
                const store = createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace'));
                project = await store.withProductCreativeSnapshot(params.productId, params.productUpdatedAt, async (product, sourceAssets, assertCurrent) => {
                    if (product.assets.length === 0) throw new Error('商品没有可用于视频编排的图片素材');
                    const assetMap = new Map(product.assets.map((asset) => [asset.id, asset]));
                    const requestedAssetIds = Array.from(new Set(params.scenes.flatMap((scene) => scene.productAssetIds)));
                    requestedAssetIds.forEach((assetId) => {
                        if (!assetMap.has(assetId)) throw new Error(`商品素材不存在或不属于当前商品：${assetId}`);
                    });
                    sourcePathMap = new Map(sourceAssets.map((asset) => [asset.assetId, asset.absolutePath]));
                    return createProductVideoProject({
                        proposal,
                        assertSnapshotCurrent: () => { assertCurrent(); signal.throwIfAborted(); },
                        productSnapshot: {
                            id: product.id,
                            name: product.name,
                            updatedAt: product.updatedAt,
                            brandName: product.brandName,
                            facts: product.facts,
                            skus: product.skus,
                            sources: product.sources,
                        },
                        sourceAssets,
                    });
                });
                reused = false;
            }

            if (!project) throw new Error('商品视频工程创建失败');
            const activeProject = project;
            sourcePathMap = new Map(activeProject.assets
                .filter((asset) => asset.provenance?.sourceAssetId)
                .map((asset) => [String(asset.provenance?.sourceAssetId), asset.projectPath]));
            if (activeProject.productVideo?.voiceoverAutoApprovedAt) {
                await submitApprovedProductVideoVoiceovers(activeProject.id).catch((error) => {
                    console.error('[ProductVideoCompose] voiceover submission failed:', error);
                });
            }
            const sceneStateMap = new Map(activeProject.productVideo?.scenes.map((scene) => [scene.id, scene.generationStatus]) || []);
            const aiScenes = proposal.scenes.filter((scene) => (
                scene.source === 'ai-motion'
                && (!reused || sceneStateMap.get(scene.id) === 'pending' || sceneStateMap.get(scene.id) === 'generating')
            ));
            await Promise.all(aiScenes.map(async (scene) => {
                try {
                    const capability = resolveProductVideoMotionCapability(getSettings() as unknown as Record<string, unknown>);
                    if (!capability.available) throw new Error('当前没有可用的参考图视频模型，已保留原图动效；配置模型后可手动重试此镜头。');
                    await setProductVideoSceneGenerationState({ projectId: activeProject.id, sceneId: scene.id, status: 'generating' });
                    const references = scene.productAssetIds.map((assetId) => sourcePathMap.get(assetId)).filter((item): item is string => Boolean(item));
                    const result = await new VideoGenerateTool().execute({
                        operation: 'generate',
                        prompt: String(scene.generationPrompt || '').trim(),
                        generationMode: 'reference-guided',
                        referenceImages: references,
                        count: 1,
                        durationSeconds: Math.max(1, scene.durationMs / 1000),
                        aspectRatio: proposal.canvas.aspectRatio,
                        resolution: '1080p',
                        generateAudio: false,
                        projectId: activeProject.id,
                        title: `${proposal.title}-${scene.title}`,
                    }, signal);
                    const generated = generatedVideoPath(result);
                    if (!generated) throw new Error(result.error?.message || 'AI 动效镜头生成失败');
                    await attachGeneratedProductVideoScene({
                        projectId: activeProject.id,
                        sceneId: scene.id,
                        absolutePath: generated.absolutePath,
                        generationJobId: generated.generationJobId,
                        prompt: scene.generationPrompt,
                    });
                } catch (error) {
                    await setProductVideoSceneGenerationState({
                        projectId: activeProject.id,
                        sceneId: scene.id,
                        status: 'failed',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }));
            project = await getVideoEditorV2Project(activeProject.id) || activeProject;
            return this.successResult(project.id, project.title, project.status, reused, params.proposalId);
        } catch (error) {
            return {
                ...createErrorResult(error instanceof Error ? error.message : String(error), ToolErrorType.EXECUTION_FAILED),
                data: { code: (error as { code?: string })?.code },
            };
        }
    }

    private successResult(projectId: string, title: string, status: string, reused: boolean, proposalId: string): ToolResult {
        const uri = `video-project://${projectId}`;
        return {
            success: true,
            llmContent: [
                reused ? 'Reused the existing product video project for this approved proposal.' : 'Created an editable product video project.',
                `projectId=${projectId}`,
                `status=${status}`,
                `[打开商品视频工程](${uri})`,
            ].join('\n'),
            display: 'product video compose',
            data: { kind: 'product-video-project', projectId, title, status, reused, uri, proposalId },
        };
    }
}
