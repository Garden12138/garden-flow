import { z } from 'zod';
import {
  DeclarativeTool,
  ToolKind,
  type ToolResult,
  createErrorResult,
  createSuccessResult,
} from '../toolRegistry';
import {
  createGardenFlowProject,
  listGardenFlowProjects,
  saveGardenFlowCopyPack,
  saveGardenFlowImagePack,
  saveGardenFlowRetrospective,
} from '../gardenflowStore';

const PlatformSchema = z.enum(['xiaohongshu', 'wechat_official_account']);
const TaskTypeSchema = z.enum(['direct_write', 'expand_from_xhs']);
const SourceModeSchema = z.enum(['manual', 'knowledge', 'manuscript']);

const GardenFlowProjectCreateParamsSchema = z.object({
  goal: z.string().min(1).describe('User goal for this self-media content project.'),
  platform: PlatformSchema.optional().describe('Target platform. Use xiaohongshu or wechat_official_account.'),
  taskType: TaskTypeSchema.optional().describe('Creation task type. direct_write or expand_from_xhs.'),
  targetAudience: z.string().optional().describe('Target audience profile.'),
  tone: z.string().optional().describe('Desired writing tone/style.'),
  successCriteria: z.string().optional().describe('How success should be measured.'),
  sourcePlatform: PlatformSchema.optional().describe('Original source platform when expanding from an existing draft/note.'),
  sourceNoteId: z.string().optional().describe('Source note/document id for traceability.'),
  sourceMode: SourceModeSchema.optional().describe('Where the source comes from: manual, knowledge, or manuscript.'),
  sourceTitle: z.string().optional().describe('Source note/manuscript title.'),
  sourceManuscriptPath: z.string().optional().describe('Source manuscript path, if expanding from an existing draft.'),
  tags: z.array(z.string()).optional().describe('Project tags for later retrieval.'),
});

type GardenFlowProjectCreateParams = z.infer<typeof GardenFlowProjectCreateParamsSchema>;

const GardenFlowCopyPackParamsSchema = z.object({
  projectId: z.string().min(1).describe('GardenFlow project id.'),
  platform: PlatformSchema.optional().describe('Target platform for this copy pack.'),
  taskType: TaskTypeSchema.optional().describe('Creation task type.'),
  titleOptions: z.array(z.string()).min(1).describe('Candidate titles for this post.'),
  finalTitle: z.string().optional().describe('Final title selected for publishing.'),
  summary: z.string().optional().describe('Short article summary, especially for WeChat articles.'),
  introduction: z.string().optional().describe('Lead paragraph / intro section, especially for WeChat articles.'),
  content: z.string().min(1).describe('Final post body content.'),
  hashtags: z.array(z.string()).optional().describe('Hashtag list.'),
  coverTexts: z.array(z.string()).optional().describe('Cover text options.'),
  imageSuggestions: z.array(z.string()).optional().describe('Suggested supporting images for the article.'),
  cta: z.string().optional().describe('Closing CTA for WeChat articles.'),
  sourcePlatform: PlatformSchema.optional().describe('Original source platform for expansion tasks.'),
  sourceNoteId: z.string().optional().describe('Source note/document id.'),
  sourceMode: SourceModeSchema.optional().describe('Source mode: manual, knowledge, or manuscript.'),
  sourceTitle: z.string().optional().describe('Source title.'),
  sourceManuscriptPath: z.string().optional().describe('Source manuscript path, if any.'),
  publishPlan: z.string().optional().describe('Publishing timing and action plan.'),
});

type GardenFlowCopyPackParams = z.infer<typeof GardenFlowCopyPackParamsSchema>;

const GardenFlowImagePackParamsSchema = z.object({
  projectId: z.string().min(1).describe('GardenFlow project id.'),
  coverPrompt: z.string().optional().describe('Prompt for cover image generation.'),
  notes: z.string().optional().describe('Additional notes for image generation workflow.'),
  images: z.array(
    z.object({
      purpose: z.string().optional().describe('Usage goal for this image.'),
      prompt: z.string().min(1).describe('Image generation prompt.'),
      style: z.string().optional().describe('Style direction.'),
      ratio: z.string().optional().describe('Aspect ratio, e.g. 3:4, 1:1.'),
    })
  ).min(1).describe('Image prompt list.'),
});

type GardenFlowImagePackParams = z.infer<typeof GardenFlowImagePackParamsSchema>;

const GardenFlowRetrospectiveParamsSchema = z.object({
  projectId: z.string().min(1).describe('GardenFlow project id.'),
  metrics: z.object({
    views: z.number().optional(),
    likes: z.number().optional(),
    comments: z.number().optional(),
    collects: z.number().optional(),
    shares: z.number().optional(),
    follows: z.number().optional(),
  }).optional(),
  whatWorked: z.string().optional().describe('What worked well in this run.'),
  whatFailed: z.string().optional().describe('What did not work as expected.'),
  nextHypotheses: z.array(z.string()).optional().describe('Hypotheses for next iteration.'),
  nextActions: z.array(z.string()).optional().describe('Action list for next iteration.'),
});

type GardenFlowRetrospectiveParams = z.infer<typeof GardenFlowRetrospectiveParamsSchema>;

const GardenFlowListProjectsParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().describe('How many recent projects to list.'),
});

type GardenFlowListProjectsParams = z.infer<typeof GardenFlowListProjectsParamsSchema>;

export class GardenFlowCreateProjectTool extends DeclarativeTool<typeof GardenFlowProjectCreateParamsSchema> {
  readonly name = 'gardenflow_create_project';
  readonly displayName = 'GardenFlow Create Project';
  readonly description =
    'Create a structured GardenFlow project for Xiaohongshu or WeChat creation. Use this before generating copy/images.';
  readonly kind = ToolKind.Other;
  readonly parameterSchema = GardenFlowProjectCreateParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: GardenFlowProjectCreateParams): string {
    return `Create GardenFlow project for goal: ${params.goal}`;
  }

  async execute(params: GardenFlowProjectCreateParams): Promise<ToolResult> {
    try {
      const result = await createGardenFlowProject(params);
      const response = createSuccessResult(
        `Project created: ${result.project.id}\nGoal: ${result.project.goal}\nPath: ${result.projectDir}`,
        `已创建项目 ${result.project.id}`
      );
      response.data = {
        projectId: result.project.id,
        projectDir: result.projectDir,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to create GardenFlow project: ${String(error)}`);
    }
  }
}

export class GardenFlowSaveCopyPackTool extends DeclarativeTool<typeof GardenFlowCopyPackParamsSchema> {
  readonly name = 'gardenflow_save_copy_pack';
  readonly displayName = 'GardenFlow Save Copy Pack';
  readonly description =
    'Save platform-aware copy artifacts (Xiaohongshu or WeChat article fields) into project files.';
  readonly kind = ToolKind.Edit;
  readonly parameterSchema = GardenFlowCopyPackParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: GardenFlowCopyPackParams): string {
    return `Save copy pack for project: ${params.projectId}`;
  }

  async execute(params: GardenFlowCopyPackParams): Promise<ToolResult> {
    try {
      const result = await saveGardenFlowCopyPack(params);
      const response = createSuccessResult(
        `Copy pack saved: ${result.filePath}\nProject: ${result.project.id}\nStatus: ${result.project.status}\nManuscript: manuscripts/${result.manuscriptPath}`,
        `文案包已保存（${result.project.id}）`
      );
      response.data = {
        projectId: result.project.id,
        filePath: result.filePath,
        manuscriptPath: result.manuscriptPath,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to save copy pack: ${String(error)}`);
    }
  }
}

export class GardenFlowSaveImagePackTool extends DeclarativeTool<typeof GardenFlowImagePackParamsSchema> {
  readonly name = 'gardenflow_save_image_pack';
  readonly displayName = 'GardenFlow Save Image Pack';
  readonly description =
    'Save platform-aware image strategy and generation prompts into project files.';
  readonly kind = ToolKind.Edit;
  readonly parameterSchema = GardenFlowImagePackParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: GardenFlowImagePackParams): string {
    return `Save image pack for project: ${params.projectId}`;
  }

  async execute(params: GardenFlowImagePackParams): Promise<ToolResult> {
    try {
      const result = await saveGardenFlowImagePack(params);
      const response = createSuccessResult(
        `Image pack saved: ${result.filePath}\nProject: ${result.project.id}\nStatus: ${result.project.status}\nPlanned media assets created: ${result.plannedAssetCount}`,
        `配图包已保存（${result.project.id}）`
      );
      response.data = {
        projectId: result.project.id,
        filePath: result.filePath,
        plannedAssetCount: result.plannedAssetCount,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to save image pack: ${String(error)}`);
    }
  }
}

export class GardenFlowSaveRetrospectiveTool extends DeclarativeTool<typeof GardenFlowRetrospectiveParamsSchema> {
  readonly name = 'gardenflow_save_retrospective';
  readonly displayName = 'GardenFlow Save Retrospective';
  readonly description =
    'Save retrospective summary and metrics after publishing, including action items for next iteration.';
  readonly kind = ToolKind.Edit;
  readonly parameterSchema = GardenFlowRetrospectiveParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: GardenFlowRetrospectiveParams): string {
    return `Save retrospective for project: ${params.projectId}`;
  }

  async execute(params: GardenFlowRetrospectiveParams): Promise<ToolResult> {
    try {
      const result = await saveGardenFlowRetrospective(params);
      const response = createSuccessResult(
        `Retrospective saved: ${result.filePath}\nProject: ${result.project.id}\nStatus: ${result.project.status}`,
        `复盘已保存（${result.project.id}）`
      );
      response.data = {
        projectId: result.project.id,
        filePath: result.filePath,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to save retrospective: ${String(error)}`);
    }
  }
}

export class GardenFlowListProjectsTool extends DeclarativeTool<typeof GardenFlowListProjectsParamsSchema> {
  readonly name = 'gardenflow_list_projects';
  readonly displayName = 'GardenFlow List Projects';
  readonly description = 'List recent GardenFlow projects and statuses so you can continue an existing creation task.';
  readonly kind = ToolKind.Read;
  readonly parameterSchema = GardenFlowListProjectsParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: GardenFlowListProjectsParams): string {
    return `List recent GardenFlow projects (limit=${params.limit || 20})`;
  }

  async execute(params: GardenFlowListProjectsParams): Promise<ToolResult> {
    try {
      const projects = await listGardenFlowProjects(params.limit || 20);
      if (projects.length === 0) {
        return createSuccessResult('No GardenFlow projects found.', '暂无项目');
      }

      const lines = projects.map((project) =>
        `- ${project.id} | ${project.status} | ${project.goal} | ${project.updatedAt}`
      );
      return createSuccessResult(
        `Recent GardenFlow projects:\n${lines.join('\n')}`,
        `已找到 ${projects.length} 个项目`
      );
    } catch (error) {
      return createErrorResult(`Failed to list GardenFlow projects: ${String(error)}`);
    }
  }
}
