import { z } from 'zod';
import { CreationDraftSchema, CreationTurnSchema } from '../../../shared/creationWorkspace';
import { DeclarativeTool, ToolKind, type ToolResult, createErrorResult, ToolErrorType } from '../toolRegistry';
import { readCreationWorkspace, saveCreationWorkspace, undoCreationWorkspace, creationProductSources } from '../creationWorkspaceStore';
const Read = z.object({ _creationTurn: CreationTurnSchema.optional() }).strict();
const Edit = Read.extend({ draft: CreationDraftSchema });
export class CreationReadTool extends DeclarativeTool<typeof Read> {
    readonly name = 'creation_read'; readonly displayName = '读取当前创作草稿'; readonly kind = ToolKind.Read; readonly parameterSchema = Read;
    readonly description = 'Read the verified current creation workspace, current draft, selected page/scene, product facts and owned source IDs. Always read before editing. Blank fields are allowed. Never invent product or media IDs.';
    getDescription() { return this.displayName; }
    async execute(params: z.infer<typeof Read>): Promise<ToolResult> {
        try { if (!params._creationTurn) throw new Error('缺少当前作品绑定'); const value = await readCreationWorkspace(params._creationTurn.workspaceId);
            if (value.spaceId !== params._creationTurn.spaceId) throw new Error('作品不属于当前空间');
            const sources = await creationProductSources(value.id);
            return { success: true, llmContent: JSON.stringify({ platform: value.platform, capability: value.capability, draft: value.draft, revision: value.revision, selectedId: params._creationTurn.selectedId, sources }), display: '已读取最新创作内容与素材' };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
export class CreationEditTool extends DeclarativeTool<typeof Edit> {
    readonly name = 'creation_edit'; readonly displayName = '保存当前创作草稿'; readonly kind = ToolKind.Edit; readonly parameterSchema = Edit;
    readonly description = 'Save a reversible complete draft to the runtime-bound workspace. Preserve fields the user did not ask to change. Ordinary text, pages and scenes update the editor and local preview immediately. You may leave incomplete fields blank and ask for missing product/source choices. Never claim media was generated; media generation and publication are separate confirmed workbench actions.';
    getDescription() { return this.displayName; }
    async execute(params: z.infer<typeof Edit>): Promise<ToolResult> {
        try { if (!params._creationTurn) throw new Error('缺少当前作品绑定'); const workspace = await saveCreationWorkspace({ ...params._creationTurn, draft: params.draft, origin: 'ai' });
            return { success: true, llmContent: JSON.stringify({ revision: workspace.revision, summary: '作品编辑与预览已同步，可撤销' }), display: '作品编辑与预览已同步，可撤销', data: { workspace } };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
export class CreationUndoTool extends DeclarativeTool<typeof Read> {
    readonly name = 'creation_undo'; readonly displayName = '撤销创作修改'; readonly kind = ToolKind.Edit; readonly parameterSchema = Read;
    readonly description = 'Undo the latest saved edit in the current verified creation workspace. Never generate media or publish.';
    getDescription() { return this.displayName; }
    async execute(params: z.infer<typeof Read>): Promise<ToolResult> {
        try { if (!params._creationTurn) throw new Error('缺少当前作品绑定'); const workspace = await undoCreationWorkspace(params._creationTurn);
            return { success: true, llmContent: '已撤销上一处创作修改', display: '已撤销', data: { workspace } };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
