import { z } from 'zod';
import { DeclarativeTool, ToolKind, ToolErrorType, createErrorResult, type ToolResult } from '../toolRegistry';
import { prepareXhsPublication } from '../xhsPublishPreparation';

const XhsPublishPrepareSchema = z.object({
    operation: z.enum(['inspect', 'prepare']),
    projectId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
    assetId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
    notePath: z.string().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    body: z.string().trim().min(1).optional(),
    hashtags: z.array(z.string()).max(30).optional(),
}).strict().refine((input) => [input.projectId, input.assetId, input.notePath].filter(Boolean).length <= 1, '只选择一个发布来源');

export class XhsPublishPrepareTool extends DeclarativeTool<typeof XhsPublishPrepareSchema> {
    readonly name = 'xhs_publish_prepare';
    readonly displayName = 'Prepare Xiaohongshu Publication';
    readonly description = 'inspect resolves the current session video, latest exported asset and trusted product facts. prepare updates the structured note and confirmation, and amends a verified owned browser draft in place while retaining uploaded media. Preserve fields not requested to change. Title must be at most 20 UTF-16 characters. Correct TITLE_TOO_LONG and retry. Never generates video or submits publication. Users may explicitly request publication of the current version in conversation; runtime handles authorization, review and submission. Multiple candidates require an explicit choice.';
    readonly kind = ToolKind.Other;
    readonly parameterSchema = XhsPublishPrepareSchema;
    constructor(private readonly getSessionId: () => string) { super(); }
    getDescription(): string { return '准备已有视频的小红书发布确认'; }
    async execute(params: z.infer<typeof XhsPublishPrepareSchema>, signal: AbortSignal): Promise<ToolResult> {
        if (signal.aborted) return createErrorResult('已取消准备发布', ToolErrorType.CANCELLED);
        try {
            const { readXhsVideoPublishSource } = await import('../xhsVideoPublishSource');
            const { getXhsNoteProject, saveXhsNoteProject, bindXhsNoteMedia } = await import('../xhsNoteProjectStore');
            const { getXhsPublisherService } = await import('../xhsPublisherService');
            const result = await prepareXhsPublication(this.getSessionId(), params, {
                readSource: readXhsVideoPublishSource,
                getNote: getXhsNoteProject,
                saveNote: saveXhsNoteProject,
                bindMedia: bindXhsNoteMedia,
                requestConsent: (sessionId, notePath) => getXhsPublisherService().requestPublication(sessionId, notePath, 'explicit-request'),
            });
            if (result.kind === 'xhs-publish-source') return { success: true, llmContent: JSON.stringify(result), data: result };
            const pageUpdate = await getXhsPublisherService().refreshPreparedDraft(result.job);
            const publicationState = result.job.publishStatus === 'published' ? '该版本已有发布成功记录，不会重复发布。'
                : result.job.publishStatus === 'unknown' || result.job.publishStatus === 'submitted' ? '该版本已尝试提交但结果未核实，不代表未发布。请先检查笔记管理，并在对话中告知核实结果。'
                    : '当前版本尚未提交。可继续在对话修改，或明确要求“重新发布当前版本”；确认卡按钮也可使用。';
            return {
                success: true,
                llmContent: `已准备第 ${result.note.version} 版小红书稿件，标题：${result.note.document.finalTitle}。[打开稿件](${result.note.uri})。${publicationState}${pageUpdate || ''}${result.job.status === 'blocked' || result.job.status === 'submit_result_unknown' ? ` ${result.job.errorMessage}` : ''}`,
                data: { kind: result.kind, jobId: result.job.id, status: result.job.status, publishStatus: result.job.publishStatus, projectPath: result.note.projectPath, uri: result.note.uri },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && 'code' in error && error.code === 'TITLE_TOO_LONG') {
                return { ...createErrorResult(`${message}。请修正 title 参数并重新调用 prepare，不要截断用户已确认的文案。`, ToolErrorType.INVALID_PARAMS), data: { kind: 'xhs-publish-validation-error', code: 'TITLE_TOO_LONG', reason: message } };
            }
            return { ...createErrorResult(message, ToolErrorType.EXECUTION_FAILED), data: { kind: 'xhs-publish-blocked', reason: message } };
        }
    }
}
