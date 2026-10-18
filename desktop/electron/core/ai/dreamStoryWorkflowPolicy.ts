import type { IntentRoute, RuntimeContext } from './types';
export const DREAM_STORY_TOOLS = ['dream_story_read', 'dream_story_edit', 'dream_story_propose'];
export function isDreamWorkflow(kind?: string): boolean { return kind === 'dream-story-create' || kind === 'dream-story-edit'; }
export function applyDreamStoryWorkflowPolicy(route: IntentRoute, context: RuntimeContext): IntentRoute {
    if (!isDreamWorkflow(String(context.metadata?.workflowKind)) || !context.metadata?.dreamStoryTurn) return route;
    return { ...route, intent: 'manuscript_creation', workflowKind: context.metadata.workflowKind as 'dream-story-create' | 'dream-story-edit',
        recommendedRole: 'video-director', deliverables: ['当前梦境作品的故事与八幕分镜候选或已保存修改'],
        requiredCapabilities: ['dream-story-read', 'dream-story-edit'], requiresHumanApproval: false,
        requiresLongRunningTask: false, requiresMultiAgent: false, reasoning: 'structured-policy:dream-story', source: 'rule' };
}
