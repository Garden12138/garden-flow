import { APP_BRAND } from '../../config/brand';
import type { GenerationIntent } from '../app-shell/types';
import {
    generationAgentActiveSkillsForMode,
    generationAgentRoleForMode,
    SOCIAL_COVER_DIRECTOR_SKILL,
    type GenerationAgentPreferredRole,
} from './agentContext';
import type { StudioMode } from './feedModel';
import { generationIntentForMode, type GenerationAgentIntent } from '../../../shared/mediaGenerationContracts';

export const GENERATION_AGENT_CONTEXT_TYPE = 'generation-agent';

export type GenerationAgentSessionMetadata = {
    contextType: typeof GENERATION_AGENT_CONTEXT_TYPE;
    intent: GenerationAgentIntent;
    preferredRole: GenerationAgentPreferredRole;
    activeSkills?: string[];
    requiredSkill?: string;
    generationTarget: StudioMode;
    executionMode: 'auto';
    requiresHumanApproval: false;
    projectId?: string;
    source: 'generation-studio';
    sourceTitle?: string;
    recentAssetPolicy: 'current-project-feed';
};

export function normalizeGenerationAgentScope(value: string): string {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || 'default';
}

export function buildGenerationAgentContextId(projectId: string, source?: GenerationIntent['source'], sourceTitle?: string): string {
    const scope = normalizeGenerationAgentScope(projectId || sourceTitle || source || 'default');
    return `generation-studio:agent:${scope}`;
}

export function buildGenerationAgentInitialContext(projectId: string, sourceTitle?: string): string {
    return [
        `你当前位于 ${APP_BRAND.displayName} 创作页的「Agent 模式」。`,
        '图片、视频、音频是三种独立生成能力；当前轮次以会话 metadata.generationTarget 和消息内 currentMode 为准。用户只负责给目标、反馈和约束；你负责整理意图、补全提示词、引用上下文并直接调用对应生成工具。',
        '跨媒体任务要串联真实产物：例如先调用 image_generate 独立生成参考图，再把成功回执中的 absolutePath 传给 video_generate.referenceImages。',
        '不要要求用户二次确认；只有缺少不可推断的硬性必填项时才停止并说明缺口。',
        sourceTitle ? `当前来源: ${sourceTitle}` : '',
        projectId ? `当前项目ID: ${projectId}` : '',
    ].filter(Boolean).join('\n');
}

export function buildGenerationAgentSessionMetadata(
    mode: StudioMode,
    projectId: string,
    sourceTitle?: string,
): GenerationAgentSessionMetadata {
    const activeSkills = generationAgentActiveSkillsForMode(mode);
    const intent = generationIntentForMode(mode);
    return {
        contextType: GENERATION_AGENT_CONTEXT_TYPE,
        intent,
        preferredRole: generationAgentRoleForMode(mode),
        activeSkills: activeSkills.length > 0 ? activeSkills : undefined,
        requiredSkill: mode === 'cover' ? SOCIAL_COVER_DIRECTOR_SKILL : undefined,
        generationTarget: mode,
        executionMode: 'auto',
        requiresHumanApproval: false,
        projectId: projectId || undefined,
        source: 'generation-studio',
        sourceTitle: sourceTitle || undefined,
        recentAssetPolicy: 'current-project-feed',
    };
}
