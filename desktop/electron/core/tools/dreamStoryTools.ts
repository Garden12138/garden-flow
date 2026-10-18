import { z } from 'zod';
import { DreamRequestSchema, DreamEditOperationSchema, DreamDirectorPackageSchema, DreamContractError } from '../../../shared/dreamStory';
import { DeclarativeTool, ToolKind, type ToolResult, createErrorResult, ToolErrorType } from '../toolRegistry';
import { readDreamStory, applyDreamEdit, saveDreamCandidate } from '../dreamStoryStore';
import { getTikTokVideoVersionByProject } from '../../db';
const ReadSchema = z.object({ _dreamTurn: DreamRequestSchema.optional() }).strict();
const EditSchema = ReadSchema.extend({ operations: z.array(DreamEditOperationSchema).min(1).max(40) });
const ProposeSchema = ReadSchema.extend({ director: DreamDirectorPackageSchema, _proposalAttempt: z.number().int().min(1).max(2).optional() });

export class DreamStoryReadTool extends DeclarativeTool<typeof ReadSchema> {
    readonly name = 'dream_story_read'; readonly displayName = '读取当前梦境作品';
    readonly description = 'Read the runtime-bound private dream project. Never supply another project, source path or target. Use stable fragment, character and scene IDs.';
    readonly kind = ToolKind.Read; readonly parameterSchema = ReadSchema;
    getDescription() { return this.displayName; }
    async execute(params: z.infer<typeof ReadSchema>): Promise<ToolResult> {
        try { if (!params._dreamTurn) throw new Error('缺少已验证的工程绑定');
            const project = await readDreamStory(params._dreamTurn.projectId, params._dreamTurn.spaceId);
            const doc = project.dreamStory; const publication = getTikTokVideoVersionByProject(project.id);
            const text = JSON.stringify({ projectId: project.id, revision: doc.revision, draftEpoch: doc.draftEpoch, target: doc.target,
                targetDigest: doc.targetDigest, stage: doc.stage, fragments: doc.fragments, director: doc.director,
                style: doc.style, fidelity: doc.fidelity, emotion: doc.emotion, dreamDate: doc.dreamDate,
                publicationCopy: publication ? { title: publication.title, description: publication.description, hashtags: publication.hashtags } : undefined,
                assets: project.assets.slice(-80).map(asset => ({ id: asset.id, kind: asset.kind })), captions: doc.captions });
            if (text.length > 64000) throw new Error('作品上下文过长，请精简记录、分镜或字幕后再使用导演对话');
            return { success: true, llmContent: text, display: '已读取当前梦境作品' };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
export class DreamStoryEditTool extends DeclarativeTool<typeof EditSchema> {
    readonly name = 'dream_story_edit'; readonly displayName = '修改当前梦境作品';
    readonly description = 'Save one atomic reversible batch of story.update, scene.update, scene.order, mix.update, captions.update or undo. Locked fields cannot be changed or unlocked. No media generation, version adoption, target switching or publication.';
    readonly kind = ToolKind.Edit; readonly parameterSchema = EditSchema;
    getDescription() { return this.displayName; }
    async execute(params: z.infer<typeof EditSchema>): Promise<ToolResult> {
        try { if (!params._dreamTurn) throw new Error('缺少已验证的工程绑定');
            if (params.operations.some(op => !['story.update', 'director.update', 'publication.copy', 'scene.update', 'scene.order', 'mix.update', 'captions.update', 'undo'].includes(op.type)
                || (op.type === 'scene.update' && op.changes.locked !== undefined))) throw new Error('采用、解锁和生成请使用工作台按钮');
            const project = await applyDreamEdit({ ...params._dreamTurn, operations: params.operations });
            return { success: true, llmContent: JSON.stringify({ revision: project.dreamStory!.revision, stage: project.dreamStory!.stage }), display: '梦境修改已保存，可在工作台撤销' };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
export class DreamStoryProposeTool extends DeclarativeTool<typeof ProposeSchema> {
    readonly name = 'dream_story_propose'; readonly displayName = '保存梦境导演包候选';
    readonly description = 'Save a complete director package (schemaVersion 2 for target profileVersion 2, otherwise 1) candidate: title, language, story, emotionalArc, preservedFragmentIds, creativeAdditions, visualStyle, characters, exactly eight scenes and publication. Preserve locked scenes and use runtime target language. User adoption is a separate button. For v2 include settings, each scene settingId/continuity/mediaType/videoPrompt/videoReason, and character wardrobe/props. Hybrid recommends exactly two video scenes; choose action or turning points with reasons. No generation of images/audio/video.';
    readonly kind = ToolKind.Edit; readonly parameterSchema = ProposeSchema;
    getDescription() { return this.displayName; }
    async execute(params: z.infer<typeof ProposeSchema>): Promise<ToolResult> {
        try { if (!params._dreamTurn) throw new Error('缺少已验证的工程绑定');
            const candidate = await saveDreamCandidate(params._dreamTurn, params.director, params._proposalAttempt || 1);
            return { success: true, llmContent: JSON.stringify({ candidateId: candidate.id, basedOnRevision: candidate.basedOnRevision }), display: '故事与分镜候选已保存，请在工作台核对采用' };
        } catch (error) { return createErrorResult(String(error), error instanceof z.ZodError || error instanceof DreamContractError ? ToolErrorType.INVALID_PARAMS : ToolErrorType.EXECUTION_FAILED); }
    }
}
