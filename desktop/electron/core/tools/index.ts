/**
 * Built-in Tools - 内置工具导出
 */

// 导出所有内置工具
// 文件操作工具
export { WriteFileTool } from './writeFileTool';
export { EditTool } from './editTool';
export { ReadFileTool } from './readFileTool';
export { GrepTool } from './grepTool';
export { BashTool } from './bashTool';
export { AppCliTool } from './appCliTool';
export { AudioGenerateTool, ImageGenerateTool, VideoGenerateTool } from './mediaGenerationTools';
export { WorkspaceTool } from './workspaceTool';
// 辅助工具
export { CalculatorTool } from './calculatorTool';
export { ListDirTool } from './listDirTool';
export { ExploreWorkspaceTool } from './exploreWorkspaceTool';
export { SaveMemoryTool } from './memoryTool';
export { GardenFlowUpdateProfileDocTool, GardenFlowUpdateCreatorProfileTool } from './creatorProfileTool';
export {
    GardenFlowCreateProjectTool,
    GardenFlowSaveCopyPackTool,
    GardenFlowSaveImagePackTool,
    GardenFlowSaveRetrospectiveTool,
    GardenFlowListProjectsTool,
} from './gardenflowTool';
export { LspTool } from './lspTool';
export { TodoWriteTool, TodoReadTool } from './todoTool';
export { PlanModeEnterTool, PlanModeExitTool } from './planTool';
export { SkillTool } from './skillTool';

// 导入工具类型
import { type ToolDefinition, type ToolResult, ToolKind } from '../toolRegistry';

// Other tools imports
import { CalculatorTool } from './calculatorTool';
import { LspTool } from './lspTool';
import { PlanModeEnterTool, PlanModeExitTool } from './planTool';
import { SkillTool } from './skillTool';
import { BashTool } from './bashTool';
import { AppCliTool } from './appCliTool';
import { AudioGenerateTool, ImageGenerateTool, VideoGenerateTool } from './mediaGenerationTools';
import { WorkspaceTool } from './workspaceTool';
import {
    createBuiltinToolInstances,
    type BuiltinToolPack,
    listBuiltinToolDescriptors,
    registerBuiltinToolDescriptor,
} from './catalog';

let builtinToolsRegistered = false;

const ensureBuiltinToolDescriptorsRegistered = (): void => {
    if (builtinToolsRegistered) {
        return;
    }
    builtinToolsRegistered = true;

    const publicAllContexts: BuiltinToolPack[] = ['gardenflow', 'knowledge', 'chatroom', 'diagnostics'];
    const developerOnlyContexts: BuiltinToolPack[] = ['diagnostics'];
    const register = (descriptor: Parameters<typeof registerBuiltinToolDescriptor>[0]) => {
        registerBuiltinToolDescriptor(descriptor);
    };

    registerBuiltinToolDescriptor({
        name: 'workspace',
        displayName: 'Workspace',
        description: 'Controlled workspace mutator for writing files and applying precise edits inside the current workspace.',
        kind: ToolKind.Other,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['all paths must stay inside workspace', 'only write/edit actions are supported', 'write/edit actions may require confirmation'],
        successSignal: 'workspace action completed',
        failureSignal: 'workspace write/edit failed or unsupported action was blocked',
        artifactOutput: ['file'],
        retryPolicy: 'manual',
        create: ({ workspaceRootOverride }) => new WorkspaceTool(workspaceRootOverride),
    });
    register({
        name: 'bash',
        displayName: 'Bash Shell',
        description: 'Execute shell commands within the workspace directory only.',
        kind: ToolKind.Execute,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['cwd must be inside workspace', 'dangerous commands may require confirmation'],
        successSignal: 'command completed',
        failureSignal: 'command blocked or failed',
        artifactOutput: ['command-output'],
        retryPolicy: 'manual',
        create: ({ workspaceRootOverride }) => new BashTool(workspaceRootOverride),
    });
    register({
        name: 'app_cli',
        displayName: 'App CLI',
        description: 'CLI-style app control layer for spaces, manuscripts, media, GardenFlow and settings.',
        kind: ToolKind.Execute,
        contexts: ['gardenflow', 'diagnostics'],
        visibility: 'public',
        requiresContext: null,
        preconditions: ['command must use supported namespace/action'],
        successSignal: 'structured app result returned',
        failureSignal: 'namespace/action invalid or command failed',
        artifactOutput: ['manuscript', 'image', 'project', 'config'],
        retryPolicy: 'manual',
        create: () => new AppCliTool(),
    });
    register({
        name: 'image_generate',
        displayName: 'Generate Image',
        description: 'Typed image generation. Standalone by default, with optional explicit XHS image-slot binding. Returned absolute paths can be used directly as video references.',
        kind: ToolKind.Execute,
        contexts: ['gardenflow', 'diagnostics'],
        visibility: 'public',
        requiresContext: null,
        preconditions: ['prompt is required', 'notePath and slotId are optional but must be supplied together'],
        successSignal: 'one or more real image assets with absolute paths',
        failureSignal: 'image provider or optional binding failed',
        artifactOutput: ['image'],
        retryPolicy: 'manual',
        create: () => new ImageGenerateTool(),
    });
    register({
        name: 'video_generate',
        displayName: 'Generate Video',
        description: 'Typed standalone or structured-note video generation with explicit referenceImages, first/last frames, continuation, and driving audio.',
        kind: ToolKind.Execute,
        contexts: ['gardenflow', 'diagnostics'],
        visibility: 'public',
        requiresContext: null,
        preconditions: ['prompt is required for standalone generation', 'reference inputs must match generationMode'],
        successSignal: 'one or more real video assets, optionally bound to final-video',
        failureSignal: 'video provider, validation, or optional binding failed',
        artifactOutput: ['video'],
        retryPolicy: 'manual',
        create: () => new VideoGenerateTool(),
    });
    register({
        name: 'audio_generate',
        displayName: 'Generate Audio',
        description: 'Typed speech and voiceover audio generation with voice, language, speed, emotion, and format controls.',
        kind: ToolKind.Execute,
        contexts: ['gardenflow', 'diagnostics'],
        visibility: 'public',
        requiresContext: null,
        preconditions: ['text is required', 'voice service must be configured'],
        successSignal: 'a real audio asset with an absolute path',
        failureSignal: 'voice service or persistence failed',
        artifactOutput: ['audio'],
        retryPolicy: 'manual',
        create: () => new AudioGenerateTool(),
    });
    register({
        name: 'skill',
        displayName: 'Skill',
        description: 'Load a specialized skill into the current run.',
        kind: ToolKind.Other,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        create: ({ skillManager, onSkillActivated }) => (skillManager ? new SkillTool(skillManager, onSkillActivated) : null),
    });
    register({
        name: 'calculator',
        displayName: 'Calculator',
        description: 'Evaluate mathematical expressions.',
        kind: ToolKind.Other,
        contexts: ['diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new CalculatorTool(),
    });
    register({
        name: 'lsp',
        displayName: 'LSP',
        description: 'Use language server features like symbol lookup or definitions.',
        kind: ToolKind.LSP,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new LspTool(),
    });
    register({
        name: 'plan_mode_enter',
        displayName: 'Plan Mode Enter',
        description: 'Enter plan mode for structured execution.',
        kind: ToolKind.Other,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new PlanModeEnterTool(),
    });
    register({
        name: 'plan_mode_exit',
        displayName: 'Plan Mode Exit',
        description: 'Exit plan mode and return to default execution.',
        kind: ToolKind.Other,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new PlanModeExitTool(),
    });
};

/**
 * 创建所有内置工具实例
 * 注意：核心文件操作工具 (read, write, list 等) 现在由 ChatServiceV2 内部的 Vercel AI SDK 工具处理
 */
export function createBuiltinTools(options: {
    chatService?: any;
    skillManager?: any;
    onSkillActivated?: (payload: { name: string; description: string }) => void;
    workspaceRootOverride?: string;
    pack?: BuiltinToolPack;
} = {}): ToolDefinition<unknown, ToolResult>[] {
    ensureBuiltinToolDescriptorsRegistered();
    return createBuiltinToolInstances(options);
}

export function getRegisteredBuiltinTools() {
    ensureBuiltinToolDescriptorsRegistered();
    return listBuiltinToolDescriptors();
}

/**
 * 内置工具名称列表
 */
export const BUILTIN_TOOL_NAMES = [
    'workspace',
    'bash',
    'app_cli',
    'skill',
    'calculator',
    'lsp',
    'plan_mode_enter',
    'plan_mode_exit',
] as const;

export type BuiltinToolName = typeof BUILTIN_TOOL_NAMES[number];
