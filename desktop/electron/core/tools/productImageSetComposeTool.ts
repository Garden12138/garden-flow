import { ProductImageSetProposalSchema, type ProductImageSetProposal } from '../../../shared/productImageSet';
import { createProductImageSet } from '../productImageSetService';
import { DeclarativeTool, ToolKind, ToolErrorType, createErrorResult, type ToolResult, type ToolConfirmationDetails } from '../toolRegistry';

export class ProductImageSetComposeTool extends DeclarativeTool<typeof ProductImageSetProposalSchema> {
    readonly name = 'product_image_set_compose';
    readonly displayName = 'Compose Product Image Set';
    readonly description = 'Submit a product-owned image-set plan for durable user review. After explicit approval, create an editable XHS redpost with copied product images. No paid image, video or audio generation is submitted.';
    readonly kind = ToolKind.Execute;
    readonly parameterSchema = ProductImageSetProposalSchema;
    readonly requiresConfirmation = true;

    getDescription(params: ProductImageSetProposal): string { return `确认 ${params.productName} 的 ${params.pages.length} 张商品套图方案`; }

    getConfirmationDetails(params: ProductImageSetProposal): ToolConfirmationDetails {
        return { type: 'info', title: `确认商品套图 · ${params.productName}`,
            description: [`${params.pages.length} 张（含封面） · 3:4 · 1440×1920 PNG`, ...params.pages.map((page, index) => `${index + 1}. ${page.title} · ${page.layout}\n${page.copy}`)].join('\n\n'),
            impact: '确认后会复制商品图片并创建可编辑图文工程。默认使用原图排版，图片、视频及语音生成任务均为 0；AI 画面可稍后按页确认生成。', requiresUserAcknowledgement: true };
    }

    async execute(params: ProductImageSetProposal, signal: AbortSignal): Promise<ToolResult> {
        try {
            signal.throwIfAborted();
            const snapshot = await createProductImageSet(params);
            return { success: true, llmContent: `商品套图工程已创建：[打开商品套图](${snapshot.uri})`, display: '商品套图工程已创建',
                data: { kind: 'xiaohongshu-note-project', action: 'note-save', projectId: snapshot.relativePath, projectPath: snapshot.projectPath,
                    relativePath: snapshot.relativePath, uri: snapshot.uri, title: snapshot.document.finalTitle, noteType: 'image', status: 'draft', proposalId: params.proposalId } };
        } catch (error) {
            return { ...createErrorResult(error instanceof Error ? error.message : String(error), ToolErrorType.EXECUTION_FAILED), data: { code: (error as { code?: string })?.code } };
        }
    }
}
