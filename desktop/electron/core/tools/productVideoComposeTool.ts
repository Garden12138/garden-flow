import path from 'node:path';
import { getWorkspacePaths } from '../../db';
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
        const sceneLines = params.scenes.map((scene, index) => (
            `${index + 1}. ${scene.title} · ${(scene.durationMs / 1000).toFixed(1)}s · ${scene.source === 'ai-motion' ? 'AI 动效' : '原始素材'}${scene.overlayText ? ` · ${scene.overlayText}` : ''}`
        ));
        return {
            type: 'info',
            title: `确认商品视频分镜 · ${params.productName}`,
            description: [
                `${params.canvas.width}×${params.canvas.height} · ${params.canvas.fps}fps · ${(params.durationMs / 1000).toFixed(1)}s`,
                `AI 动效镜头：${params.scenes.filter((scene) => scene.source === 'ai-motion').length}`,
                '',
                ...sceneLines,
            ].join('\n'),
            impact: '确认后会复制商品素材、创建可编辑工程，并为 AI 动效镜头消耗模型额度。',
            requiresUserAcknowledgement: true,
        };
    }

    async execute(params: ProductVideoComposeParams, signal: AbortSignal): Promise<ToolResult> {
        try {
            const existing = await findProductVideoProjectByProposalId(params.proposalId);
            if (existing) {
                return this.successResult(existing.id, existing.title, existing.status, true);
            }
            if (signal.aborted) return createErrorResult('Product video composition cancelled.', ToolErrorType.CANCELLED);
            const store = createBrandWorkspaceStore(() => path.join(getWorkspacePaths().subjects, 'brand-workspace'));
            const product = await store.getProductCreativeReference(params.productId);
            if (product.updatedAt !== params.productUpdatedAt) {
                throw new Error('商品资料已更新，请重新生成并确认分镜');
            }
            if (product.assets.length === 0) throw new Error('商品没有可用于视频编排的图片素材');
            const assetMap = new Map(product.assets.map((asset) => [asset.id, asset]));
            const requestedAssetIds = Array.from(new Set(params.scenes.flatMap((scene) => scene.productAssetIds)));
            requestedAssetIds.forEach((assetId) => {
                if (!assetMap.has(assetId)) throw new Error(`商品素材不存在或不属于当前商品：${assetId}`);
            });
            const sourceAssets = await store.resolveProductCreativeAssetPaths(product.id, product.assets.map((asset) => asset.id));
            const sourcePathMap = new Map(sourceAssets.map((asset) => [asset.assetId, asset.absolutePath]));
            const proposal = params as ProductVideoProposal;
            let project = await createProductVideoProject({
                proposal,
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
            const aiScenes = proposal.scenes.filter((scene) => scene.source === 'ai-motion');
            await Promise.all(aiScenes.map(async (scene) => {
                try {
                    await setProductVideoSceneGenerationState({ projectId: project.id, sceneId: scene.id, status: 'generating' });
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
                        projectId: project.id,
                        title: `${proposal.title}-${scene.title}`,
                    }, signal);
                    const generated = generatedVideoPath(result);
                    if (!generated) throw new Error(result.error?.message || 'AI 动效镜头生成失败');
                    await attachGeneratedProductVideoScene({
                        projectId: project.id,
                        sceneId: scene.id,
                        absolutePath: generated.absolutePath,
                        generationJobId: generated.generationJobId,
                        prompt: scene.generationPrompt,
                    });
                } catch (error) {
                    await setProductVideoSceneGenerationState({
                        projectId: project.id,
                        sceneId: scene.id,
                        status: 'failed',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }));
            project = await getVideoEditorV2Project(project.id) || project;
            return this.successResult(project.id, project.title, project.status, false);
        } catch (error) {
            return createErrorResult(error instanceof Error ? error.message : String(error), ToolErrorType.EXECUTION_FAILED);
        }
    }

    private successResult(projectId: string, title: string, status: string, reused: boolean): ToolResult {
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
            data: { kind: 'product-video-project', projectId, title, status, reused, uri },
        };
    }
}
