import type { IntentRoute, RuntimeContext } from './types';

export function applyProductProjectEditWorkflowPolicy(route: IntentRoute, context: RuntimeContext): IntentRoute {
    if (context.metadata?.workflowKind !== 'product-project-edit' || !context.metadata.productProjectEditorTurn) return route;
    return { ...route, intent: 'manuscript_creation', workflowKind: 'product-project-edit', recommendedRole: 'copywriter',
        deliverables: ['当前商品工程的已保存修改或澄清'], requiredCapabilities: ['product-project-read', 'product-project-edit', 'product-project-undo'],
        requiresHumanApproval: false, requiresLongRunningTask: false, requiresMultiAgent: false,
        reasoning: 'structured-policy:product-project-edit', source: 'rule' };
}
