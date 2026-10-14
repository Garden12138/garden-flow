import { z } from 'zod';
import { ProductProjectEditorBindingSchema, ProductProjectEditOperationSchema } from '../../../shared/productProjectEditor';
import { DeclarativeTool, ToolKind, type ToolResult, createErrorResult, ToolErrorType } from '../toolRegistry';
import { validateProductEditorBinding, applyProductProjectEdit, undoProductProjectEdit } from '../productProjectEditorService';

const TurnSchema = z.object({ binding: ProductProjectEditorBindingSchema, requestId: z.string().min(1), expectedRevision: z.string().min(1), expectedDraftEpoch: z.number().int().nonnegative() }).strict();
const ReadSchema = z.object({ _editorTurn: TurnSchema.optional() }).strict();
const EditSchema = ReadSchema.extend({ operations: z.array(ProductProjectEditOperationSchema).min(1).max(80) }).strict();

function modelSnapshot(snapshot: Awaited<ReturnType<typeof validateProductEditorBinding>>): unknown {
    const video = snapshot.video;
    const set = snapshot.imageSet?.document.productImageSet;
    return { binding: snapshot.binding, revision: snapshot.revision, draftEpoch: snapshot.draftEpoch, dirty: snapshot.dirty, undoCount: snapshot.undoCount,
        publicationCopy: snapshot.publicationCopy,
        scenes: video?.productVideo?.scenes.map(scene => ({ id: scene.id, title: scene.title, source: scene.source, overlayText: scene.overlayText,
            narrationText: scene.narrationText, durationMs: scene.durationMs, fitMode: scene.fitMode, motionPreset: scene.motionPreset,
            sourceStartMs: scene.sourceStartMs, sourceEndMs: scene.sourceEndMs, sourceVolume: scene.sourceVolume, voiceoverStatus: scene.voiceoverStatus,
            voiceoverAssetId: scene.voiceoverAssetId, assetId: video.timeline.tracks.find(track => track.kind === 'primary-video')?.clips.find(clip => clip.sceneId === scene.id)?.assetId })),
        assets: video ? video.assets.map(asset => ({ id: asset.id, kind: asset.kind, durationMs: asset.durationMs, hasAudio: asset.probe?.hasAudio, provenance: asset.provenance })) : set?.assets.map(asset => ({ id: asset.id, kind: asset.kind })),
        audioTracks: video?.timeline.tracks.filter(track => ['music', 'voiceover'].includes(track.kind)).map(track => ({ kind: track.kind,
            clips: track.clips.map(clip => ({ sceneId: clip.sceneId, assetId: clip.assetId, volume: clip.volume })) })),
        style: set?.style, pages: set?.pages.map(({ render, generation, aiPrompt, ...page }) => page) };
}
function modelReceipt(data: Awaited<ReturnType<typeof applyProductProjectEdit>>): string {
    const receipt = { requestId: data.requestId, revision: data.revision, draftEpoch: data.draftEpoch,
        undoCount: data.undoCount, summary: data.summary.slice(0, 30).map(item => item.slice(0, 160)), summaryCount: data.summary.length,
        expiredOutputIds: data.expiredOutputIds.slice(0, 20), expiredOutputCount: data.expiredOutputIds.length,
        staleVoiceSceneIds: data.staleVoiceSceneIds, reused: data.reused };
    // Keep a complete JSON receipt within the runtime budget, even for long atomic batches.
    // The complete saved result and change summary remain available to the workbench in data.
    while (JSON.stringify(receipt).length > 4500 && receipt.summary.length > 1) receipt.summary.pop();
    while (JSON.stringify(receipt).length > 4500 && receipt.expiredOutputIds.length) receipt.expiredOutputIds.pop();
    return JSON.stringify(receipt);
}

export class ProductProjectReadTool extends DeclarativeTool<typeof ReadSchema> {
    readonly name = 'product_project_read';
    readonly displayName = '读取当前商品工程';
    readonly description = 'Read the latest bound product project, owned material IDs, selected scene/page and formal publication copy. The runtime supplies the immutable editor binding; never supply another project.';
    readonly kind = ToolKind.Read;
    readonly parameterSchema = ReadSchema;
    getDescription(): string { return this.displayName; }
    async execute(params: z.infer<typeof ReadSchema>): Promise<ToolResult> {
        try {
            if (!params._editorTurn) throw new Error('缺少主进程验证的编辑绑定');
            const data = await validateProductEditorBinding(params._editorTurn.binding);
            return { success: true, llmContent: JSON.stringify(modelSnapshot(data)), display: '已读取当前工程、素材及发布文案', data };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
export class ProductProjectEditTool extends DeclarativeTool<typeof EditSchema> {
    readonly name = 'product_project_edit';
    readonly displayName = '修改当前商品工程';
    readonly description = 'Apply one atomic, reversible batch to the bound product project. Use existing scene/page/material IDs from product_project_read. No creation, media generation, platform switching, settings or file writes. Runtime supplies the send-time revision and request ID; a stale request fails and must be retried by the user.';
    readonly kind = ToolKind.Edit;
    readonly parameterSchema = EditSchema;
    getDescription(): string { return this.displayName; }
    async execute(params: z.infer<typeof EditSchema>): Promise<ToolResult> {
        try {
            if (!params._editorTurn) throw new Error('缺少主进程验证的编辑绑定');
            const data = await applyProductProjectEdit({ ...params._editorTurn, operations: params.operations });
            const display = data.summary.join('；') + (data.staleVoiceSceneIds.length ? '；旁白已过期，请重新生成或移除后导出' : '');
            return { success: true, llmContent: modelReceipt(data), display, data };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
export class ProductProjectUndoTool extends DeclarativeTool<typeof ReadSchema> {
    readonly name = 'product_project_undo';
    readonly displayName = '撤销当前商品工程修改';
    readonly description = 'Undo the latest editable change in the bound project, preserving generated assets, media requests and publication history. This creates a new saved revision.';
    readonly kind = ToolKind.Edit;
    readonly parameterSchema = ReadSchema;
    getDescription(): string { return this.displayName; }
    async execute(params: z.infer<typeof ReadSchema>): Promise<ToolResult> {
        try {
            if (!params._editorTurn) throw new Error('缺少主进程验证的编辑绑定');
            const data = await undoProductProjectEdit(params._editorTurn);
            return { success: true, llmContent: modelReceipt(data), display: data.summary.join('；'), data };
        } catch (error) { return createErrorResult(String(error), ToolErrorType.EXECUTION_FAILED); }
    }
}
