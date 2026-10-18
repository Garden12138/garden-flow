import { evaluateProductImageSetToolPolicy } from './ai/productImageSetWorkflowPolicy';
import { getBuiltinToolDescriptor } from './tools/catalog';
import { analyzeAppCliCommand, analyzeBashCommand, parseAppCliAction } from './runtimeCommandPolicy';
import {
    MUTATOR_KINDS,
    ToolKind,
    type ToolConfirmationDetails,
    type ToolDefinition,
    type ToolResult,
} from './toolRegistry';
import type { WorkflowKind } from './ai/types';
import { DREAM_STORY_TOOLS, isDreamWorkflow } from './ai/dreamStoryWorkflowPolicy';
import {
    collectProductVideoReviewWarnings,
    evaluateProductVideoToolPolicy,
} from './productVideoRuntimePolicy';
import { evaluateVideoGenerationApprovalPolicy } from './videoGenerationApprovalPolicy';
import { isXhsPublishWorkflowTool } from './ai/xhsPublishWorkflowPolicy';
import type { ProductVideoVisualGroundingEvidence } from './productVideoVisualGrounding';

export interface RuntimePermissionContext {
    sessionId: string;
    toolPack: string;
    runtimeMode?: string;
    interactive?: boolean;
    requiresHumanApproval?: boolean;
    workflowKind?: WorkflowKind;
    explicitProductRefs?: Array<{ productId: string; name: string; updatedAt: string }>;
    productAssetVisualGrounding?: ProductVideoVisualGroundingEvidence;
    creationTarget?: import('../../shared/productCreationTarget').ProductCreationTarget;
    productVideoCompositionMode?: string;
    explicitVideoClipRefs?: import('../../shared/productVideoRemix').ProductVideoClipReference[];
    productImageSetEditing?: boolean;
}

export interface RuntimePermissionDecision {
    outcome: 'allow' | 'confirm' | 'deny';
    reason: string;
    details?: ToolConfirmationDetails | null;
    source: 'descriptor' | 'runtime-policy' | 'tool';
}

const BACKGROUND_MUTATOR_ALLOWLIST = new Set([
    'app_cli',
]);

const DIAGNOSTIC_ONLY_PACKS = new Set(['diagnostics', 'full']);

const isMutatorTool = (tool: ToolDefinition<unknown, ToolResult>): boolean => MUTATOR_KINDS.includes(tool.kind);

const buildGenericConfirmationDetails = (
    tool: ToolDefinition<unknown, ToolResult>,
    params: Record<string, unknown>,
    reason: string,
): ToolConfirmationDetails => ({
    type: tool.kind === ToolKind.Execute ? 'exec' : tool.kind === ToolKind.Edit || tool.kind === ToolKind.Delete ? 'edit' : 'info',
    title: `确认执行 ${tool.displayName}`,
    description: tool.getDescription(params),
    impact: reason,
});

const buildConfirmationDetails = (
    tool: ToolDefinition<unknown, ToolResult>,
    params: Record<string, unknown>,
    reason: string,
    requiresUserAcknowledgement?: boolean,
): ToolConfirmationDetails => {
    const details = tool.getConfirmationDetails?.(params) || buildGenericConfirmationDetails(tool, params, reason);
    if (!requiresUserAcknowledgement) return details;
    return { ...details, requiresUserAcknowledgement: true };
};

export const evaluateRuntimeToolPermission = (params: {
    tool: ToolDefinition<unknown, ToolResult>;
    toolName: string;
    args: Record<string, unknown>;
    context: RuntimePermissionContext;
}): RuntimePermissionDecision => {
    const { tool, toolName, args, context } = params;
    const descriptor = getBuiltinToolDescriptor(toolName);
    const interactive = context.interactive !== false;
    const runtimeMode = String(context.runtimeMode || '').trim();
    const editorTools = ['product_project_read', 'product_project_edit', 'product_project_undo'];
    if (isDreamWorkflow(context.workflowKind)) return DREAM_STORY_TOOLS.includes(toolName) || toolName === 'skill'
        ? { outcome: 'allow', reason: '仅允许当前梦境工程受控工具', source: 'runtime-policy' }
        : { outcome: 'deny', reason: '梦境生成和发布须使用工作台按钮', source: 'runtime-policy' };
    if (DREAM_STORY_TOOLS.includes(toolName)) return { outcome: 'deny', reason: '梦境工具需要已验证的工程会话', source: 'runtime-policy' };
    if (context.workflowKind === 'product-project-edit') {
        return editorTools.includes(toolName) || toolName === 'skill'
            ? { outcome: 'allow', reason: '当前工程的受控读取、可撤销修改和技能', source: 'runtime-policy' }
            : { outcome: 'deny', reason: '工程编辑只允许绑定工程的读取、批量修改与撤销；生成请使用工作台确认入口', source: 'runtime-policy' };
    }
    if (editorTools.includes(toolName)) return { outcome: 'deny', reason: '编辑工具只能用于已验证的商品工程编辑会话', source: 'runtime-policy' };
    if (context.productImageSetEditing && ['image_generate', 'video_generate', 'audio_generate', 'product_image_set_compose', 'product_video_compose'].includes(toolName)) {
        return { outcome: 'deny', reason: '商品套图编辑中的付费生成由工作台按页确认，请通过稿件工具保存文字和布局。', source: 'runtime-policy' };
    }
    if (context.productImageSetEditing && toolName === 'bash') return { outcome: 'deny', reason: '商品套图通过 manuscripts note-get/note-save 读取和修改；页面生成由工作台确认。', source: 'runtime-policy' };
    if (toolName === 'xhs_publish_prepare' && context.workflowKind !== 'xhs-publish') {
        return { outcome: 'deny', reason: '该工具仅用于结构化小红书发布工作流，创作请求不能自行转为发布。', source: 'runtime-policy' };
    }
    if (toolName === 'xhs_publish_prepare' && (!interactive || runtimeMode === 'background-maintenance')) {
        return { outcome: 'deny', reason: '主动发布准备只能在前台用户会话执行。', source: 'runtime-policy' };
    }
    if (context.workflowKind === 'xhs-publish' && !isXhsPublishWorkflowTool(toolName)) {
        return { outcome: 'deny', reason: '小红书发布工作流只能通过 xhs_publish_prepare 准备已有成片和持久化确认卡，禁止重新生成媒体或自行操作浏览器发布。', source: 'runtime-policy' };
    }

    const imageSetPolicy = evaluateProductImageSetToolPolicy({
        workflowKind: context.workflowKind,
        toolName,
        args,
        explicitProductRefs: context.explicitProductRefs,
        creationTarget: context.creationTarget,
        productAssetVisualGrounding: context.productAssetVisualGrounding,
    });
    if (imageSetPolicy) return { ...imageSetPolicy, source: 'runtime-policy' };
    const productVideoPolicy = evaluateProductVideoToolPolicy({
        workflowKind: context.workflowKind,
        toolName,
        args,
        explicitProductRefs: context.explicitProductRefs,
        creationTarget: context.creationTarget,
        productAssetVisualGrounding: context.productAssetVisualGrounding,
        productVideoCompositionMode: context.productVideoCompositionMode,
        explicitVideoClipRefs: context.explicitVideoClipRefs,
    });
    if (productVideoPolicy) {
        return {
            outcome: 'deny',
            reason: productVideoPolicy.reason,
            source: 'runtime-policy',
        };
    }
    const productVideoWarnings = toolName === 'product_video_compose'
        ? collectProductVideoReviewWarnings({
            args,
            productAssetVisualGrounding: context.productAssetVisualGrounding,
        }).map((warning) => warning.message)
        : [];

    const videoGenerationPolicy = evaluateVideoGenerationApprovalPolicy({ toolName, interactive });
    if (videoGenerationPolicy) {
        return {
            outcome: videoGenerationPolicy.outcome,
            reason: videoGenerationPolicy.reason,
            details: interactive
                ? buildConfirmationDetails(
                    tool,
                    args,
                    videoGenerationPolicy.reason,
                    videoGenerationPolicy.requiresUserAcknowledgement,
                )
                : null,
            source: 'runtime-policy',
        };
    }

    if (toolName === 'workspace') {
        const action = String(args.action || '').trim();
        const reason = action ? `workspace action=${action}` : 'workspace action';

        if (action === 'list' || action === 'read' || action === 'search') {
            return {
                outcome: 'deny',
                reason: `${reason} 已停用；读取/搜索/列目录请改用 bash 或 app_cli。`,
                source: 'runtime-policy',
            };
        }

        if (runtimeMode === 'background-maintenance') {
            return {
                outcome: 'deny',
                reason: `后台维护模式禁止执行 ${reason} 这类工作区写入。`,
                source: 'runtime-policy',
            };
        }

        return {
            outcome: interactive ? 'confirm' : 'deny',
            reason: `${reason} 会修改工作区文件。`,
            details: interactive ? buildGenericConfirmationDetails(tool, args, `${reason} 会修改工作区文件。`) : null,
            source: 'runtime-policy',
        };
    }

    if (toolName === 'app_cli') {
        const analysis = analyzeAppCliCommand(String(args.command || ''), {
            interactive,
            runtimeMode,
        });
        const commandAction = parseAppCliAction(String(args.command || ''));
        if (context.productImageSetEditing && analysis.className !== 'read-only' && !(commandAction.namespace === 'manuscripts' && commandAction.action === 'note-save')) {
            return { outcome: 'deny', reason: '商品套图编辑仅允许保存稿件文字和布局，付费生成由工作台按页确认。', source: 'runtime-policy' };
        }
        if (analysis.className === 'deny') {
            return {
                outcome: 'deny',
                reason: analysis.reason,
                source: 'runtime-policy',
            };
        }
        if (analysis.className === 'confirm') {
            return {
                outcome: interactive ? 'confirm' : 'deny',
                reason: analysis.reason,
                details: interactive
                    ? buildConfirmationDetails(tool, args, analysis.reason, analysis.requiresUserAcknowledgement)
                    : null,
                source: 'runtime-policy',
            };
        }
        if (analysis.className === 'read-only' || analysis.className === 'trusted-write') {
            return {
                outcome: 'allow',
                reason: analysis.reason,
                source: 'runtime-policy',
            };
        }
    }

    if (toolName === 'bash') {
        const analysis = analyzeBashCommand(String(args.command || args.cmd || ''), {
            interactive,
            runtimeMode,
        });
        if (analysis.className === 'deny') {
            return {
                outcome: 'deny',
                reason: analysis.reason,
                source: 'runtime-policy',
            };
        }
        if (analysis.className === 'confirm') {
            return {
                outcome: interactive ? 'confirm' : 'deny',
                reason: analysis.reason,
                details: interactive ? buildGenericConfirmationDetails(tool, args, analysis.reason) : null,
                source: 'runtime-policy',
            };
        }
        if (analysis.className === 'read-only') {
            return {
                outcome: 'allow',
                reason: analysis.reason,
                source: 'runtime-policy',
            };
        }
    }

    if (descriptor) {
        if (descriptor.visibility === 'internal') {
            return {
                outcome: 'deny',
                reason: `工具 ${toolName} 为内部工具，当前运行时不可直接调用。`,
                source: 'descriptor',
            };
        }

        if (descriptor.visibility === 'developer' && !DIAGNOSTIC_ONLY_PACKS.has(String(context.toolPack || ''))) {
            return {
                outcome: 'deny',
                reason: `工具 ${toolName} 为开发者专用工具，不属于当前工具包 ${context.toolPack}。`,
                source: 'descriptor',
            };
        }

        if (context.toolPack && context.toolPack !== 'full' && !descriptor.contexts.includes(context.toolPack as any)) {
            return {
                outcome: 'deny',
                reason: `工具 ${toolName} 不在当前工具包 ${context.toolPack} 的可用范围内。`,
                source: 'descriptor',
            };
        }

        if (descriptor.requiresContext) {
            return {
                outcome: 'deny',
                reason: `工具 ${toolName} 需要 ${descriptor.requiresContext} 上下文，当前运行时未附带。`,
                source: 'descriptor',
            };
        }
    }

    if (runtimeMode === 'background-maintenance' && isMutatorTool(tool) && !BACKGROUND_MUTATOR_ALLOWLIST.has(toolName)) {
        return {
            outcome: 'deny',
            reason: `后台维护模式禁止直接执行 ${toolName} 这类变更型工具。`,
            source: 'runtime-policy',
        };
    }

    if (tool.requiresConfirmation) {
        const details = tool.getConfirmationDetails?.(args)
            || buildGenericConfirmationDetails(tool, args, '该工具已声明需要人工确认。');
        return {
            outcome: interactive ? 'confirm' : 'deny',
            reason: `工具 ${toolName} 自身声明需要人工确认。`,
            details: interactive
                ? {
                    ...details,
                    ...(toolName === 'product_video_compose' && args.compositionMode === 'existing-clips' ? { remixSourceReferences: context.explicitVideoClipRefs } : {}),
                    ...(productVideoWarnings.length > 0 ? { warnings: productVideoWarnings } : {}),
                }
                : null,
            source: 'tool',
        };
    }

    if (context.requiresHumanApproval && isMutatorTool(tool)) {
        return {
            outcome: interactive ? 'confirm' : 'deny',
            reason: '当前任务被标记为需要人工审批，变更型工具必须人工确认。',
            details: interactive ? buildGenericConfirmationDetails(tool, args, '当前任务需要人工审批。') : null,
            source: 'runtime-policy',
        };
    }

    if (isMutatorTool(tool)) {
        return {
            outcome: interactive ? 'confirm' : 'deny',
            reason: `工具 ${toolName} 属于 ${tool.kind} 类变更操作。`,
            details: interactive ? buildGenericConfirmationDetails(tool, args, '变更型工具默认需要人工确认。') : null,
            source: 'runtime-policy',
        };
    }

    return {
        outcome: 'allow',
        reason: `工具 ${toolName} 为只读或安全工具。`,
        source: descriptor ? 'descriptor' : 'runtime-policy',
    };
};
