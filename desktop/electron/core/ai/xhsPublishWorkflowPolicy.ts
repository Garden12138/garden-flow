import type { IntentRoute, RuntimeContext } from './types';

export function applyXhsPublishWorkflowPolicy(route: IntentRoute, context: RuntimeContext): IntentRoute {
    if (context.runtimeMode !== 'gardenflow' || (route.intent !== 'xhs_publishing' && context.metadata?.workflowKind !== 'xhs-publish')) return route;
    const localAction = route.xhsPublishAction && !['prepare', 'modify', 'resume'].includes(route.xhsPublishAction.intent);
    return {
        ...route,
        intent: 'xhs_publishing',
        workflowKind: 'xhs-publish',
        recommendedRole: 'copywriter',
        requiredCapabilities: localAction ? [] : ['writing', 'artifact-save', 'xhs-publish-prepare'],
        deliverables: localAction ? ['当前版本发布动作回执'] : ['绑定已有成片的小红书稿件', '持久化发布确认卡'],
        requiresHumanApproval: true,
        requiresMultiAgent: false,
        requiresLongRunningTask: false,
        reasoning: `${route.reasoning}; structured-policy=xhs-publish`,
    };
}

export function isXhsPublishWorkflowTool(name: string): boolean {
    return name === 'xhs_publish_prepare';
}

export function validateXhsPublishCompletion(state: 'not-called' | 'inspected' | 'awaiting-confirmation' | 'blocked', action?: IntentRoute['xhsPublishAction']) {
    if (action?.publicationRequested) return { complete: false, maxRecoveryAttempts: 0, feedback: '本轮要求发布当前版本，只接受运行时发布执行回执；准备稿件不能完成重发请求。' };
    return state === 'not-called' || state === 'inspected'
        ? { complete: false, maxRecoveryAttempts: 2, feedback: '请调用 xhs_publish_prepare：inspect 读取当前成片和可信商品事实；prepare 提交标题、正文和话题并创建发布确认卡。无成片或有多个候选时，请明确说明阻断原因，不能重新生成视频或声称已发布。' }
        : { complete: true };
}
