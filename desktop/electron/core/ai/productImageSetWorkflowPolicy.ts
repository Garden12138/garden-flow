import type { IntentRoute, RuntimeContext } from './types';
import { readExplicitProductRefs } from './productVideoWorkflowPolicy.ts';
import { evaluateProductVideoToolPolicy } from '../productVideoRuntimePolicy.ts';
import type { ProductVideoVisualGroundingEvidence } from '../productVideoVisualGrounding';

export function isStructuredProductImageSetCreation(metadata?: Record<string, unknown>): boolean {
    return metadata?.workflowKind === 'product-image-set-compose' || Boolean(metadata?.platform === 'xiaohongshu' && metadata.xhsNoteType === 'image'
        && !metadata.activeXhsNotePath && !metadata.activeXhsNoteUri && metadata.editorBindingKind !== 'xiaohongshu-note'
        && readExplicitProductRefs(metadata).length > 0);
}

export function applyProductImageSetWorkflowPolicy(route: IntentRoute, context: RuntimeContext): IntentRoute {
    if (context.runtimeMode !== 'gardenflow' || !isStructuredProductImageSetCreation(context.metadata)) return route;
    return { ...route, intent: 'manuscript_creation', workflowKind: 'product-image-set-compose',
        deliverables: ['可编辑商品图文套图工程'], requiredCapabilities: ['planning', 'product-asset-grounding', 'artifact-save', 'product-image-set-compose'],
        recommendedRole: 'image-director', requiresLongRunningTask: false, requiresMultiAgent: false, requiresHumanApproval: true,
        source: route.source === 'llm' ? 'llm+rule' : route.source, reasoning: `${route.reasoning}; structured-policy=product-image-set-compose` };
}

export function evaluateProductImageSetToolPolicy(input: {
    workflowKind?: IntentRoute['workflowKind']; toolName: string; args: Record<string, unknown>;
    creationTarget?: import('../../../shared/productCreationTarget').ProductCreationTarget;
    explicitProductRefs?: ReturnType<typeof readExplicitProductRefs>; productAssetVisualGrounding?: ProductVideoVisualGroundingEvidence;
}): { outcome: 'deny'; reason: string } | null {
    if (input.workflowKind === 'product-image-set-compose' && ['image_generate', 'video_generate', 'audio_generate', 'app_cli', 'bash', 'product_video_compose'].includes(input.toolName)) {
        return { outcome: 'deny', reason: '商品套图规划只能提交 product_image_set_compose；人工确认前不得创建稿件或调用付费媒体生成。' };
    }
    if (input.toolName !== 'product_image_set_compose') return null;
    if (input.workflowKind !== 'product-image-set-compose') return { outcome: 'deny', reason: '套图工具只用于明确选择的商品套图工作流' };
    const decision = evaluateProductVideoToolPolicy({ ...input, workflowKind: undefined, toolName: 'product_video_compose', args: { ...input.args, scenes: [] } });
    if (decision) return decision;
    const groundedIds = new Set(input.productAssetVisualGrounding?.assets.map((asset) => asset.assetId));
    const pages = Array.isArray(input.args.pages) ? input.args.pages as Array<{ productAssetIds?: string[] }> : [];
    if (pages.some((page) => page.productAssetIds?.some((id) => !groundedIds.has(id)))) return { outcome: 'deny', reason: '套图使用了尚未通过视觉预检的商品图片，请使用本轮已核验素材' };
    return null;
}
