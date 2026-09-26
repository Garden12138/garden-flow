import type { WorkflowKind } from './ai/types';
import type { ProductVideoVisualGroundingEvidence } from './productVideoVisualGrounding';

export type ProductVideoRuntimeRef = {
    productId: string;
    name: string;
    updatedAt: string;
};

export type ProductVideoToolPolicyDecision = {
    outcome: 'deny';
    reason: string;
} | null;

export type ProductVideoReviewWarning = {
    code: 'visual-asset-risk' | 'visual-text-fact-check';
    message: string;
    assetIds: string[];
    sceneIds: string[];
};

const proposalScenes = (args: Record<string, unknown>): Array<Record<string, unknown>> => (
    Array.isArray(args.scenes)
        ? args.scenes.filter((scene): scene is Record<string, unknown> => (
            Boolean(scene && typeof scene === 'object' && !Array.isArray(scene))
        ))
        : []
);

const sceneAssetIds = (scene: Record<string, unknown>): string[] => (
    Array.isArray(scene.productAssetIds)
        ? scene.productAssetIds.map((assetId) => String(assetId || '').trim()).filter(Boolean)
        : []
);

/**
 * Visual classifications and OCR-derived copy are review aids, not safety
 * boundaries. Keep them visible to the user without preventing a deliberate
 * confirmation; ownership/version/visual-channel checks remain hard gates.
 */
export function collectProductVideoReviewWarnings(params: {
    args: Record<string, unknown>;
    productAssetVisualGrounding?: ProductVideoVisualGroundingEvidence;
}): ProductVideoReviewWarning[] {
    const grounding = params.productAssetVisualGrounding;
    if (grounding?.status !== 'verified') return [];

    const scenes = proposalScenes(params.args);
    const referencedAssetIds = new Set(scenes.flatMap(sceneAssetIds));
    const warnings: ProductVideoReviewWarning[] = [];
    const visuallyFlagged = grounding.assets.filter((asset) => asset.suitability === 'exclude');
    if (visuallyFlagged.length > 0) {
        const usedFlagged = visuallyFlagged.filter((asset) => referencedAssetIds.has(asset.assetId));
        const usedText = usedFlagged.length > 0
            ? `其中当前分镜使用了 ${usedFlagged.map((asset) => asset.assetId).join('、')}。`
            : '当前分镜没有使用这些素材。';
        warnings.push({
            code: 'visual-asset-risk',
            message: `视觉模型将 ${visuallyFlagged.map((asset) => asset.assetId).join('、')} 标记为可能含价格、促销或活动日期；该判断可能误判。${usedText}请结合真实缩略图核对，提示不会阻止创建工程。`,
            assetIds: visuallyFlagged.map((asset) => asset.assetId),
            sceneIds: scenes
                .filter((scene) => sceneAssetIds(scene).some((assetId) => usedFlagged.some((asset) => asset.assetId === assetId)))
                .map((scene) => String(scene.id || '').trim())
                .filter(Boolean),
        });
    }

    const visibleTextAssetIds = new Set(grounding.assets
        .filter((asset) => asset.visibleText.length > 0)
        .map((asset) => asset.assetId));
    const overlayScenes = scenes.filter((scene) => String(scene.overlayText || '').trim().length > 0);
    if (overlayScenes.length > 0) {
        const labels = overlayScenes.map((scene, index) => {
            const title = String(scene.title || '').trim() || String(scene.id || '').trim() || `镜头 ${index + 1}`;
            return `${title}「${String(scene.overlayText || '').trim()}」`;
        });
        const visuallyGroundedSceneCount = overlayScenes.filter((scene) => (
            sceneAssetIds(scene).some((assetId) => visibleTextAssetIds.has(assetId))
        )).length;
        const visualTextNote = visuallyGroundedSceneCount > 0
            ? `其中 ${visuallyGroundedSceneCount} 个镜头引用了含可见文字的商品图片；图片 OCR 可辅助拟稿，但不等于已录入的结构化商品事实。`
            : '这些屏幕文字由 AI 根据当前商品资料拟定，尚未经过人工事实确认。';
        warnings.push({
            code: 'visual-text-fact-check',
            message: `${labels.join('、')}：${visualTextNote}请重点核对成分、功效、比例、规格和价格表述。提示不会阻止创建工程，后续也可继续修改。`,
            assetIds: Array.from(new Set(overlayScenes.flatMap(sceneAssetIds)
                .filter((assetId) => visibleTextAssetIds.has(assetId)))),
            sceneIds: overlayScenes
                .map((scene) => String(scene.id || '').trim())
                .filter(Boolean),
        });
    }

    return warnings;
}

export function evaluateProductVideoToolPolicy(params: {
    workflowKind?: WorkflowKind;
    toolName: string;
    args: Record<string, unknown>;
    explicitProductRefs?: ProductVideoRuntimeRef[];
    productAssetVisualGrounding?: ProductVideoVisualGroundingEvidence;
}): ProductVideoToolPolicyDecision {
    if (
        params.workflowKind === 'product-video-compose'
        && (params.toolName === 'video_generate' || params.toolName === 'image_generate')
    ) {
        return {
            outcome: 'deny',
            reason: `商品视频工程模式禁止代理直接调用 ${params.toolName}；请提交完整分镜到 product_video_compose，由工程工具在人工确认后生成 AI 镜头。`,
        };
    }

    if (
        params.workflowKind === 'product-video-compose'
        && (params.toolName === 'bash' || params.toolName === 'app_cli')
    ) {
        return {
            outcome: 'deny',
            reason: '商品视频规划已由主进程注入经过校验的商品事实与图片理解结果，不允许代理通过文件列表或命令行替代视觉理解。',
        };
    }

    if (params.toolName !== 'product_video_compose') return null;
    const productRefs = Array.isArray(params.explicitProductRefs) ? params.explicitProductRefs : [];
    if (productRefs.length !== 1) {
        return {
            outcome: 'deny',
            reason: productRefs.length > 1
                ? '当前引用了多个商品，请先让用户明确选择一个主商品，再提交商品视频分镜。'
                : '当前没有已验证的商品引用，不能创建商品视频工程。',
        };
    }
    if (String(params.args.productId || '').trim() !== productRefs[0].productId) {
        return {
            outcome: 'deny',
            reason: '分镜中的 productId 与当前已选择商品不一致，请重新读取商品并修正提案。',
        };
    }
    if (String(params.args.productUpdatedAt || '').trim() !== productRefs[0].updatedAt) {
        return {
            outcome: 'deny',
            reason: '分镜中的商品版本与当前已选择商品不一致，请重新读取最新商品资料并修正提案。',
        };
    }
    const grounding = params.productAssetVisualGrounding;
    if (
        grounding?.status !== 'verified'
        || grounding.productId !== productRefs[0].productId
        || grounding.productUpdatedAt !== productRefs[0].updatedAt
        || grounding.imageCount < 1
        || grounding.assets.length < 1
    ) {
        return {
            outcome: 'deny',
            reason: '商品图片尚未通过视觉模型校验，不能提交分镜确认卡。请先重新读取并理解真实商品图片。',
        };
    }
    return null;
}
