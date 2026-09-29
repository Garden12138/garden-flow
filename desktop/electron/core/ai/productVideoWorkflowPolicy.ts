import type { IntentRoute, RuntimeContext } from './types';

export type ExplicitProductRef = {
  productId: string;
  name: string;
  updatedAt: string;
};

export type ProductVideoVisualPreparationDecision =
  | { action: 'skip'; productRefs: ExplicitProductRef[] }
  | { action: 'prepare'; productRefs: [ExplicitProductRef] }
  | { action: 'require-product-selection'; productRefs: ExplicitProductRef[] };

export const readExplicitProductRefs = (metadata: unknown): ExplicitProductRef[] => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const refs = (metadata as Record<string, unknown>).explicitProductRefs;
  if (!Array.isArray(refs)) return [];
  return refs
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const productId = String(record.productId || '').trim();
      const name = String(record.name || '').trim();
      const updatedAt = String(record.updatedAt || '').trim();
      return productId && name && updatedAt ? { productId, name, updatedAt } : null;
    })
    .filter((item): item is ExplicitProductRef => Boolean(item));
};

export const resolveProductVideoVisualPreparation = (input: {
  workflowKind?: IntentRoute['workflowKind'];
  metadata?: unknown;
}): ProductVideoVisualPreparationDecision => {
  const productRefs = readExplicitProductRefs(input.metadata);
  if (input.workflowKind !== 'product-video-compose') {
    return { action: 'skip', productRefs };
  }
  if (productRefs.length === 1) {
    return { action: 'prepare', productRefs: [productRefs[0]] };
  }
  return { action: 'require-product-selection', productRefs };
};

export const applyProductVideoWorkflowPolicy = (
  route: IntentRoute,
  context: RuntimeContext,
): IntentRoute => {
  if (
    context.runtimeMode !== 'gardenflow'
    || (route.intent !== 'video_creation' && context.metadata?.productVideoReplan !== true)
    || readExplicitProductRefs(context.metadata).length === 0
  ) {
    return route;
  }

  return {
    ...route,
    intent: 'video_creation',
    workflowKind: 'product-video-compose',
    deliverables: ['可编辑商品视频工程', '商品视频分镜'],
    requiredCapabilities: ['planning', 'video-scripting', 'product-asset-grounding', 'artifact-save', 'product-video-compose'],
    recommendedRole: 'video-director',
    requiresLongRunningTask: false,
    requiresMultiAgent: false,
    requiresHumanApproval: true,
    reasoning: `${route.reasoning}; structured-policy=product-video-compose`,
    source: route.source === 'llm' ? 'llm+rule' : route.source,
  };
};
